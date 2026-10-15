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
- **Links:** `npm run build && npm run check:links` checks every external link. Publishers that block
  automated checks (HTTP 403 or 429) and one server that sends an incomplete certificate chain are
  listed separately so you can open them in a browser. A DNS error (`ENOTFOUND`) on a link that worked
  before is usually a local network hiccup; re-run the check.

## Team

The PRD asks the footer to name the team. Add member names to the second `about__team` paragraph in
`index.html` ("Made by LMC 3403 Group 2 at Georgia Tech, Fall 2026."), for example
`Made by LMC 3403 Group 2 at Georgia Tech, Fall 2026: Name, Name, Name, Name and Name.`
The page has about 50 words of room under the 2,000-word cap; run `npm run check:words` after.

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
- Contrast: body text is 4.5:1 or better everywhere (axe-core reports no violations). The poster's
  mid-blue (`--wash-blue`) cannot reach 4.5:1 with any text color, so, as the PRD's color rules say,
  only large display text (section titles, the hero subhead) sits directly on it, which meets the
  WCAG AA large-text ratio of 3:1. Body copy on blue sections sits on deep-blue panels or light cards.
- Body text is capped at 70 characters per line (`--measure` in `styles/tokens.css`).

## Revision log

The PRD's acceptance criteria ask for first-draft feedback to be logged and addressed before
Oct. 23. Add a row for each piece of peer or instructor feedback and the commit that addressed it.

| Date | Feedback | What changed | Commit |
|------|----------|--------------|--------|
| Oct. 15 | Pre-draft design review: map panel button invisible, campus strip pinned early, flip-card backs clipped | Fixed all three | `8b67928`, `64e15ae`, `169c4a6` |
| Oct. 15 | Pre-draft PRD audit: lines over 70 characters; Map, Watch, Solutions had no exit cue | 70-character measure; exit cue on every section | `377d929`, `86a3a0f` |
| Oct. 15 | Pre-draft copy review: unexplained acronyms (SDG, EWB-GT, JMP, GAWP), claims stronger than sources | Acronyms explained or removed; claims matched to sources | `86a3a0f`, `8b67928` |
| Oct. 15 | Pre-draft QA pass: phone menu shrank after scrolling; widening or rotating jumped to the top; focus hidden in the campus strip; landscape phones got a cramped nav and map panel; late script brought the loader back | Fixed each | `08b66f4`, `11c8e5a`, `dbce803`, `6319506`, `19f378b`, `8aeae53`, `626aa9c` |
| Oct. 15 | Pre-draft QA pass: no-JS forms put the email in the URL; transcript not keyboard-scrollable; jump links landed under the nav; small layout and Sources typos | Fixed each | `9bddb5f`, `d327275`, `cc2d354`, `de663e1`, `7e33bfc`, `5c11b52`, `c831202` |
|  | *First-draft feedback goes here* |  |  |

## Credits

Sources are listed in the site footer. Photos are credited in captions and in `data/photo-credits.json`.
Icons: [Lucide](https://lucide.dev) (ISC). Fonts: Pixelify Sans and Montserrat (SIL Open Font
License). Libraries: GSAP, Lenis, SplitType, canvas-confetti and html2canvas.
