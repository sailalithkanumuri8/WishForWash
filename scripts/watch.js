// Watch: click-to-load YouTube player (captions on) and the "lights down" pin (23).

import { PIN_QUERY, registerMotion } from './motion.js';
import { qs } from './utils.js';

export function initWatch() {
  const figure = qs('[data-video]');
  if (!figure) return;
  const poster = qs('[data-video-poster]', figure);
  const id = figure.dataset.videoId;
  if (!poster || !id) return;

  // Click-to-load keeps YouTube off the page (and its weight) until it's wanted.
  poster.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    const params = new URLSearchParams({
      autoplay: '1',
      cc_load_policy: '1',
      cc_lang_pref: 'en',
      hl: 'en',
      rel: '0',
      playsinline: '1',
    });
    if (figure.dataset.videoStart) params.set('start', figure.dataset.videoStart);
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params}`;
    iframe.title = `Video: ${figure.dataset.videoTitle || 'Wish for Wash'}`;
    iframe.loading = 'lazy';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    poster.replaceWith(iframe);
    iframe.focus();
  });
}

// 23. "Lights down": the background dims and the player scales up as it pins.
registerMotion('lights-down', ({ enabled, gsap }) => {
  const section = qs('#watch');
  const frame = qs('#watch .video__frame');
  const dim = qs('#watch .watch__dim');
  if (!enabled || !section || !frame || !dim) return;

  // Pin only where the player fits on screen; short landscape phones get the plain scrub.
  const mm = gsap.matchMedia();
  mm.add(PIN_QUERY, () => {
    gsap
      .timeline({
        scrollTrigger: {
          trigger: frame,
          start: 'center center',
          end: '+=65%',
          pin: qs('#watch .video'),
          scrub: 0.6,
          anticipatePin: 1,
        },
      })
      .fromTo(dim, { opacity: 0 }, { opacity: 0.82, ease: 'none' }, 0)
      .fromTo(frame, { scale: 0.86 }, { scale: 1, ease: 'none' }, 0);
  });
  mm.add('(max-width: 767px), (max-height: 599px)', () => {
    gsap
      .timeline({ scrollTrigger: { trigger: frame, start: 'top 85%', end: 'center center', scrub: 0.6 } })
      .fromTo(dim, { opacity: 0 }, { opacity: 0.7, ease: 'none' }, 0)
      .fromTo(frame, { scale: 0.92 }, { scale: 1, ease: 'none' }, 0);
  });
  return () => mm.revert();
});
