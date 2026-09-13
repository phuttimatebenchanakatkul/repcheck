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
| `--link` | `#2f66e8` | `#6d9bf5` |

`--link` is the same idea applied to links rather than to labels: policy and
consent links (`.auth-consent a`, `.auth-switch a`, the settings Legal list)
plus the focus ring below. It exists because `--blue` measures 3.39:1 against
`--card-bg` on dark — an AA failure on the one piece of text a user is being
asked to agree to. Light is deliberately the same LITERAL as `--blue`, not
`var(--blue)`: `--blue` is also a fill under white text (`.cta-blue` and
friends), so retuning it for a fill must not silently restyle every policy
link. `tests/test_legal_pass_asset_integrity.py` computes the real ratio on
every surface `--link` can land on.

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

**Status check, 2026-09-12: `--green-ink`, `--amber-ink` and `--blue-ink` are
specified here but do NOT exist in any stylesheet yet** — `git grep green-ink`
hits this file and nothing else, and the `tests/test_marketing_contrast.py`
this section used to cite was never added either. Treat the three rows above
as the agreed values to use when coloured text next needs one, not as tokens
you can reference today. `--link` is the only one of the four that is live
(`static/style.css`, used in `static/auth.css`).

When an ink does ship, the check it needs is the one
`tests/test_legal_pass_asset_integrity.py` already performs for `--link`:
compute real ratios from the real tokens against every surface in both themes,
so it survives a repalette and fails only on a real regression. It should also
assert that the two dark blocks (the `prefers-color-scheme` one and the
`[data-theme="dark"]` one) define every ink identically — they are
hand-duplicated, and an ink added to one and forgotten in the other breaks
only the OS-default path, which is the one nobody clicks to check.

The marketing site keeps its own pair: `--ink` (`#0a0a0a`, the near-black text
and the focus ring) and `--ink-body` (`#2a2a2a`, softer, for the long-form
body copy on the legal pages at a 68ch measure).

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

Webfonts, but **self-hosted** — no Google Fonts link anywhere, in the app or
on the marketing site. The app loads Inter from `static/fonts.css`
(`font-family: "Inter", -apple-system, "Segoe UI", Roboto, Arial, sans-serif`),
and Thai mode swaps the whole stack for
`"SF Pro TH", "SF Thonburi", "Thonburi", "Noto Sans Thai", "Sarabun", ...`
(`:root[data-lang="th"]` in `static/style.css`). The marketing site uses
Archivo for text and JetBrains Mono for eyebrows/labels, from
`marketing/assets/fonts.css`.

The faces are served from `static/fonts/` and `marketing/assets/fonts/`, one
variable face per family+subset declaring a weight RANGE — never one file per
weight. Do not reintroduce a `fonts.googleapis.com` link or a
`fonts.gstatic.com` preconnect: the CSP no longer allowlists either host, and
`/cookies` tells the reader the app loads no fonts from Google. The reasoning,
the subset split, and the per-face weight ranges are documented at the top of
each `fonts.css`; the app-side cache and filename invariants are in CLAUDE.md
under "Fonts are self-hosted".

Observed scale (px, weight):
- 17px / 800 — sheet/modal titles
- 17px / 700 — action-row labels in a bottom sheet (`.af-action-title`); the
  weight, not the size, is what keeps them under the title above them
- 13.5px / 700 — list-row labels, entry names
- 13px / 500 — intro/helper copy
- 11–12px / 700–800 — section eyebrows (uppercase, 0.04–0.08em tracking; the
  smaller the size, the wider the tracking)
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
- Bottom sheets: `border-radius: 34px 34px 0 0`, slide up via `transform: translateY(100%) → 0`, `transition: transform 0.48s cubic-bezier(0.32, 0.72, 0, 1)`
  - Top corners only — the bottom edge sits flush with the viewport. The
    full-screen phone rules keep the same rounding; they must not reset it
    to `border-radius: 0`, or the sheet reads as a bare rectangle on the one
    viewport where it is used most.
- Mobile breakpoint: `max-width: 380px` gets tighter padding and smaller icon/label sizes — see `.af-action-row` / `.af-action-title` in `templates/nutrition.html` for the pattern

## Breakpoints

Five bands, all in `static/style.css`. Width is the only signal except at the
top of the ladder, so the same phone lands in a different band held sideways
than it does held upright — that is intended, not an oversight.

| Band | Reads as | What it changes |
|---|---|---|
| `max-width: 380px` | small phone | tighter padding, smaller icons and labels |
| `max-width: 480px` | phone, portrait | `.app` drops to 8px side padding; `.mobile-tabbar` keeps 8px side gutters |
| `min-width: 481px` | tablet in Split View, phone in landscape | `.mobile-tabbar` is capped at 420px and centred; everything else is still the phone layout |
| `min-width: 721px` | tablet, full screen | the app becomes a centred column in a box — see "Wide screens: the app in a box" in `static/style.css` |
| `min-width: 721px` + `hover: hover` + `pointer: fine` | desktop with a mouse | that box is re-skinned as a phone on a dark desk |

The desk skin needs both media features to agree because a tablet reporting
one of them wrongly must not get a drawn-on phone bezel; that is what
Guideline 4 rejected 0.7.1 (33). See IOS_APP_STORE.md.

**480 and 481 are a pair.** The tab-bar cap starts exactly one pixel above
where the phone rule stops. Move one without the other and you get either a
gap (481–720px uncapped, which is the whole Split View range — the bug fixed
in v0.11.1.0, where a 720px window rendered a 696px bar that snapped to 420px
at 721px) or an overlap (the cap stripping the phone's 8px gutters, since both
rules are `.mobile-tabbar` at the same specificity). `tests/test_ipad_layout.py`
holds the pairing, the 420px cap, its 12px `max()` floor, and the cap's
position in the file.

## Focus: `:focus-visible`, and never a bare `outline: none`

Every keyboard-reachable thing needs a visible focus indicator (WCAG 2.4.7),
and the indicator goes on `:focus-visible`, not `:focus` — so clicking a field
with a mouse does not draw a ring, and tabbing into it does.

An `outline: none` is only allowed when something else visibly replaces it.
Two patterns are in use, and which one applies depends on whether the control
has a surface of its own:

- **Light the wrapper on `:focus-within`** — `.log-sheet-search`,
  `.pc-ck-weight-field`, `.hx-space-input-wrap`. Use this where there is a
  padded container to tint or border.
- **Ring the input itself** — `outline: 2px solid var(--link)` with
  `outline-offset: 2px`, as on `.auth-field input` and `.ag-inputrow input`.
  Use this where the control has no container to work with. `--link`, not
  `--blue`: `--blue` is 3.39:1 against the dark card, barely over the 3:1
  floor a non-text indicator needs.

A border-colour change on `:focus` is a mouse treatment, not a focus
indicator; keep it and add the ring on top for keyboard.

The marketing site solves the same problem once for the whole page:
`:where(a, button, input, [tabindex]):focus-visible` paints a
`3px solid var(--ink)` ring, and the three dark grounds (`.nav-cta`,
`.btn-dark`, anything inside `.phone-screen`) override `outline-color` to
`var(--paper)` rather than adding per-element rules. The `:where()` wrapper
keeps that base rule at zero specificity on purpose; it also means the rule
declares no `border-radius`, which would otherwise square off any element
with its own radius.

`tests/test_legal_pass_asset_integrity.py` asserts that every input which
suppresses its outline lights up on keyboard focus, so a new
`outline: none` with nothing behind it fails the suite rather than shipping.

## Component pattern: choice screens

When a screen offers several entry actions (see `renderAfChoice()` and
`renderAfMealQuickChoice()` in `templates/nutrition.html`), use a vertical
list of equal-weight rows: `.af-action-list` wrapping `.af-action-row`, each
row a monochrome icon, a label, and a right chevron on a plain rounded
surface. No accent fills, no icon badges, no grid.

This replaced two earlier patterns and the history is worth keeping, because
the reasoning reversed:

- A grid of gradient-badge tiles (`.af-tile`), then
- one dominant CTA (`.af-primary-cta`) plus a quiet row of small accent icon
  buttons (`.af-secondary-row`), established 2026-08-16 on the theory that
  one action deserved the weight.

Both are gone. Promoting one action only works when the sheet always opens
for the same reason, and this one doesn't — it opens from a page button, from
two different quick actions, and from three camera fallbacks, each arriving
with a different action already in mind. Equal-weight rows let every entry
point look correct, and they scale to a screen with one row without leaving a
half-empty grid behind.

A "recent" list, where a screen has one, sits below the rows under an
uppercase eyebrow, as plain rows carrying a name and a single number.
