// Word count per section, measured on the built page (run `npm run build` first).
// The assignment asks for 1,200-2,000 words of written content. Following the PRD,
// map pop-up text is counted inside its section; the Sources list, the video
// transcript, decorative SVG text and navigation chrome are not counted.
//
//   npm run build && npm run check:words

import fs from 'node:fs';

const BUDGET = { home: 60, issue: 300, map: 450, watch: 80, solutions: 300, gt: 200, act: 250, about: 100 };
const html = fs.readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');

function stripBlocks(input) {
  return input
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<template[\s\S]*?<\/template>/gi, ' ')
    .replace(/<details class="transcript"[\s\S]*?<\/details>/gi, ' ')
    .replace(/<ol class="sources__list"[\s\S]*?<\/ol>/gi, ' ')
    .replace(/<sup>[\s\S]*?<\/sup>/gi, ' ')
    .replace(/<[^>]*\bdata-wordcount="skip"[^>]*>[\s\S]*?<\/(div|p|span|ul|li|section|aside)>/gi, ' ');
}

function toWords(fragment) {
  const text = stripBlocks(fragment)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z#0-9]+;/gi, ' ');
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
}

function sectionHtml(id) {
  const start = html.indexOf(`id="${id}"`);
  if (start === -1) return '';
  const open = html.lastIndexOf('<section', start);
  const end = html.indexOf('</section>', start);
  return html.slice(open, end);
}

let total = 0;
console.log('Section        words   budget');
for (const [id, budget] of Object.entries(BUDGET)) {
  const words = toWords(sectionHtml(id)).length;
  total += words;
  console.log(`${`#${id}`.padEnd(14)} ${String(words).padStart(5)}   ${String(budget).padStart(6)}`);
}
console.log(`${'TOTAL'.padEnd(14)} ${String(total).padStart(5)}   ${String(Object.values(BUDGET).reduce((a, b) => a + b, 0)).padStart(6)}`);
console.log(total >= 1200 && total <= 2000 ? 'Within the 1,200-2,000 word requirement.' : 'OUTSIDE the 1,200-2,000 word requirement!');
process.exitCode = total >= 1200 && total <= 2000 ? 0 : 1;
