// Rehearsal-only endpoint. Existing production handlers are deliberately unchanged.
import { createClient } from '@supabase/supabase-js';
import { createSecurityHandler } from '../src/server/security/handler.js';
export default createSecurityHandler({
  env: process.env,
  createDatabase: ({ url, key }) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
});
