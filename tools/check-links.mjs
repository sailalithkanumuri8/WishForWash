// Check every external link on the built page and in the data files.
//   npm run build && npm run check:links
// Some publishers block automated requests (HTTP 403/429); those are reported
// separately so a person can confirm them in a browser.

import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, root), 'utf8');

const urls = new Set();
for (const match of read('dist/index.html').matchAll(/(?:href|src)="(https?:\/\/[^"#]+)[^"]*"/g)) urls.add(match[1]);
for (const file of ['data/sources.json', 'data/regions.json', 'data/quiz.json']) {
  if (!fs.existsSync(new URL(file, root))) continue;
  for (const match of read(file).matchAll(/"(https?:\/\/[^"#\s]+)[^"]*"/g)) urls.add(match[1]);
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';

async function check(url) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        headers: { 'user-agent': UA, accept: 'text/html,application/pdf,*/*' },
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok || method === 'GET') return res.status;
    } catch (error) {
      if (method === 'GET') return `ERR ${error.cause?.code || error.name}`;
    }
  }
  return 'ERR';
}

const results = [];
const list = [...urls].sort();
for (let i = 0; i < list.length; i += 6) {
  const batch = list.slice(i, i + 6);
  results.push(...(await Promise.all(batch.map(async (url) => ({ url, status: await check(url) })))));
}

const ok = results.filter((r) => typeof r.status === 'number' && r.status < 400);
const blocked = results.filter((r) => r.status === 403 || r.status === 429 || r.status === 999);
const broken = results.filter((r) => !ok.includes(r) && !blocked.includes(r));

console.log(`${ok.length} OK, ${blocked.length} blocked bots (check by hand), ${broken.length} broken\n`);
for (const r of [...broken, ...blocked]) console.log(`${String(r.status).padEnd(8)} ${r.url}`);
process.exitCode = broken.length ? 1 : 0;
