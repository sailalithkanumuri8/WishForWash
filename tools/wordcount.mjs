// Word count per section, measured on the built page (run `npm run build` first).
// The assignment asks for 1,200-2,000 words of written content. Following the PRD,
// map pop-up text is counted inside its section; the Sources list, the video
// transcript, photo credits and decorative SVG text are not counted.
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
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<details class="transcript"[\s\S]*?<\/details>/gi, ' ')
    .replace(/<ol class="sources__list"[\s\S]*?<\/ol>/gi, ' ')
    .replace(/<sup>[\s\S]*?<\/sup>/gi, ' ')
    // Attribution and other apparatus marked data-wordcount="skip" (photo credits, etc.)
    .replace(/<(\w+)\b[^>]*\bdata-wordcount="skip"[^>]*>[\s\S]*?<\/\1>/gi, ' ');
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

// The quiz is drawn by JavaScript from data/quiz.json, so count it from the data.
const quiz = JSON.parse(fs.readFileSync(new URL('../data/quiz.json', import.meta.url), 'utf8'));
// Every visitor reads all five questions but only one persona result (count the longest).
const questionWords = toWords(quiz.questions.flatMap((q) => [q.prompt, ...q.options, q.explain]).join(' ')).length;
const personaWords = Math.max(
  ...quiz.personas.map((p) => toWords([p.headline, p.summary, p.next?.label].join(' ')).length),
);
const quizWords = questionWords + personaWords;
const all = total + quizWords;
console.log(`${'+ quiz (JS)'.padEnd(14)} ${String(quizWords).padStart(5)}`);
console.log(`${'ALL CONTENT'.padEnd(14)} ${String(all).padStart(5)}`);
const ok = all >= 1200 && all <= 2000;
console.log(ok ? 'Within the 1,200-2,000 word requirement.' : 'OUTSIDE the 1,200-2,000 word requirement!');
process.exitCode = ok ? 0 : 1;
