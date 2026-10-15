// Ambient effects: rising bubbles (7), the drop cursor with click ripples (8)
// and the magnetic "Join the Wish" button.

import { registerMotion } from './motion.js';
import { hasFinePointer } from './prefs.js';
import { qsa, observeVisibility } from './utils.js';

/* --------------------------------------------------------------------------
   7. Rising bubble particles in section backgrounds (canvas, 40 max)
   -------------------------------------------------------------------------- */

const MAX_BUBBLES = 40;
const PER_CANVAS = 12;

function makeBubble(w, h, fresh) {
  const r = 2 + Math.random() * 7;
  return {
    x: Math.random() * w,
    y: fresh ? Math.random() * h : h + r + Math.random() * 40,
    r,
    speed: 0.25 + Math.random() * 0.6,
    wobble: Math.random() * Math.PI * 2,
    wobbleSpeed: 0.01 + Math.random() * 0.02,
    alpha: 0.18 + Math.random() * 0.3,
  };
}

registerMotion('bubbles', ({ enabled }) => {
  const canvases = qsa('canvas.bubbles');
  canvases.forEach((c) => c.getContext('2d')?.clearRect(0, 0, c.width, c.height));
  if (!enabled || canvases.length === 0) return;

  const fields = canvases.map((canvas) => ({
    canvas,
    ctx: canvas.getContext('2d'),
    bubbles: [],
    visible: false,
    w: 0,
    h: 0,
  }));

  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resize(field) {
    const rect = field.canvas.getBoundingClientRect();
    field.w = rect.width;
    field.h = rect.height;
    field.canvas.width = Math.round(rect.width * dpr);
    field.canvas.height = Math.round(rect.height * dpr);
    field.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  let raf = 0;
  function frame() {
    raf = 0;
    const active = fields.filter((f) => f.visible);
    if (active.length === 0) return;
    // Share the 40-bubble budget between visible sections.
    const budget = Math.min(PER_CANVAS, Math.floor(MAX_BUBBLES / active.length));
    active.forEach((f) => {
      while (f.bubbles.length < budget) f.bubbles.push(makeBubble(f.w, f.h, true));
      if (f.bubbles.length > budget) f.bubbles.length = budget;
      const { ctx } = f;
      ctx.clearRect(0, 0, f.w, f.h);
      f.bubbles.forEach((b, i) => {
        b.y -= b.speed;
        b.wobble += b.wobbleSpeed;
        const x = b.x + Math.sin(b.wobble) * 6;
        if (b.y < -b.r * 2) f.bubbles[i] = makeBubble(f.w, f.h, false);
        ctx.beginPath();
        ctx.arc(x, b.y, b.r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(217, 236, 250, ${b.alpha})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.28, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${b.alpha * 0.9})`;
        ctx.fill();
      });
    });
    raf = requestAnimationFrame(frame);
  }

  const start = () => {
    if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
  };

  const stops = fields.map((field) =>
    observeVisibility(field.canvas, (isVisible) => {
      field.visible = isVisible;
      if (isVisible) {
        resize(field);
        start();
      } else {
        field.ctx.clearRect(0, 0, field.w, field.h);
      }
    }),
  );

  const onResize = () => fields.forEach((f) => f.visible && resize(f));
  const onVisibility = () => (document.hidden ? cancelAnimationFrame(raf) || (raf = 0) : start());
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    cancelAnimationFrame(raf);
    stops.forEach((stop) => stop());
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibility);
    fields.forEach((f) => f.ctx.clearRect(0, 0, f.canvas.width, f.canvas.height));
  };
});

/* --------------------------------------------------------------------------
   8. Custom drop cursor that leaves ripple rings on click (desktop only)
   -------------------------------------------------------------------------- */

registerMotion('cursor', ({ enabled }) => {
  const root = document.documentElement;
  const layer = document.querySelector('.cursor-layer');
  if (!enabled || !hasFinePointer() || !layer) {
    root.classList.remove('has-drop-cursor');
    return;
  }
  root.classList.add('has-drop-cursor');

  const onDown = (event) => {
    if (event.button !== 0) return;
    const ring = document.createElement('span');
    ring.className = 'cursor-ripple';
    ring.style.left = `${event.clientX}px`;
    ring.style.top = `${event.clientY}px`;
    layer.appendChild(ring);
    ring.addEventListener('animationend', () => ring.remove(), { once: true });
  };
  window.addEventListener('pointerdown', onDown, { passive: true });

  return () => {
    window.removeEventListener('pointerdown', onDown);
    root.classList.remove('has-drop-cursor');
    layer.replaceChildren();
  };
});

/* --------------------------------------------------------------------------
   Magnetic hover for "Join the Wish" (and any [data-magnetic] button)
   -------------------------------------------------------------------------- */

registerMotion('magnetic', ({ enabled, gsap }) => {
  if (!enabled || !hasFinePointer()) return;
  const cleanups = qsa('[data-magnetic]').map((el) => {
    const xTo = gsap.quickTo(el, 'x', { duration: 0.4, ease: 'power3.out' });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.4, ease: 'power3.out' });
    const onMove = (event) => {
      const rect = el.getBoundingClientRect();
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      xTo(dx * 0.25);
      yTo(dy * 0.35);
    };
    const onLeave = () => {
      xTo(0);
      yTo(0);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  });
  return () => cleanups.forEach((fn) => fn());
});

/* --------------------------------------------------------------------------
   Pause CSS animation loops in sections that are off-screen
   -------------------------------------------------------------------------- */

const sections = qsa('.section');
if ('IntersectionObserver' in window && sections.length) {
  const io = new IntersectionObserver(
    (entries) => entries.forEach((entry) => entry.target.classList.toggle('is-offscreen', !entry.isIntersecting)),
    { rootMargin: '100px 0px' },
  );
  sections.forEach((section) => io.observe(section));
}
