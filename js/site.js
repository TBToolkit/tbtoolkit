const menuToggle = document.querySelector('[data-menu-toggle]');
const nav = document.querySelector('[data-nav]');

if (menuToggle && nav) {
  const setMenu = (open) => {
    nav.classList.toggle('is-open', open);
    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  };

  menuToggle.addEventListener('click', () => {
    setMenu(!nav.classList.contains('is-open'));
  });

  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => setMenu(false));
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setMenu(false);
  });

  document.addEventListener('click', (event) => {
    if (!nav.classList.contains('is-open')) return;
    if (!nav.contains(event.target) && !menuToggle.contains(event.target)) setMenu(false);
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 920) setMenu(false);
  });
}

document.querySelectorAll('[data-year]').forEach((el) => {
  el.textContent = new Date().getFullYear();
});

// Keep each page exactly where the user left it while navigating within the site.
const pageViewKey = `tbtoolkit.page-view.v1:${location.pathname}`;
const statefulDetails = [...document.querySelectorAll('details')];
let savedPageView = null;

try {
  savedPageView = JSON.parse(sessionStorage.getItem(pageViewKey) || 'null');
} catch {
  savedPageView = null;
}

const detailKey = (detail, index) => detail.dataset.pageState || detail.id || `details-${index}`;

statefulDetails.forEach((detail, index) => {
  const open = savedPageView?.details?.[detailKey(detail, index)];
  if (typeof open === 'boolean') detail.open = open;
});

const savePageView = () => {
  const details = {};
  statefulDetails.forEach((detail, index) => {
    details[detailKey(detail, index)] = detail.open;
  });
  try {
    sessionStorage.setItem(pageViewKey, JSON.stringify({
      scrollY: Math.max(0, Math.round(window.scrollY)),
      details
    }));
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
};

statefulDetails.forEach((detail) => detail.addEventListener('toggle', savePageView));
window.addEventListener('pagehide', savePageView);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') savePageView();
});

if (Number.isFinite(savedPageView?.scrollY)) {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const restorePageScroll = () => window.scrollTo({top: savedPageView.scrollY, behavior: 'auto'});
  requestAnimationFrame(restorePageScroll);
  window.addEventListener('load', () => {
    restorePageScroll();
    setTimeout(restorePageScroll, 150);
    setTimeout(restorePageScroll, 600);
  }, {once: true});
}
