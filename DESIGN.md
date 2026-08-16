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

Icon badges use a gradient of the accent, not the flat hex — e.g. green:
`linear-gradient(135deg, #29b87e, var(--green))`, with a matching tinted
box-shadow (`0 6px 14px rgba(31, 169, 113, 0.42)` for green). Follow this
pattern for any new colored icon badge instead of a flat fill.

Color is also an identifier: each entry point in a choice grid (take photo,
upload, barcode, create, macros, etc.) keeps one accent consistently across
every screen it appears on. Don't reassign an accent already claimed by
another action.

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
- Bottom sheets: `border-radius: 22px 22px 0 0`, slide up via `transform: translateY(100%) → 0`, `transition: transform 0.48s cubic-bezier(0.32, 0.72, 0, 1)`
- Mobile breakpoint: `max-width: 380px` gets tighter padding and smaller icon/label sizes — see `.af-tile`, `.af-primary-cta-icon`, `.af-sec-*` in `templates/nutrition.html` for the pattern

## Component pattern: choice screens

When a screen offers several entry actions plus a "recent" list underneath
(see `renderAfChoice()` in `templates/nutrition.html`), prefer one dominant
primary action over a grid of equal-weight tiles — established in the
`analyze-food-photo-modal` redesign (2026-08-16). One large CTA
(`.af-primary-cta`) + a quiet row of small icon buttons (`.af-secondary-row`)
for the rest, each icon reusing its existing accent color from the tile grid.
