// The Issue: stat counters (15), the "1 in 4" people grid (16), WASH icons that
// draw themselves (17) and cause cards that tilt toward the cursor (18).

import { registerMotion } from './motion.js';
import { hasFinePointer } from './prefs.js';
import { qsa } from './utils.js';

const FIG_H = 44;

// 15. Stat numbers count up from zero when scrolled into view.
registerMotion('counters', ({ enabled, gsap, ScrollTrigger }) => {
  if (!enabled) return;
  qsa('#issue [data-count]').forEach((el) => {
    const target = parseFloat(el.dataset.count);
    const decimals = parseInt(el.dataset.decimals || '0', 10);
    const finalText = el.textContent;
    const state = { value: 0 };
    el.textContent = (0).toFixed(decimals);
    ScrollTrigger.create({
      trigger: el,
      start: 'top 85%',
      once: true,
      onEnter: () =>
        gsap.to(state, {
          value: target,
          duration: 1.6,
          ease: 'power2.out',
          onUpdate: () => (el.textContent = state.value.toFixed(decimals)),
          onComplete: () => (el.textContent = finalText),
        }),
    });
  });
  return () => qsa('#issue [data-count]').forEach((el) => (el.textContent = Number(el.dataset.count).toFixed(parseInt(el.dataset.decimals || '0', 10))));
});

// 16. 100-person grid: 25 figures drain to empty as you scroll ("1 in 4").
registerMotion('people', ({ enabled, gsap }) => {
  const dry = qsa('#people-grid .person--dry .person__water');
  if (!enabled || dry.length === 0) return;
  gsap.set(dry, { attr: { y: 0, height: FIG_H } });
  // Drain in a scattered order so the empties appear across the whole crowd.
  const order = [...dry].sort((a, b) => {
    const ia = qsa('#people-grid .person').indexOf(a.closest('.person'));
    const ib = qsa('#people-grid .person').indexOf(b.closest('.person'));
    return ((ia * 37) % 101) - ((ib * 37) % 101);
  });
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: '#people-grid',
      start: 'top 75%',
      end: 'bottom 35%',
      scrub: 0.6,
    },
  });
  order.forEach((rect, i) => {
    tl.to(rect, { attr: { y: FIG_H, height: 0 }, duration: 1, ease: 'none' }, i * 0.35);
  });
  return () => gsap.set(dry, { attr: { y: FIG_H, height: 0 } });
});

// 17. W(A), S, H icons draw their outlines when scrolled into view.
registerMotion('wash-icons', ({ enabled, gsap, ScrollTrigger }) => {
  if (!enabled) return;
  qsa('.wash__icon').forEach((icon) => {
    const paths = qsa('.draw', icon);
    paths.forEach((p) => {
      const len = Math.ceil(p.getTotalLength());
      gsap.set(p, { strokeDasharray: len, strokeDashoffset: len });
    });
    ScrollTrigger.create({
      trigger: icon,
      start: 'top 85%',
      once: true,
      onEnter: () => gsap.to(paths, { strokeDashoffset: 0, duration: 1.2, ease: 'power2.out', stagger: 0.15 }),
    });
  });
});

// 18. Cause cards tilt in 3D toward the cursor on hover (desktop only).
registerMotion('tilt', ({ enabled }) => {
  if (!enabled || !hasFinePointer()) return;
  const cleanups = qsa('[data-tilt]').map((card) => {
    const onMove = (event) => {
      const rect = card.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width - 0.5;
      const py = (event.clientY - rect.top) / rect.height - 0.5;
      card.classList.add('is-tilting');
      card.style.setProperty('--ry', `${(px * 14).toFixed(2)}deg`);
      card.style.setProperty('--rx', `${(-py * 12).toFixed(2)}deg`);
    };
    const onLeave = () => {
      card.classList.remove('is-tilting');
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
    };
    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerleave', onLeave);
    return () => {
      card.removeEventListener('pointermove', onMove);
      card.removeEventListener('pointerleave', onLeave);
      onLeave();
    };
  });
  return () => cleanups.forEach((fn) => fn());
});
