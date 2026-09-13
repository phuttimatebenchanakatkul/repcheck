## gstack (recommended)

This project uses [gstack](https://github.com/garrytan/gstack) for AI-assisted workflows.
Install it for the best experience:

```bash
git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup --team
```

Skills like /qa, /ship, /review, /investigate, and /browse become available after install.
Use /browse for all web browsing. Use ~/.claude/skills/gstack/... for gstack file paths.

## API server
Don't start the backend/API server unless the current task actually requires it running.

## The other docs in here
There is no root README -- this file is the entry point.

- [DESIGN.md](DESIGN.md) -- design tokens, type, focus rules. Source of truth
  for `/design-shotgun` and `/design-html`; reuse its values.
- [IOS_APP_STORE.md](IOS_APP_STORE.md) -- the App Store plan, the Guideline
  4.2/4.8 defences, what still needs an Apple account by hand.
- [CHANGELOG.md](CHANGELOG.md) -- written by `/ship`, newest first.
- [TODOS.md](TODOS.md) -- deferred work, with a Completed section.
- [marketing/README.md](marketing/README.md) -- the pre-launch site.

## Testing

Two suites, both must pass before shipping:

```bash
npm run test          # vitest + jsdom -- tests-js/*.test.js
python -m pytest -q   # tests/*.py
```

`npm install` first if vitest is missing. There is no build step; the JS under
test is loaded straight from `static/*.js` and from inline `<script>` blocks in
`templates/*.html` via the extractors in `tests-js/support/`.

Some suites are source-level regex assertions against the real file rather than
behavioural tests (see `tests/test_hyrox_flagged_copy_matches_behavior.py`,
`tests/test_cross_user_name_escaping.py`). That is a deliberate tradeoff for
hand-rolled JS with no module boundary -- when adding one, mutation-check it:
break the thing it guards and confirm the test actually fails.

Escaping note: `RepCheckI18n.t()` does NOT escape its vars, and most list rows
are template literals assigned via `innerHTML`. Any `t()` call carrying
user-controlled data inside one needs an explicit `escapeHtml()`. There is no
shared helper -- each file defines its own.

## Client-side JS: classic scripts, classic workers

Tab pages are swapped in place by `static/pagenav.js`, which re-runs their
inline scripts through `new Function` and SKIPS any `<script>` whose type is
not classic JS. A tab page written as `<script type="module">` never runs when
reached from the tab bar -- silently, with no throw. The same rule holds one
level down: `static/pose_worker.js` (the analyze page's pose detection, off the
main thread) is a CLASSIC worker because MediaPipe's WASM loader calls
`importScripts()`, which module workers refuse outright ("Module scripts don't
support importScripts()"), so `new Worker(url, { type: "module" })` dies at
init every time.

So keep page and worker logic in classic scripts, and pull ESM deps in with a
dynamic `import()` at point of use, with an ABSOLUTE specifier (`new Function`
has no script base URL). A small `type="module"` shim that only hangs things on
`window` is fine (see `templates/nutrition.html`). Note `node --check` is not a
valid classic-parse check -- Node retries as ESM on top-level await and accepts
it; use `new Function(src)` instead.

Teardown follows from the same swap: pagenav replaces the DOM without unloading
the document, so `pagehide` and `visibilitychange` never fire. Anything holding
a resource (camera `MediaStream`, `MediaRecorder`, `Worker`, RAF loop,
`setInterval`/`setTimeout`, object URLs) must release it on
`document.addEventListener("repcheck:page-will-swap", ...)`. `nav_scope` tracks
`setInterval` but not `setTimeout`, and nothing tracks a `MediaStream`, so the
camera pages do this by hand: `templates/index.html`, `templates/nutrition.html`
and `templates/challenges.html` each call their own close/teardown functions
from that listener.

## Touch listeners: arm from state, never for the life of the page

A non-passive `touchmove` (one that calls `preventDefault()`) makes its target's
whole region scroll-blocking for as long as it is attached. Bound at load, it
taxes every scroll on every page for a gesture that is usually impossible. So
attach it only while its gesture can actually start, and remove it otherwise:
`bindSheetDrag` in `templates/base.html` arms on open and disarms on close
(`_sheetDragArm`/`_sheetDragDisarm`, idempotent so a bind that lands after its
own open still arms), and `syncPullArming()` in `static/analyze_chat_widget.js`
arms only while the page is at the top with the dock closed.

Do NOT arm inside `touchstart`, which is the obvious place. Both WebKit and
Chromium decide whether a touch sequence is cancelable at touch-DOWN, from the
handler regions already committed. A blocking listener added during the dispatch
of a passive `touchstart` lands too late for the gesture in flight: `e.cancelable`
comes back false and `preventDefault()` silently does nothing, so the preview
follows the finger while the page rubber-bands underneath it. Arm from scroll or
open state instead, so the listener is in place before the finger lands.

## CSS: a media query adds no specificity, so placement is the rule

`static/style.css` is one long cascade with several rules writing the same
properties on the same selector at different widths. A media query does NOT
raise specificity -- `@media (min-width: 481px) { .mobile-tabbar { left: ... } }`
and a bare `.mobile-tabbar { left: ... }` are both (0,1,0), so the later one
in the file wins, at every width the query matches. Two consequences, both of
which have already cost a release:

- **A responsive override must sit AFTER the base rule it overrides.** The
  481px tab-bar cap is placed directly after the `max-width: 480px` phone
  block for that reason. Hoisting it above the base `.mobile-tabbar` rule in
  the `@media all` section makes it silently inert -- no throw, no warning,
  the bar just stops being capped.
- **Adjacent width bands are a pair; edit them together.** `max-width: 480px`
  and `min-width: 481px` have to stay exactly one pixel apart or you open a
  gap (the v0.11.1.0 bug: 481-720px, the whole iPad Split View range, was
  uncapped) or an overlap (the cap stripping the phone's gutters).

`tests/test_ipad_layout.py` asserts both -- that the breakpoints stay
adjacent, and that the cap is the last rule in the file to write the tab bar's
insets. The full breakpoint ladder is in [DESIGN.md](DESIGN.md).

## Fonts are self-hosted, and immutable by filename

Inter + Noto Sans Thai (`static/fonts.css`, faces in `static/fonts/`) and
Archivo + JetBrains Mono on the marketing site
(`marketing/assets/fonts.css`, faces in `marketing/assets/fonts/`). Four
invariants, each with a test behind it:

1. **Never reintroduce a Google Fonts `<link>`** (or a `fonts.gstatic.com`
   preconnect). The CSP's `style-src`/`font-src` no longer allowlist any
   host, so a stray link is refused by the browser with nothing but a console
   error to show for it -- the page just renders in the fallback face. And
   `/cookies` tells the reader the app loads no fonts from Google, which a
   re-added link turns into a false statement in a published policy.
   `tests/test_legal_policy_integrity.py` pins both the templates and the CSP.
2. **One variable face per family+subset, with a weight RANGE** -- not one
   file per weight. Inter and Noto Sans Thai are both variable, so Google's
   css2 API returned the SAME bytes for each weight asked for individually,
   one per request: the first cut of
   `static/fonts.css` shipped five byte-identical copies of one 48KB blob and
   made an English page download that face five times. If a heavier cut is
   needed, WIDEN THE RANGE; do not add a block.
   `test_no_font_file_is_shipped_twice` and
   `test_the_font_faces_cover_every_weight_the_stylesheets_use` hold this.
3. **A changed face needs a NEW filename.** `.woff2` files under
   `/static/fonts/` get a one-year `immutable` Cache-Control with no `?v=`
   query, because a stylesheet's query string is not inherited by the
   relative `url()`s inside it. That is only safe while filenames are
   content-stable, so `tests/fixtures/font_digests.json` records a SHA-256
   per file and `test_every_font_file_matches_its_recorded_digest` fails if
   the bytes behind a name change. Re-subsetting a face means a new name plus
   a new digest entry, never an in-place swap. (The digest pin covers
   `static/fonts/` only -- the marketing site's faces are served by Render, not
   by this rule.)
4. **That cache rule matches the RESOLVED filename, never `request.path`.**
   Browsers do not decode `%2e` before normalising, so the first cut's
   `request.path.startswith("/static/fonts/")` handed
   `/static/fonts/%2e%2e/i18n.js` a year-long immutable header on app JS --
   one poisoned URL could pin stale JS in a shared proxy for a year. See
   `cache_versioned_assets` in `app.py` and
   `tests/test_font_cache_headers.py`.

## Public pages are an explicit allowlist

The whole app is auth-gated by the `require_login` `before_request` hook in
`app.py`; anything reachable without an account has to be named in
`_PUBLIC_ENDPOINTS` (`/api/*` is separately exempt because those routes answer
their own JSON 401). Alongside `static`, `library_asset` and the auth flows,
the public policy pages are `privacy`, `terms`, `support`, `cookies` and
`refunds`. Adding a policy page means adding its endpoint there too, or it
302s to `/login` for exactly the readers it exists for: App Review, and anyone
at the signup consent notice who does not have an account yet.

`/cookies` renders every figure it quotes -- session lifetime, SameSite,
Secure, HttpOnly, the OAuth state window -- from `app.config` rather than
hardcoding them, so the page cannot drift from the cookie the app actually
sets. Keep new claims on that page sourced the same way.
`tests/test_legal_policy_integrity.py` cross-checks the pages against the
code: every cookie the app sets is named, every third party the code talks to
appears on `/privacy`, the policy pages link to each other, and settings links
all of them. A new processor or a new cookie breaks that suite until the
policy is updated, which is the point.

## Versioning

`VERSION` (4-digit `MAJOR.MINOR.PATCH.MICRO`) is the source of truth; `package.json`
carries the npm-valid 3-digit translation of it. Both are bumped by `/ship`, which also
writes the matching `CHANGELOG.md` entry and prefixes the PR title with `v<VERSION>`.
Started at 0.1.0.0 -- anything before that shipped unversioned.

## Deploy Configuration (configured by /setup-deploy)
- Platform: Render
- Production URL: https://repcheck-q0m4.onrender.com
- Deploy workflow: auto-deploy on push to main (no render.yaml checked in -- configured via the Render dashboard)
- Deploy status: query the Render API -- `RENDER_API_KEY` is in `.env` (see below)
- Merge method: squash
- Project type: web app (Flask, server-rendered, no build step)
- Post-deploy health check: https://repcheck-q0m4.onrender.com/ -- expect a 302 to /login (the whole app is auth-gated), not a 200; treat 302->/login as healthy, anything else (500, timeout, unrelated redirect) as a failure

### Checking a deploy actually landed
**The health check alone cannot tell you a deploy succeeded.** Render rolls
back to the previous release when a deploy fails, and the rolled-back app
still answers the health check with a 302 to /login. On 2026-08-25 that hid a
failed v0.4.0.0 deploy: the health check passed the whole time while the
merged feature was simply absent from the site.

So after merging to main, confirm by deploy **status**, not by health check:

```bash
set -a; . ./.env; set +a
curl -s -H "Authorization: Bearer $RENDER_API_KEY" -H "Accept: application/json" "https://api.render.com/v1/services/srv-d9dl6amrnols73cm9uv0/deploys?limit=1"
```

Look for `"status": "live"`. Anything else (`update_failed`, `build_failed`,
`canceled`) means production is still on the previous release. For the reason,
read the build and boot logs:

```bash
curl -s -H "Authorization: Bearer $RENDER_API_KEY" -H "Accept: application/json" "https://api.render.com/v1/logs?ownerId=tea-d9dkndjrjlhs73aqq5i0&resource=srv-d9dl6amrnols73cm9uv0&limit=100"
```

Service ids: `srv-d9dl6amrnols73cm9uv0` (this Flask app),
`srv-da6241gu01pc738uiv80` (the marketing static site). Never echo the key.

Then, and only then, verify the feature itself is reachable -- a route that
should exist, not just the health check.

### Custom deploy hooks
- Pre-merge: none
- Deploy trigger: automatic on push to main
- Deploy status: Render API (see above), then the health check
- Health check: curl -s -o /dev/null -w "%{http_code}" https://repcheck-q0m4.onrender.com/ -- expect 302

## Marketing / pre-launch site (`marketing/`)
A second, separate Render deployment -- a static pre-launch/marketing page,
independent of the Flask app above. See [marketing/README.md](marketing/README.md)
for local preview and deploy setup. Deployed as a Render **Static Site** (not
a Web Service like the main app), root directory `marketing`, publish
directory `.`, no build command. It shares brand colors/type with the app
(see `DESIGN.md`) but has its own HTML/CSS/JS and does not import from
`static/` or `templates/`.

It carries its OWN legal pages (`marketing/privacy.html`, `cookies.html`,
`terms.html`) rather than linking to the Flask app's, because the waitlist
collects an email address before anyone has an account. They are separate
files describing the same operator, so a change to what the app collects or
who processes it has to land on both sides.
`tests/test_marketing_site_compliance.py` checks the marketing copy against
the real app.

Before this is live: `marketing/app.js`'s `ENDPOINT` constant is a Formspree
placeholder and needs swapping for a real form endpoint, or waitlist
submissions will fail. **If you switch to a provider other than Formspree,
update `marketing/privacy.html` in the same commit** -- it names Formspree as
the processor and the country the address is transferred to, and naming the
wrong processor in a privacy notice is a compliance failure, not a stale
comment.
