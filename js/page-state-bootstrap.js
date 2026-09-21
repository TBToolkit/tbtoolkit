// Runs before first paint so returning pages can restore off-screen without a visible jump.
try {
  const key = `tbtoolkit.page-view.v1:${location.pathname}`;
  const state = JSON.parse(sessionStorage.getItem(key) || 'null');
  if (Number.isFinite(state?.scrollY)) {
    document.documentElement.classList.add('is-restoring-page');
    setTimeout(() => document.documentElement.classList.remove('is-restoring-page'), 1500);
  }
} catch {
  // Storage can be unavailable in private or restricted browser contexts.
}
