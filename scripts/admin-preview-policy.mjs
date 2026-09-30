export function allowAdminPreview(env = process.env, command = 'build') {
  if (env.VERCEL_ENV === 'production') return false;
  return env.QCLUB_SECURITY_REHEARSAL === 'enabled' &&
    (env.VERCEL_ENV === 'preview' || command === 'serve');
}
