// V2 is isolated from production routes, styles, auth and background effects.
// The build removes this branch entirely when building for production.
const previewPath = window.location.pathname === "/__v2-preview" ||
  window.location.pathname.startsWith("/__v2-preview/");

async function boot() {
  if (__QCLUB_ADMIN_PREVIEW__ && window.location.pathname === "/__checkout-preview") {
    await import("./checkout-preview/entry.jsx");
    return;
  }
  // Dedicated preview entry: no production App effects, cloud sync or PIN cache.
  if (__QCLUB_ADMIN_PREVIEW__ && window.location.pathname === "/__admin-preview") {
    await import("./admin-preview/entry.jsx");
    return;
  }
  if (__QCLUB_V2_PREVIEW__ && previewPath) {
    await import("./v2-preview/entry.jsx");
    return;
  }
  await import("./production-entry.jsx");
}
boot();
