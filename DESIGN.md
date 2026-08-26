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
under white text on a button or an icon chip. Used *as* text they miss the
4.5:1 bar, and every place we colour text this way (eyebrows, pills, section
kickers) is 11.5-12.5px, so none of it earns the 3:1 large-text exemption.
Coloured text uses a text-only variant instead -- same hue, same saturation,
lightness moved in whichever direction that theme needs:

| Token | Light | Dark |
|---|---|---|
| `--green-ink` | `#177e54` | reverts to `--green` |
| `--amber-ink` | `#916721` | `#c68c2d` |
| `--blue-ink` | `#2b63e8` | `#5884ed` |

**There is no "always darken" rule -- check, don't assume.** Each accent fails
somewhere different:

- **green** fails only on light. On dark it clears every surface as-is
  (4.6:1 worst case, on `--green-bg`), so dark reverts to the accent.
- **amber** fails on light, and on dark clears `--bg` and `--card-bg` but not
  its own tint `--amber-bg` (3.97:1) -- so dark gets a *lightened* value, not
  a revert.
- **blue** passes on white but misses on `--blue-bg` (4.39:1), and fails every
  dark surface (3.2-3.9:1). It moves both ways: slightly darker on light,
  lighter on dark.

An ink must clear 4.5:1 against every surface it can land on in that theme --
`--bg`, `--card-bg`, and its own `-bg` tint -- including tints no component
uses yet, so a chip added later is safe before it ships rather than after.
Only the three accents we currently set text in have inks; add the matching
one when red, purple or pink is first used as text rather than reaching for
the fill accent.

Live so far in `marketing/styles.css`. `tests/test_marketing_contrast.py`
computes the real ratios from the real tokens for every ink against every
surface in both themes, so it survives a repalette and fails only on a real
regression. It also checks that the two dark blocks (the
`prefers-color-scheme` one and the `[data-theme="dark"]` one) define every ink
identically -- they are hand-duplicated, and an ink added to one and forgotten
in the other breaks only the OS-default path, which is the one nobody clicks
to check.

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

As of v0.4.5.0 (`remove-glow-effects`) this is no longer a rule applied branch
by branch: the remaining 48 colored halos were swept out of every sheet and
template at once, along with the two animated ones (the chat dock's
`ag-bar-breathe` pulse and the tour spotlight's `tour-pulse` ring). The rule is
now enforced mechanically by `tests/test_no_colored_glow_shadows.py`, which
fails on any *blurred* `box-shadow` painted in a chromatic color. Its one blind
spot is documented in the test itself: a colored *zero-blur* ring is
structurally identical to a focus ring, so an animated pulse built that way
would still slip through — review keyframes by eye.

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
