// Georgia Tech: the campus strip scrolls sideways while the page is pinned (26).
// Under 768px wide or 600px tall (a pinned card wouldn't fit), or with motion off,
// it is a native swipe carousel instead.

import { getLenis, PIN_QUERY, registerMotion } from './motion.js';
import { clamp, qs } from './utils.js';

registerMotion('campus-strip', ({ enabled, gsap }) => {
  const campus = qs('[data-campus]');
  const track = qs('.campus__track', campus || document);
  const viewport = qs('.campus__viewport', campus || document);
  if (!enabled || !campus || !track || !viewport) return;

  const mm = gsap.matchMedia();
  mm.add(PIN_QUERY, () => {
    const distance = () => Math.max(0, track.scrollWidth - viewport.clientWidth);
    if (distance() < 40) return undefined;
    campus.classList.add('is-pinned');
    viewport.scrollLeft = 0;
    const tween = gsap.to(track, {
      x: () => -distance(),
      ease: 'none',
      scrollTrigger: {
        trigger: campus,
        start: 'center center',
        end: () => `+=${distance()}`,
        pin: true,
        scrub: 0.5,
        anticipatePin: 1,
        invalidateOnRefresh: true,
      },
    });

    // The browser can't scroll focus into view on a transformed track, so when
    // Tab reaches a card off to the side, scroll the page to where the strip
    // shows it (the scrub then slides it in). Measured after the browser's own
    // focus scroll, which can move the page into the pin.
    const reveal = (card) => {
      const st = tween.scrollTrigger;
      const max = distance();
      if (!card.isConnected || !st || !max) return;
      const shown = st.progress * max;
      const left = card.getBoundingClientRect().left - track.getBoundingClientRect().left;
      const right = left + card.offsetWidth;
      const width = viewport.clientWidth;
      let slide;
      if (right > shown + width) slide = right - width;
      else if (left < shown) slide = left;
      else return;
      const y = st.start + clamp(slide / max, 0, 1) * (st.end - st.start);
      const lenis = getLenis();
      if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
      else window.scrollTo(0, y);
    };
    const onFocus = (event) => {
      const card = event.target.closest('.campus__card');
      if (card) requestAnimationFrame(() => requestAnimationFrame(() => reveal(card)));
    };
    track.addEventListener('focusin', onFocus);
    return () => {
      track.removeEventListener('focusin', onFocus);
      campus.classList.remove('is-pinned');
    };
  });
  return () => mm.revert();
});
