import { z } from 'zod';
import {
  consumeRateLimit,
  errorResponse,
  handleCors,
  HttpError,
  jsonResponse,
  requestJson,
  serviceClient,
  sha256Hex,
} from '../_shared/backend.ts';

const PairRequest = z.object({
  code: z.string().trim().min(8).max(32),
  deviceName: z.string().trim().min(1).max(100),
});

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

Deno.serve(async (request) => {
  const cors = handleCors(request);
  if (cors) return cors;
  try {
    if (request.method !== 'POST') throw new HttpError('method_not_allowed', 405);
    const client = serviceClient();
    const ip = (request.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
    const ipHash = await sha256Hex(ip || 'unknown');
    if (!(await consumeRateLimit(client, `pair:${ipHash}`, 5, 600))) {
      throw new HttpError('rate_limited', 429);
    }
    const parsed = PairRequest.safeParse(await requestJson(request));
    if (!parsed.success) throw new HttpError('invalid_request', 400);
    const codeHash = await sha256Hex(parsed.data.code.toUpperCase());
    const token = randomToken();
    const tokenHash = await sha256Hex(token);
    const { data: deviceId, error } = await client.rpc('consume_device_pairing', {
      p_code_hash: codeHash,
      p_token_hash: tokenHash,
    });
    if (error) throw new HttpError('pairing_unavailable', 503);
    if (typeof deviceId !== 'string') throw new HttpError('pairing_invalid', 401);
    return jsonResponse(request, { deviceId, token });
  } catch (error) {
    return errorResponse(request, error);
  }
});
