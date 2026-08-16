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
