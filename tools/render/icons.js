// Inline SVG sprite built from Lucide (ISC license) at build time.
// Use an icon with: <svg class="icon" aria-hidden="true"><use href="#i-droplet"></use></svg>
import fs from 'node:fs';
import path from 'node:path';

const LUCIDE = [
  'droplet', 'droplets', 'waves', 'users', 'wrench', 'coins', 'settings-2', 'hand', 'toilet',
  'shower-head', 'arrow-down', 'arrow-right', 'arrow-up', 'play', 'external-link', 'x',
  'chevron-left', 'chevron-right', 'check', 'sparkles', 'map-pin', 'leaf', 'recycle',
  'flask-conical', 'sun', 'sprout', 'building-2', 'cloud-rain', 'share-2', 'download', 'mail',
  'clock', 'calendar', 'graduation-cap', 'globe', 'microscope', 'lightbulb', 'megaphone',
  'heart-handshake', 'pipette', 'house', 'list', 'map', 'layers', 'zoom-out', 'rotate-ccw',
  'badge-check', 'award', 'info', 'milestone', 'heart-pulse', 'building', 'fish', 'factory',
  'tractor', 'test-tube', 'construction', 'scale', 'link', 'copy', 'menu', 'repeat', 'bubbles',
  'gauge', 'circle-check', 'circle-x', 'trees', 'pencil-ruler', 'hand-coins',
  'send', 'circle-alert', 'pencil', 'hourglass', 'party-popper', 'qr-code',
];

// Lucide no longer ships brand icons; this is a simple camera-glyph outline.
const CUSTOM = {
  instagram:
    '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="0.6" fill="currentColor"/>',
};

export default function renderIcons({ root }) {
  const dir = path.join(root, 'node_modules/lucide-static/icons');
  const symbols = LUCIDE.map((name) => {
    const file = path.join(dir, `${name}.svg`);
    if (!fs.existsSync(file)) throw new Error(`[icons] Lucide icon not found: ${name}`);
    const svg = fs.readFileSync(file, 'utf8');
    const inner = svg
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/^[\s\S]*?<svg[^>]*>/, '')
      .replace(/<\/svg>\s*$/, '')
      .replace(/\s*\n\s*/g, '');
    return `<symbol id="i-${name}" viewBox="0 0 24 24">${inner}</symbol>`;
  });
  for (const [name, inner] of Object.entries(CUSTOM)) {
    symbols.push(`<symbol id="i-${name}" viewBox="0 0 24 24">${inner}</symbol>`);
  }
  return `<svg class="sprite" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden">${symbols.join('')}</svg>`;
}
