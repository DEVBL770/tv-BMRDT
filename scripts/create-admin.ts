import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.ADMIN_EMAIL?.trim();
const password = process.env.ADMIN_PASSWORD;

if (!url || !serviceRoleKey || !email || !password) {
  throw new Error(
    'SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL et ADMIN_PASSWORD sont requis.',
  );
}

const client = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: existingAdmin, error: lookupError } = await client
  .from('app_admin')
  .select('user_id')
  .eq('id', true)
  .maybeSingle();

if (lookupError) throw new Error('Impossible de vérifier le compte administrateur existant.');
if (existingAdmin) throw new Error('Un compte administrateur existe déjà.');

const { data, error: createError } = await client.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});

if (createError || !data.user) throw new Error('La création du compte administrateur a échoué.');

const { error: insertError } = await client.from('app_admin').insert({
  id: true,
  user_id: data.user.id,
});

if (insertError) {
  await client.auth.admin.deleteUser(data.user.id);
  throw new Error('L’enregistrement du compte administrateur a échoué.');
}

console.info(`Compte administrateur créé : ${email}`);
