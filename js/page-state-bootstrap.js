// Runs before first paint so returning pages can restore off-screen without a visible jump.
try {
  const key = `tbtoolkit.page-view.v1:${location.pathname}`;
  const state = JSON.parse(sessionStorage.getItem(key) || 'null');
  if (!location.hash && Number.isFinite(state?.scrollY)) {
    const root = document.documentElement;
    const release = () => {
      root.classList.remove('is-restoring-page');
      root.style.removeProperty('visibility');
      root.style.removeProperty('min-height');
      root.style.removeProperty('scroll-behavior');
    };
    root.classList.add('is-restoring-page');
    root.style.setProperty('visibility', 'hidden', 'important');
    root.style.setProperty('scroll-behavior', 'auto', 'important');
    root.style.setProperty('min-height', `${state.scrollY + innerHeight}px`);
    scrollTo(0, state.scrollY);
    setTimeout(release, 1500);
  }
} catch {
  // Storage can be unavailable in private or restricted browser contexts.
}
