#!/usr/bin/env node
// Builds the Explore Georgia map:
//   assets/map/georgia.svg   the inline SVG (regions, rivers, lakes, labels)
//   data/regions.json        each hotspot's pin {x, y} (percent of the map box),
//                            projected from its real latitude/longitude
//
// Run: npm run build:map
//
// Data sources (public domain or official):
// - State and county boundaries: U.S. Census Bureau cartographic boundary files
//   (2017), redistributed as TopoJSON by the us-atlas package (counties-10m.json).
// - Region groups: Georgia's 12 Regional Commissions, county membership read from
//   the Georgia Department of Community Affairs map "Regional Commissions,
//   Effective July 1, 2021" (https://dca.georgia.gov/media/50266/download).
//   Stored in tools/data/ga-regional-commissions.json.
// - Rivers and lakes: Natural Earth 1:10m physical vectors (public domain):
//   rivers_lake_centerlines, rivers_north_america, lakes, lakes_north_america.
//   Trimmed to Georgia in tools/data/ga-hydro.json. To regenerate it, download the
//   four GeoJSON files from https://github.com/nvkelso/natural-earth-vector
//   (geojson/ne_10m_*.geojson) into a folder and run:
//     node tools/build-map.mjs --hydro <folder>
// - City label positions: decimal coordinates of each city center.
//
// Projection: Lambert conformal conic with the Georgia Statewide Lambert standard
// parallels (31°25'N, 34°17'N) and central meridian (83°30'W).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoArea, geoConicConformal, geoContains, geoDistance, geoPath } from 'd3-geo';
import * as topojson from 'topojson-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => path.join(ROOT, p);
const readJSON = (p) => JSON.parse(fs.readFileSync(rel(p), 'utf8'));

/* --------------------------------------------------------------------------
   Optional step: trim Natural Earth hydrography to Georgia
   -------------------------------------------------------------------------- */

const GA_BOX = [-85.8, 30.2, -80.6, 35.2];
const inBox = ([x, y]) => x >= GA_BOX[0] && x <= GA_BOX[2] && y >= GA_BOX[1] && y <= GA_BOX[3];
const round4 = (pt) => [Math.round(pt[0] * 1e4) / 1e4, Math.round(pt[1] * 1e4) / 1e4];

// Major rivers are stitched into one continuous upstream-to-downstream line so
// they can "flow in" and shimmer. `source` is the headwater end; parts that
// start south of `minLat` (Florida reaches) are left out.
const MAJOR = {
  chattahoochee: { names: ['Chattahoochee'], source: [-83.746, 34.716], minLat: 30.72 },
  flint: { names: ['Flint'], source: [-84.452, 33.625], minLat: 30.7 },
  savannah: { names: ['Chattooga', 'Tugaloo', 'Savannah'], source: [-83.121, 35.076], minLat: 31.9 },
};

// Context rivers drawn faintly (each may have several parts).
const MINOR = {
  altamaha: { file: 'centerlines', name: 'Altamaha' },
  oconee: { file: 'centerlines', name: 'Oconee' },
  ocmulgee: { file: 'na', name: 'Ocmulgee' },
  ogeechee: { file: 'na', name: 'Ogeechee' },
  satilla: { file: 'na', name: 'Satilla' },
  stmarys: { file: 'na', name: 'St. Marys' },
  alapaha: { file: 'na', name: 'Alapaha' },
  withlacoochee: { file: 'na', name: 'Withlacoochee' },
  ochlockonee: { file: 'na', name: 'Ochlockonee' },
  etowah: { file: 'na', name: 'Etowah' },
  oostanaula: { file: 'na', name: 'Oostanaula' },
};

const LAKES = {
  lanier: 'Lake Sidney Lanier',
  seminole: 'Lake Seminole',
  wfgeorge: 'Walter F. George Reservoir',
  hartwell: 'Hartwell Lake',
  thurmond: 'J. Strom Thurmond Lake',
  russell: 'Richard B. Russell Lake',
  allatoona: 'Allatoona Lake',
  sinclair: 'Lake Sinclair',
};

function linesOf(geometry) {
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

// Chain line parts end to end, starting at the part nearest `source`.
function chain(parts, source, tolerance = 0.03) {
  const remaining = parts.filter((p) => p.length > 1);
  const out = [];
  let end = source;
  while (remaining.length) {
    let best = -1;
    let reverse = false;
    let bestD = Infinity;
    remaining.forEach((p, i) => {
      const ds = dist(p[0], end);
      const de = dist(p[p.length - 1], end);
      if (ds < bestD) [bestD, best, reverse] = [ds, i, false];
      if (de < bestD) [bestD, best, reverse] = [de, i, true];
    });
    if (out.length && bestD > tolerance) break;
    const [part] = remaining.splice(best, 1);
    const oriented = reverse ? [...part].reverse() : part;
    out.push(...(out.length ? oriented.slice(1) : oriented));
    end = out[out.length - 1];
  }
  return out;
}

function extractHydro(dir) {
  const load = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.geojson`), 'utf8')).features;
  const centerlines = load('ne_10m_rivers_lake_centerlines');
  const na = load('ne_10m_rivers_north_america');
  const lakes = [...load('ne_10m_lakes'), ...load('ne_10m_lakes_north_america')];
  const all = [...centerlines, ...na];

  const major = {};
  for (const [id, { names, source, minLat }] of Object.entries(MAJOR)) {
    const parts = all
      .filter((f) => names.includes(f.properties.name))
      .flatMap((f) => linesOf(f.geometry))
      .filter((line) => line.some(inBox) && line[0][1] >= minLat);
    major[id] = chain(parts, source).map(round4);
  }

  const minor = {};
  for (const [id, { file, name }] of Object.entries(MINOR)) {
    const pool = file === 'na' ? na : centerlines;
    minor[id] = pool
      .filter((f) => f.properties.name === name)
      .flatMap((f) => linesOf(f.geometry))
      .filter((line) => line.some(inBox))
      .map((line) => line.map(round4));
  }

  const lakeOut = {};
  for (const [id, name] of Object.entries(LAKES)) {
    const feature = lakes.find((f) => f.properties.name === name);
    if (!feature) throw new Error(`lake not found: ${name}`);
    const polys = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    lakeOut[id] = { name, polygons: polys.map((rings) => rings.map((ring) => ring.map(round4))) };
  }

  const out = {
    source:
      'Natural Earth 1:10m physical vectors (public domain): rivers_lake_centerlines, rivers_north_america, lakes, lakes_north_america. Trimmed to Georgia by tools/build-map.mjs --hydro.',
    major,
    minor,
    lakes: lakeOut,
  };
  fs.writeFileSync(rel('tools/data/ga-hydro.json'), `${JSON.stringify(out)}\n`);
  console.log('wrote tools/data/ga-hydro.json');
}

/* --------------------------------------------------------------------------
   Map build
   -------------------------------------------------------------------------- */

const VIEW_W = 1000;
const PAD_X = 64;
const PAD_TOP = 72;
const PAD_BOTTOM = 60;

// City labels for orientation (not hotspots). [lon, lat], label anchor offset.
const CITIES = [
  { name: 'Atlanta', at: [-84.388, 33.749], dx: -14, dy: 60, anchor: 'end' },
  { name: 'Athens', at: [-83.3576, 33.9519], dx: 12, dy: 8, anchor: 'start' },
  { name: 'Augusta', at: [-82.0105, 33.4735], dx: -12, dy: 8, anchor: 'end' },
  { name: 'Macon', at: [-83.6324, 32.8407], dx: -12, dy: -4, anchor: 'end' },
  { name: 'Columbus', at: [-84.9877, 32.461], dx: 12, dy: 8, anchor: 'start' },
  // Savannah sits on the map's right edge beside the coast drop, so its label
  // goes above the dot, offset in screen pixels (styles: .map-city--above).
  { name: 'Savannah', at: [-81.0912, 32.0809], dx: 0, dy: 0, anchor: 'end', cls: 'map-city--above' },
  { name: 'Valdosta', at: [-83.2785, 30.8327], dx: 12, dy: 8, anchor: 'start' },
];

// River labels: placed at a point along the river with a rotation (degrees).
const RIVER_LABELS = [
  { name: 'Chattahoochee R.', at: [-85.06, 31.62], rotate: -88, dx: -10 },
  { name: 'Flint R.', at: [-84.09, 31.98], rotate: -72, dx: 12 },
  { name: 'Savannah R.', at: [-82.0, 33.12], rotate: 52, dx: 14 },
];

const STATE_LABELS = [
  { name: 'TENNESSEE', at: [-84.9, 35.13], cls: 'map-state-label--top' },
  { name: 'NORTH CAROLINA', at: [-83.3, 35.13], cls: 'map-state-label--top' },
  { name: 'SOUTH CAROLINA', at: [-81.75, 34.15] },
  { name: 'ALABAMA', at: [-85.72, 32.6], rotate: -90 },
  { name: 'FLORIDA', at: [-83.3, 30.24] },
  { name: 'ATLANTIC', at: [-80.92, 31.05], rotate: -90 },
];

const NEIGHBORS = ['01', '12', '37', '45', '47']; // AL, FL, NC, SC, TN

// Douglas–Peucker simplification in projected (screen) units.
function segmentDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function simplifyLine(points, project, tolerance) {
  if (points.length <= 2) return points;
  const projected = points.map(project);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0;
    let index = -1;
    for (let i = a + 1; i < b; i += 1) {
      const d = segmentDistance(projected[i], projected[a], projected[b]);
      if (d > max) [max, index] = [d, i];
    }
    if (max > tolerance) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// Simplify every arc of a TopoJSON topology once. Shared borders are stored as
// shared arcs, so neighboring regions still meet exactly (no slivers or gaps).
function simplifyTopology(topology, project, tolerance) {
  const [kx, ky] = topology.transform.scale;
  const [tx, ty] = topology.transform.translate;
  const arcs = topology.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    const absolute = arc.map(([qx, qy]) => {
      x += qx;
      y += qy;
      return [x * kx + tx, y * ky + ty];
    });
    return simplifyLine(absolute, project, tolerance);
  });
  const { transform, ...rest } = topology;
  return { ...rest, arcs };
}

// Rewrite d3's absolute "M x,y L x,y ... Z" output as compact relative commands.
// Deltas are taken between already-rounded points, so nothing drifts.
function compactPath(d) {
  if (!d) return '';
  const fmt = (n) => {
    const r = Math.round(n * 10) / 10;
    return (Object.is(r, -0) ? 0 : r).toString().replace(/^(-?)0\./, '$1.');
  };
  let out = '';
  // A number needs a leading space unless it follows a command letter or starts with "-".
  const emit = (s, afterLetter) => {
    out += afterLetter || s.startsWith('-') ? s : ` ${s}`;
  };
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  for (const [, cmd, args] of d.matchAll(/([MLZ])([^MLZ]*)/g)) {
    if (cmd === 'Z') {
      out += 'z';
      cx = sx;
      cy = sy;
      continue;
    }
    const nums = args.split(/[ ,]+/).filter(Boolean).map(Number);
    for (let i = 0; i < nums.length; i += 2) {
      const x = Math.round(nums[i] * 10) / 10;
      const y = Math.round(nums[i + 1] * 10) / 10;
      let afterLetter = false;
      if (cmd === 'M' && i === 0) {
        // Relative moveto; following pairs are implicit relative linetos.
        out += 'm';
        afterLetter = true;
        sx = x;
        sy = y;
      }
      emit(fmt(x - cx), afterLetter);
      emit(fmt(y - cy), false);
      cx = x;
      cy = y;
    }
  }
  return out;
}

// Decode a path (absolute M/L/Z or compact m/z with implicit pairs) into
// subpaths of absolute points. Used to verify compactPath round-trips exactly.
function decodePath(d) {
  const tokens = d.match(/[MLZmlz]|-?(?:\d+\.?\d*|\.\d+)/g) || [];
  const subpaths = [];
  let cmd = '';
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let pending = [];
  let current = null;
  for (const t of tokens) {
    if (/[MLZmlz]/.test(t)) {
      cmd = t;
      if (t === 'Z' || t === 'z') {
        x = sx;
        y = sy;
      }
      continue;
    }
    pending.push(Number(t));
    if (pending.length < 2) continue;
    const [a, b] = pending;
    pending = [];
    const relative = cmd === 'm' || cmd === 'l';
    x = relative ? x + a : a;
    y = relative ? y + b : b;
    if (cmd === 'M' || cmd === 'm') {
      current = [];
      subpaths.push(current);
      sx = x;
      sy = y;
      cmd = cmd === 'm' ? 'l' : 'L';
    }
    current.push([x, y]);
  }
  return subpaths;
}

function assertSamePath(original, compact, label) {
  const a = decodePath(original);
  const b = decodePath(compact);
  const flat = (subs) => subs.flat();
  const pa = flat(a);
  const pb = flat(b);
  if (a.length !== b.length || pa.length !== pb.length) {
    throw new Error(`compactPath changed the shape of ${label}: ${a.length}/${pa.length} vs ${b.length}/${pb.length}`);
  }
  pa.forEach((p, i) => {
    if (Math.abs(p[0] - pb[i][0]) > 0.051 || Math.abs(p[1] - pb[i][1]) > 0.051) {
      throw new Error(`compactPath drifted on ${label} at point ${i}: ${p} vs ${pb[i]}`);
    }
  });
}

function rewind(geometry) {
  // d3-geo expects clockwise exterior rings; GeoJSON (RFC 7946) uses the opposite.
  const fix = (rings) => rings.map((ring) => {
    const area = geoArea({ type: 'Polygon', coordinates: [ring] });
    return area > 2 * Math.PI ? [...ring].reverse() : ring;
  });
  if (geometry.type === 'Polygon') return { type: 'Polygon', coordinates: fix(geometry.coordinates) };
  return { type: 'MultiPolygon', coordinates: geometry.coordinates.map(fix) };
}

function buildMap() {
  const us = readJSON('node_modules/us-atlas/counties-10m.json');
  const rc = readJSON('tools/data/ga-regional-commissions.json');
  const hydro = readJSON('tools/data/ga-hydro.json');
  const regionsPath = 'data/regions.json';
  const hotspots = readJSON(regionsPath);

  const states = topojson.feature(us, us.objects.states).features;
  const georgia = states.find((f) => f.id === '13');
  const gaCounties = us.objects.counties.geometries.filter((g) => g.id.startsWith('13'));
  if (gaCounties.length !== 159) throw new Error(`expected 159 Georgia counties, got ${gaCounties.length}`);

  const regionOf = new Map();
  for (const region of rc.regions) for (const county of region.counties) regionOf.set(county, region.id);
  for (const g of gaCounties) {
    if (!regionOf.has(g.properties.name)) throw new Error(`county without a region: ${g.properties.name}`);
  }

  // Fit Georgia to the view width, then size the height to match.
  const projection = geoConicConformal().parallels([31 + 25 / 60, 34 + 17 / 60]).rotate([83.5, 0]);
  projection.fitWidth(VIEW_W - PAD_X * 2, georgia);
  const probe = geoPath(projection).bounds(georgia);
  const gaH = probe[1][1] - probe[0][1];
  const VIEW_H = Math.round(gaH + PAD_TOP + PAD_BOTTOM);
  projection.fitExtent(
    [
      [PAD_X, PAD_TOP],
      [VIEW_W - PAD_X, VIEW_H - PAD_BOTTOM],
    ],
    georgia,
  );
  const verified = (absolute, label) => {
    const compact = compactPath(absolute);
    if (absolute) assertSamePath(absolute, compact, label);
    return compact;
  };
  const fullPath = geoPath(projection).digits(1);
  const path = (geometry, label = 'path') => verified(fullPath(geometry), label);
  const clippedPath = geoPath(projection.clipExtent([[-20, -20], [VIEW_W + 20, VIEW_H + 20]])).digits(1);
  const clipped = (geometry, label = 'clipped') => verified(clippedPath(geometry), label);
  const P = (lonlat) => projection(lonlat).map((n) => Math.round(n * 10) / 10);
  const project = (lonlat) => projection(lonlat);

  // Draw from a simplified copy of the topology (about half a map unit of error).
  const topo = simplifyTopology(us, project, 0.55);
  const topoGeorgia = topojson.feature(topo, topo.objects.states).features.find((f) => f.id === '13');
  const topoCounties = topo.objects.counties.geometries.filter((g) => g.id.startsWith('13'));
  const sameState = (a, b) => a !== b && a.id.startsWith('13') && b.id.startsWith('13');
  const regionId = (g) => regionOf.get(g.properties.name);

  // Region groups: dissolve counties per Regional Commission. Containment checks
  // use the full-detail geometry; drawing uses the simplified one.
  const regionPaths = rc.regions.map((region) => {
    const inRegion = (g) => regionId(g) === region.id;
    const merged = topojson.merge(us, gaCounties.filter(inRegion));
    const drawn = topojson.merge(topo, topoCounties.filter(inRegion));
    return { ...region, feature: { type: 'Feature', geometry: merged }, d: path(drawn) };
  });

  // Faint county lines inside each region, from a coarser copy (they never sit on a region border).
  const topoFaint = simplifyTopology(us, project, 1.1);
  const countyMesh = path(
    topojson.mesh(topoFaint, topoFaint.objects.counties, (a, b) => sameState(a, b) && regionId(a) === regionId(b)),
  );
  const regionMesh = path(
    topojson.mesh(topo, topo.objects.counties, (a, b) => sameState(a, b) && regionId(a) !== regionId(b)),
  );
  const outline = path(topoGeorgia);
  // Compact paths start with a relative "m", so multi-part layers are built as one
  // geometry (FeatureCollection / MultiLineString) and compacted once, never joined.
  const neighbors = clipped(
    {
      type: 'FeatureCollection',
      features: topojson.feature(topo, topo.objects.states).features.filter((f) => NEIGHBORS.includes(f.id)),
    },
    'neighbors',
  );

  // Rivers and lakes (simplified the same way).
  const line = (coords, tolerance) =>
    path({ type: 'LineString', coordinates: simplifyLine(coords, project, tolerance) });
  const majorRivers = Object.entries(hydro.major).map(([id, coords]) => ({ id, d: line(coords, 0.45) }));
  const minorRivers = path(
    {
      type: 'MultiLineString',
      coordinates: Object.values(hydro.minor)
        .flat()
        .map((coords) => simplifyLine(coords, project, 0.9)),
    },
    'minor rivers',
  );
  const lakes = Object.entries(hydro.lakes).map(([id, lake]) => ({
    id,
    name: lake.name,
    d: path(
      rewind({
        type: 'MultiPolygon',
        coordinates: lake.polygons.map((rings) => rings.map((ring) => simplifyLine(ring, project, 0.5))),
      }),
    ),
  }));

  // Hotspot pins from real coordinates; check each sits inside its region group.
  for (const spot of hotspots) {
    const lonlat = [spot.coords.lon, spot.coords.lat];
    const region = regionPaths.find((r) => r.id === spot.region);
    if (!region) throw new Error(`${spot.id}: unknown region "${spot.region}"`);
    if (!geoContains(region.feature, lonlat)) {
      // The 1:10m Census lines are generalized by up to a couple of kilometers
      // (Lake Lanier's county line runs through open water), so accept pins
      // within 3 km of their region and say so.
      const rings = region.feature.geometry.coordinates.flat();
      const km = Math.min(...rings.flat().map((p) => geoDistance(lonlat, p) * 6371));
      if (km > 3) throw new Error(`${spot.id}: ${lonlat} is ${km.toFixed(1)} km outside region "${spot.region}"`);
      console.log(`  note: ${spot.id} sits ${km.toFixed(1)} km from region "${spot.region}" on the generalized lines`);
    }
    const [x, y] = projection(lonlat);
    spot.pin = { x: Math.round((x / VIEW_W) * 10000) / 100, y: Math.round((y / VIEW_H) * 10000) / 100 };
  }
  fs.writeFileSync(rel(regionsPath), `${JSON.stringify(hotspots, null, 2)}\n`);

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const cityLabels = CITIES.map((c) => {
    const [x, y] = P(c.at);
    return `<g class="map-city${c.cls ? ` ${c.cls}` : ''}"><circle cx="${x}" cy="${y}" r="4"/><text x="${Math.round(x + c.dx)}" y="${Math.round(y + c.dy)}" text-anchor="${c.anchor}">${esc(c.name)}</text></g>`;
  }).join('');
  const riverLabels = RIVER_LABELS.map((r) => {
    const [x, y] = P(r.at);
    const tx = Math.round(x + (r.dx || 0));
    return `<text class="map-river-label" x="${tx}" y="${Math.round(y)}" transform="rotate(${r.rotate} ${tx} ${Math.round(y)})" text-anchor="middle">${esc(r.name)}</text>`;
  }).join('');
  const stateLabels = STATE_LABELS.map((s) => {
    const [x, y] = P(s.at);
    const rot = s.rotate ? ` transform="rotate(${s.rotate} ${Math.round(x)} ${Math.round(y)})"` : '';
    const cls = s.cls ? `map-state-label ${s.cls}` : 'map-state-label';
    return `<text class="${cls}" x="${Math.round(x)}" y="${Math.round(y)}" text-anchor="middle"${rot}>${esc(s.name)}</text>`;
  }).join('');

  const ordered = [...hotspots].sort((a, b) => a.order - b.order);
  // No-JS fallback pins (numbered like the list cards). Crowded pins fan out on
  // a leader line, matching the interactive drops.
  const staticPins = ordered
    .map((s, i) => {
      const x = Math.round((s.pin.x / 100) * VIEW_W * 10) / 10;
      const y = Math.round((s.pin.y / 100) * VIEW_H * 10) / 10;
      const ox = s.offset ? Math.round(s.offset.dx * 1.4) : 0;
      const oy = s.offset ? Math.round(s.offset.dy * 1.4) : 0;
      const leader = s.offset ? `<path d="M0 0L${ox} ${oy}"/><circle class="map-static-pin__dot" r="5"/>` : '';
      return `<g class="map-static-pin" transform="translate(${x} ${y})">${leader}<g transform="translate(${ox} ${oy})"><circle r="17"/><text y="7" text-anchor="middle">${i + 1}</text></g></g>`;
    })
    .join('');

  // A 50-mile scale bar near the bottom-left corner.
  const a = projection([-85.45, 30.5]);
  const b = projection([-85.45 + 80.4672 / (111.32 * Math.cos((30.5 * Math.PI) / 180)), 30.5]);
  const barLen = Math.round(b[0] - a[0]);
  const barX = PAD_X;
  const barY = VIEW_H - 22;

  const svg = `<svg class="map-svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="map-svg-title" focusable="false">
<title id="map-svg-title">Map of Georgia with its 12 regional commission areas, major rivers and six water and sanitation hotspots</title>
<path class="map-neighbors" d="${neighbors}"/>
<g class="map-land">
<path class="map-land-shadow" d="${outline}"/>
<g class="map-regions">${regionPaths
    .map((r) => `<path class="map-region" data-region="${r.id}" d="${r.d}"><title>${esc(r.name)}</title></path>`)
    .join('')}</g>
<path class="map-counties" d="${countyMesh}"/>
<path class="map-region-lines" d="${regionMesh}"/>
<path class="map-outline" id="map-outline-path" pathLength="1000" d="${outline}"/>
</g>
<g class="map-water">
<g class="map-lakes">${lakes.map((l) => `<path class="map-lake" data-lake="${l.id}" d="${l.d}"/>`).join('')}</g>
<path class="map-rivers-minor" d="${minorRivers}"/>
<g class="map-rivers">${majorRivers
    .map((r) => `<path class="map-river" id="map-river-${r.id}" data-river="${r.id}" pathLength="1000" d="${r.d}"/>`)
    .join('')}</g>
<g class="map-shimmer">${majorRivers
    .map((r) => `<path class="map-river-shimmer" data-river="${r.id}" pathLength="1000" d="${r.d}"/>`)
    .join('')}</g>
</g>
<g class="map-labels">${stateLabels}${riverLabels}${cityLabels}</g>
<g class="map-scale" transform="translate(${barX} ${barY})"><path d="M0 0h${barLen}M0 -6v12M${barLen} -6v12M${Math.round(barLen / 2)} -4v8"/><text x="${barLen + 10}" y="7">50 mi</text></g>
<g class="map-static-pins">${staticPins}</g>
</svg>
`;
  fs.mkdirSync(rel('assets/map'), { recursive: true });
  fs.writeFileSync(rel('assets/map/georgia.svg'), svg);

  // A light lon/lat outline of Georgia for the "Zoom out to the world" globe.
  const outlineRings = topoGeorgia.geometry.coordinates
    .map((polygon) => polygon[0])
    .sort((a, b) => b.length - a.length)
    .slice(0, 1)
    .map((ring) => simplifyLine(ring, project, 3).map(round4));
  fs.writeFileSync(
    rel('assets/map/georgia-outline.json'),
    `${JSON.stringify({ type: 'Polygon', coordinates: outlineRings })}\n`,
  );
  console.log(`wrote assets/map/georgia.svg (${VIEW_W}x${VIEW_H}, ${(svg.length / 1024).toFixed(1)} KB)`);
  for (const s of ordered) console.log(`  ${s.order}. ${s.id.padEnd(16)} pin ${s.pin.x}%, ${s.pin.y}%  region ${s.region}`);
}

const hydroFlag = process.argv.indexOf('--hydro');
if (hydroFlag !== -1) extractHydro(process.argv[hydroFlag + 1]);
else buildMap();
