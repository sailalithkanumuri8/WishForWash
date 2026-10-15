// Tab bar: sticky state, scroll-spy with a wavy underline, smooth anchor
// scrolling with shareable hashes, the mobile menu, the Motion switch and the
// back-to-top drop.

import { gsap, lockScroll, scrollToTarget } from './motion.js';
import { motionEnabled, onMotionChange, setMotion } from './prefs.js';
import { createFocusTrap, qs, qsa } from './utils.js';

const SECTION_IDS = ['home', 'issue', 'map', 'watch', 'solutions', 'gt', 'act', 'about'];

export function initNav() {
  const header = qs('#site-header');
  const tabsWrap = qs('.nav__tabs-wrap');
  const wave = qs('.nav__wave');
  const tabs = qsa('.nav__tab');
  const menuLinks = qsa('.mobile-menu__link');
  const sections = SECTION_IDS.map((id) => document.getElementById(id)).filter(Boolean);
  let activeId = null;
  let menuOpen = false;
  let suppressSpy = false;

  /* ---- Sticky state: transparent over the hero, solid after 80px ---- */
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 80);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---- Wavy underline follows the active tab ---- */
  function placeWave() {
    const tab = tabs.find((t) => t.dataset.section === activeId);
    if (!tab || !tabsWrap || tabsWrap.offsetParent === null) {
      wave?.style.setProperty('--wave-o', '0');
      return;
    }
    const wrapRect = tabsWrap.getBoundingClientRect();
    const rect = tab.getBoundingClientRect();
    const inset = 10;
    wave.style.setProperty('--wave-x', `${rect.left - wrapRect.left + inset}px`);
    wave.style.setProperty('--wave-w', `${Math.max(0, rect.width - inset * 2)}px`);
    wave.style.setProperty('--wave-o', '1');
  }

  function setActive(id, { updateHash = true } = {}) {
    if (id === activeId) return;
    activeId = id;
    [...tabs, ...menuLinks].forEach((link) => {
      if (link.dataset.section === id) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
    placeWave();
    // Keep the address bar pointing at the section in view so it can be shared.
    if (updateHash && !menuOpen) {
      const url = id === 'home' ? `${location.pathname}${location.search}` : `#${id}`;
      history.replaceState(null, '', url);
    }
  }

  /* ---- Scroll-spy (IntersectionObserver) ---- */
  // A thin band across the upper part of the viewport decides which section is "in view".
  const visible = new Set();
  const spy = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      });
      const current = sections.find((s) => visible.has(s));
      if (current && !suppressSpy) setActive(current.id);
    },
    { rootMargin: '-35% 0px -60% 0px', threshold: 0 },
  );
  sections.forEach((section) => spy.observe(section));

  window.addEventListener('resize', placeWave);
  document.fonts?.ready.then(placeWave);

  /* ---- Smooth scrolling for in-page links ---- */
  function goTo(id, { push = true, immediate = false, moveFocus = true } = {}) {
    const target = document.getElementById(id);
    if (!target) return;
    if (push) history.pushState(null, '', id === 'home' ? `${location.pathname}${location.search}` : `#${id}`);
    if (SECTION_IDS.includes(id)) {
      suppressSpy = true;
      setActive(id, { updateHash: false });
    }
    scrollToTarget(target, {
      immediate,
      onComplete: () => {
        suppressSpy = false;
        if (!moveFocus) return;
        // Move focus for keyboard and screen reader users without jumping the page.
        const focusTarget = target.matches('section') ? target.querySelector('h1, h2') || target : target;
        if (!focusTarget.hasAttribute('tabindex')) focusTarget.setAttribute('tabindex', '-1');
        focusTarget.focus({ preventScroll: true });
      },
    });
    // Safety net in case a scroll is interrupted before it completes.
    window.setTimeout(() => (suppressSpy = false), 2200);
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const id = decodeURIComponent(link.getAttribute('href').slice(1));
    if (!id || id === 'main' || !document.getElementById(id)) return;
    // Links into the collapsed Sources list are handled in main.js.
    if (id.startsWith('src-')) return;
    event.preventDefault();
    if (menuOpen) closeMenu({ returnFocus: false });
    goTo(id);
  });

  window.addEventListener('popstate', () => {
    const id = location.hash.slice(1) || 'home';
    if (document.getElementById(id)) goTo(id, { push: false });
  });

  // Arriving with a hash (a shared link): land on that section below the nav.
  if (location.hash.length > 1) {
    const id = decodeURIComponent(location.hash.slice(1));
    if (document.getElementById(id)) {
      const land = () => goTo(id, { push: false, immediate: true, moveFocus: false });
      requestAnimationFrame(land);
      window.addEventListener('load', land, { once: true });
    }
  }

  /* ---- Mobile menu: full-screen overlay that rises like a wave ---- */
  const menuBtn = qs('#menu-btn');
  const menu = qs('#mobile-menu');
  const menuIcon = qs('.nav__menu-icon use', menuBtn);
  const menuLabel = qs('.nav__menu-label', menuBtn);
  // The bar stays on top of the overlay, so keep focus within the whole header.
  const trap = createFocusTrap(header, { onEscape: () => closeMenu() });

  function setMenuButton(open) {
    menuBtn.setAttribute('aria-expanded', String(open));
    menuIcon?.setAttribute('href', open ? '#i-x' : '#i-menu');
    if (menuLabel) menuLabel.textContent = open ? 'Close' : 'Menu';
  }

  function openMenu() {
    if (menuOpen) return;
    menuOpen = true;
    menu.hidden = false;
    setMenuButton(true);
    header.classList.add('menu-open');
    lockScroll(true);
    if (motionEnabled()) {
      gsap.fromTo(menu, { yPercent: 100 }, { yPercent: 0, duration: 0.6, ease: 'power3.out' });
      gsap.fromTo(
        qsa('.mobile-menu__list li', menu),
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', stagger: 0.05, delay: 0.15 },
      );
    }
    trap.activate(qs('.mobile-menu__link[aria-current="true"]', menu) || qs('.mobile-menu__link', menu));
  }

  function closeMenu({ returnFocus = true } = {}) {
    if (!menuOpen) return;
    menuOpen = false;
    setMenuButton(false);
    trap.deactivate({ returnFocus });
    lockScroll(false);
    const finish = () => {
      menu.hidden = true;
      header.classList.remove('menu-open');
      gsap.set(menu, { clearProps: 'transform' });
    };
    if (motionEnabled()) gsap.to(menu, { yPercent: 100, duration: 0.45, ease: 'power2.in', onComplete: finish });
    else finish();
  }

  menuBtn?.addEventListener('click', () => (menuOpen ? closeMenu() : openMenu()));
  qs('[data-menu-close]', menu)?.addEventListener('click', () => closeMenu());
  // Same query as the tab bar in main.css: tabs show from 768px except on short landscape phones.
  window.matchMedia('(min-width: 768px) and (min-height: 501px), (min-width: 1100px)').addEventListener('change', (e) => {
    if (e.matches) closeMenu({ returnFocus: false });
  });

  /* ---- Motion on/off switch ---- */
  const toggle = qs('#motion-toggle');
  const syncToggle = (on) => {
    toggle?.setAttribute('aria-checked', String(on));
    const state = toggle?.querySelector('.motion-toggle__state');
    if (state) state.textContent = on ? 'On' : 'Off';
  };
  syncToggle(motionEnabled());
  toggle?.addEventListener('click', () => setMotion(!motionEnabled()));
  onMotionChange(syncToggle);

  /* ---- Back to top: a drop that appears after the map and drips up ---- */
  const backTop = qs('#back-to-top');
  const mapSection = document.getElementById('map');
  if (backTop && mapSection) {
    const io = new IntersectionObserver(
      ([entry]) => {
        const pastMap = !entry.isIntersecting && entry.boundingClientRect.top < 0;
        backTop.classList.toggle('is-visible', pastMap);
      },
      { threshold: 0 },
    );
    io.observe(mapSection);

    backTop.addEventListener('click', (event) => {
      event.preventDefault();
      const svg = backTop.querySelector('svg');
      if (motionEnabled() && svg) {
        gsap
          .timeline()
          .to(svg, { scaleY: 0.82, scaleX: 1.12, transformOrigin: '50% 100%', duration: 0.14, ease: 'power2.out' })
          .to(svg, { scaleY: 1.25, scaleX: 0.86, y: -26, opacity: 0, duration: 0.32, ease: 'power2.in' })
          .add(() => goTo('home'))
          .set(svg, { clearProps: 'all' }, '+=0.6');
      } else {
        goTo('home');
      }
    });
  }
}
