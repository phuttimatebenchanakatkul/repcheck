# RepCheck marketing / pre-launch site

Static HTML/CSS/JS. No build step, no framework, no dependency on the Flask
app in the repo root — this folder is entirely self-contained and safe to
deploy as its own Render **Static Site**, separate from the main `repcheck`
web service.

Self-contained now includes the fonts and the legal pages:

- `index.html` — the pre-launch page.
- `privacy.html`, `cookies.html`, `terms.html` — the site's own policies,
  reachable from the footer's Legal nav. They exist separately from the Flask
  app's `/privacy`, `/cookies`, `/terms` because the waitlist collects an
  email address from people who have no account. Same operator, two sets of
  files: a change to what is collected or who processes it has to land on
  both. `tests/test_marketing_site_compliance.py` checks this copy against
  the real app.
- `assets/fonts.css` + `assets/fonts/` — Archivo and JetBrains Mono, served
  first-party. **Do not add a `fonts.googleapis.com` link back.** With these
  local the site makes zero third-party requests on load and needs no cookie
  banner; the waitlist POST to the form provider is the one deliberate
  cross-origin request, and it is disclosed in `privacy.html` and
  `cookies.html`. The OFL texts ship beside the faces because the licence
  requires it. `test_no_page_loads_anything_from_another_company` in
  `tests/test_marketing_site_compliance.py` fails on any off-site URL that
  is not on its click-through allowlist, so a re-added font host, script,
  iframe or pixel breaks the suite rather than quietly making
  `cookies.html` untrue.

## Local preview

```bash
python -m http.server 8790 --directory marketing
```

Then open http://localhost:8790. (`.claude/launch.json` has a `marketing`
config wired to the same command for the in-app browser preview.)

## Deploying to Render

**Status: live** at https://repcheckofficials.onrender.com
(Render static site `repcheckofficials`, id `srv-dakis7lg1s2s73cfnrt0`),
publishing `marketing` from `main` with auto-deploy on.

A second service serves the same files at
https://repcheck-marketing.onrender.com (`repcheck-marketing`, id
`srv-da6241gu01pc738uiv80`), also from `main`. Both are live on purpose and
both are kept headered — one merge to `main` deploys to both.

**The two show different shapes of the same page.** `repcheck-marketing` is
the 1080x566 Instagram landscape canvas; `repcheckofficials` is the ordinary
full-bleed site. A static deploy has no per-host build step, so the switch is
`marketing/assets/canvas-frame.js`, which adds an `rc-canvas` class from
`location.hostname` before the first paint; `styles.css` defines
`--rc-frame-w` / `--rc-frame-h` as the WINDOW by default and redefines them
under `html.rc-canvas` as the FRAME, so nearly every rule is written once and
is right in both. Add `?canvas=1` or `?canvas=0` to any URL to preview either
shape. Moving a host between the two means editing `CANVAS_HOSTS` in that
file and nothing else. It exists
because **an onrender.com hostname is assigned when a service is created and
cannot be changed afterwards** — renaming a service relabels it in the
dashboard and leaves the URL alone (tested: the rename went through, the URL
did not move). A new hostname means a new service, and deleting a service
releases its hostname for good.

That same rule is why the Flask app answers on `repcheck-q0m4` while its
service is named plainly `repcheck` — the suffix is Render's, added because
`repcheck` was taken, and it is not transferable to anything else.

### Security headers

Set on **both** services as response headers (Render dashboard → Headers, or
`PUT /v1/services/{id}/headers`). They are NOT in this repo, because they are
serving config rather than content — so they do not travel with a fork, a new
service, or a restore from git. **If you create another service for this
site, set them again there**; a service with none of these is a weaker copy
of the same site on a URL people can still reach.

Note that `PUT /headers` REPLACES the whole rule set rather than adding to
it, so mirroring one service onto another means reading the source's rules
and sending them entire.

    Content-Security-Policy       default-src 'self'; script-src 'self';
                                  style-src 'self' 'unsafe-inline';
                                  img-src 'self'; font-src 'self';
                                  media-src 'self';
                                  connect-src 'self' https://formspree.io;
                                  frame-src 'none'; frame-ancestors 'none';
                                  object-src 'none'; base-uri 'none';
                                  form-action 'none';
                                  upgrade-insecure-requests
    X-Frame-Options               DENY
    Referrer-Policy               no-referrer
    Permissions-Policy            camera=(), microphone=(), geolocation=(),
                                  payment=(), usb=(), magnetometer=(),
                                  gyroscope=(), accelerometer=()
    Cross-Origin-Opener-Policy    same-origin
    Cross-Origin-Resource-Policy  same-origin

Render already sends `Strict-Transport-Security` (ten years, preload) and
`X-Content-Type-Options: nosniff`, so those are not repeated above.

Two directives are load-bearing and worth knowing before you change anything:

- `script-src 'self'` is only possible because no page carries an inline
  `<script>` — pricing.html's billing toggle lives in `assets/pricing.js` for
  exactly this reason, and `test_no_page_carries_an_inline_script` keeps it
  that way. Add an inline block and it will not run in production, silently.
- `style-src` carries `'unsafe-inline'` and has to: `app.js` writes
  `style="width:…"` into markup it builds (the race watch's progress bar).
  Inline *style* cannot execute script, so this is a much smaller concession
  than the script-src equivalent would be.

`connect-src` names `https://repcheck-q0m4.onrender.com` because that is where
the waitlist POSTs — RepCheck's own API, not a form relay. Three things have to
agree, and a change to any one of them breaks the form:

1. `ENDPOINT` in `app.js` (where the page posts),
2. `connect-src` in this header (whether the browser will let it),
3. `WAITLIST_ORIGINS` in the app's `app.py` (whether the API will answer).

And `privacy.html` names where the address ends up, so it changes with them.

The Flask service (`repcheck-q0m4`) does not serve `marketing/` — there are
no references to it in `app.py`, and `/marketing` 404s there. The two are
entirely separate services.

This is a static site, so it's a different Render service type than the main
app (`Static Site`, not `Web Service`) — cheaper, no cold starts, and it
doesn't touch the existing `repcheck-q0m4` service at all.

### Option A — Blueprint (repo root `render.yaml`)

**There is no `render.yaml` in the repo** — both services are configured in
the Render dashboard, and the live site was created via Option B. This option
is kept because it is the cleaner setup if you ever want it in version
control: write a `render.yaml` at the repo root defining this static site and
nothing else, so creating a Blueprint instance from it leaves the
dashboard-configured Flask service alone. Render dashboard → **New** →
**Blueprint** → connect this repo → apply.

### Option B — Dashboard, by hand

1. Render dashboard → **New** → **Static Site**.
2. Connect this repo.
3. Root/build settings:
   - **Root directory**: `marketing`
   - **Build command**: (leave empty — nothing to build)
   - **Publish directory**: `.`
4. Pick a name (e.g. `repcheck-marketing`) and a custom domain once you have
   one (e.g. `repcheck.app`, pointing the main app at `app.repcheck.app` or
   similar so the two don't collide).
5. Deploy. Auto-deploy on push to `main` works the same way as the main app.

## Before this goes live

- ~~**`app.js`**: `ENDPOINT` is a Formspree placeholder~~ — **done.** The
  waitlist posts to `https://repcheck-q0m4.onrender.com/api/waitlist`, the
  Flask app's own route, and the addresses land in its `waitlist` table. The
  owner reads them at `/admin/waitlist` (list, CSV download, per-address
  delete), linked as **Waitlist** in the account menu.
  **If the destination ever changes, update `privacy.html` in the same
  commit** — its "Who else sees it" section names who receives the address
  and which country it goes to. Naming the wrong one in a privacy notice is a
  compliance failure, not a stale comment.
- `robots.txt` points its sitemap at `https://repcheck.app/sitemap.xml`,
  which doesn't exist yet — either generate one or drop that line.
- Content mirrors the real app (735 exercises, 744 foods, 8 HYROX stations,
  EN/TH) — re-verified 2026-09-12 against `len(EXERCISE_DETAILS)` and
  `len(FOOD_LIBRARY)`, which is what `tests/test_marketing_site_compliance.py`
  asserts against. The exercise figure said 527 for months after the
  library grew past it; re-derive these rather than trusting the page. If
  those numbers move, update the stats band and feature copy here too.
