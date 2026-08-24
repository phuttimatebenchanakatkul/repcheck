# RepCheck marketing / pre-launch site

Static HTML/CSS/JS. No build step, no framework, no dependency on the Flask
app in the repo root — this folder is entirely self-contained and safe to
deploy as its own Render **Static Site**, separate from the main `repcheck`
web service.

## Local preview

```bash
python -m http.server 8790 --directory marketing
```

Then open http://localhost:8790. (`.claude/launch.json` has a `marketing`
config wired to the same command for the in-app browser preview.)

## Deploying to Render

This is a static site, so it's a different Render service type than the main
app (`Static Site`, not `Web Service`) — cheaper, no cold starts, and it
doesn't touch the existing `repcheck-q0m4` service at all.

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

- **`app.js`**: `ENDPOINT` is a placeholder (`https://formspree.io/f/YOUR_FORM_ID`).
  Waitlist submissions will fail until this points at a real form endpoint.
  Create a free form at https://formspree.io (or swap in Buttondown/another
  provider) and paste the real endpoint in.
- Swap `favicon.svg`'s placeholder green mark for the real RepCheck mark if
  you want the exact `logo-mark.png` glyph instead of the simplified SVG one
  (kept as SVG so it stays crisp at every tab size with zero extra bytes).
- `robots.txt` points its sitemap at `https://repcheck.app/sitemap.xml`,
  which doesn't exist yet — either generate one or drop that line.
- Content mirrors the real app (527 exercises, 744 foods, 8 HYROX stations,
  EN/TH) as of 2026-08-23 pulled from `workout_library.py`,
  `food_library.py` and the HYROX station list in `app.py`/`hyrox.html`. If
  those numbers move, update the stats band and feature copy here too.
