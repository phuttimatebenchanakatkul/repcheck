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
behavioural tests (see `tests/test_hyrox_personal_best_section.py`,
`tests/test_cross_user_name_escaping.py`). That is a deliberate tradeoff for
hand-rolled JS with no module boundary -- when adding one, mutation-check it:
break the thing it guards and confirm the test actually fails.

Escaping note: `RepCheckI18n.t()` does NOT escape its vars, and most list rows
are template literals assigned via `innerHTML`. Any `t()` call carrying
user-controlled data inside one needs an explicit `escapeHtml()`. There is no
shared helper -- each file defines its own.

## Deploy Configuration (configured by /setup-deploy)
- Platform: Render
- Production URL: https://repcheck-q0m4.onrender.com
- Deploy workflow: auto-deploy on push to main (no render.yaml checked in -- configured via the Render dashboard)
- Deploy status command: none (no Render CLI/API key configured) -- poll the production URL
- Merge method: squash
- Project type: web app (Flask, server-rendered, no build step)
- Post-deploy health check: https://repcheck-q0m4.onrender.com/ -- expect a 302 to /login (the whole app is auth-gated), not a 200; treat 302->/login as healthy, anything else (500, timeout, unrelated redirect) as a failure

### Custom deploy hooks
- Pre-merge: none
- Deploy trigger: automatic on push to main
- Deploy status: poll production URL (no CLI available)
- Health check: curl -s -o /dev/null -w "%{http_code}" https://repcheck-q0m4.onrender.com/ -- expect 302

## Marketing / pre-launch site (`marketing/`)
Live at https://repcheck-marketing.onrender.com -- a second, separate Render
deployment (static site `repcheck-marketing`, `srv-da6241gu01pc738uiv80`),
independent of the Flask app above. It deploys from the
`marketing-analyze-demo` branch, NOT `main`; switch it to `main` once that
branch merges. See [marketing/README.md](marketing/README.md)
for local preview and deploy setup. Deployed as a Render **Static Site** (not
a Web Service like the main app), publish path `marketing` (repo-root
relative), no build command. It shares brand colors/type with the app
(see `DESIGN.md`) but has its own HTML/CSS/JS and does not import from
`static/` or `templates/`.

STILL BROKEN ON THE LIVE SITE: `marketing/app.js`'s `ENDPOINT` constant is a
Formspree placeholder (`YOUR_FORM_ID`), so waitlist submissions fail against
the real form. Swap it for a real endpoint.
