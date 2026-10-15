// Georgia Tech: the campus strip scrolls sideways while the page is pinned (26).
// Under 768px wide or 600px tall (a pinned card wouldn't fit), or with motion off,
// it is a native swipe carousel instead.

import { registerMotion } from './motion.js';
import { qs } from './utils.js';

registerMotion('campus-strip', ({ enabled, gsap }) => {
  const campus = qs('[data-campus]');
  const track = qs('.campus__track', campus || document);
  const viewport = qs('.campus__viewport', campus || document);
  if (!enabled || !campus || !track || !viewport) return;

  const mm = gsap.matchMedia();
  mm.add('(min-width: 768px) and (min-height: 600px)', () => {
    const distance = () => Math.max(0, track.scrollWidth - viewport.clientWidth);
    if (distance() < 40) return undefined;
    campus.classList.add('is-pinned');
    viewport.scrollLeft = 0;
    gsap.to(track, {
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
    return () => campus.classList.remove('is-pinned');
  });
  return () => mm.revert();
});
