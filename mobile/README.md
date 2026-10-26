# RepCheck (native app)

React Native + Expo (SDK 58), TypeScript, expo-router. The plan, decisions and per-phase status are in
[`../MOBILE_APP_PLAN.md`](../MOBILE_APP_PLAN.md); the design tokens in [`../DESIGN.md`](../DESIGN.md).

```bash
npm install
cp .env.example .env     # fill in the Supabase URL + PUBLISHABLE key and the API URL
npx expo start           # scan the QR code with Expo Go on your iPhone
npm run check            # tsc --noEmit, expo lint, Jest
```

- Add packages with `npx expo install <name>`, not `npm add`: it picks the version that matches the SDK.
- `src/i18n/en.json` and `th.json` are generated from the website's `static/i18n.js`: `npm run i18n:export`.
- `src/supabase/database.types.ts` is generated from the live schema: `python ../scripts/gen_supabase_types.py`.
- Never put a secret in `.env`: every `EXPO_PUBLIC_*` value is readable by anyone who has the app.
- Keep test files out of `src/app/` (every file there is a route).

```
src/app/        screens (expo-router): (auth), setup, (tabs)
src/auth/       sign-in actions, Apple/Google, first-sign-in profile, the AuthProvider
src/api/        typed client for the Flask API (../api)
src/supabase/   client, Keychain session storage, generated DB types
src/store/      offline: persisted query cache, write queue (outbox), sync manager
src/i18n/       translations (website export + the app's own `app.*`)
src/ui/         design tokens, contrast maths, shared components
```
