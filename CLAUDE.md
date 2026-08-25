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

Before this is live: `marketing/app.js`'s `ENDPOINT` constant is a Formspree
placeholder and needs swapping for a real form endpoint, or waitlist
submissions will fail.
