// Static markup for the Explore Georgia map, built from data/regions.json.
// Everything here is readable without JavaScript: the inline SVG map (with
// numbered pins) and the six stories as plain cards. scripts/map.js turns it
// into the interactive map (drops, tooltip, dialog, filters, zoom, world view).

const CITE = /\[\[([\w-]+)\]\]/g;
const ITALIC = /\*([^*]+)\*/g;

// "[[source-id]]" tokens in regions.json become numbered citation links, and
// "*E. coli*" becomes italic.
export function withCitations(text, escapeHtml) {
  return escapeHtml(text)
    .replace(ITALIC, '<i>$1</i>')
    .replace(CITE, (_, id) => `<sup><a class="cite" href="#src-${id}"></a></sup>`);
}

export function statText(stat) {
  return `${stat.prefix || ''}${stat.value.toLocaleString('en-US')}${stat.suffix || ''}`;
}

const DROP_PATH = 'M20 2C15.5 12.5 4 20.5 4 32.5a16 16 0 0 0 32 0C36 20.5 24.5 12.5 20 2Z';

const FILTERS = [
  { id: 'all', label: 'All', icon: 'map' },
  { id: 'supply', label: 'Water supply', icon: 'droplets' },
  { id: 'quality', label: 'Water quality', icon: 'test-tube' },
  { id: 'sanitation', label: 'Sanitation', icon: 'toilet' },
];

const icon = (name, cls = '') => `<svg class="icon${cls ? ` ${cls}` : ''}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

export default function renderMap({ readJSON, readText, escapeHtml }) {
  const regions = readJSON('data/regions.json').sort((a, b) => a.order - b.order);
  const sources = new Map(readJSON('data/sources.json').map((s) => [s.id, s]));
  const svg = readText('assets/map/georgia.svg').replace(/<\?xml[^>]*\?>\s*/, '').trim();

  const sourceLink = (id) => {
    const src = sources.get(id);
    if (!src) throw new Error(`[map] unknown source "${id}"`);
    const label = `Source: ${src.publisher ? `${src.publisher}, ` : ''}${src.title} (opens in a new tab)`;
    return `<a class="map-source" href="${escapeHtml(src.url)}" target="_blank" rel="noopener" aria-label="${escapeHtml(label)}">Source${icon('external-link')}</a>`;
  };

  const filters = FILTERS.map(
    (f) =>
      `<button class="chip map-chip" type="button" data-filter="${f.id}" aria-pressed="${f.id === 'all'}">${icon(f.icon)}${f.label}</button>`,
  ).join('');

  const pins = regions
    .map((r, i) => {
      const off = r.offset ? ` data-dx="${r.offset.dx}" data-dy="${r.offset.dy}"` : '';
      const label = `${r.name}, ${r.issue.toLowerCase()} issue, open details`;
      // .pin sits on the true location; .pin__anchor carries the declutter offset;
      // the button falls in (GSAP) and its body grows on hover (CSS).
      return `<li class="pin" data-id="${r.id}" data-filters="${r.filters.join(' ')}" style="--x:${r.pin.x}%;--y:${r.pin.y}%;--i:${i}"${off}>
<span class="pin__dot" aria-hidden="true"></span><span class="pin__leader" aria-hidden="true"></span>
<span class="pin__anchor"><span class="pin__ripple" aria-hidden="true"></span>
<button class="drop" type="button" data-hotspot="${r.id}" aria-haspopup="dialog" aria-label="${escapeHtml(label)}"><span class="drop__body" aria-hidden="true">
<svg class="drop__shape" viewBox="0 0 40 50"><path d="${DROP_PATH}"/></svg>${icon(r.icon, 'drop__icon')}<svg class="drop__check" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5"/><path d="M7.5 12.4l3 3 6-6.4"/></svg>
</span></button></span></li>`;
    })
    .join('');

  const cards = regions
    .map(
      (r) => `<article class="map-story card card--ice on-light" id="story-${r.id}" data-id="${r.id}" data-filters="${r.filters.join(' ')}">
<p class="label map-story__issue">${icon(r.icon)}${escapeHtml(r.issue)}</p>
<h3 class="map-story__name">${escapeHtml(r.name)}</h3>
<p class="map-story__headline">${escapeHtml(r.headline)}</p>
<p class="map-story__stat"><strong class="map-story__num">${escapeHtml(statText(r.stat))}</strong> ${withCitations(r.stat.label, escapeHtml)}<sup><a class="cite" href="#src-${r.stat.source}"></a></sup> ${sourceLink(r.stat.source)}</p>
<p class="map-story__text">${withCitations(r.story, escapeHtml)}</p>
<p class="map-story__done">${icon('sprout')}<span>${withCitations(r.done, escapeHtml)}</span></p>
<p class="map-story__why">${icon('graduation-cap')}<span>${escapeHtml(r.whyYou)}</span></p>
<a class="btn btn--navy btn--sm map-story__action" href="${escapeHtml(r.action.href)}"${r.action.href.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${escapeHtml(r.action.label)}${icon('arrow-right')}</a>
</article>`,
    )
    .join('\n');

  const trackerDrops = regions.map(() => '<li></li>').join('');

  return `<div class="map-app" id="map-app" data-map-app>
<div class="map-layout">
<div class="map-side">
<div class="map-progress" data-progress>
<ol class="map-progress__drops" aria-hidden="true">${trackerDrops}</ol>
<p class="map-progress__text" data-progress-text><span data-progress-count>0</span> of ${regions.length} explored</p>
</div>
<div class="map-filters" role="group" aria-label="Filter hotspots by issue">${filters}</div>
<div class="map-tools">
<button class="map-tool" type="button" data-toggle="rivers" aria-pressed="true">${icon('waves')}Rivers</button>
<button class="map-tool" type="button" data-toggle="list" aria-pressed="false" aria-controls="map-list">${icon('list')}List<span class="map-tool__extra"> view</span></button>
<button class="map-tool" type="button" data-world-open aria-label="World view: zoom out to the world">${icon('globe')}World<span class="map-tool__extra"> view</span></button>
</div>
</div>
<div class="map-stage" data-map-stage>
<div class="map-canvas">${svg}</div>
<ol class="map-pins" aria-label="Hotspots, north to south">${pins}</ol>
<div class="map-tip" data-tip aria-hidden="true" hidden></div>
<div class="map-world" data-world hidden></div>
</div>
<div class="map-panel" data-panel role="dialog" aria-modal="true" aria-labelledby="map-panel-title" data-lenis-prevent hidden></div>
</div>
<div class="map-list" id="map-list" data-list role="region" aria-label="Hotspot stories">
${cards}
</div>
</div>`;
}
