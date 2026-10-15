// "1 in 4" figure: 100 people, 25 of whom lack safe drinking water.
// Rendered at build time so the graphic exists without JavaScript; the scroll
// animation (scripts/issue.js) fills the 25 figures and drains them as you scroll.

const COLS = 20;
const ROWS = 5;
const CELL_W = 28;
const CELL_H = 52;
const DRY_COUNT = 25;
const FIG_H = 44;

// Small deterministic PRNG so the pattern is stable between builds.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickDry() {
  // One dry figure in every block of four keeps the "1 in 4" visibly even,
  // with a random position inside each block so it doesn't look mechanical.
  const rand = mulberry32(2025);
  const dry = new Set();
  for (let block = 0; block < DRY_COUNT; block += 1) {
    dry.add(block * 4 + Math.floor(rand() * 4));
  }
  return dry;
}

const HEAD = '<circle cx="10" cy="6" r="5.4"/>';
const BODY = '<path d="M2.4 23a7.6 7.6 0 0 1 7.6-7.6 7.6 7.6 0 0 1 7.6 7.6v9.6h-3.3V43h-8.6V32.6H2.4Z"/>';

export default function renderPeople() {
  const dry = pickDry();
  const people = [];
  for (let i = 0; i < COLS * ROWS; i += 1) {
    const x = (i % COLS) * CELL_W + 4;
    const y = Math.floor(i / COLS) * CELL_H + 4;
    const isDry = dry.has(i);
    // Dry figures are drawn empty (the end state); the animation refills them first.
    // A dark void behind their water shows through as it drains.
    const water = isDry
      ? `<rect class="person__void" x="0" y="0" width="20" height="${FIG_H}"/>` +
        `<rect class="person__water" x="0" y="${FIG_H}" width="20" height="0"/>`
      : `<rect class="person__water" x="0" y="0" width="20" height="${FIG_H}"/>`;
    people.push(
      `<g class="person${isDry ? ' person--dry' : ''}" transform="translate(${x} ${y})">` +
        `<g clip-path="url(#person-shape)">${water}</g>` +
        `<g class="person__outline">${HEAD}${BODY}</g>` +
        `</g>`,
    );
  }
  const width = COLS * CELL_W + 4;
  const height = ROWS * CELL_H + 4;
  return (
    `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="100 figures of people; 25 of them, scattered through the group, are empty to show the 1 in 4 who lack safe drinking water.">` +
    `<defs><clipPath id="person-shape">${HEAD}${BODY}</clipPath></defs>` +
    people.join('') +
    `</svg>`
  );
}
