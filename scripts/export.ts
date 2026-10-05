import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

if (!url || !anonKey || !email || !password) {
  throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_EMAIL et ADMIN_PASSWORD sont requis.');
}

const client = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: login, error: loginError } = await client.auth.signInWithPassword({
  email,
  password,
});
if (loginError || !login.session) throw new Error('Connexion administrateur impossible.');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = join(process.cwd(), 'exports', timestamp);
await mkdir(join(output, 'media'), { recursive: true });

const response = await fetch(`${url.replace(/\/$/, '')}/functions/v1/admin`, {
  method: 'POST',
  headers: {
    apikey: anonKey,
    authorization: `Bearer ${login.session.access_token}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ action: 'export' }),
});
if (!response.ok) throw new Error('L’export des données a échoué.');
const exported = (await response.json()) as {
  mediaPaths?: Array<{ id: string; bucket: string; storage_path: string; mime: string }>;
};
await writeFile(join(output, 'export.json'), JSON.stringify(exported, null, 2));

for (const item of exported.mediaPaths ?? []) {
  const { data, error } = await client.storage.from(item.bucket).download(item.storage_path);
  if (error || !data) throw new Error(`Téléchargement du média ${item.id} impossible.`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  await writeFile(join(output, 'media', `${item.id}.${item.mime.split('/')[1]}`), bytes);
}

await client.auth.signOut();
console.info(`Export enregistré dans ${output}`);
