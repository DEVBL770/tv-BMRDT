import { z } from 'zod';
import {
  authenticateDevice,
  errorResponse,
  handleCors,
  HttpError,
  jsonResponse,
  requireAdmin,
  serviceClient,
} from '../_shared/backend.ts';

const WeatherCacheSchema = z.object({
  temperature_c: z.number().nullable(),
  symbol: z.string().nullable(),
  updated_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  last_modified: z.string().nullable(),
  attribution: z.string(),
});

function normalizedWeather(cache: z.infer<typeof WeatherCacheSchema>) {
  return {
    temperatureC: cache.temperature_c,
    symbol: cache.symbol,
    updatedAt: cache.updated_at,
    expiresAt: cache.expires_at,
    attribution: cache.attribution,
  };
}

function expiryFromResponse(response: Response, now: Date): string {
  const expires = response.headers.get('expires');
  if (expires) {
    const date = new Date(expires);
    if (!Number.isNaN(date.valueOf())) return date.toISOString();
  }
  const maxAge = /max-age=(\d+)/i.exec(response.headers.get('cache-control') ?? '');
  return new Date(now.getTime() + Number(maxAge?.[1] ?? 3600) * 1000).toISOString();
}

function metValues(value: unknown): { temperature: number; symbol: string } {
  if (typeof value !== 'object' || value === null) throw new HttpError('weather_invalid', 502);
  const properties = (value as Record<string, unknown>).properties;
  if (typeof properties !== 'object' || properties === null) {
    throw new HttpError('weather_invalid', 502);
  }
  const timeseries = (properties as Record<string, unknown>).timeseries;
  if (!Array.isArray(timeseries) || timeseries.length === 0) {
    throw new HttpError('weather_invalid', 502);
  }
  const first = timeseries[0] as Record<string, unknown>;
  const data = first.data as Record<string, unknown> | undefined;
  const instant = data?.instant as Record<string, unknown> | undefined;
  const details = instant?.details as Record<string, unknown> | undefined;
  const temperature = details?.air_temperature;
  const next = (data?.next_1_hours ?? data?.next_6_hours ?? data?.next_12_hours) as
    | Record<string, unknown>
    | undefined;
  const summary = next?.summary as Record<string, unknown> | undefined;
  const symbol = summary?.symbol_code;
  if (typeof temperature !== 'number' || typeof symbol !== 'string') {
    throw new HttpError('weather_invalid', 502);
  }
  return { temperature, symbol };
}

async function authorize(
  request: Request,
  client: ReturnType<typeof serviceClient>,
): Promise<void> {
  if (request.headers.has('x-device-token')) {
    if (!(await authenticateDevice(request, client))) throw new HttpError('unauthorized', 401);
    return;
  }
  await requireAdmin(request);
}

Deno.serve(async (request) => {
  const cors = handleCors(request);
  if (cors) return cors;
  try {
    if (request.method !== 'GET' && request.method !== 'POST') {
      throw new HttpError('method_not_allowed', 405);
    }
    const client = serviceClient();
    await authorize(request, client);
    const { data: cachedData, error: cacheError } = await client
      .from('weather_cache')
      .select('temperature_c,symbol,updated_at,expires_at,last_modified,attribution')
      .eq('id', true)
      .maybeSingle();
    if (cacheError) throw new HttpError('weather_unavailable', 503);
    const cached = cachedData ? WeatherCacheSchema.parse(cachedData) : null;
    if (cached?.expires_at && Date.parse(cached.expires_at) > Date.now()) {
      return jsonResponse(request, normalizedWeather(cached));
    }

    const userAgent = Deno.env.get('MET_USER_AGENT')?.trim();
    if (!userAgent) throw new HttpError('weather_unconfigured', 503);
    const { data: settings, error: settingsError } = await client
      .from('settings')
      .select('latitude,longitude')
      .eq('id', true)
      .maybeSingle();
    if (settingsError || !settings) throw new HttpError('weather_unavailable', 503);
    const lat = Number(settings.latitude).toFixed(4);
    const lon = Number(settings.longitude).toFixed(4);
    const headers = new Headers({ 'User-Agent': userAgent, Accept: 'application/json' });
    if (cached?.last_modified) headers.set('If-Modified-Since', cached.last_modified);
    let response: Response;
    try {
      response = await fetch(
        `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`,
        { headers },
      );
    } catch {
      throw new HttpError('weather_unavailable', 502);
    }
    const now = new Date();
    const expiresAt = expiryFromResponse(response, now);
    let temperature = cached?.temperature_c ?? null;
    let symbol = cached?.symbol ?? null;
    let updatedAt = cached?.updated_at ?? null;
    let lastModified = cached?.last_modified ?? null;
    if (response.status === 304) {
      if (temperature === null || !symbol || !updatedAt) {
        throw new HttpError('weather_invalid', 502);
      }
      lastModified = response.headers.get('last-modified') ?? lastModified;
    } else {
      if (!response.ok) throw new HttpError('weather_unavailable', 502);
      const values = metValues(await response.json());
      temperature = values.temperature;
      symbol = values.symbol;
      updatedAt = now.toISOString();
      lastModified = response.headers.get('last-modified') ?? lastModified;
    }
    const row = {
      id: true,
      temperature_c: temperature,
      symbol,
      updated_at: updatedAt,
      expires_at: expiresAt,
      last_modified: lastModified,
      attribution: 'Météo : MET Norway',
      payload: {},
    };
    const { error: upsertError } = await client
      .from('weather_cache')
      .upsert(row, { onConflict: 'id' });
    if (upsertError) throw new HttpError('weather_unavailable', 503);
    const { error: healthError } = await client.from('source_health').upsert(
      {
        source: 'met-locationforecast',
        last_success_at: now.toISOString(),
        last_error_code: null,
        last_error_at: null,
        updated_at: now.toISOString(),
      },
      { onConflict: 'source' },
    );
    if (healthError) throw new HttpError('weather_unavailable', 503);
    return jsonResponse(
      request,
      normalizedWeather({
        temperature_c: temperature,
        symbol,
        updated_at: updatedAt,
        expires_at: expiresAt,
        last_modified: lastModified,
        attribution: row.attribution,
      }),
    );
  } catch (error) {
    if (
      error instanceof HttpError &&
      (error.code === 'weather_unavailable' ||
        error.code === 'weather_invalid' ||
        error.code === 'weather_unconfigured')
    ) {
      const client = serviceClient();
      const now = new Date().toISOString();
      await client.from('source_health').upsert(
        {
          source: 'met-locationforecast',
          last_failure_at: now,
          last_error_code:
            error.code === 'weather_invalid'
              ? 'invalid_response'
              : error.code === 'weather_unconfigured'
                ? 'configuration_missing'
                : 'upstream_unavailable',
          last_error_at: now,
          updated_at: now,
        },
        { onConflict: 'source' },
      );
    }
    return errorResponse(request, error);
  }
});
