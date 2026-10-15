// Build-time helpers for index.html.
//
// Writers edit plain data files (data/*.json) and never touch markup. This plugin
// turns that data into static HTML, so every section is readable even when
// JavaScript fails, and it numbers citations automatically:
//
//   <!-- @include assets/map/georgia.svg -->  inlines a file
//   <!-- @render name -->                     inlines tools/render/name.js output
//   <a class="cite" href="#src-ID"></a>       becomes a numbered source link
//   <!-- @sources -->                         the numbered Sources list (footer)
//   %SITE_URL%                                the deployed site URL
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const INCLUDE_RE = /<!--\s*@include\s+(\S+)\s*-->/g;
const RENDER_RE = /<!--\s*@render\s+([\w-]+)\s*-->/g;
const CITE_RE = /<a class="cite" href="#src-([\w-]+)"[^>]*>[^<]*<\/a>/g;
const SOURCES_MARKER = /<!--\s*@sources\s*-->/;

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function replaceAsync(input, re, fn) {
  const jobs = [];
  input.replace(re, (...args) => {
    jobs.push(fn(...args));
    return '';
  });
  const results = await Promise.all(jobs);
  let i = 0;
  return input.replace(re, () => results[i++]);
}

function renderSourceItem(src, n) {
  const parts = [];
  if (src.authors) parts.push(escapeHtml(src.authors));
  parts.push(
    src.url
      ? `<a href="${escapeHtml(src.url)}" target="_blank" rel="noopener">${escapeHtml(src.title)}</a>`
      : escapeHtml(src.title),
  );
  if (src.publisher) parts.push(`<span class="sources__pub">${escapeHtml(src.publisher)}</span>`);
  if (src.date) parts.push(escapeHtml(src.date));
  const type = src.type ? `<span class="sources__type">${escapeHtml(src.type)}</span>` : '';
  const alt = src.altUrl
    ? ` <a class="sources__alt" href="${escapeHtml(src.altUrl)}" target="_blank" rel="noopener">(${escapeHtml(src.altLabel || 'mirror')})</a>`
    : '';
  const note = `${alt}${src.note ? ` <span class="sources__note">${escapeHtml(src.note)}</span>` : ''}`;
  return `<li id="src-${escapeHtml(src.id)}" data-n="${n}">${type}${parts.join('. ')}.${note}</li>`;
}

export default function wishForWash({ siteUrl }) {
  let root = process.cwd();

  const readText = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  const readJSON = (rel) => JSON.parse(readText(rel));
  const exists = (rel) => fs.existsSync(path.join(root, rel));

  return {
    name: 'wish-for-wash',
    configResolved(config) {
      root = config.root;
    },
    handleHotUpdate({ file, server }) {
      // index.html is generated from these files, so reload the page when they change.
      if (/[\\/](data|tools[\\/]render|assets[\\/]map)[\\/]/.test(file)) {
        server.ws.send({ type: 'full-reload' });
      }
    },
    transformIndexHtml: {
      order: 'pre',
      async handler(html) {
        const ctx = { root, siteUrl, readText, readJSON, exists, escapeHtml };

        html = html.replace(INCLUDE_RE, (_, rel) => {
          if (!exists(rel)) throw new Error(`[wish-for-wash] @include file not found: ${rel}`);
          return readText(rel).replace(/<\?xml[^>]*\?>\s*/, '');
        });

        html = await replaceAsync(html, RENDER_RE, async (_, name) => {
          const file = path.join(root, 'tools/render', `${name}.js`);
          if (!fs.existsSync(file)) throw new Error(`[wish-for-wash] renderer not found: tools/render/${name}.js`);
          const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
          return mod.default(ctx);
        });

        // Number citations in order of first appearance and build the Sources list to match.
        const sources = readJSON('data/sources.json');
        const byId = new Map(sources.map((s) => [s.id, s]));
        const order = [];
        html = html.replace(CITE_RE, (_, id) => {
          const src = byId.get(id);
          if (!src) throw new Error(`[wish-for-wash] citation to unknown source "${id}"`);
          if (!order.includes(id)) order.push(id);
          const n = order.indexOf(id) + 1;
          const label = `${src.publisher ? `${src.publisher}: ` : ''}${src.title}`;
          return `<a class="cite" href="#src-${id}" data-src="${id}" aria-label="Source ${n}" title="${escapeHtml(label)}">${n}</a>`;
        });
        // Photo credits join the list for every photo that appears on the page.
        if (exists('data/photo-credits.json')) {
          for (const photo of readJSON('data/photo-credits.json')) {
            if (!html.includes(photo.file)) continue;
            const id = `photo-${photo.id}`;
            if (byId.has(id)) continue;
            const entry = {
              id,
              type: 'Photo credit',
              authors: photo.author,
              title: photo.title,
              publisher: `${photo.license}, via Wikimedia Commons`,
              note: `${photo.modifications}.`,
              url: photo.sourceUrl,
            };
            sources.push(entry);
            byId.set(id, entry);
          }
        }
        const uncited = sources.filter((s) => !order.includes(s.id)).map((s) => s.id);
        const list = [...order, ...uncited]
          .map((id, i) => renderSourceItem(byId.get(id), i + 1))
          .join('\n');
        html = html.replace(SOURCES_MARKER, list);
        html = html.replace(/%SOURCE_COUNT%/g, String(order.length + uncited.length));

        return html.replaceAll('%SITE_URL%', siteUrl);
      },
    },
  };
}
