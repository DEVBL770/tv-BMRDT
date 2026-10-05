import { createClient } from '@supabase/supabase-js';

export type BackendClient = ReturnType<typeof createClient>;

export class HttpError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
  }
}

function allowedOrigins(): string[] {
  return (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-device-token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  });
  const origin = request.headers.get('origin');
  if (origin && allowedOrigins().includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  return headers;
}

export function handleCors(request: Request): Response | null {
  const origin = request.headers.get('origin');
  if (origin && !allowedOrigins().includes(origin)) {
    return jsonResponse(request, { error: 'origin_not_allowed' }, 403);
  }
  if (request.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders(request) });
  }
  return null;
}

export function jsonResponse(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  const headers = corsHeaders(request);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(request: Request, error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonResponse(request, { error: error.code, ...(error.details ?? {}) }, error.status);
  }
  return jsonResponse(request, { error: 'internal_error' }, 500);
}

export async function requestJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError('invalid_request', 400);
  }
}

export function serviceClient(): BackendClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new HttpError('service_unavailable', 503);
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function bearerToken(request: Request): string | undefined {
  const header = request.headers.get('authorization');
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

export async function requireAdmin(request: Request): Promise<{ id: string; email?: string }> {
  const token = bearerToken(request);
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_ANON_KEY');
  if (!token || !url || !key) throw new HttpError('unauthorized', 401);
  const caller = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await caller.auth.getUser(token);
  if (userError || !userData.user) throw new HttpError('unauthorized', 401);
  const { data: isAdmin, error } = await caller.rpc('is_admin');
  if (error) throw new HttpError('authorization_unavailable', 503);
  if (isAdmin !== true) throw new HttpError('forbidden', 403);
  return { id: userData.user.id, ...(userData.user.email ? { email: userData.user.email } : {}) };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function consumeRateLimit(
  client: BackendClient,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const start = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { data, error } = await client.rpc('consume_rate_limit', {
    p_key: key,
    p_window_start: start,
    p_limit: limit,
  });
  if (error) throw new HttpError('rate_limit_unavailable', 503);
  return data === true;
}

export async function authenticateDevice(
  request: Request,
  client: BackendClient,
): Promise<{ id: string; last_seen: string | null } | null> {
  const token = request.headers.get('x-device-token');
  if (!token || token.length > 256) return null;
  const tokenHash = await sha256Hex(token);
  const { data, error } = await client
    .from('devices')
    .select('id,last_seen,revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error) throw new HttpError('device_auth_unavailable', 503);
  if (!data || data.revoked_at) return null;
  return { id: data.id, last_seen: data.last_seen };
}

export function runInBackground(promise: Promise<unknown>): void {
  const runtime = (
    globalThis as typeof globalThis & {
      EdgeRuntime?: { waitUntil: (task: Promise<unknown>) => void };
    }
  ).EdgeRuntime;
  if (runtime) runtime.waitUntil(promise);
  else void promise.catch(() => undefined);
}
