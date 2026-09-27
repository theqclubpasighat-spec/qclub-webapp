// V2 is isolated from production routes, styles, auth and background effects.
// The build removes this branch entirely when building for production.
const previewPath = window.location.pathname === "/__v2-preview" ||
  window.location.pathname.startsWith("/__v2-preview/");

if (__QCLUB_V2_PREVIEW__ && previewPath) {
  import("./v2-preview/entry.jsx");
} else {
  import("./production-entry.jsx");
}
