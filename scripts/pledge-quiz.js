// Take Action: the action ladder (animation 27), the Wish Pledge with its coin
// toss and downloadable My Wish card (animation 28), the "How water-wise are
// you?" quiz, sharing, and the join form.
//
// The static HTML keeps the ladder, pledge, share and join forms readable on
// their own. This module adds behavior, builds the quiz from data/quiz.json,
// and creates the result panels that only exist after someone interacts.

import quiz from '../data/quiz.json';
import { gsap, registerMotion, scrollToTarget } from './motion.js';
import { motionEnabled } from './prefs.js';
import { announce, navHeight, observeVisibility, qs, qsa } from './utils.js';

const GT_EMAIL = /^[^\s@]+@gatech\.edu$/i;
const SHARE_TEXT =
  '1 in 4 people still lack safe drinking water. See how it shows up across Georgia, then take one step to fix it.';
const LETTERS = 'ABCD';
const DROP_PATH = 'M8 1.5C6.2 5.6 2 8.6 2 13a6 6 0 0 0 12 0c0-4.4-4.2-7.4-6-11.5Z';

const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** "https://example.com/path/" -> "example.com/path" for display. */
function displayUrl(url) {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** Superscript citation links that match the numbered footer Sources list. */
function citations(ids = []) {
  const links = ids
    .map((id) => {
      const item = document.getElementById(`src-${id}`);
      const n = item?.dataset.n;
      if (!n) return '';
      return `<a class="cite" href="#src-${id}" data-src="${id}" aria-label="Source ${n}">${n}</a>`;
    })
    .join('');
  return links ? `<sup>${links}</sup>` : '';
}

/** Restart a one-shot CSS animation class on an element. */
function replayClass(el, className) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  el.addEventListener('animationend', () => el.classList.remove(className), { once: true });
}

export function initAct() {
  const app = document.getElementById('act-app');
  if (!app) return;
  const configured = app.dataset.siteUrl || '';
  const siteUrl = configured.startsWith('http') ? configured : window.location.href.split('#')[0];
  const share = createSharer(siteUrl);

  initLadder(app);
  initPledge(app, siteUrl);
  initQuiz(app, share);
  initShareCard(app, share);
  initJoin(app);

  const reward = qs('.reward', app);
  if (reward) observeVisibility(reward, (on) => reward.classList.toggle('is-onscreen', on));
}

/* --------------------------------------------------------------------------
   27. Action ladder: each rung fills with water as you scroll past it
   -------------------------------------------------------------------------- */

function initLadder(app) {
  const ladder = qs('[data-ladder]', app);
  if (!ladder) return;
  // Pause the drifting wave tops while the ladder is off-screen.
  observeVisibility(ladder, (on) => ladder.classList.toggle('is-onscreen', on));

  registerMotion('ladder', ({ enabled, gsap: g }) => {
    // Motion off: the static markup already shows every rung full.
    if (!enabled) return;
    const levels = qsa('.rung__level', ladder);
    g.set(levels, { y: 100 });
    const timeline = g.timeline({
      defaults: { ease: 'none', duration: 1 },
      scrollTrigger: { trigger: ladder, start: 'top 80%', end: 'bottom 45%', scrub: 0.6 },
    });
    levels.forEach((level) => timeline.to(level, { y: 0 }));
  });
}

/* --------------------------------------------------------------------------
   28. Wish Pledge: drop checkboxes, a coin into water, the My Wish card
   -------------------------------------------------------------------------- */

const RESULT_TEMPLATE = `
  <h3 class="pledge__done" tabindex="-1" data-wish-heading>Your wish is ready!</h3>
  <div class="pledge__scene" data-wish-scene>
    <svg class="pledge__pool pledge__pool--back" viewBox="0 0 600 90" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false" data-pool>
      <ellipse cx="300" cy="46" rx="296" ry="32" fill="#8fd3f0" />
      <ellipse cx="300" cy="46" rx="210" ry="18" fill="none" stroke="#d9ecfa" stroke-width="2" opacity=".75" />
      <g fill="none" stroke="#ffffff" stroke-width="2.5" data-ripples>
        <ellipse cx="300" cy="46" rx="44" ry="9" opacity="0" />
        <ellipse cx="300" cy="46" rx="44" ry="9" opacity="0" />
        <ellipse cx="300" cy="46" rx="44" ry="9" opacity="0" />
      </g>
    </svg>
    <figure class="wish-card" data-wish-card>
      <div class="wish-card__inner">
        <div class="wish-card__brand">
          <svg class="wish-card__logo" viewBox="0 0 30 38" width="30" height="38" aria-hidden="true" focusable="false">
            <path d="M15 1C11.5 9 3 15.5 3 24.5a12 12 0 0 0 24 0C27 15.5 18.5 9 15 1Z" fill="#2f7fd6" stroke="#d9ecfa" stroke-width="2" />
            <path d="M9.5 22.5c.4-3 2.1-5.4 4.2-7" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" opacity=".85" />
            <path d="M10.5 28.5c2.6 2.4 6.4 2.4 9 0" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" />
          </svg>
          <span class="wish-card__wordmark">WISH FOR WASH</span>
        </div>
        <p class="wish-card__title">MY WISH</p>
        <div class="wish-card__box">
          <p class="wish-card__lead">Safe water for every community, starting with mine. This semester, I will:</p>
          <ul class="wish-card__list" data-wish-list></ul>
          <p class="wish-card__sign">Signed, <span data-wish-name></span></p>
        </div>
        <p class="wish-card__foot">
          <span data-wish-date></span>
          <span data-wish-url></span>
        </p>
      </div>
      <svg class="wish-card__waves" viewBox="0 0 400 34" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d="M0 12C50 2 100 2 150 12s100 10 150 0 75-10 100-6V34H0Z" fill="#55b6da" />
        <path d="M0 22c60-10 110-10 170 0s110 10 170 0 45-6 60-4V34H0Z" fill="#2f64a8" />
      </svg>
    </figure>
    <svg class="pledge__pool pledge__pool--front" viewBox="0 0 600 90" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false" data-pool>
      <path d="M0 52Q150 36 300 52T600 52V90H0Z" fill="#55b6da" />
      <path d="M0 52Q150 36 300 52T600 52" fill="none" stroke="#d9ecfa" stroke-width="3" />
      <g fill="#d9ecfa" data-splash>
        <path d="M300 34c-1.8 4-5.6 6.7-5.6 10.5a5.6 5.6 0 0 0 11.2 0c0-3.8-3.8-6.5-5.6-10.5Z" opacity="0" />
        <path d="M300 34c-1.8 4-5.6 6.7-5.6 10.5a5.6 5.6 0 0 0 11.2 0c0-3.8-3.8-6.5-5.6-10.5Z" opacity="0" />
        <path d="M300 34c-1.8 4-5.6 6.7-5.6 10.5a5.6 5.6 0 0 0 11.2 0c0-3.8-3.8-6.5-5.6-10.5Z" opacity="0" />
        <path d="M300 34c-1.8 4-5.6 6.7-5.6 10.5a5.6 5.6 0 0 0 11.2 0c0-3.8-3.8-6.5-5.6-10.5Z" opacity="0" />
        <path d="M300 34c-1.8 4-5.6 6.7-5.6 10.5a5.6 5.6 0 0 0 11.2 0c0-3.8-3.8-6.5-5.6-10.5Z" opacity="0" />
        <path d="M300 34c-1.8 4-5.6 6.7-5.6 10.5a5.6 5.6 0 0 0 11.2 0c0-3.8-3.8-6.5-5.6-10.5Z" opacity="0" />
      </g>
    </svg>
    <svg class="pledge__coin" viewBox="0 0 48 48" aria-hidden="true" focusable="false" data-coin>
      <g data-coin-face>
        <circle cx="24" cy="24" r="22" fill="#8c7d45" />
        <circle cx="24" cy="23" r="21" fill="#b3a369" />
        <circle cx="24" cy="23" r="16" fill="none" stroke="#e4d9a8" stroke-width="2" />
        <path d="M24 12c-2 4.6-6.5 7.8-6.5 12.6a6.5 6.5 0 0 0 13 0c0-4.8-4.5-8-6.5-12.6Z" fill="#e4d9a8" />
      </g>
    </svg>
  </div>
  <div class="pledge__actions" data-wish-actions>
    <button class="btn btn--navy" type="button" data-wish-download>${icon('download')}Download my card</button>
    <button class="btn btn--outline-navy" type="button" data-wish-edit>${icon('pencil')}Edit my pledge</button>
  </div>
  <p class="act-status" role="status" data-wish-status></p>`;

function initPledge(app, siteUrl) {
  const card = qs('#pledge', app);
  const form = qs('#pledge-form', card || app);
  const formPane = qs('[data-pledge-form-pane]', card || app);
  const result = qs('[data-pledge-result]', card || app);
  if (!card || !form || !formPane || !result) return;

  const fieldset = qs('.pledge__fieldset', form);
  const boxes = qsa('input[name="commitment"]', form);
  const nameInput = qs('#pledge-name', form);
  const error = qs('#pledge-error', card);

  result.innerHTML = RESULT_TEMPLATE;
  const ui = {
    heading: qs('[data-wish-heading]', result),
    scene: qs('[data-wish-scene]', result),
    wish: qs('[data-wish-card]', result),
    list: qs('[data-wish-list]', result),
    name: qs('[data-wish-name]', result),
    date: qs('[data-wish-date]', result),
    url: qs('[data-wish-url]', result),
    pools: qsa('[data-pool]', result),
    ripples: qsa('[data-ripples] ellipse', result),
    splash: qsa('[data-splash] path', result),
    coin: qs('[data-coin]', result),
    coinFace: qs('[data-coin-face]', result),
    actions: qs('[data-wish-actions]', result),
    status: qs('[data-wish-status]', result),
    download: qs('[data-wish-download]', result),
    edit: qs('[data-wish-edit]', result),
  };
  let timeline = null;

  function showError(on) {
    if (on) {
      error.innerHTML = `${icon('circle-alert')}<span>Choose at least one promise to make your wish.</span>`;
      error.hidden = false;
    } else {
      error.hidden = true;
      error.textContent = '';
    }
    fieldset.setAttribute('aria-describedby', on ? 'pledge-hint pledge-error' : 'pledge-hint');
    boxes.forEach((box) => {
      if (on) {
        box.setAttribute('aria-invalid', 'true');
        box.setAttribute('aria-describedby', 'pledge-error');
      } else {
        box.removeAttribute('aria-invalid');
        box.removeAttribute('aria-describedby');
      }
    });
  }

  boxes.forEach((box) =>
    box.addEventListener('change', () => {
      if (boxes.some((b) => b.checked)) showError(false);
    }),
  );

  function fillCard(promises, rawName) {
    const name = rawName.trim().replace(/\s+/g, ' ').slice(0, 30);
    ui.list.replaceChildren(
      ...promises.map((text) => {
        const li = document.createElement('li');
        li.textContent = text;
        return li;
      }),
    );
    ui.name.textContent = name || 'a Yellow Jacket';
    ui.date.textContent = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    ui.url.textContent = displayUrl(siteUrl);
    ui.heading.textContent = name ? `Your wish is ready, ${name}!` : 'Your wish is ready!';
    ui.wish.setAttribute('aria-label', `My Wish card${name ? ` for ${name}` : ''}`);
  }

  function resetScene() {
    timeline?.kill();
    timeline = null;
    gsap.set([ui.wish, ui.actions, ...ui.pools, ui.coin, ui.coinFace, ...ui.ripples, ...ui.splash], {
      clearProps: 'all',
    });
    ui.status.textContent = '';
  }

  function playScene() {
    resetScene();
    const animate = motionEnabled();
    ui.pools.forEach((pool) => (pool.style.display = animate ? '' : 'none'));
    ui.coin.style.display = animate ? '' : 'none';
    if (!animate) return;

    const sceneHeight = ui.scene.clientHeight;
    const fall = Math.max(140, sceneHeight - 120);
    const rise = Math.min(sceneHeight * 0.8, 420);

    timeline = gsap.timeline({
      onComplete: () => {
        ui.pools.forEach((pool) => (pool.style.display = 'none'));
        ui.coin.style.display = 'none';
      },
    });
    // Opacity (not visibility) so the card and buttons stay in the accessibility tree.
    timeline
      .set(ui.wish, { y: rise, opacity: 0 })
      .set(ui.actions, { opacity: 0, y: 12 })
      .set(ui.coin, { visibility: 'visible', autoAlpha: 1, y: -fall, rotation: -25 })
      // The coin tumbles down into the water...
      .to(ui.coin, { y: 0, rotation: 15, duration: 0.6, ease: 'power2.in' }, 0)
      .to(ui.coinFace, { scaleX: 0.15, transformOrigin: '50% 50%', duration: 0.1, repeat: 5, yoyo: true, ease: 'sine.inOut' }, 0)
      .to(ui.coin, { autoAlpha: 0, y: 16, duration: 0.16, ease: 'power1.in' }, 0.6);

    // ...splashing drops up and out (the only thing allowed to bounce)...
    ui.splash.forEach((drop, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      const dx = side * (26 + ((i * 23) % 64));
      const up = 30 + ((i * 17) % 34);
      timeline
        .set(drop, { opacity: 1, x: 0, y: 0, scale: 0.7, svgOrigin: '300 44' }, 0.6)
        .to(drop, { x: dx, duration: 0.7, ease: 'none' }, 0.6)
        .to(drop, { y: -up, scale: 1, duration: 0.32, ease: 'power2.out' }, 0.6)
        .to(drop, { y: 12, opacity: 0, duration: 0.38, ease: 'power2.in' }, 0.92);
    });

    // ...rings ripple across the surface...
    ui.ripples.forEach((ring, i) => {
      timeline.fromTo(
        ring,
        { opacity: 0.95, scale: 0.3, svgOrigin: '300 46' },
        { opacity: 0, scale: 3.4, duration: 1.1, ease: 'power2.out' },
        0.62 + i * 0.18,
      );
    });

    // ...and the My Wish card rises out of the water.
    timeline
      .to(ui.wish, { y: 0, opacity: 1, duration: 0.8, ease: 'power3.out' }, 0.72)
      .to(ui.actions, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, 1.25)
      .to(ui.pools, { autoAlpha: 0, duration: 0.45, ease: 'power1.out' }, 1.4);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const chosen = boxes.filter((box) => box.checked);
    if (chosen.length === 0) {
      showError(true);
      boxes[0].focus();
      return;
    }
    showError(false);
    fillCard(
      chosen.map((box) => box.dataset.card),
      nameInput?.value || '',
    );
    formPane.hidden = true;
    result.hidden = false;
    playScene();
    ui.heading.focus({ preventScroll: true });
    if (card.getBoundingClientRect().top < navHeight()) {
      scrollToTarget(card, { offset: navHeight() + 16 });
    }
    announce('Your My Wish card is ready. You can download it as an image.');
  });

  ui.edit.addEventListener('click', () => {
    resetScene();
    result.hidden = true;
    formPane.hidden = false;
    (boxes.find((box) => box.checked) || boxes[0]).focus();
  });

  ui.download.addEventListener('click', () => downloadCard(ui.wish, ui.status, ui.download));
}

/** Render the card to a PNG in the browser with html2canvas (loaded on demand). */
async function downloadCard(cardEl, statusEl, button) {
  button.disabled = true;
  statusEl.textContent = 'Making your image…';
  let holder = null;
  let probeFix = null;
  try {
    const { default: html2canvas } = await import('html2canvas');
    if (document.fonts?.ready) await document.fonts.ready;

    // Export a fixed-size copy so every download looks the same (1080 x 1350).
    holder = document.createElement('div');
    holder.className = 'wish-export';
    holder.setAttribute('aria-hidden', 'true');
    const copy = cardEl.cloneNode(true);
    copy.removeAttribute('style');
    copy.removeAttribute('data-wish-card');
    holder.appendChild(copy);
    document.body.appendChild(holder);

    // html2canvas finds each font's baseline with a 1x1 <img> that must sit
    // inline on the text line. Our reset makes images display:block, which
    // pushes the probe down a line and draws all text too low. Undo that for
    // the probe only, while the export runs.
    probeFix = document.createElement('style');
    probeFix.textContent = 'img[src^="data:image/gif;base64,R0lGODlhAQAB"]{display:inline!important}';
    document.head.appendChild(probeFix);

    const canvas = await html2canvas(copy, {
      scale: 2,
      backgroundColor: null,
      logging: false,
      // Clone only the card, not the whole page (skips the bubble canvases too).
      ignoreElements: (el) => el.parentElement === document.body && el !== holder,
      onclone: async (doc) => {
        const clone = doc.querySelector('.wish-export');
        if (!clone) return;
        clone.style.left = '0px';
        // html2canvas lays out and measures text inside its cloned document.
        // Load every web font the card uses there first, or the text is
        // measured with fallback fonts and drawn out of place.
        if (doc.fonts) {
          const view = doc.defaultView;
          const loads = Array.from(clone.querySelectorAll('*'), (el) => {
            const style = view.getComputedStyle(el);
            const text = el.textContent.trim() || 'Wish';
            return doc.fonts.load(`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`, text);
          });
          await Promise.allSettled(loads);
          await doc.fonts.ready;
        }
      },
    });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The browser could not create the image.');

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'my-wish-wish-for-wash.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    statusEl.textContent = 'Downloaded! Look for my-wish-wish-for-wash.png.';
  } catch (error) {
    console.error('[pledge] card download failed', error);
    statusEl.textContent = 'Sorry, that download did not work. A screenshot of your card works too.';
  } finally {
    holder?.remove();
    probeFix?.remove();
    button.disabled = false;
  }
}

/* --------------------------------------------------------------------------
   Sharing (quiz result and the QR card)
   -------------------------------------------------------------------------- */

function createSharer(siteUrl) {
  const data = { title: 'Wish for Wash | Clean Water Starts in Georgia', text: SHARE_TEXT, url: siteUrl };
  return async function share(statusEl) {
    const say = (message) => {
      if (statusEl) statusEl.textContent = message;
    };
    say('');
    if (typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(data))) {
      try {
        await navigator.share(data);
        say('Thanks for sharing Wish for Wash!');
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return; // the visitor closed the share sheet
        // Otherwise fall back to copying the link.
      }
    }
    try {
      await navigator.clipboard.writeText(siteUrl);
      say(`Link copied: ${displayUrl(siteUrl)}`);
    } catch {
      say(`Copy this link: ${siteUrl}`);
    }
  };
}

function initShareCard(app, share) {
  const button = qs('[data-share]', qs('#share', app) || app);
  const status = qs('[data-share-status]', app);
  button?.addEventListener('click', () => share(status));
}

/* --------------------------------------------------------------------------
   "How water-wise are you?" quiz: one question at a time
   -------------------------------------------------------------------------- */

function initQuiz(app, share) {
  const host = qs('[data-quiz]', app);
  if (!host || !Array.isArray(quiz.questions) || quiz.questions.length === 0) return;
  const questions = quiz.questions;
  const total = questions.length;

  host.innerHTML = `
    <form class="quiz__form" novalidate data-quiz-form>
      <div class="quiz__progress">
        <p class="quiz__count" data-quiz-count></p>
        <ol class="quiz__dots" aria-hidden="true">
          ${questions
            .map(() => `<li class="quiz__dot"><svg viewBox="0 0 16 20"><path d="${DROP_PATH}" /></svg></li>`)
            .join('')}
        </ol>
      </div>
      ${questions
        .map(
          (q, qi) => `
        <fieldset class="quiz__q" data-quiz-q="${qi}" hidden>
          <legend class="quiz__prompt">
            <span class="visually-hidden">Question ${qi + 1} of ${total}: </span>${escapeHtml(q.prompt)}
          </legend>
          <ul class="quiz__options" role="list">
            ${q.options
              .map(
                (option, oi) => `
              <li>
                <label class="quiz__opt">
                  <input class="quiz__radio" type="radio" name="quiz-${escapeHtml(q.id)}" value="${oi}" />
                  <span class="quiz__letter" aria-hidden="true">${LETTERS[oi]}</span>
                  <span class="quiz__opt-text">${escapeHtml(option)}</span>
                  <span class="quiz__tag" data-quiz-tag></span>
                  <svg class="icon quiz__mark quiz__mark--right" aria-hidden="true"><use href="#i-circle-check"></use></svg>
                  <svg class="icon quiz__mark quiz__mark--wrong" aria-hidden="true"><use href="#i-circle-x"></use></svg>
                </label>
              </li>`,
              )
              .join('')}
          </ul>
        </fieldset>`,
        )
        .join('')}
      <p class="field-error quiz__error" data-quiz-error hidden></p>
      <div class="quiz__feedback" tabindex="-1" data-quiz-feedback hidden></div>
      <div class="quiz__controls">
        <button class="btn btn--navy" type="submit" data-quiz-check>${icon('check')}Check answer</button>
        <button class="btn btn--navy" type="button" data-quiz-next hidden></button>
      </div>
    </form>
    <div class="quiz__result" data-quiz-result hidden></div>`;

  const form = qs('[data-quiz-form]', host);
  const count = qs('[data-quiz-count]', host);
  const dots = qsa('.quiz__dot', host);
  const fieldsets = qsa('[data-quiz-q]', host);
  const error = qs('[data-quiz-error]', host);
  const feedback = qs('[data-quiz-feedback]', host);
  const checkBtn = qs('[data-quiz-check]', host);
  const nextBtn = qs('[data-quiz-next]', host);
  const result = qs('[data-quiz-result]', host);

  const state = { index: 0, answered: false, answers: new Array(total).fill(null) };

  function setError(message) {
    if (message) {
      error.innerHTML = `${icon('circle-alert')}<span>${escapeHtml(message)}</span>`;
      error.hidden = false;
    } else {
      error.hidden = true;
      error.textContent = '';
    }
  }

  function show(index) {
    state.index = index;
    state.answered = false;
    fieldsets.forEach((fs, i) => (fs.hidden = i !== index));
    dots.forEach((dot, i) => dot.classList.toggle('is-current', i === index));
    count.textContent = `Question ${index + 1} of ${total}`;
    feedback.hidden = true;
    feedback.innerHTML = '';
    checkBtn.hidden = false;
    nextBtn.hidden = true;
    setError('');
  }

  function burst(label) {
    for (let i = 0; i < 10; i += 1) {
      const bubble = document.createElement('span');
      bubble.className = 'quiz__bubble';
      const angle = (i / 10) * Math.PI * 2 + Math.random() * 0.5;
      const distance = 24 + Math.random() * 30;
      bubble.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
      bubble.style.setProperty('--dy', `${Math.sin(angle) * distance}px`);
      bubble.style.setProperty('--s', `${6 + Math.random() * 8}px`);
      label.appendChild(bubble);
      bubble.addEventListener('animationend', () => bubble.remove(), { once: true });
    }
  }

  function grade(choice) {
    const q = questions[state.index];
    const fs = fieldsets[state.index];
    const labels = qsa('.quiz__opt', fs);
    const correct = choice === q.answer;
    state.answers[state.index] = choice;
    state.answered = true;

    qsa('input', fs).forEach((radio) => (radio.disabled = true));
    const chosen = labels[choice];
    chosen.classList.add(correct ? 'is-correct' : 'is-wrong');
    qs('[data-quiz-tag]', chosen).textContent = 'Your answer';
    if (!correct) {
      labels[q.answer].classList.add('is-answer');
      qs('[data-quiz-tag]', labels[q.answer]).textContent = 'Correct answer';
    }
    dots[state.index].classList.add(correct ? 'is-right' : 'is-wrong');

    feedback.classList.toggle('is-right', correct);
    feedback.innerHTML = `
      <p class="quiz__feedback-title">${icon(correct ? 'circle-check' : 'circle-x')}<span>${
        correct ? 'Correct!' : `Not quite. Correct answer: ${escapeHtml(q.options[q.answer])}.`
      }</span></p>
      <p>${escapeHtml(q.explain)}${citations(q.cite)}</p>
      <p class="quiz__from">From: <a href="${escapeHtml(q.section.href)}">${escapeHtml(q.section.label)}</a></p>`;
    feedback.hidden = false;
    checkBtn.hidden = true;
    nextBtn.hidden = false;
    nextBtn.innerHTML =
      state.index === total - 1 ? `See my result${icon('award')}` : `Next question${icon('arrow-right')}`;

    if (motionEnabled()) {
      if (correct) burst(chosen);
      else replayClass(chosen, 'is-shaking');
    }
    feedback.focus({ preventScroll: true });
  }

  function showResult() {
    const score = state.answers.filter((answer, i) => answer === questions[i].answer).length;
    const persona =
      quiz.personas.find((p) => score >= p.min && score <= p.max) || quiz.personas[quiz.personas.length - 1];
    const next = persona.next;
    result.innerHTML = `
      <p class="label quiz__result-kicker">Your result</p>
      <p class="quiz__score"><span class="quiz__score-num">${score}</span><span class="quiz__score-of">of ${total} correct</span></p>
      <h4 class="quiz__persona" tabindex="-1" data-quiz-persona>${escapeHtml(persona.headline)}</h4>
      <p class="quiz__summary">${escapeHtml(persona.summary)}</p>
      <div class="quiz__result-actions">
        <a class="btn btn--navy" href="${escapeHtml(next.href)}"${next.external ? ' target="_blank" rel="noopener"' : ''}>${escapeHtml(next.label)}${icon(next.external ? 'external-link' : 'arrow-right')}</a>
        <button class="btn btn--outline-navy" type="button" data-quiz-share>${icon('share-2')}Share the site</button>
        <button class="btn btn--outline-navy" type="button" data-quiz-retake>${icon('rotate-ccw')}Retake quiz</button>
      </div>
      <p class="act-status" role="status" data-quiz-share-status></p>`;
    form.hidden = true;
    result.hidden = false;
    result.dataset.persona = persona.id;
    qs('[data-quiz-share]', result).addEventListener('click', () =>
      share(qs('[data-quiz-share-status]', result)),
    );
    qs('[data-quiz-retake]', result).addEventListener('click', retake);
    qs('[data-quiz-persona]', result).focus({ preventScroll: true });
    if (result.getBoundingClientRect().top < navHeight()) {
      scrollToTarget(qs('#quiz', app), { offset: navHeight() + 16 });
    }
  }

  function retake() {
    state.answers.fill(null);
    fieldsets.forEach((fs) => {
      qsa('input', fs).forEach((radio) => {
        radio.disabled = false;
        radio.checked = false;
      });
      qsa('.quiz__opt', fs).forEach((label) => label.classList.remove('is-correct', 'is-wrong', 'is-answer'));
      qsa('[data-quiz-tag]', fs).forEach((tag) => (tag.textContent = ''));
    });
    dots.forEach((dot) => dot.classList.remove('is-right', 'is-wrong'));
    result.hidden = true;
    result.innerHTML = '';
    form.hidden = false;
    show(0);
    qs('input', fieldsets[0]).focus();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.answered) {
      nextBtn.click();
      return;
    }
    const checked = qs('input:checked', fieldsets[state.index]);
    if (!checked) {
      setError('Pick an answer first.');
      qs('input', fieldsets[state.index]).focus();
      return;
    }
    setError('');
    grade(Number(checked.value));
  });

  form.addEventListener('change', () => {
    if (!state.answered) setError('');
  });

  nextBtn.addEventListener('click', () => {
    if (state.index < total - 1) {
      show(state.index + 1);
      qs('input', fieldsets[state.index]).focus();
    } else {
      showResult();
    }
  });

  show(0);
}

/* --------------------------------------------------------------------------
   Join form: validates a GT email; posts only if an endpoint is configured
   -------------------------------------------------------------------------- */

const JOIN_LINKS = {
  // EWB-GT's link page carries the current application (opens each fall and spring).
  apply: 'https://linktr.ee/ewb.gt',
  instagram: 'https://www.instagram.com/ewb.usa.gt/',
  engage: 'https://gatech.campuslabs.com/engage/organization/engineers-without-borders',
};

function initJoin(app) {
  const card = qs('#join', app);
  const form = qs('#join-form', card || app);
  const done = qs('[data-join-done]', card || app);
  if (!card || !form || !done) return;

  const nameInput = qs('#join-name', form);
  const emailInput = qs('#join-email', form);
  const nameError = qs('#join-name-error', form);
  const emailError = qs('#join-email-error', form);
  const submit = qs('.join__submit', form);
  const status = qs('[data-join-status]', form);
  const endpoint = (form.dataset.endpoint || '').trim();
  let attempted = false;

  function setFieldError(input, errorEl, message, baseDescribedBy = '') {
    if (message) {
      errorEl.innerHTML = `${icon('circle-alert')}<span></span>`;
      errorEl.lastElementChild.textContent = message;
      errorEl.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', [baseDescribedBy, errorEl.id].filter(Boolean).join(' '));
    } else {
      errorEl.hidden = true;
      errorEl.textContent = '';
      input.removeAttribute('aria-invalid');
      if (baseDescribedBy) input.setAttribute('aria-describedby', baseDescribedBy);
      else input.removeAttribute('aria-describedby');
    }
  }

  const validateName = () => {
    const message = nameInput.value.trim() ? '' : 'Enter your name.';
    setFieldError(nameInput, nameError, message);
    return !message;
  };

  const validateEmail = () => {
    const value = emailInput.value.trim();
    let message = '';
    if (!value) message = 'Enter your GT email.';
    else if (!GT_EMAIL.test(value)) message = 'Use your @gatech.edu email address.';
    setFieldError(emailInput, emailError, message, 'join-email-hint');
    return !message;
  };

  nameInput.addEventListener('input', () => attempted && validateName());
  emailInput.addEventListener('input', () => attempted && validateEmail());

  function showDone({ name, email, interests }, saved) {
    const first = name.split(' ')[0];
    done.innerHTML = `
      <h4 class="join__done-title" tabindex="-1" data-join-title></h4>
      <p data-join-lead></p>
      <ol class="join__steps">
        <li><strong>Apply to EWB-GT</strong> when applications open each fall and spring, and say you'd like to join Wish for Wash: <a href="${JOIN_LINKS.apply}" target="_blank" rel="noopener">find the EWB-GT application</a>.</li>
        <li><strong>Follow <a href="${JOIN_LINKS.instagram}" target="_blank" rel="noopener">@ewb.usa.gt</a></strong> on Instagram for application dates and events.</li>
        <li><strong>Find EWB-GT on <a href="${JOIN_LINKS.engage}" target="_blank" rel="noopener">GT Engage</a></strong>, and request to join there once you're accepted.</li>
      </ol>
      <p data-join-interests hidden></p>
      <button class="btn btn--ghost btn--sm" type="button" data-join-edit>${icon('pencil')}Edit my answers</button>`;
    qs('[data-join-title]', done).textContent = `You're on your way, ${first}!`;
    qs('[data-join-lead]', done).textContent = saved
      ? `Thanks! We got your info and will write to ${email}. To make it official:`
      : "This class version of our site doesn't save sign-ups, so here's how to make it official:";
    if (interests.length) {
      const note = qs('[data-join-interests]', done);
      const list = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(interests);
      note.textContent = `Mention your interest in ${list} on your application.`;
      note.hidden = false;
    }
    qs('[data-join-edit]', done).addEventListener('click', () => {
      done.hidden = true;
      done.innerHTML = '';
      form.hidden = false;
      nameInput.focus();
    });
    form.hidden = true;
    done.hidden = false;
    qs('[data-join-title]', done).focus({ preventScroll: true });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    attempted = true;
    status.textContent = '';
    const nameOk = validateName();
    const emailOk = validateEmail();
    if (!nameOk || !emailOk) {
      (nameOk ? emailInput : nameInput).focus();
      return;
    }
    const data = {
      name: nameInput.value.trim().replace(/\s+/g, ' '),
      email: emailInput.value.trim(),
      interests: qsa('input[name="interests"]:checked', form).map((box) => box.value),
    };

    if (!endpoint) {
      showDone(data, false);
      return;
    }

    submit.disabled = true;
    status.textContent = 'Sending…';
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      status.textContent = '';
      showDone(data, true);
    } catch (error) {
      console.error('[join] submission failed', error);
      status.textContent = "We couldn't send that. Try again, or join through Instagram or GT Engage.";
    } finally {
      submit.disabled = false;
    }
  });
}
