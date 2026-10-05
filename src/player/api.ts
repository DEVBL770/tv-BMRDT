import { z } from 'zod';
import { supabase } from '../lib/supabase';
import type { PackageBundle, PlayerWeather } from './store';

export type PairingResult = {
  deviceId: string;
  token: string;
};

export type SyncRequest = {
  knownVersion: number | null;
  displayedVersion: number | null;
  clientTime: string;
  build: string;
  cacheStatus: string;
  lastError: string | null;
};

export type SyncResponse = {
  serverTime: string;
  clockSkewSeconds: number | null;
  current: { number: number; hash: string } | null;
};

export class PlayerApiError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
  ) {
    super(code);
  }
}

const SyncResponseSchema = z.object({
  serverTime: z.string(),
  clockSkewSeconds: z.number().nullable().optional(),
  current: z
    .object({
      number: z.number().int().positive(),
      hash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .nullable(),
});

const PairingResultSchema = z.object({
  deviceId: z.uuid(),
  token: z.string().min(40),
});

const WeatherSchema = z.object({
  temperatureC: z.number().nullable(),
  symbol: z.string().nullable(),
  updatedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  attribution: z.string(),
});

function statusFromError(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  if ('status' in error && typeof error.status === 'number') return error.status;
  if ('context' in error && error.context instanceof Response) return error.context.status;
  return undefined;
}

async function invoke<T>(
  functionName: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<T> {
  if (!supabase) throw new PlayerApiError('supabase_unconfigured');
  const { data, error } = await supabase.functions.invoke<T>(functionName, {
    body,
    headers,
  });
  if (error) {
    const status = statusFromError(error);
    throw new PlayerApiError(status === 401 ? 'unauthorized' : 'function_request_failed', status);
  }
  if (data === null) throw new PlayerApiError('empty_response');
  return data;
}

export async function pairDevice(code: string, deviceName: string): Promise<PairingResult> {
  const result = PairingResultSchema.safeParse(await invoke('pair', { code, deviceName }));
  if (!result.success) throw new PlayerApiError('invalid_pairing_response');
  return result.data;
}

export async function syncDevice(token: string, request: SyncRequest): Promise<SyncResponse> {
  const result = SyncResponseSchema.safeParse(
    await invoke('player', { action: 'sync', ...request }, { 'x-device-token': token }),
  );
  if (!result.success) throw new PlayerApiError('invalid_sync_response');
  return {
    ...result.data,
    clockSkewSeconds: result.data.clockSkewSeconds ?? null,
  };
}

export async function fetchPackage(number: number, token: string): Promise<PackageBundle> {
  return invoke<PackageBundle>(
    'player',
    { action: 'package', number },
    { 'x-device-token': token },
  );
}

export async function downloadMedia(url: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new PlayerApiError('media_download_failed');
  }
  if (!response.ok) throw new PlayerApiError('media_download_failed', response.status);
  return response.blob();
}

export async function fetchWeather(token: string): Promise<PlayerWeather> {
  const result = WeatherSchema.safeParse(await invoke('weather', {}, { 'x-device-token': token }));
  if (!result.success || !result.data.updatedAt || !result.data.expiresAt) {
    throw new PlayerApiError('invalid_weather_response');
  }
  return {
    temperatureC: result.data.temperatureC,
    symbol: result.data.symbol,
    updatedAt: result.data.updatedAt,
    expiresAt: result.data.expiresAt,
    attribution: result.data.attribution,
  };
}
