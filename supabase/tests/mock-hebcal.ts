import { createServer } from 'node:http';
import { calendarResponse } from '../../src/domain/providers/fixtures/hebcal-recorded';

let mode: 'ok' | 'fail' | 'invalid' = 'ok';
const port = Number(process.env.MOCK_HEBCAL_PORT ?? 8765);

function eachDate(start: string, end: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${start}T12:00:00.000Z`);
  const last = new Date(`${end}T12:00:00.000Z`);
  while (current <= last) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${port}`);
  if (url.pathname === '/_mode' && request.method === 'POST') {
    const chunks: Uint8Array[] = [];
    request.on('data', (chunk: Uint8Array) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      mode = body === 'fail' || body === 'invalid' ? body : 'ok';
      response.writeHead(204).end();
    });
    return;
  }
  if (mode === 'fail') {
    response.writeHead(503, { 'content-type': 'application/json' }).end('{"error":"offline"}');
    return;
  }
  const start = url.searchParams.get('start') ?? '2026-09-01';
  const end = url.searchParams.get('end') ?? start;
  if (url.pathname === '/hebcal') {
    const items =
      mode === 'invalid'
        ? 'invalid'
        : calendarResponse.items.filter((item) => {
            const date = item.date.slice(0, 10);
            return date >= start && date <= end;
          });
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ items }));
    return;
  }
  if (url.pathname === '/zmanim') {
    const items = eachDate(start, end).map((date) => ({
      date,
      times: {
        alotHaShachar: `${date}T05:30:00+02:00`,
        misheyakir: `${date}T06:00:00+02:00`,
        sunrise: `${date}T07:30:00+02:00`,
        chatzot: `${date}T13:00:00+02:00`,
        sunset: `${date}T19:00:00+02:00`,
        tzeit85deg: `${date}T19:35:00+02:00`,
      },
    }));
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ items }));
    return;
  }
  response.writeHead(404).end();
});

server.listen(port, '0.0.0.0');

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
