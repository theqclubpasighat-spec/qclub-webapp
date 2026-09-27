// No browser query, localStorage value or VITE_* variable can enable this in production.
export function allowV2Preview(env = process.env, command = "build") {
  if (env.VERCEL_ENV === "production") return false;
  return env.VERCEL_ENV === "preview" ||
    (command === "serve" && env.QCLUB_LOCAL_V2_PREVIEW === "1");
}
