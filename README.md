# Wish for Wash

A single scrolling website that shows Georgia Tech students how the global clean-water crisis
(UN SDG 6) shows up in their own state, then turns that awareness into one concrete action.
Built for LMC 3403 (Group 2, Fall 2026) from the team's PRD and poster.

**Live site:** https://sailalithkanumuri8.github.io/WishForWash/ (deployed by GitHub Actions)

## Run it locally

```bash
npm install
npm run dev        # http://127.0.0.1:5173 with live reload
npm run build      # production build in dist/
npm run preview    # serve the build at http://127.0.0.1:4173
```

Requires Node 20.19 or newer.

## How the page is organized

One `index.html` with eight `<section>` blocks. The tabs in the nav glide to each one:

| # | Section | Anchor | Job in the arc |
|---|---------|--------|----------------|
| 0 | Hero (logo = Home) | `#home` | Hook |
| 1 | The Issue | `#issue` | Understand the scale |
| 2 | Explore Georgia | `#map` | Feel it locally |
| 3 | Watch | `#watch` | Emotional turn |
| 4 | Solutions | `#solutions` | Show it is solvable |
| 5 | Georgia Tech | `#gt` | Institutional alignment |
| 6 | Take Action | `#act` | Convert |
| 7 | Footer (About + Sources) | `#about` | Credibility |

```
index.html            the one page (eight <section> blocks with ids)
styles/tokens.css     color, type and spacing variables (poster palette)
styles/main.css       everything else, in page order
scripts/main.js       entry point; starts each section, then the motion layer
scripts/nav.js        scroll-spy, smooth scroll, mobile menu, Motion switch, back-to-top
scripts/motion.js     GSAP + Lenis setup, reduced-motion switch, site-wide reveals
scripts/map.js        interactive Georgia map
scripts/pledge-quiz.js  action ladder, Wish Pledge, quiz, join form
scripts/*.js          hero, issue, watch, solutions, campus strip, effects
data/regions.json     map stories (edit text here, not in code)
data/quiz.json        quiz questions and personas
data/sources.json     every source; citations are numbered automatically
assets/               images (WebP), SVG illustrations, fonts
tools/                build helpers, word counter, link checker
```

## Editing content (no code needed)

- **Map stories:** `data/regions.json`.
- **Quiz:** `data/quiz.json` (questions, answers, explanations and the three personas).
- **Sources:** `data/sources.json`. In the HTML, cite a source with
  `<sup><a class="cite" href="#src-ID"></a></sup>`. At build time the citations are numbered in the
  order they first appear, and the footer Sources list is generated to match. Photo credits from
  `data/photo-credits.json` are added to the list automatically for every photo used on the page.
- **Word count:** `npm run build && npm run check:words` prints words per section against the PRD
  budget, adds the quiz text (drawn by JavaScript) and checks the total against the 1,200 to 2,000
  word requirement. The video transcript, Sources list and photo credits are not counted.
- **Links:** `npm run build && npm run check:links` checks every external link. A few publishers
  (gatech.edu news, ScienceDirect) block automated checks with HTTP 403 and one server sends an
  incomplete certificate chain; the report lists those separately so you can open them in a browser.

## Team

The footer credits LMC 3403 Group 2 and the team roles. Add member names in the `about__team`
paragraph in `index.html`.

## Swapping in our own video

The Watch section currently embeds Georgia Tech's "The Kendeda Building: Water Petal" (the PRD's
fallback). To use our own video, change `data-video-id` and `data-video-title` on the
`<figure class="video">` in `index.html`, replace `assets/img/video-poster.webp`, update the caption
and paste our transcript into the `<details class="transcript">` block.

## Join form responses

The class version has no backend: the join form validates the GT email and then points people to
GT Engage and the EWB-GT Instagram. To collect responses, create a Formspree form and put its
endpoint in the form's `data-endpoint` attribute in `index.html`.

## Deploying

Pushing to `main` runs `.github/workflows/deploy.yml`, which builds the site and publishes `dist/` to
GitHub Pages. In the repository settings, set **Pages → Source** to **GitHub Actions** once. The site
URL lives in `vite.config.js` (`SITE_URL`); the canonical link, Open Graph tags and the share QR code
all use it.

## Accessibility and motion

- Semantic landmarks, one `h1`, a skip link and visible focus rings.
- Full keyboard use of the nav, map, quiz and pledge.
- Reduced motion: the site follows the system setting, and the **Motion** switch in the nav turns
  every animation off or on (skips the loader, removes parallax, cursor, particles and pinning, and
  shows final numbers).
- Every section is readable with JavaScript turned off.

## Credits

Sources are listed in the site footer. Photos are credited in captions and in `data/photo-credits.json`.
Icons: [Lucide](https://lucide.dev) (ISC). Fonts: Pixelify Sans and Montserrat (SIL Open Font
License). Libraries: GSAP, Lenis, SplitType, canvas-confetti and html2canvas.
