// Run only against an isolated rehearsal database. Never prints PINs or hashes.
import { createClient } from '@supabase/supabase-js';
import { hashPin, rehearsalConfig, validPin } from '../src/server/security/foundation.js';

async function main() {
  const { url, key } = rehearsalConfig(process.env);
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.from('qclub_state').select('state').eq('key', 'main').single();
  if (error || !data) throw new Error('SOURCE_UNAVAILABLE');
  const admin = data.state?.admin;
  const values = { main: admin?.mainPin || admin?.pin, staff: admin?.staffPin, committee: admin?.committeePin };
  if (Object.values(values).some(pin => !validPin(pin))) throw new Error('SOURCE_PIN_VALIDATION_FAILED');
  if (new Set(Object.values(values)).size !== 3) throw new Error('DUPLICATE_ROLE_PINS');
  const { data: existing, error: readError } = await db.rpc('qclub_security_credentials');
  if (readError || !Array.isArray(existing)) throw new Error('PRIVATE_STORE_UNAVAILABLE');
  const missing = Object.entries(values).filter(([id]) => !existing.some(row => row.credential_id === id));
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ dryRun: true, newCredentials: missing.length, existingCredentials: existing.length }));
    return;
  }
  // Each import is atomic and insert-only. A retry skips already imported rows.
  for (const [id, pin] of missing) {
    const pin_hash = await hashPin(pin);
    const result = await db.rpc('qclub_security_import_credential', { p_credential_id: id, p_pin_hash: pin_hash });
    if (result.error) throw new Error('CREDENTIAL_IMPORT_FAILED');
  }
  console.log(JSON.stringify({ imported: missing.length, sourceUnchanged: true }));
}
main().catch(() => { console.error('Credential rehearsal failed. No secrets were logged; inspect configuration and database access.'); process.exitCode = 1; });
