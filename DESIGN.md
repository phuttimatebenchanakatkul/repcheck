# DESIGN.md

Design tokens extracted from `static/style.css`. This is the source of truth
for `/design-shotgun` and `/design-html` — reuse these values instead of
inventing new ones.

## Color

App theme is toggled via `[data-theme="dark"]` on `<html>` (a user setting,
not `prefers-color-scheme`). Every surface/text/border color is a CSS custom
property so both themes stay in sync.

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#f5f6f8` | `#0b0b0c` |
| `--card-bg` | `#ffffff` | `#1c1c1e` |
| `--text` | `#101114` | `#f5f5f7` |
| `--text-secondary` | `#6b6d78` | `#8e8e93` |
| `--border` | `#edeff2` | `#2c2c2e` |

Accent colors (same hex in both themes, only the `-bg` tint flips):

| Token | Accent | Light bg | Dark bg |
|---|---|---|---|
| `--green` | `#1fa971` | `#e7f6ee` | `#12321f` |
| `--red` | `#d1453b` | `#fdeceb` | `#3a1f1e` |
| `--amber` | `#b9832a` | `#fbf1e2` | `#3a2f14` |
| `--blue` | `#2f66e8` | `#eaf0fd` | `#14213f` |
| `--purple` | `#7c4fe0` | `#f3edfd` | `#2a1f45` |
| `--pink` | `#c0398c` | `#fbeaf4` | `#3a1830` |

**Accents are for fills, not for text.** The hexes above are picked to sit
under white text on a button or an icon chip. Used *as* text on a light
surface they land around 2.7-3.1:1, and every place we colour text this way
(eyebrows, pills, section kickers) is 11.5-12.5px, which needs 4.5:1. So
coloured text uses a darkened text-only variant instead -- same hue, same
saturation, lower lightness:

| Token | Light | Dark |
|---|---|---|
| `--green-ink` | `#177e54` | reverts to `--green` |
| `--amber-ink` | `#916721` | reverts to `--amber` |

Dark mode reverts to the accent because the accent already clears AA there
(green 6.5:1, amber 5.9:1) and the darkened shades would be the ones failing.
Only the two accents we actually set text in are defined; add the matching
`-ink` when you first colour text with red, blue, purple or pink rather than
reaching for the fill accent. Live so far in `marketing/styles.css`;
`tests/test_marketing_contrast.py` computes the real ratios and fails if a
token drifts back under the bar.

Icon badges come in two treatments, and which one you use depends on where the
badge sits, not on what it does. Neither treatment has a glow.

**Entry-point badges** — the icon on a choice tile, a primary CTA, a quick
action: a gradient of the accent, not the flat hex (green:
`linear-gradient(135deg, #29b87e, var(--green))`). The gradient is the whole
treatment: no tinted `box-shadow` behind it. This doc used to prescribe one
(`0 6px 14px rgba(31, 169, 113, 0.42)` for green) and it was removed
everywhere it got applied — see `fix/remove-cta-glow-effect`,
`fix/remove-af-icon-glow`, `feat/quick-actions-five`, the HYROX add-a-station
tiles, the personal-bests trophy badge, and the onboarding "You're all set!"
checkmark (`.ob-result-hero-icon`, `feat/onboarding-5-steps`). A colored halo on every badge
reads as decoration competing with the accent it is supposed to carry.
Elevation still belongs on things that actually sit above the page
(`--shadow` on cards, the hover lift on interactive rows — see Layout); it
does not belong on a badge that is flush inside one. Ask before adding a glow
back.

The quick-actions sheet's tiles (`.qa-*` in `static/style.css`) go further and
use FLAT accent fills rather than a gradient — fine, and increasingly the
default for a dense grid of them.

**In-list badges** — the leading glyph on an inset-card row, or an empty
state's icon: flat `var(--<accent>-bg)` fill with a `var(--<accent>)` glyph.
A row is a list item, not a destination, and even a gradient on every row
turns a scannable list into a field of lights. See `.af-icon-emoji` and
`.nl-empty-icon` (`templates/nutrition.html`), and `.nl-create-food-icon`, the
"Create a food" row on the food sheet's Custom tab. Use the `--<accent>-bg`
token rather than an `rgba()` of the accent: the token is redefined per theme,
so a fixed alpha over the dark card reads flat.

Color is also an identifier: each entry point in a choice grid (take photo,
upload, barcode, create, macros, etc.) keeps one accent consistently across
every screen it appears on. Don't reassign an accent already claimed by
another action.

The empty-state mascot is the one deliberate exception, and it is monochrome
precisely because of that rule: it narrates rather than acts, so giving it an
accent would either burn a color no future action could use, or make it change
identity per screen. It has its own greys instead of reusing `--text`, because
`--text` is right on dark (a near-white blob) and wrong on light (a near-black
inkblot on a white card):

| Token | Light | Dark |
|---|---|---|
| `--rc-mascot-body` | `#6b6d78` | `#f5f5f7` |
| `--rc-mascot-detail` | `#3f414a` | `#8e8e93` |

`-body` is the silhouette; `-detail` is the props on and around it (sweatband,
crumbs, speed lines, podium outline) and must stay darker than `-body`, since
some props are drawn on top of it. Long-form reasoning is in `static/mascot.js`.

## Type

System font stack, no webfont: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif`.
Thai text gets its own stack layered in: `"SF Pro TH", "SF Thonburi", "Thonburi", "Noto Sans Thai", ...`.

Observed scale (px, weight):
- 17px / 800 — sheet/modal titles
- 15.5px / 800 — primary CTA titles
- 13.5px / 700 — tile/row labels, entry names
- 13px / 500 — intro/helper copy
- 12px / 700–800 — section eyebrows (uppercase, 0.04–0.06em tracking)
- 11.5px / 400 — meta/caption text (secondary color)

Numeric values that line up in columns (calories, weights, times) should use
`font-variant-numeric: tabular-nums`.

## Layout

- `--radius-lg: 20px` — sheet/modal corners
- `--radius-md: 14px` — cards, rows, tiles
- Small icon badges: 11px radius; small buttons: 999px (full pill)
- `--shadow: 0 1px 2px rgba(16,17,20,.03), 0 8px 24px rgba(16,17,20,.05)` — default resting elevation
- Hover elevation on interactive tiles/rows: `0 8-10px 18-24px rgba(20,20,20,.08-.12)` + `translateY(-1px to -2px)`
  - Not used by the quick-actions tiles: they move `border-color` on hover and
    paint no shadow at all. See the icon-badge exception above.
- Bottom sheets: `border-radius: 22px 22px 0 0`, slide up via `transform: translateY(100%) → 0`, `transition: transform 0.48s cubic-bezier(0.32, 0.72, 0, 1)`
- Mobile breakpoint: `max-width: 380px` gets tighter padding and smaller icon/label sizes — see `.af-tile`, `.af-primary-cta-icon`, `.af-sec-*` in `templates/nutrition.html` for the pattern

## Component pattern: choice screens

When a screen offers several entry actions plus a "recent" list underneath
(see `renderAfChoice()` in `templates/nutrition.html`), prefer one dominant
primary action over a grid of equal-weight tiles — established in the
`analyze-food-photo-modal` redesign (2026-08-16). One large CTA
(`.af-primary-cta`) + a quiet row of small icon buttons (`.af-secondary-row`)
for the rest, each icon reusing its existing accent color from the tile grid.
