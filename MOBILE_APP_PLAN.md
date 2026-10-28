# RepCheck native app: React Native/Expo on Supabase

Status: **plan finished 2026-10-24. Supabase Pro project created the same
day** (ref `edktymiqqgqmzaxckfzc`, Singapore, Postgres 17), with keys in
`.env` and verified. **Phase 1, first part (schema, security rules, import
script, Storage and the file copy) was built and tested 2026-10-24/25**; see "Phase 1 status" below for
what is done, what is proven, what is still to do, and what needs a decision.

Connection gotcha: `SUPABASE_DB_URL` must use the shared pooler
(`aws-0-ap-southeast-1.pooler.supabase.com:6543`, user `postgres.<ref>`). The
`db.<ref>.supabase.co` address the dashboard offers is IPv6-only, which Render
can't reach.

## Why

The App Store app (0.12.10, released 2026-10-24) is a Capacitor webview whose
`server.url` is the live Render site (`capacitor.config.json`). Every screen is
the website. It passed review, but it feels like a website: taps wait on a
server round trip, browser behaviour leaks through (callouts, text selection,
rubber-banding, zoom), and it uses no iOS features beyond the camera and
Sign in with Apple/Google. The goal is a native app on a backend built for it.

## The website is frozen (decided 2026-10-24)

**From now on, no new work goes into the website** (`templates/`,
`static/`, the page routes in `app.py`). The native app replaces it.

- **Until the native app launches**, the website is still what every App
  Store user sees, because the current iOS app loads it. So it gets **only
  fixes for real breakage** (crashes, data loss, security, App Review
  problems). No features and no redesigns.
- **The website stays on SQLite** the whole time. It is never ported to
  Supabase. Its data moves once, at launch (see "Launch day").
- **After launch it is retired**, apart from the small pieces listed under
  "What survives".

## Decisions

| Question | Decision | Why |
|---|---|---|
| App framework | **React Native + Expo (TypeScript)** | Real native views, navigation and gestures; JS skills carry over; Android almost free |
| Builds | **EAS Build** in the cloud | No Mac available. Expo Go and dev builds install on a real iPhone/iPad from Windows, with live reload |
| Database | **Supabase Postgres** | Managed, backed up, with row-level security so the app can talk to it directly |
| Auth | **Supabase Auth** (email, Apple, Google) | Native SDKs for React Native. Replaces `auth.py` entirely |
| Files | **Supabase Storage** | Progress photos and the trimmed analysis clip, in two private buckets under `<user id>/`. Challenge clips are not kept (the site deletes them once graded) |
| Who talks to the DB | **Hybrid.** The app reads and writes the user's own data directly (RLS); anything secret goes through Flask | Plain CRUD gets instant and works offline. Gemini/FatSecret keys, rate limits, grading and moderation stay on the server |
| Backend | **Flask becomes API-only**, on Postgres | AI, food lookup, limits, consent, citations, grading and moderation logic already exist and work |
| Region | **Supabase Southeast Asia (Singapore)** | The Render service is in Singapore, and every Flask query crosses that link |
| Bundle id | **Same: `com.benchanakatkul.repcheck`** | Ships as an update to the existing App Store listing; users get it automatically |
| JS fixes after launch | **expo-updates (OTA)** | Keeps today's "fix it by deploying" speed for JS-only changes |
| Data shape | **Normalised tables from day one** | No web client to stay compatible with, so the JSON blobs in `user_data` become real tables in the import script |

## What to buy and hand over (when you're ready)

1. **Supabase Pro** ($25 a month). Free projects pause after a week without
   traffic and include 1GB of file storage, which form videos would fill.
2. Create **one project, region Southeast Asia (Singapore)**, and choose a
   strong database password.
3. **Put the keys in `.env` yourself**, not in chat:
   ```
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_ANON_KEY=...          # publishable; safe inside the app
   SUPABASE_SERVICE_ROLE_KEY=...  # secret; server only, never in the app
   SUPABASE_DB_URL=postgresql://...pooler.supabase.com:6543/postgres
   ```
   They're all under **Project Settings → API** and **Project Settings →
   Database → Connection string** (use the "Transaction pooler" one).
4. Later, for Sign in with Apple and Google: Supabase **Authentication →
   Providers**. This needs the same Apple Services ID/key and Google client
   ids that `auth.py` uses now. Setting these up is a step in phase 1.

Development uses this same project with a **copy of production data**
loaded in. The real import happens again on launch day.

---

## Architecture

```
iPhone / iPad (Expo app)
  ├── Supabase directly ── Auth, Postgres (RLS), Storage
  └── Flask (Render, API only) ── AI, barcode/food lookup, rate limits,
                                  consent, challenge grading, reports,
                                  account deletion, admin
                                  └── Supabase Postgres (service role)
```

Flask verifies the **Supabase JWT** on every request (`current_user()`
keeps its signature, so the call sites in the API routes don't change).

### Repo layout

```
mobile/                  Expo app (TypeScript, expo-router)
  app/                   screens (file-based routes)
    (tabs)/              native tab bar: Home, Workouts, Analyze, Nutrition, Coach
  src/supabase/          client, auth session, generated DB types
  src/api/               typed client for the Flask routes
  src/store/             local cache + offline queue (TanStack Query, persisted)
  src/logic/             ported pure logic (macros, units, streak, coaching)
  src/i18n/              en.json, th.json exported from static/i18n.js
  src/ui/                design tokens from DESIGN.md, shared components
supabase/migrations/     schema + RLS, checked in
scripts/migrate_sqlite_to_supabase.py
```

Navigation uses expo-router: native tabs (a real `UITabBar`) plus native
stacks, so the back swipe, large titles and sheets are the system's own.

---

## Phases

Each phase ends with a build on a real iPhone **and an iPad**. The app is
Universal (see `IOS_APP_STORE.md`), so every screen needs a tablet layout
from the start.

### 1. Backend foundations
- **Schema** as SQL migrations. `profiles` (keyed by `auth.users.id`)
  replaces `users`. The `user_data` blobs become tables: food entries,
  workout days and sets, weigh-ins, analyze log, HYROX history, coaching
  profile, goals, split plan, favourites, day status and settings. The other
  existing tables come across with uuid `user_id`s and `timestamptz`, except
  `native_auth_tokens`, which Supabase Auth makes unnecessary.
- **RLS on every table**, no exceptions. Own-row policies; leaderboards
  and friends only through views or RPCs that expose display names and
  scores and respect blocks; no client access to `rate_limits`,
  `usage_events`, `content_reports` or admin data.
- **Rules that used to live in Flask move into the database.** For
  example, `_merge_coaching_profile_write` (never drop a stored required
  field) becomes a trigger or constraint, because the app writes directly.
  Go through `account_sync.js` and every `/api/sync` validator for these.
- **Import script** (`scripts/migrate_sqlite_to_supabase.py`): users →
  `auth.users` + `profiles` (a deterministic uuid per legacy id), blobs parsed
  into tables, then every table read back and compared with the plan before
  anything is committed. It must be rerunnable, because it runs for dev now and
  again for real at launch. It also copies the files (progress photos, analysis
  clips) into the two private Storage buckets from a copy of the old server's
  folders (`--files-dir`), checking each against Storage's own record of it.
- **Flask ported to Postgres** (`psycopg` through the pooler, same function
  names in `database.py`), verifying Supabase JWTs, with the page routes
  deleted from this branch.
- **Tests:** a two-user isolation suite proving user A can't read, update or
  delete user B's rows in every table and bucket. Mutation-check it by
  dropping a policy and confirming the test fails. The existing pytest
  suites for the surviving API routes move onto Postgres (CI service
  container; locally the Supabase CLI, which needs Docker Desktop).

### 2. App foundations
Scaffold `mobile/` (Expo SDK, TypeScript, expo-router, ESLint, Jest). Supabase
Auth with native Sign in with Apple (`expo-apple-authentication`), Google and
email. Generated DB types. Offline cache and write queue. Design tokens,
fonts, light and dark mode, i18n. Tab shell. *Done when you can sign in on
your iPhone in Expo Go and see your real (copied) data.*

### 3. The daily loop (the biggest phase)
Home (today, streak, quick actions), Nutrition (food log, AI photo scan with
the native camera, barcode scan, search, custom foods, favourites, goals and
macros) and Workouts (logging, split plan, exercise library, custom
exercises). Haptics on every log and complete action.

### 4. Analyze and the AI coach
Record with `react-native-vision-camera` or pick from the library, then upload
and have Flask grade it. (Today the app may only READ its own Storage files; an
upload straight to the `analyze-videos` bucket needs a new INSERT policy and new
isolation tests, so decide between that and a multipart upload to Flask here.) Results, history and playback.
The analyze, coach and workout chats keep their citations, the Report button
and the AI-consent gate exactly. Each of these closed an App Review
rejection.

### 5. Everything else
Weight and logging history, full stats, streaks and check-in photos. Friends
and QR codes, challenges, leaderboards, block and report (Guideline 1.2).
Onboarding, settings, account deletion and restore (5.1.1), HYROX. Legal pages
open in an in-app browser sheet.

### 6. Native features
Push notifications (device tokens in Supabase; sent from Flask), Apple Health
(write workouts, read weight and steps), a home-screen widget (Swift via
`expo-apple-targets`, built by EAS), and optionally the pose skeleton overlay.

### 7. Launch
See "Launch day" below.

---

## The Flask port (`api/`)

**How it differs from the plan above, and why.** Phase 1 said to port `app.py` and `database.py` in place on a
branch. A merge to `main` auto-deploys to Render, where the website and the App Store app still run on SQLite, so an
in-place port could not land on `main` until launch day and would drift from it meanwhile. The port is instead a new,
additive package, `api/`, that production never imports (and `api/` imports nothing from `app.py` or `database.py`,
which run SQL against SQLite and start side effects at import). It lands on `main` slice by slice, is tested there,
installs from its own `requirements-api.txt` (so the live site's build is untouched), and becomes its own Render
service when the app ships. `app.py` is retired at launch with the rest of the website. Pure-logic modules are reused
as they are (`name_filter`, `ai_safety`, `coaching_engine`, the food and exercise libraries, the Gemini wrappers).

**Verified about the tokens** (against this project): access tokens are ES256 JWTs, one hour long, verifiable
locally against `<project>/auth/v1/.well-known/jwks.json` with `PyJWT` (already a dependency); the publishable and
secret keys are not JWTs. A locally verified token cannot know a session was revoked or a user banned since it was
issued: such a token works until it expires.

**Photos (done), and where they differ from the website.** Same rules (front/back, a real date from the account's
creation day to tomorrow, 12 MiB, must verify as JPEG/PNG/WebP, 500 per person with the same 429 message), with three
deliberate differences: the stored type and extension come from what the bytes verify as, not the filename the client
chose (a client that sends no filename, as a phone camera blob may, just works); the 500 ceiling is enforced under a
per-user advisory lock, so uploads racing at 499 cannot both land (the website could be raced past it); and deleting
removes the file BEFORE the row, so a failed removal leaves the photo visible and retryable instead of an invisible file
nobody can delete. Order of an upload: validate, store the file, record the row under the lock; a failure at any step
undoes the earlier ones, so a refused upload never leaves a row or a file. The app reads its own photo rows and files
directly (row-level security); Flask is for writing and for short-lived signed links.

**Analyze, consent and limits (done), and where they differ from the website.** `POST /api/analyze` takes the same
multipart upload (a clip up to 300 MiB, an exercise name), trims and grades it with the existing `pipeline.run_pipeline`
(ffmpeg + Gemini), keeps the trimmed clip in the private `analyze-videos` bucket and the result in `analyze_results`, and
keeps each person's newest 20. History, one result, the latest, and a short-lived signed playback link are JSON
endpoints (`/api/analyze/history`, `/history/<id>`, `/latest`, `/video/<id>`). Consent (`POST /api/ai-consent`, the same 403
with `needs_ai_consent`) is checked before the upload is touched. Deliberate differences:

- **The daily allowance is reserved before the Gemini call and refunded if the work fails**, atomically, in one SQL
  statement. The website peeked first and recorded afterwards, so simultaneous requests all passed the peek. Both promises
  hold: a failed analysis never burns the one-a-day, and concurrent requests can never exceed it. A refused request is a
  429 with `Retry-After` (the website answered 400).
- **Exemption is configuration, not code.** The owner and App Review's demo account are exempt from the limits only if
  their addresses are in `ADMIN_EMAILS` / `REVIEW_ACCOUNT_EMAILS` on the API service (comma-separated); with neither set,
  nobody is. **Set `ADMIN_EMAILS` when the service is created or the owner is limited too.** The address comes from the
  verified token, never the request.
- **Pruning removes the stale clip through the Storage API before its row, and keeps the row if the clip will not go**, so
  the next analysis retries; a pruned analysis takes its chat thread with it (a cascade). A prune failure never fails the
  analysis that triggered it.
- The clip is best-effort exactly as before (storage failing, or refusing it, saves the analysis without one), but a clip
  over the bucket's 50 MiB limit is not attempted, and an empty one is not stored.
- The exercise name is length- and control-character-checked (it goes into the model's prompt); NUL characters in the
  model's text are dropped (Postgres cannot store them).
- Sections are returned as on the website (summary and detail HTML per section) but without the inline-SVG `icon`; the app
  draws its own from `css_class`. `has_video` in the history list means a clip was stored, not that the file still exists
  (the detail and playback endpoints check that when they sign the link). Times are ISO 8601 with a UTC offset.
- Deployment note for later: grading runs inside the request (a minute or more), so the service needs a worker timeout well
  above gunicorn's default 30 s, and ffmpeg in its image.

**The chats, HYROX, splits and coaching (done), and where they differ from the website.** `POST /api/coach-chat`,
`/api/analyze-chat`, `/api/workout-chat` (one shared 3-a-day budget, as before), `/api/hyrox/analyze` (8 races per 5 hours),
`/api/generate-split` (1 plan a day; every split type counts, only `ai_suggest` needs consent), and the coaching routes
`GET /api/coaching/body-fat-ranges`, `POST /api/coaching/calculate` and `POST /api/coaching/weekly-adjustment`. They call the
website's own modules unchanged (`coach_chat`, `analyze_chat`, `workout_chat`, `hyrox_coach`, `split_planner`,
`checkin_analyzer`, `coaching_engine`); the model calls go through `api/ai.py` so tests substitute fakes. Deliberate differences:

- **A call that fails does not cost a use.** The modules swallow model errors and answer with a fallback, so each backend
  reports `failed`, and the use that was reserved before the call is refunded (the website recorded it whatever happened).
  An over-limit chat is still a normal-looking 200 reply with `limited: true`, exactly as the chat widgets expect.
- **Everything is bounded before it can reach a prompt.** Message 1000 characters (the website's input allowed 600 and the
  server had no limit), history 40 turns of 4000 characters, context 40 000 characters, a HYROX race 40 segments and 20 000
  characters, split inputs as before plus 14 custom days. A malformed history, context or race is a 400 that costs nothing;
  on the website it crashed inside the module and spent a message on the fallback reply.
- **No crash on a list where a word belongs.** The website's coaching check raises on `{"aspiration": [1]}` (a 500); the port
  answers 400, and agrees with the website's check on 800 random payloads plus every boundary.
- **The weekly check-in is now metered** (`checkin_analysis`, 5 a day; the website never limited it, so any signed-in user
  could spend Gemini quota). Past the limit, or without consent, or if the model fails, the check-in still completes with the
  deterministic adjustment, so a limited person loses only the AI refinement. Bad numbers in the logs are a 400, not a 500.
- `hyrox_coach` keeps a per-session budget in Flask's cookie session, which this API does not have; it runs inside a throwaway
  request context so the module stays byte-for-byte the website's and the per-account limit replaces its budget.

**Food (done), and where it differs from the website.** `POST /api/analyze-food` (the AI photo scan, 1 a day), `POST
/api/scan-barcode` (a photo or a live camera frame), `POST /api/lookup-barcode` (a decoded or typed number),
`GET /api/search-food-online`, and `GET/POST/DELETE` on `/api/custom-foods` and `/api/custom-exercises`. They call
`analyze_food_gemini` and `barcode_scanner` unchanged through `api/ai.py`. A person's own food for a barcode still beats any
external lookup, and a barcode nobody knows is still a normal 200 (`not_found`) that lets the app offer to create it.
Deliberate differences:

- **Every food route needs a sign-in.** The website let anyone scan or look up a barcode (`current_user()` was optional
  there), which made it a free way to drive image decoding and outbound traffic from the server. An account with no profile
  can still scan; it just is not counted.
- **The scan allowance is reserved first and handed back on failure**, like the other AI features: a photo the model could not
  analyze is a 502 that costs nothing, and simultaneous scans cannot exceed the one a day. A refused scan is a 429 with
  `Retry-After`. The photo's type comes from its bytes (a client may send any name or content type), and a photo that is not a
  readable JPEG/PNG/WebP is refused before it costs anything.
- **Bounded.** A photo is 12 MiB, a barcode frame 6 MiB, the note 300 characters, a search 100. Control characters are dropped
  from every text field (a NUL cannot be stored at all). A macro is clamped to 0-5000 g and a serving to 100 000 g (`Infinity`
  and `1e308` were accepted), and a food's emoji is clipped to 8 characters like an exercise's.
- **The 500-food and 500-exercise ceilings are enforced under a per-person lock**, so requests racing at 499 cannot both land
  (the website could be raced past them). A barcode that races past the duplicate check is caught by the database's unique
  index and answered with the same 409. Calories are still derived from the macros, never taken from the client.
- Barcode digits are ASCII `0-9` only (`str.isdigit` also accepted other scripts' digits), and a barcode over 20 digits is cut.

**Social, the waitlist and the owner's endpoints (done), and where they differ from the website.** Friends
(`GET /api/friends`, `POST /api/friends/add`), blocking (`GET/POST/DELETE /api/safety/block[s]`), reports
(`POST /api/safety/report`, `POST /api/ai-report`), `GET /api/activity/dates`, challenges (`GET/POST /api/challenges`,
`GET /api/challenges/today`, `POST /api/challenges/<id>/submit`), `GET /api/leaderboard`, `POST /api/hyrox/results`,
`GET /api/hyrox/leaderboard`, the public `POST /api/waitlist` the marketing form posts to, and `/api/admin/*` for the
owner (the moderation queue, the waitlist as JSON or CSV, erasing an address, the signup list and one account's usage).
A person is a UUID now, so every id in a request or response is one. Deliberate differences:

- **A challenge can be submitted to only if it is yours or a friend's, and the friend is not blocked.** The website accepted
  any challenge id, which put a stranger's score on the board of people who never befriended them. Not visible is the same
  404 as not existing.
- **The day's challenge attempt is held while the clip is graded** (an atomic reservation per exercise per UTC day, in
  `rate_limits`) and given back if the clip cannot be counted, so two simultaneous uploads cannot both reach the model. The
  website checked saved attempts only, so a double tap graded twice.
- **Friend-code guesses are counted under a per-person lock** (30 wrong codes an hour, as before; only a code that matches
  nobody counts), so a burst cannot exceed the budget; a code that is not text is a 400, not a crash. The QR image route is
  gone: the app draws its own QR from the friend code, and its scanner should accept both the bare code and the old
  `.../friends?add=CODE` link form.
- **HYROX:** a time must also be finite and at most 24 hours (the website accepted NaN). The plausibility floor still applies
  on the way out, before each person's best is taken. `/api/hyrox/history-entry` is not ported: the app writes its own
  race history straight to `hyrox_races` under row-level security.
- **The 200-challenge and 500-result ceilings, report caps and the AI-report ceiling are enforced under a lock** so racing
  requests cannot pass them.
- **Waitlist:** the hourly limit per visitor is one atomic statement (the website read, then wrote), an address with a control
  character is refused (Postgres cannot store a NUL; the website answered 500), a body whose email or source is not text is
  handled instead of crashing, and the CSV neutralises a cell that starts like a spreadsheet formula (`=cmd@evil.com` is a
  valid address). The visitor is `request.remote_addr` behind `ProxyFix(x_for=1)`: **the Render service must sit behind exactly
  one proxy hop, or the per-visitor limit keys on the wrong address.** CORS answers only the two marketing hostnames.
- **Owner endpoints are JSON and answer 404 to everyone else.** The owner is whoever's verified token email is in
  `ADMIN_EMAILS`; App Review's demo account (`REVIEW_ACCOUNT_EMAILS`) is exempt from limits but is never an admin.
  `/admin/export-db` is gone: Supabase keeps the backups and `pg_dump` is the export. The Supabase dashboard remains the
  fallback for anything these do not cover.

**The old password (done in v0.22.0.0).** `POST /api/auth/legacy-login {email, password}` is the one unauthenticated door onto a
password check; the app calls it once, only after Supabase says the credentials are wrong. If the password matches the old
scrypt hash in `legacy_password_hashes`, Supabase's password is set to it through the Auth admin API and the app signs in
normally; the database trigger then drops the old hash (so a leaked old password can never be put back, which a test proves
against the real project). Because it is a password oracle, every non-success is the SAME 401 (unknown address, no old hash,
wrong password) and a scrypt hash is computed in all three so the time does not say which; tries are counted per address
(10 / 15 min, the website's login limit) and per caller (30 / 15 min) BEFORE any hashing, atomically, and a success gives the
address's tries back. A password the project refuses (too short or leaked) is a 409 `reset_required`: the app offers a reset link.
**The email is not confirmed by this** (the importer left it unconfirmed because the old site never verified an address): the
next step is the confirmation email, which the app can resend. That settles the plan's open decision the recommended way.

**Security shape.** Flask connects as the `postgres` owner, which bypasses RLS: every query in `api/` must scope itself
to the caller by hand, and the tests prove it route by route (an action on one account never touches another).
Algorithms are restricted to the asymmetric ones, and a service-role token, an anonymous session, a wrong audience or
issuer, and a subject that is not a UUID are all refused.

**Open decision 4 is closed by construction.** A profile row can be created only by `POST /api/profile`, which applies
the display-name filter, and every table a user owns points at `profiles`. So someone who signs up straight against
Supabase Auth, skipping Flask, gets an account with nowhere to put data; sign-ups do not have to be routed through
Flask. (Switching sign-ups off in the dashboard is still sensible until the app exists, to keep spam accounts out.)

| Slice | State |
|---|---|
| Settings, token verification, pooled Postgres access, Auth-admin and Storage clients, JSON plumbing, health | **Done** (v0.16.0.0) |
| Profile creation, rename, account deletion + restore (30-day grace), the purge that removes a person's stored files through the Storage API before their Auth user | **Done** (v0.16.0.0) |
| Progress photos: upload (type, size, date window, 500 cap), list, signed link, delete, through Storage | **Done** (v0.17.0.0) |
| Analyze: grade an uploaded clip, store the trimmed clip, history, playback, the 20-newest prune through Storage | **Done** (v0.18.0.0) |
| Consent, per-account rate limits and usage counters | **Done** (v0.18.0.0, with analyze) |
| The three chats, HYROX analysis, split generation, coaching calculations and the weekly check-in | **Done** (v0.19.0.0) |
| Custom foods and exercises (writes stay behind Flask), the food photo scan, barcodes and online search | **Done** (v0.19.0.0) |
| Friends, blocks, reports (+AI reports), challenges, leaderboards, HYROX results, the streak's server-side dates | **Done** (v0.20.0.0) |
| Waitlist (the marketing form posts to Flask), the owner's endpoints (moderation queue, waitlist, signups) | **Done** (v0.20.0.0) |
| Deploy as its own Render service (`Dockerfile.api`, the `SUPABASE_*` variables) | **Prepared** (v0.20.1.0): the image and the click-through are below; creating the service is yours |

## Phase 2 status: the app foundations (`mobile/`)

**What is in, and how it is checked.** Everything below is covered by `cd mobile && npm run check` (strict TypeScript, lint,
267 Jest tests), by `tests/test_mobile_app.py`, and by 161 deliberate breakages of the app's logic (all noticed by a test except
two that change nothing observable). `npx expo export --platform ios` compiles the whole app to a Hermes bundle.

| Piece | Where | Notes |
|---|---|---|
| Expo SDK 58 app, expo-router, typed routes | `mobile/` | Bundle id `com.benchanakatkul.repcheck`, Universal, version `1.0.0` (above the store's `0.12.10`); the website's icon |
| Design tokens | `src/ui/tokens.ts` | DESIGN.md's palette, radii, scale. System font (SF Pro / the system Thai face): what a native app uses. A red ink and a button fill were ADDED so error text and the primary button clear 4.5:1; a test computes every ratio |
| Native tab shell | `src/app/(tabs)/` | `NativeTabs` (a real UITabBar), five tabs with SF Symbols, labels follow the language; each screen is a placeholder until its phase |
| Sign-in, sign-up | `src/app/(auth)/sign-in.tsx`, `src/auth/` | Email + password and native Sign in with Apple. The website's consent notice, word for word (a test pins it), with the Terms/Privacy links in an in-app browser |
| The gate | `src/app/_layout.tsx` | `Stack.Protected`: signed-out, setting-up, and signed-in are three separate sets of screens, so a stale link cannot reach a tab without a session |
| First sign-in | `src/auth/profile.ts` | Creates the profile through `POST /api/profile` (the only thing that makes one), using the name typed at sign-up or shared by Apple, falling back to the provider's; an email account with no usable name is asked for one |
| Session storage | `src/supabase/secureStorage.ts` | The Supabase session in the iOS Keychain, chunked (a session exceeds SecureStore's 2 KB), read all-or-nothing |
| Supabase client | `src/supabase/client.ts` | PKCE flow, auto-refresh paused in the background |
| API client | `src/api/` | Typed; bearer token on every call, one forced refresh on a 401, timeouts, server messages surfaced, `Retry-After` and the AI-consent refusal recognised |
| DB types | `src/supabase/database.types.ts` | Generated from the live schema, only for tables the app may read |
| Offline | `src/store/` | React Query cache persisted for a day (wiped on sign-out); a write queue for direct Supabase writes: idempotent operations only, order kept, a newer write replaces a waiting one, a refusal is set aside rather than blocking the rest, backoff for the rest, nothing of anyone's survives sign-out |
| Old passwords, reset, resend | `src/auth/legacy.ts`, `src/app/reset-password.tsx` | Sign-in tries Supabase, then asks the server about the OLD hash once; "Forgot password?"; a recovery link holds the person on a new-password step (`recovering` state) before they enter the app; "Resend confirmation email" when an address is unconfirmed |
| Translations | `src/i18n/` | The website's 913 strings exported from `static/i18n.js` (same keys, same `{vars}`, same fallback rules) plus the app's own `app.*` strings in English and Thai (**the Thai is mine and wants a native read**) |

**Bugs the checks found while it was written:** a session rewrite that failed partway could leave the old manifest pointing at a
mixed set of pieces (a corrupt session); a newer write queued while its row was on the wire would have replaced the entry
being sent and been lost; the SDK re-announcing `SIGNED_IN` on returning to the foreground would have restarted setup.

**Not verified, and why (needs you or a device):**

- **Nothing has run on a phone yet.** There is no Mac, no Expo account linked and no device in this session. The first real
  check is `npx expo start` and opening it in Expo Go on your iPhone, then an iPad.
- **Sign in with Apple** needs the Apple Developer App ID with the capability, a Services ID, and the Apple provider enabled in the
  Supabase dashboard (and a build that includes the capability; Expo Go cannot do it, a development build can).
- **Google sign-in is written but OFF** (`EXPO_PUBLIC_GOOGLE_SIGN_IN=1` turns it on): it needs the Google provider and
  `repcheck://auth-callback` in Supabase's redirect URLs, and has not met a real Google account.
- **Email confirmation** must stay ON in Supabase and needs custom SMTP before launch (see "Passwords").
- **EAS**: `mobile/eas.json` exists since v0.43.0.0 (see "Phase 7a status"); linking it to your Expo account (`npx eas-cli init`) is still yours.
- **Added in v0.22.0.0 (same caveat: nothing has run on a device):** the legacy-password fallback, "resend confirmation email",
  and password reset by email. A reset link needs `repcheck://reset-password` (and, in development, the `exp://...` address Expo
  Go shows) in Supabase's allowed redirect URLs and the **Site URL** set to a page that tells the reader to go back to the app;
  it only works on the phone that asked for it (the one-time code is tied to a secret kept there).

## Phase 3 status: the daily loop (`mobile/`, v0.23.0.0)

**What is in, and how it is checked.** Home, Nutrition and Workouts work end to end against Supabase, online and offline. Checked by
`cd mobile && npm run check` (strict TypeScript, lint, 929 Jest tests), `tests/test_mobile_libraries.py`, and 991 deliberate
breakages of the new logic, data layer and screens (in two passes; each survivor was killed by a new test, fixed, or is a change with no effect: a type, a tuning constant, a style number, a counter).

| Piece | Where | Notes |
|---|---|---|
| Food and exercise libraries | `scripts/export_libraries.py` -> `mobile/src/data/foods.json` (744 foods), `exercises.json` (735 exercises) | Generated from `food_library.py` and `exercise_library.py`; `--check` fails when stale, and `tests/test_mobile_libraries.py` also checks the JSON against the Python modules (names, macros, every dish ingredient is a food, dish calories match the sum of their ingredients) |
| The website's rules, in TypeScript | `src/logic/` | Macros, goals, units, dates, streaks, search and scoring, suggestions, workouts and sets, the split plan, the food icon. **Each is tested against the website's own code**: `static/*.js` run in a sandbox, and functions lifted out of `templates/nutrition.html` and `workouts.html`, over every food in the library and seeded random inputs. Where the website had a quirk (a day's total is the sum of per-entry ROUNDED values; a blank or zero amount keeps the last good one) the port keeps it |
| Rows <-> app shapes | `src/data/mappers.ts` | A row is written WHOLE (NULL for what is absent, so converting a food to a dish leaves no stale columns); `extra` (fields another version put there) is carried through; weights outside 0-400 kg are refused before anything is queued; reps and loads are cleaned to what the integer and non-negative columns accept |
| Writes | `src/data/ops.ts`, `src/store/outbox.ts` | Every change is an idempotent whole-row upsert or a delete by key. A workout's sets are replaced as a group: `Outbox.replace` drops the older version's still-waiting set writes and queues the new ones **all or nothing, saved once** |
| What the screen shows | `src/data/overlay.ts`, `hooks.ts` | The server's rows with this device's still-waiting writes laid on top **in the order they were queued**, so a log made offline shows at once and a refetch never makes it vanish. The actions patch the query cache with the SAME overlay functions, so "what the cache says after my action" and "what the screen shows while it is queued" cannot disagree |
| Reads | `src/data/access.ts` | Straight from Supabase, each query filtered by `user_id` as well as by row-level security; the streak reads days from food, workouts, weigh-ins and `activity_days`, paged, plus the days only the server records (`/api/activity/dates`, best effort) |
| Sync | `src/store/SyncManager.tsx` | After a flush that sent or lost anything, the person's cached data is marked stale so the screens read the server again |
| Home | `src/features/home/` | Streak (current, longest, last 7 days), today's calories and macros, quick actions, a weigh-in (kg or lb) |
| Nutrition | `src/features/nutrition/` | Week strip with a dot on logged days, calorie ring and macro bars against goals (calories derived from macros, as on the website), foods in time order that open to their amount (g / oz / mL, or a dish's total scaled across its ingredients) and ingredients, favourites, search of the library and the person's own foods, "recent", "top picks around this hour", quick add from typed macros, create a food of your own, edit goals, delete with a confirmation |
| Workouts | `src/features/workouts/` | Today's split plan, week strip, exercises in time order that open to their sets (weight x reps; each-side L/R where the exercise allows; bodyweight movements reps only; add and remove sets; the weight carries to the next set), a tick when every set has its reps, favourites, search, create your own exercise |
| Haptics | `src/ui/haptics.ts` | A light tick for a favourite or an added set, the success tap when a food is logged, an exercise added, a weight saved or the last rep count goes in |

**Bugs the checks found while it was written:**

- A re-saved workout with fewer sets would, offline, have been followed by the longer old version's extra sets (coalescing only
  replaces the SAME row). Fixed by `Outbox.replace` and an overlay that applies the set writes in queue order.
- A custom exercise made "each side" was logged in both-sides mode the first time, because the list the screen held did not yet
  contain it.
- `newId()` returned `undefined` where the platform's UUID generator is a stub: two entries would have shared a key. It now always
  returns a non-empty string.
- The progress bar was not announced by a screen reader (it was not marked accessible).
- Adding an ingredient to a food that was open showed the old single food until it was closed (the card kept its draft).
- Switching a food's unit read the amount back from the rounded text, drifting up to 0.05 g each time.
- A failed "Add" (full queue) had already thrown away the food and amount the person chose.
- `daysBetween` went through local clock arithmetic and could be off by a day across a daylight-saving change; it now counts calendar days in UTC.
- The digit-before-the-match rule of the food search score (`7up` for `up`) was untested against the website.

**Added in v0.24.0.0: the food scans.** "Scan a meal" (take or choose a photo, AI estimate) and "Scan barcode" (live camera) in the log
sheet. A photo asks for AI consent first (the website's wording) and sends nothing until allowed; a server refusal for missing consent asks
again. The result screen is the website's: editable name, confidence, the AI-estimate note or the data source's required credit, macros that
follow the amount, serving sizes, amount in servings / g / oz. It logs a dish of the scan's ingredients marked `source: "scan"`. A barcode
nobody knows leads to making the food yourself with that barcode. Camera and photo permission texts are in `app.json`. `expo-camera` and
`expo-image-picker` were added with `expo install`.

**Added in v0.25.0.0: "Plan my split".** The wizard, in the app. *Let AI build it*: where you train, your goal (optional), how many days;
the server builds the plan (`POST /api/generate-split`, after AI consent). *Build it myself*: a template or your own day names, and the
exercises you tick for each day (browsed by category, your own first, create one on the spot); no AI is involved. The built plan is reviewed
and edited: what falls on each weekday (any of its days, or Rest), exercises added or removed, and each exercise's sets and reps (held to
20 and 50, with the standard shown and a reset). A saved plan opens on today's weekday and saves edits as they are made; "Edit split"
starts the wizard over. Saving marks the day for the streak, as the website does. Today's plan card quick-logs an exercise for TODAY and
shows a tick once it is logged.

**Added in v0.26.0.0: the history pages.** *Streak history* (from the streak card on Home): current and longest streak and a calendar of the
days that counted; going back stops at the first month the app reads data for (`STREAK_WINDOW_DAYS`). *Weight history* (from the weigh-in
card): a month or a year at a time with latest / average / change, a line chart, the month's list with each day's change, the year's months,
and a calendar of the days weight was logged. Tapping a day shows its weight; only TODAY can be logged or replaced (the website's rule).
The weigh-in form is now one shared component (`features/history/WeightForm.tsx`) used by Home and the calendar. Weigh-ins are read a page
at a time, so a long history is not cut at 1000 rows. Both pages are root-stack screens with a native header and back button.

**Added in v0.27.0.0: nutrition history and removing your own items.** *Logging History* (from the Nutrition page): a month calendar of
each day's status, logged / fasting / incomplete / not logged, with the month's counts; tap a day to mark it (a day with food can be
marked incomplete, one without can be marked fasting, and "logged" clears the mark), offline too. *Full stats*: this week's calories day
by day against the goal, the average of the days with food, how many fell within 10% of the goal, and a chosen day's macros against the
goals. Both read a range of food (`nutritionRange`, paged, with the same offline overlay as every other read). Your own foods can be
removed from the Custom list, and your own exercises from the plan's exercise checklist, each after a confirmation.

**Phase 3 is complete.** What is left is the polish listed in `TODOS.md` (swipe-to-delete, exercise videos and photos, per-hour "+"
logging) and everything in phases 4-7.

**Not verified, and why:** nothing has run on a phone yet (see Phase 2). The screens are checked by Jest with the real data layer
over an in-memory Supabase, not by eye: spacing, the sheet presentation and haptics need Expo Go on an iPhone and an iPad. The
Thai `app.*` strings added here are mine and want a native read.

## Phase 4 status: Analyze and the AI coach (`mobile/`)

Phase 4 ships in slices. **4a, the Analyze tab, is v0.28.0.0; 4b-1, the Coach tab, is v0.29.0.0; 4b-2, the analysis chat, is v0.30.0.0; 4b-3, the workout
chat, is v0.31.0.0.** That is all of Phase 4 as scoped here: analyze, results, history and playback, and the three chats with their
citations, Report button and consent gate. The coaching calculators and the weekly check-in (`/api/coaching/*`) belong with the
profile and check-in photos in Phase 5.

**Added in v0.28.0.0: Analyze.** Choose an exercise (the last one analyzed is already chosen; the picker offers recent, favourites and a
starter set, and searches the library and your own exercises), film a set or choose a clip, send it, read the result. The result is the
website's: the form score in its bucket's colour (80 and up, 50 and up, below), the one-line verdict, the stretch / squeeze note, the reps
counted (hidden at zero), a link to the how-to video or a YouTube search, *What went well* and *Your next step* up front and the other
sections behind *Full report*, each card showing its first point and the rest on request, and the "AI estimates, not medical advice"
note. The clip plays back muted and looping. *Recent analyses* (the newest five) and *Analysis History* (all that the server keeps, by
month) open any past analysis; each shows its saved report with no signal and fetches a new clip link when opened.

Decisions made here, so they are not re-opened:

- **A multipart upload to Flask, not a Storage INSERT.** `POST /api/analyze` already trims, grades, stores the clip, refunds a failed use
  and prunes to 20. Uploading straight to the bucket would need a new INSERT policy and a second set of isolation tests for no gain.
  The upload is given ten minutes (`ANALYZE_VIDEO_TIMEOUT_MS`).
- **`expo-image-picker`, not `react-native-vision-camera`.** It runs in Expo Go (no development build is needed to try the app), uses the
  system camera, and exports a 720p H.264 file (`videoExportPreset`), which keeps a minute of footage in the tens of megabytes (the server
  refuses more than 300 MB). It films at most 65 seconds: the server skips the first 5 and grades the next 60 (`trim_video.py`;
  `tests/test_mobile_app.py` fails if the two drift). What it gives up is the website's live pose-skeleton overlay while recording; that
  needs vision-camera and a development build (see `TODOS.md`).
- **The report is drawn as native text.** The server sends small HTML (`api/feedback.py`: markdown after `html.escape`, a summary
  paragraph and a bullet list). `logic/richText.ts` reads only the tags that can occur and drops every other tag, so nothing in a
  model's answer can render as markup or load anything. It is tested against the server's real output
  (`scripts/export_feedback_fixtures.py` writes the fixtures; `tests/test_mobile_app.py` fails when they go stale).
- **Consent comes before the clip leaves the phone.** With no consent on file the question is asked first and nothing is sent, not even
  to be refused; a 403 from the server (consent withdrawn on another device) leads to the same question. The question now lists videos
  (`aiConsent.item2`) beside photos, and the picker's permission texts say what the camera, library and microphone are for (it records
  sound with a video).
- **No `muted` dimming.** The website dims a "muted" section on a strong set, but those are always behind *Full report*, where it forces
  full brightness; the app simply never dims.
- **The status lines stay on the last one.** The website cycles the seven lines round and round; grading can take minutes, and
  "Loading video..." returning after "Drafting your form report..." reads as a restart.

**Added in v0.29.0.0: the Coach tab (4b-1), and the parts every chat shares.** Ask about training; one conversation per day (yesterday's
is gone when the day turns, as on the website), kept on the device and on the server in `coach_messages`, emptied with *New chat*. Every
answer carries its sources (at most three, plain https links, opened in the in-app browser), a link to every source, the "AI-generated,
not medical advice" line, and the Report button (four reasons, then the reply's own text to `/api/ai-report`): each of these closed an App
Review rejection (1.4.1, 4.7.1) and `tests/test_mobile_app.py` pins them. The consent question comes before the first message leaves the
phone, and now names chat messages. Over the daily limit, the notice and a countdown replace the text box until the wait is over.

The shared pieces: `logic/chat.ts` (reply and citation parsing, the website's `formatBubble` rules, the countdown, history), `api/chat.ts`
(the three chat routes and the report), `features/chat/` (`ChatView`, `useChatSession`, `SourcesFooter`), and a coach-thread slice of the
data layer (mapper, ops, overlay, fetch, hook, actions, tested like every other table; the fake database now numbers `seq` itself).

Deliberate differences from the website's chat:
- **A question is saved WITH its answer.** The website saved the question first and also sent it twice (inside `history` and as `message`,
  so the model saw it twice). Here `history` is what came before and a question that fails (no signal, an error, the daily limit, no consent
  yet) goes back into the text box instead of staying in the thread unanswered.
- **A notice is not a reply.** Errors and the limit notice are shown, never saved, never sent back as history, and carry no AI footer; the
  website saved them as turns and put the Report button under the limit notice.
- **Streak.** An answered question marks the day (`activity_days`, action `coach_chat`), offline-safe like every other write.

**Added in v0.30.0.0: ask about an analysis (4b-2).** *Ask about this analysis* on a result (fresh from the Analyze tab, or opened from
the history) opens a chat about THAT analysis (`/analysis-chat?id=7`): its scores, rep count and report are told to the AI service with
each question (the website's context, field for field; `tests/test_mobile_app.py` compares them). One thread per analysis, kept in
`analyze_chat_messages` (the table has no date column, so the day a turn was made on rides in `extra.date`), read back with the analysis
and gone with it when the server prunes to the newest 20. A chat closes 24 hours after its analysis was made, as on the website: the
thread stays readable and the box says so. Same footer, report button, limit countdown and consent question as the coach. An answered
question marks the day (`activity_days`, action `analyze_chat`).

**Added in v0.31.0.0: the workout chat (4b-3).** On the Workouts tab, a *Workout AI Chat* card appears once something is logged on the day
you are looking at (as on the website) and opens that day's chat (`/workout-chat?day=2026-10-27`). Ask about progressive overload, form or
whether you are training a muscle enough. Each question is sent with `workout_summary`, built by `logic/workoutSummary.ts` from the
website's own functions, line for line (a test runs the website's code on the same seeded histories, in kilograms and pounds, English and
Thai): the last seven calendar days, then each exercise's last four sessions with every set (the 30 trained most recently), in the
person's units. One thread per day in `workout_chat_messages`, kept for good; only TODAY's takes questions (a past day is read-only, as on
the website) and *New chat* empties one day only. The same footer, Report button, limit countdown and consent question as the other chats.

Deliberate difference: the summary is built from the newest 300 workouts (`WORKOUT_HISTORY_LIMIT`), where the website used the whole log,
so an exercise not trained for months can be missing from "last four sessions". The workout itself is the streak activity, so the chat
marks nothing.

**Not verified, and why:** nothing has run on a phone. The camera, the picker's export, `expo-video` playback and a real 60-second
upload over mobile data need Expo Go on an iPhone. `npx expo export --platform ios` compiles it; Jest covers the logic and the screens
with a mocked API, picker and player. The new Thai strings are mine and want a native read.

## Phase 5 status: everything else (`mobile/`)

Phase 5 ships in slices, most App-Review-critical first. **5a, Settings, is v0.32.0.0; 5b, the coaching profile wizard, is v0.33.0.0; 5c, the weekly check-in, is v0.34.0.0; 5d, friends and report / block, is v0.35.0.0; 5e, the daily challenge and leaderboard, is v0.36.0.0; 5f-1, the HYROX race tracker, is v0.37.0.0; 5f-2, the HYROX leaderboard and AI race analysis, is v0.38.0.0; 5g, the "it's been N days" nudge, is v0.39.0.0; 5h, HYROX practice and how-to, is v0.41.0.0 (v0.40.0.0 was Phase 6a, reminders); 5j, the HYROX custom race builder, is v0.42.0.0.**

**Added in v0.32.0.0: Settings (5a).** Home has a *Settings* button (a root-stack screen, `/settings`). *Account*: your name (saved through
`/api/account`) and your email, with "Signed in with Apple/Google, email is managed there" for those accounts. *Appearance*: system, light or
dark. *Language*: English or Thai. *Units*: weight, height, distance and clock. Theme, language and units are ACCOUNT settings
(`user_settings`, written through the offline queue like every other write), applied at once; `SettingsApplier` puts the saved theme
(`Appearance.setColorScheme`) and language to work as they load, so they follow the person to another device. *AI features*: on or off,
as easy to withdraw as to give (5.1.2(i)), with the link to what is sent. *Legal*: contact, privacy, terms, cookies, refunds and sources,
each an existing public website page opened in the in-app browser (`src/links.ts`; a test checks every one is in `_PUBLIC_ENDPOINTS`).
*Log out*. *Delete account* (5.1.1(v)): a native confirmation, then the deletion is SCHEDULED (30 days, `ACCOUNT_GRACE_DAYS`, pinned to the
server's) and the screen shows the date and *Keep my account*; while a deletion is scheduled Home shows a banner that opens Settings,
as the website's does on every page.

**Added in v0.33.0.0: the coaching profile wizard (5b), the website's onboarding.** The questions behind a calorie and macro target: goal
(lose, maintain, gain), weight and gender, goal weight and how fast (losing or gaining only), height, body type (pictures, per gender),
activity, protein, diet, and whether to spread calories through the week. The maths is the server's own (`POST /api/coaching/calculate`,
the website's `coaching_engine`); the app asks the questions, enforces the website's limits (goal weight on the right side of the current
one, height 130-230 cm, rate limits), and shows the targets before anything is saved. Saving writes the coaching profile (`coaching_profiles`,
the whole row, the week laid out when spread), the protein / fat / carb goals, and `profiles.onboarding_completed`. It is offered by a card
on Home while there is no profile, and by Settings (*Set up* / *Edit profile*, which opens on what is saved); it is not forced on a new
account.

Differences from the website: weight and height are typed (in the person's own units) instead of scrolled on rulers, and the rate is the
native slider with the same "slower / standard / faster" badge and the website's warning above the standard pace (Guideline 1.4) in
place of its custom-drawn one; the website's live "estimated daily budget" under the slider is not shown (the result screen has the real
numbers). The body-type pictures are the website's own files, copied into `assets/bodyfat` and compared byte for byte by a test; the
ranges are generated into `src/data/bodyfat.json` by `scripts/export_libraries.py`.

**Added in v0.34.0.0: the weekly check-in with progress photos (5c).** Seven days after the last check-in (or after the profile was made) a
card on Home and on Nutrition offers it; until then Nutrition says how many days are left. It shows the week (tap a day to cycle it
between logged / incomplete, or not logged / fasting, as the website does), today's weight unless it is already logged, and optional
front and back photos (camera or library). Completing it uploads the photos (best effort: a photo that cannot be kept does not stop the
check-in), sends the week to `POST /api/coaching/weekly-adjustment`, and shows the answer: *on track*, or the new daily target, why, and
each macro's old and new value. The server does the maths (and, with AI consent, lets the model read the photos); a refusal or failure
keeps the week (nothing is saved, so it can be retried). A new target is saved as the protein / fat / carb goals, the coaching row
records the day, the reason and the change, and the day counts toward the streak. Reaching the goal weight makes the check-in due at
once and skips the adjustment: the screen offers *Set new goals* (the wizard) and marks that goal as handled.

Differences from the website: "handled" is two columns (`goal_handled_weight_kg` / `goal_handled_aspiration`, compared with the profile's
goal) rather than the website's separate flag, so a goal that moves is simply a new goal; a profile this app wrote is always complete,
so there is no "fix my profile" step beyond opening the wizard when there is no profile; the week is read from the account, not from
what this device remembers.

**Added in v0.35.0.0: friends, and report / block (5d).** *Friends* (from Home) shows your friend code and a QR for it, lets you add a
friend by typing a code or scanning their QR (the camera reads QR codes only; a code in a link or on its own is accepted, anything else
is ignored), and lists your friends. Each friend has a "more options" button that opens the report / block sheet (Guideline 1.2): report
the name for one of four reasons (the server blocks them for you at the same time) or just block. *Blocked accounts* in Settings lists
who you have blocked, with Unblock. These are the server's (`/api/friends`, `/api/safety/*`), so they need a connection; the last list
read stays on the device. The QR holds the website's own add-friend link (`/friends?add=CODE`) so any camera can read it.

Differences from the website: the app can scan a QR (the website's scanner was removed; the app has a real camera), copy uses the system
clipboard, and there is no "suggest from contacts" (the website dropped it as a 5.1.2 risk and a test keeps it out). New packages:
`react-native-qrcode-svg` and `expo-clipboard`. Challenges and leaderboards, the other places another person's name will show, come next
and will open the same sheet.

**Added in v0.36.0.0: the daily challenge and leaderboard (5e).** *Challenges* (from Home) shows today's exercise (push-ups, sit-ups and
pull-ups rotate, one a day for everybody, decided by the server), a *Record an attempt* button (spent after one attempt a day), and the
leaderboard: total reps across every attempt, Friends or Global (Global first), your own standing pinned above the others, the top 25
listed with their real rank and how far each is from you, and a "more options" button on every other name that opens the same report /
block sheet as Friends. Recording is in the app: the front camera with a 10 second countdown to get in position, then up to 25 seconds
(the server grades the first 25), *Stop & submit* after the first two. The app creates the challenge only when the clip is ready to
send (the website creates one when the recorder opens, leaving an empty one behind for every abandoned try), the server counts the reps,
and the result shows reps done, reps counted and a note, with the clip played back. An attempt counts as a day for the streak once the
server has counted it. The AI consent question comes first. Closing mid-recording throws the clip away.

Differences from the website: the website's decorative "analysing" skeleton over the clip (MediaPipe, cosmetic) is not drawn, and the
camera is not zoom-normalised. The camera text in `app.json` now also names friend QR codes and the rep challenge.

**Added in v0.37.0.0: the HYROX race tracker (5f-1).** *HYROX* (from Home) is the website's race simulator: pick Open or Pro, Singles or
Doubles (and Full or Half length for Singles), see the whole race in order with what each station asks of you (the standard weight in the
person's unit, the laps of their own lane, the reps), then run it by tapping through the sixteen segments against the clock. The clock is the
time since the start, so it stays right if the screen locks. A finished race shows its time, whether it is a new personal best (or flagged
as faster than anyone has raced, which the server would refuse too) and where the time went (running against stations, a bar for each
segment); it is saved to the account (`hyrox_races` and `hyrox_race_splits`, offline-safe like every other log) and its time put on the global
leaderboard when it counts there (a full-length race that is not flagged). *Personal bests* shows your five fastest for each combo and every race
you have finished, newest first; each opens its breakdown and can be removed. Gender comes from the coaching profile; only a person with no
profile is asked. The lane length (and, at the end of a race, which leaderboard is yours) are kept in two columns of the settings row.

**Added in v0.38.0.0: the HYROX leaderboard and the AI's read of a race (5f-2).** The HYROX page now carries the global leaderboard (also
from the finish screen): one gender at a time (the one chosen, else the one raced under last, else the profile's; a person with none is asked
once and the answer is kept on the account) and one of four boards, Open and Pro, Singles and Doubles, with your own place marked or shown
below the listed rows, and report / block on every other name (Guideline 1.2). After a race the AI reads the splits and says where to gain time,
what was strong and what is already solid, station by station, each section short with "Read more" for the fuller bullets; the breakdown's bars
turn green or amber to match. The read is kept on the race, so reopening one from the history shows it with no wait. With the AI switch on
it runs at once on a fresh race; otherwise (and for older races) a button offers it and the consent question comes first. A flagged time is
not coached; at the day's limit the server's notice is shown and nothing is kept (the website keeps the notice as if it were a read).

**Added in v0.41.0.0: HYROX practice weights, the Doubles split, and how each station is done (5h).** In Pro Singles each loaded station (sled
push, sled pull, farmers carry, sandbag lunges) can be practised with a lighter weight, never above the standard and never under a tenth of it;
the distance grows to match (half the weight, about double the laps: sleds in whole 12.5 m segments, carries exact, rounded once against the
lane), the agenda and the race show it, and the website's warning that race day is the standard weight appears once anything is moved. In Doubles
each loaded station's rounds are split between the person and their partner (half and half to begin with; yours and your partner's always add
up to the Singles total), and the race shows the person's own share. Both belong to the practice session only: they are never saved on a race, and
go when what they were measured against changes (category or gender for weights, format or length for the split). Tapping a station on the
HYROX page, or *How to do it* in the race, shows what it is, three steps and the tip that saves most time, with the tutorial video opening in the
in-app browser (the website embeds it). The how-to text is the website's, English only there too. A test runs the website's own copy.

Not in this slice, and why: hand-built custom races follow in 5j (below). The website's one-off back-fill of old races onto the board is the launch import's job.

**Added in v0.42.0.0: the HYROX custom race builder (5j).** Setting up a race now asks Standard or Custom first. Custom starts as the whole
standard race, sixteen blocks, and lets the athlete add any of nine stations (run, SkiErg, sled push and pull, burpee broad jumps, row, farmers carry,
lunges, wall balls) in four picker groups, any number of times, remove any, reorder with up and down arrows, and give each its own amount
(metres, or reps for wall balls; distances to a tenth, reps whole, an unreadable entry the station's own default). The website also lets a block be
dragged by press-and-hold; here the arrows do it, which a screen reader can also use. The lane-length card is shared with the standard setup. The race
runs block by block: the loaded stations show laps of the lane and the distance they come to, wall balls the reps, a run or erg the distance. It is
saved in the same tables as any race, as category `custom` with no format or gender, never flagged, never a personal best, and never posted to the
leaderboard or sent to the coach (neither has a standard to measure it against). The blocks being built are kept for the visit when
switching back to Standard. A test checks the nine stations, the five lap-based ones and the 75-rep wall-ball default against `static/hyrox.js`.

**Added in v0.39.0.0: the inactivity nudge (5g).** A card on Home and on Nutrition for someone with a coaching profile who has not logged a
weight or any food for three days (counting from the profile's first day when they never have): "It's been N days since you logged ...",
with Dismiss. Dismissing records today on the coaching row (`inactivity_notified_on`), so it stays away for the day and is back tomorrow if
they are still away; on the website, dismissing did not hide the banner. It waits for the weigh-ins and food to load before it speaks. The
website also raised a browser notification for the same thing; that is a push notification here and belongs to Phase 6.

Not in 5a, and why: *Blocked accounts* waits for friends and leaderboards (it lists what you blocked there); *Gender* is a coaching-profile
field that belongs with onboarding; *Replay the tour* is the website's guided tour, which the app does not have.

## Phase 6 status: native features (`mobile/`)

**6a, reminders, is v0.40.0.0.** Local notifications (`expo-notifications`), not push: nothing is sent from a server and no device token is
kept, so there is nothing new for the privacy policy to say and no APNs key to hold. *Settings > Reminders* turns them on (which is when iOS
asks for permission) and off; the choice is about this phone, kept on it, and off until chosen. When on, two reminders are kept waiting, each
for its next occasion only, and replaced whenever the person's data changes, the language changes or the app returns to the front:

- **Away:** 6 pm on the day the third quiet day (no weight, no food) begins; if the person is already away, the next 6 pm, once, not every
  day (coming back moves it out of the way). This is the website's browser notification (`coaching.notify.body`), which could only fire while a
  tab was open.
- **Check-in due:** 9 am on the day the weekly check-in falls due (seven days after the last). One already due is not reminded of: the cards on
  Home and Nutrition say so.

Both need a coaching profile. Signing out cancels them. Not done in Phase 6 yet, and why: real push (needs the APNs key and an Expo or
Apple account, plus a Flask sender), Apple Health (a native module: needs an EAS development build to try) and the home-screen widget
(Swift via `expo-apple-targets`, built by EAS) are all things that cannot be tried here, and follow once there is a device to run them on.

## Phase 7a status: build configuration (`mobile/`, v0.43.0.0)

`mobile/eas.json` has three profiles. **development** is a development client for internal distribution (what Expo Go cannot be: Sign in with Apple,
and later Apple Health and the widget, need native code); **preview** is an internal build of the real app for testers; **production** is the App
Store build, with the build number counted up by EAS (`appVersionSource: remote`, `autoIncrement`) because the store refuses a number it has seen.
Each profile reads the EAS environment of the same name, so the three public values (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_KEY`,
`EXPO_PUBLIC_API_URL`, named in `mobile/.env.example`) are set once per environment on expo.dev, never in the file. A test fails if a secret turns up in
`eas.json`, if the store profile becomes a development client, or if the build number stops counting up.

`npx expo-doctor` now passes 20 of 20: five Expo packages were a patch behind the SDK's pinned versions (`expo`, `expo-camera`, `expo-router`,
`expo-web-browser`, `@expo/ui`), which is the first thing an EAS build would have flagged. `npx expo install --fix` brought them level.

What is still yours, in order (none of it can be done from here):

1. `npx eas-cli login`, then `npx eas-cli init` in `mobile/` (writes the project id into `app.json`; commit it).
2. On expo.dev, create the three variables above in the **development**, **preview** and **production** environments (the URL and publishable key
   are public by design; the API URL needs the Render API service from "Deploying `api/` (Render)").
3. `npx eas-cli build --profile development --platform ios`, install it on your phone (an internal build needs the phone registered with
   `eas device:create` and an Apple Developer account signed in to EAS), then `npx expo start --dev-client`.
4. Supabase dashboard: Apple provider, `repcheck://auth-callback` and `repcheck://reset-password` in the redirect URLs, custom SMTP (see "Passwords").
5. For TestFlight and the store: `npx eas-cli build --profile production --platform ios`, then `npx eas-cli submit --profile production --platform ios`.

## Phase 8: leaving Render (decided 2026-10-28)

**The decision.** The app's server-side work (about forty endpoints: AI, food lookup, friends, leaderboards, account deletion) moves from the Flask
`api/` on Render into **Supabase Edge Functions**, so the native app depends on Supabase alone. The Terms, Privacy and Sources pages stop being
pages on the Render website and become screens inside the app (James said they should "live in an IDE", read here as: inside the app; correct this if
it meant something else). The website (`templates/`, `static/`, `app.py`) stays frozen and on Render until launch day, then is retired as already planned.

**Shape.** One function, `supabase/functions/api`, with a small route table. Its address is `<project>/functions/v1/api/...`, so the app's existing
paths (`/api/profile`, ...) work against a base of `<project>/functions/v1` with no change to any screen. It is deployed with `--no-verify-jwt`
because Supabase's built-in check is for the legacy HS256 secret; the function verifies the project's ES256 token itself (JWKS), exactly as
`api/auth.py` does. Postgres is reached with the connection string Supabase gives every function; like Flask, it connects as the owner, so every query
scopes itself to the caller by hand. Code in `supabase/functions/_shared/` takes its collaborators (database, Gemini, Storage, clock) as arguments, so
the tests (`deno test`, run through `npx deno`) use fakes and need no network.

**Slices.** Each lands as code with tests but stays UNROUTED (the app still talks to Flask) until the last one, which flips the base URL and deletes
`api/`, `Dockerfile.api`, `requirements-api.txt` and the Render notes. That keeps every merge safe and lets the cut-over be rehearsed once.

- **8a, foundations (v0.44.0.0, done):** the router, token check, database, rate limits, AI-consent check, and the health and consent routes. The profile
  routes need the display-name filter and move with the accounts in 8b. 49 Deno tests, a live check against the real project
  (`npx deno task test:live`: one throwaway user, removed afterwards), and `tests/test_edge_functions.py` pinning the limits, messages and routes to Flask's.
- **8b, accounts (v0.45.0.0, done):** the profile routes, rename, delete / restore, and the purge of accounts past their 30 days (run from a request, at most hourly,
  in the background: there is no scheduler). With them come the display-name filter (generated from `name_filter.py`, and run against ~1,600 names beside the
  Python one) and the Auth and Storage clients. 112 Deno tests; the live check now also makes two throwaway accounts, uploads a file for each, schedules both,
  purges only the one that is due and proves the other's file and profile are still there.
- **8c, files and sign-in (v0.46.0.0, done):** progress photos (upload, list, a short-lived link, delete) and the legacy-password login. Photos are checked
  without Pillow: the bytes are read as PNG (every chunk's CRC), JPEG or WebP, with the picture-size ceiling Pillow had, and a seeded run of Pillow-made pictures
  and damaged copies gets the same verdict from both. The old password hashes (Werkzeug scrypt and pbkdf2) verify through `node:crypto`, checked against hashes
  Werkzeug itself wrote. 179 Deno tests, and a live test that signs in as a throwaway person with a REAL token (so the project's real keys do the verifying) and
  walks profile, consent, a photo up and back down through its signed link, an imported password moving across and then signing in on Supabase, and deletion
  and restore.
- **8c2, owner tools (not started):** the waitlist (the marketing site posts to the website's own endpoint today, which goes when the website does, so this one
  must be ready before then) and the owner-only admin routes. The app does not call either.
- **Unchecked until deployed:** which request header carries the caller's address on Supabase's edge. The legacy login limits tries per address and per caller, and
  uses the LAST `X-Forwarded-For` entry (the one the proxy added), falling back to `X-Real-IP`. If the caller's address turns out to be somewhere else, only the per-caller
  budget is weakened; the per-address one is not touched.
- **8d, social (v0.47.0.0, done, except submitting a clip):** friends by code (with the per-hour guess budget), report and block (both directions), the AI-reply report,
  the daily challenge (list, create, today), the reps leaderboard, HYROX results and the HYROX leaderboard, and the streak's server-side dates. **Submitting a challenge
  clip is NOT ported**: it grades a video, so it moves with the video grader in 8g, and the app cannot switch over until it does. 218 Deno tests; the live check now has
  two real people befriend, challenge, score, report and block each other and checks what each can and cannot see afterwards; and helpers that read text (user ids,
  friend codes, UTC offsets, HYROX times, the day's exercise) are run through Python and TypeScript over seeded corpora, which found one real difference (Python
  accepts `3_600` as a number) before it shipped. Timestamps now end in `Z` (`2026-10-28T10:00:00.000Z`) where Flask wrote `+00:00`; the app reads both.
- **8e1, the three AI chats (v0.48.0.0, done):** coach, analysis follow-up and workout chat, with the health-source citations App Review asked for, the shared
  3-a-day budget (a failed or unreachable model gives the use back), and a Gemini client over its REST API that tries up to three times when Google says it is
  busy. The Coach's prompt and the source catalog are GENERATED from the Python (`scripts/gen_edge_chat_data.py`); the analysis and workout prompts, the
  citation parser, and the request checks (message, history, context and its Python-written size) are run through both languages over seeded corpora and
  agree. 252 Deno tests; the live check asks the real model all three chats and checks the sources it cites, then that the fourth message is limited.
  **The model:** the code defaults to the website's `gemini-3.1-flash-lite`, and the `GEMINI_MODEL` secret overrides it without a redeploy. On 2026-10-28 that
  model answered every request with HTTP 503 "high demand" (so the website's chat was likely failing too) while `gemini-3.5-flash-lite` answered, slowly (~20 s);
  which to use is James's call.
- **8e2, coaching targets and the weekly check-in (v0.49.0.0, done):** `coaching_engine` ported to TypeScript (its ranges and constants GENERATED from the Python, its
  rounding Python's: a tie goes to the even number), the profile check, the weekly spread and tune, the check-in photo review and the three coaching routes. The
  check-in review uses `gemini-3.5-flash` as before, with one try and a 30 s limit, and any failure leaves the deterministic number (and gives the use back).
  **New: golden files.** `scripts/edge_golden.py` runs seeded and hand-picked cases through the PYTHON and writes the answers to
  `supabase/functions/tests/fixtures/*_golden.json`; the TypeScript's own offline tests check them (so a mutation run needs no Python), and a Python test fails
  if a file is stale. **One deliberate fix:** the Python check-in prompt told the model the person weighed "None kg" (it read a key the profile never has);
  this tells it the real weight. 296 Deno tests; the live check has a real photo reviewed by the real model.
- **8e3, the split generator (v0.50.0.0, done):** `split_planner` (the plan without the model, the checking of the model's plan, both prompts, the beginner
  window) and the route `/api/generate-split`, with the exercise library GENERATED from `workout_library.py` (`scripts/gen_edge_workout_data.py`). The picked-split
  path asks the model for text as before; "Let AI build it" sends the REST form of the same response schema to `gemini-3.5-flash-lite` (the live run proved the API
  accepts it). A custom split never asks the model but still spends the day's one plan, as before. Proven against ~3,800 Python answers (golden file + side by
  side): fallback plans over every split, day count, location and goal keyword; every prompt (by hash, with the text of every 40th); ~1,050 model answers broken in
  assorted ways; the lifter text, with its ties; the route's input cleaning. New helpers `_shared/pyText.ts` (Python's `str()`, `repr()` of a float, `format(x, ".1f")`
  and `json.dumps`). **Two fixes on the way:** the Python built one prompt list from a set (so the same request gave a differently ordered prompt) and now keeps the
  order given; and the chat context-size check counted DEL as one character where Python writes six. 334 Deno tests.
- **8e4, HYROX analysis.**
- **8f, food:** custom foods and exercises, food search and barcode lookup (Open Food Facts, FatSecret), AI meal photo.
- **8g, lift video:** see "The one hard part" below.
- **8h, cut-over:** in-app legal pages, `EXPO_PUBLIC_API_URL` defaults to the functions address, Flask and its Dockerfile deleted, `CLAUDE.md` and this plan rewritten.

**The one hard part.** The form grader (`pipeline.py`, `rep_form_analyzer.py`, `pose_landmarker.py`, `people_detector.py`, `trim_video.py`) trims with
ffmpeg and counts reps with OpenCV and MediaPipe. An Edge Function has neither. The replacement is to give Gemini the whole clip (uploaded to
Storage by the app, passed on through Gemini's file upload) and let it grade and count. That trades the deterministic rep count for the model's,
so it needs a side-by-side run on real lifts before it replaces anything; it is slice 8f for that reason, and 8a-8e do not depend on it. If the
comparison is bad, the alternative is on-device pose detection in the app (MediaPipe), which is a larger piece of native work.

**What only James can do**, once the slices are in: `supabase login`; `supabase secrets set GEMINI_API_KEY=... ADMIN_EMAILS=... REVIEW_ACCOUNT_EMAILS=...`
(and the FatSecret keys); `supabase functions deploy api --no-verify-jwt --project-ref edktymiqqgqmzaxckfzc`. Supabase supplies `SUPABASE_URL`,
the service key and `SUPABASE_DB_URL` to every function itself.

## Deploying `api/` (Render)

`Dockerfile.api` is the API's own image (the website's is `Dockerfile`, untouched). It installs `requirements-api.txt`,
adds `ffmpeg` and `libzbar0`, and runs `gunicorn "api.app:create_app()"` with ONE worker and eight threads and a 600 s
worker timeout (a set is graded inside the request, a minute or more; gunicorn's default is 30 s). One worker because a
second copy of OpenCV and the Gemini client roughly doubles memory; the threads cover the waiting. `tests/test_api_deploy_files.py`
holds the contract (every third-party import of `api/` is installed, the command and timeout, no secret baked in).

**Create the service (Render dashboard, ~5 minutes):**

1. **New + > Web Service > Build and deploy from a Git repository**, pick the `repcheck` repository.
2. Name `repcheck-api`. Region **Singapore** (the Supabase project is in Singapore; every request makes several database
   round trips). Branch `main`. Leave Root Directory empty.
3. **Language: Docker.** Dockerfile Path **`./Dockerfile.api`**. (It must not be the default `./Dockerfile`: that is the website.)
4. Instance type **Starter** or larger. The free tier sleeps, and 512 MB is the floor for OpenCV + ffmpeg; if the service is ever
   killed for memory, move to Standard (2 GB) rather than adding workers.
5. **Advanced > Health Check Path: `/api/health`** (it answers 503 when the database is unreachable, so Render stops routing to a
   broken instance). Leave Auto-Deploy on. No disk is needed: uploads and clips live in temporary directories and the files that
   matter go to Supabase Storage.
6. **Environment variables** (Add from `.env` where noted; never paste them anywhere else):

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | from `.env` |
   | `SUPABASE_SERVICE_ROLE_KEY` | from `.env` (the `sb_secret_...` key) |
   | `SUPABASE_DB_URL` | from `.env`: the shared pooler on port **6543** (`...pooler.supabase.com:6543`), not the `db.<ref>` host, which is IPv6-only and Render cannot reach it |
   | `GEMINI_API_KEY` | the same value as on the website's service |
   | `ADMIN_EMAILS` | `phuttimatebenchanakatkul@gmail.com` (comma-separated). **Without it the owner endpoints answer 404 to you too, and you are limited like everyone else** |
   | `REVIEW_ACCOUNT_EMAILS` | the same value as on the website's service (App Review's demo account: exempt from limits, never an admin) |
   | `FATSECRET_CLIENT_ID`, `FATSECRET_CLIENT_SECRET`, `FATSECRET_REGION` | optional; copy from the website's service if set there (without them the extra food lookup is a silent no-op) |

7. **Create Web Service.** The first build takes several minutes.

**Check it** (replace the host with the one Render shows): `https://repcheck-api.onrender.com/api/health` should answer
`{"ok":true}`, and `https://repcheck-api.onrender.com/api/profile` should answer 401 `{"ok":false,...}` (a route that needs a token).
Deploy status can be read from the Render API like the website's (`srv-...` id of the new service); a failed deploy rolls back
silently, so check the status, not just the health URL.

**Two things that must match the service, or it fails quietly:**

- **Exactly one proxy hop** sits in front of it (Render's own). The waitlist's per-visitor limit keys on `request.remote_addr` behind
  `ProxyFix(x_for=1)`; a CDN or second proxy in front would make every visitor share one address (or let a caller choose theirs).
- At launch the marketing form's three settings move together: `ENDPOINT` in `marketing/app.js`, `connect-src` in the marketing
  sites' Render CSP header, and `WAITLIST_ORIGINS` in `api/admin.py` (already the two marketing hostnames). Update
  `marketing/privacy.html` in the same change if the destination or the processor changes.

**Not part of this service:** the website keeps running from `Dockerfile` until launch day. Nothing here changes it; this
service simply sits unused until the native app talks to it.

## Synced data (what the browser kept, and where it lives now)

Traced from the code that writes each key (`app.py` `SYNCED_DATA_KEYS`,
`static/account_sync.js`, the templates), not from old rows. All weights are kg,
heights cm, distances km. Day keys are the device's LOCAL calendar date. Every
`addedAt` / `loggedAt` / `analyzedAt` is milliseconds since epoch.

| Old key | Now | Notes |
|---|---|---|
| `repcheck_nutrition_log_v1` | `nutrition_entries` | A meal is simple (`grams`, `unit`, per-100 g `base_*`) or composite (`ingredients`, kept as jsonb). No calories are stored; they are computed from the `base_*` values. `log_date` and `added_at` are independent: "Log macros" stamps `Date.now()` even on a past day. |
| `repcheck_workout_log_v2` | `workout_entries` + `workout_sets` | Sets are ordered rows. `""` in the old data means "not filled in" and is NULL now. Each-side mode keeps left/right columns next to the both-sides ones. |
| `repcheck_weight_log_v1` | `weight_entries` | One per day; `0 < kg <= 400` (the old endpoint's rule) is a constraint. |
| `repcheck_day_status_v1` | `day_status_overrides` | Only `fasting` / `incomplete`; "logged" and "none" are the absence of a row. |
| `repcheck_activity_log_v1` | `activity_days` | The server's streak back-fill (challenge, analysis, hyrox, checkin_photo) is still computed from the other tables at read time. |
| `repcheck_analyze_log_v1` | `analyze_log_entries` | No ids in the old data; uniqueness on (user, exercise, time) stands in. Note: `result.html` appends a fresh entry on every view of an old result (website bug, not carried as a fix). |
| `repcheck_hyrox_history_v1` | `hyrox_races` + `hyrox_race_splits` | `date` is a full ISO UTC timestamp. The AI analysis is jsonb. Distinct from `hyrox_results`, the leaderboard table. |
| `repcheck_coach_chat_v1` | `coach_messages` | Single-day thread, no turn ids. Old turns may lack a `date` (NULL kept). |
| `repcheck_workout_chat_v1` | `workout_chat_messages` | Per day, permanent. Turns from current code carry a client id; older ones do not. |
| `repcheck_analyze_chat_v1_<id>` | `analyze_chat_messages` | One thread per analysis; a composite foreign key to the user's own `analyze_results` row replaces the old "id must be yours" check, and deleting an analysis deletes its thread (what `prune_analyze_results` did by hand). |
| `repcheck_theme`, `_language`, `_units_v1`, hyrox gender / lane / synced flag | `user_settings` | One row per user. Theme and language were per-device in the website (local won); they are per-account now. |
| `repcheck_nutrition_goals_v1` | `nutrition_goals` | protein / fat / carbs. Calories are 4p + 9f + 4c. |
| `repcheck_nutrition_favorites_v1`, `repcheck_exercise_favorites_v1` | `nutrition_favorites`, `exercise_favorites` | |
| `repcheck_split_plan_v1` | `split_plans` | One document, always replaced whole; days / schedule / prescriptions stay jsonb. |
| `repcheck_coaching_profile_v1` + the five `repcheck_coaching_*` keys | `coaching_profiles` | One row per user. A trigger keeps `database._merge_coaching_profile_write`'s rule: a required field, once stored, cannot be blanked. |

**What stayed JSON, and why:** a thing that is one document, always read and
written whole (split plan, a meal's ingredients, a race's AI analysis, a reply's
sources). Splitting those adds joins and no capability. Everything queried or
edited as a row is a table.

**Constraints are only rules the old server enforced.** The sync route accepted
any JSON for most keys, so stricter rules would reject real legacy rows at
import. Enforced: real calendar dates (`date` columns), the weight range, the
coaching-profile rule, the analyze-chat ownership rule. Every table also has an
`extra jsonb` column: a field the importer does not recognise is kept there, so
nothing is dropped.

**Not carried over, deliberately, until you decide:** the 2 MiB-per-key and
200-entries-per-day ceilings (`MAX_SYNC_VALUE_BYTES`, `/api/workout/log-day`) and
`PER_USER_LIMITS`. The app can now write these tables directly, so a per-user
ceiling has to be chosen again, in the database.

## Phase 1 status (2026-10-25)

**Built and applied to the Supabase project:** seven migrations in
`supabase/migrations/`.

1. `core_tables`: profiles and the tables that were already real SQLite tables.
2. `user_data_tables`: the `user_data` blobs as tables, plus the coaching-profile
   trigger.
3. `extra_columns`: an `extra jsonb` on every table, so a field the importer does
   not recognise is kept, not dropped.
4. `hardening` (from the first review): generated keys the client cannot choose,
   an idempotency key on chat turns, indexes on every column RLS and cascades
   filter by, quarantined import data erased with its owner, the coaching profile
   cannot be deleted and re-inserted partial.
5. `password_and_whitespace` (from the adversarial review): a legacy password hash
   is dropped by a trigger whenever the account's password changes by any route,
   and the required-field rule treats whitespace as blank.
6. `whitespace_means_all_whitespace`: `btrim` strips only spaces, so a tab or a
   non-breaking space still counted as a value; now it strips all of them.
7. `storage_buckets`: two private buckets, `progress-photos` (12 MiB, JPEG / PNG /
   WebP: the site's own limits) and `analyze-videos` (50 MiB, the six video types the
   site accepted), with one read-own policy each on `storage.objects`.

RLS is on every table; the project exposes no table automatically and new tables
start closed (default privileges revoked from `anon`, `authenticated` and PUBLIC).
Also built: the two-user isolation suite (`tests/test_supabase_rls.py`), the importer
(`scripts/migrate_sqlite_to_supabase.py`) and its unit tests
(`tests/test_sqlite_to_supabase_mappers.py`, `_plan.py`, `_files.py`), and the
Storage isolation suite (`tests/test_supabase_storage.py`).

**Who can touch what.** The app reads and writes its own rows directly in the
user-data tables above, and reads (only) its own rows in `custom_foods`,
`custom_exercises`, `progress_photos`, `analyze_results`, `hyrox_results`;
those writes stay behind Flask because Flask enforces rules the database does not
(the 500-row cap, calories derived from macros, the check-in date window). It
manages its own `blocked_users`. It can change only `profiles.onboarding_completed`:
name, avatar, friend code, AI consent and deletion stay in Flask, because the
display-name filter (App Review 1.2) is Python and must not be bypassable. It can
update its coaching profile but not delete it (that row goes with the account).
Friends, challenges, leaderboards, reports, usage and rate limits are
unreachable from the app and served by Flask. User ids are **not secrets**: they are
derived from the legacy ids, so nothing may rely on an id being unguessable.

**Storage.** Objects live at `<user id>/<file name>`, where the name is
`progress_photos.filename` or `analyze_results.video_filename`. The app may READ its
own files (download, signed link, list its own folder) and nothing else: Flask, with
the service role, uploads, replaces and deletes, for the same reason it keeps writing
the matching tables (it checks what the database cannot: that the bytes are really an
image, the 500-photo cap, the check-in date window). Neither bucket allows direct
SQL deletes (Storage refuses them), and **deleting an Auth user does not delete its
files**, both measured: account deletion and the history prune
(`ANALYZE_HISTORY_KEEP`) must remove objects through the Storage API. The Flask port
owns that; `run_deletion_purge`'s file unlinks today are the model.

**What is proven, and how**
- **Isolation (`tests/test_supabase_rls.py`, 155 tests, ~55 s).** Signs in as real
  users and calls the Data API the way the app will. Mutation-checked against the
  live project: 25 guards loosened one at a time (a policy opened wide, a check or
  foreign key dropped, a table exposed, default privileges reopened, the coaching
  trigger or the legacy-hash trigger removed, whitespace trimmed as spaces only),
  every one caught, and the catalog (policies, grants, constraints, triggers and
  function bodies) identical to a snapshot afterwards.
  That exercise found real weaknesses in the tests themselves, all fixed: a forged
  write sent with `Prefer: return=representation` is masked (the new row must
  pass the SELECT policy to be returned), so attackers are simulated with
  `return=minimal`, PostgREST's default; forging against a row that already
  exists is refused by its primary key rather than by policy, so forgeries target
  a victim who owns nothing; and the structural policy check must test each
  USING / WITH CHECK clause on its own.
  Loosening a lone UPDATE/DELETE policy is behaviourally invisible (Postgres also
  applies the SELECT policy to the rows it touches), so those are killed by the
  structural test, not a behavioural one. The suite needs `SUPABASE_*` in `.env`
  and is skipped without it, so CI does not run it (see `TODOS.md`).
- **Storage isolation (`tests/test_supabase_storage.py`, 58 tests, ~20 s).** Two
  signed-in users and a third with nothing, against the live Storage API: own files
  readable; no other user's file readable by name, by `..`, `%2e%2e`, `//` or a
  leading slash, by a signed link, or listed; nothing readable signed out; and not one
  upload, overwrite, delete, move or copy works for the app, in either bucket, proved
  by the EFFECT (bytes and keys unchanged, read back with the service key) because
  Storage reports a refusal as HTTP 400 with the real status in the body and a refused
  bulk delete as 200 with an empty list. A control test runs the same requests as the
  service role and requires every one to succeed, so a malformed request cannot pass
  as a refusal. Buckets and policies are pinned exactly (all private, the limits, the
  types, one SELECT policy each scoped to the bucket AND the caller, RLS on every
  storage table). 22 guards loosened one at a time (a policy opened wide or to anon,
  a bucket made public, an INSERT / UPDATE / DELETE policy added, users allowed to
  see / create / change buckets, limits removed or doubled, a type widened, a stray
  public bucket, a policy on another storage table): all caught, 18 by the behavioural
  tests alone (the other 4 are catalog-level by nature: two are behaviourally
  equivalent today because the folder check still blocks everyone, two have nothing
  observable), catalog identical afterwards. That exercise found a real flaw in the
  tests: under a loosened bucket policy their own attack on the REAL bucket succeeded
  and left it public, so the test now restores the buckets in a `finally` and the
  harness detects and repairs such damage. Not covered, and not coverable from here:
  `storage.objects` itself is owned by `supabase_storage_admin`, so turning its RLS off
  cannot be simulated; the suite asserts it is on.
- **Importer (314 unit tests, no network, ~4 s).** 129 mutations of the importer,
  all caught, plus two on the float-precision guard below and 53 on the file copy
  (52 caught; the survivor is equivalent: `requests` adds the JSON content type itself). End to end on the live
  project, twice: a synthetic database built with the current `init_db()` (Apple,
  Google and local accounts, a scheduled deletion, orphans, awkward text, every
  blob shape; 45 independent checks, including what an imported user can and
  cannot read through the API) and the 28-account dev database (a naive per-user
  count taken straight from the raw JSON agrees on 28 users x 10 tables, zero
  mismatches). A forced re-import reproduces everything, and the project was
  emptied again afterwards. The file copy was run live with the dev database and the
  dev server's disk: only the two referenced photos went up (not the 357 unreferenced
  test PNGs beside them), each byte-identical by md5 and by a full sha256 download;
  an injected failure after the upload removed the files, the accounts and the rows;
  a stray file in an imported user's folder was tidied on the next `--reset`; replacing
  the dev import with the synthetic one emptied the departed users' folders and used
  the video bucket; the owner could read their photo through the API and another user
  could neither read it nor get a signed link.
- **The importer's own guarantees.** All-or-nothing: every table is read back and
  compared with the plan, row by row, before the commit, and a mismatch rolls the
  database back and deletes the Auth accounts that run created. Every source item is
  accounted for (imported / quarantined / duplicate / orphaned) or the run stops.
  An account that cannot be imported (a malformed email, say) stops the run
  until it is fixed in the source or left out on purpose with `--skip-account`.
  `--reset` replaces a previous import inside the same transaction, so a failed
  reset leaves the project as it was. It refuses to run on top of an earlier import
  without `--reset`, and `--reset` refuses once any imported account has signed in
  (after launch those are the real users) unless `--force-reset-signed-in-accounts`
  is given the project ref. Values that cannot be stored (NUL characters, lone
  surrogates) are parked in `import_quarantine` instead of failing the run.
  Verification never prints a value, only which column differs.
- **The file copy's guarantees.** Rows that point at files need an explicit answer:
  `--files-dir <folder>` (a copy of the old server's `progress_photos/` and
  `analyze_videos/`) or `--skip-files`; with neither, or with a folder in which none of
  the files is found (almost certainly the wrong folder), the run stops before writing
  anything. Only files the imported rows name are copied (no unreferenced file, and
  nothing for a deleted, expired or skipped account). A name must be what the old
  server generated (a hex id plus an allowed extension: no separators, no leading dot),
  links are refused, and over-limit files are reported, not truncated. An absent file
  is reported and its row kept (the old site answered 404 for it too). Files go up
  BEFORE the database transaction, are checked against Storage's own record (for a
  single-part upload the ETag is the md5, so nothing is downloaded again), and any
  failure removes exactly the objects this run added. After the commit, Storage is
  tidied to the plan: an imported user's folder holds only planned files, and a
  departed user's folder is emptied.

**Running it**

```
python scripts/migrate_sqlite_to_supabase.py <file.db> --dry-run --files-dir <disk>   # map + account + look for the files, touch nothing
python scripts/migrate_sqlite_to_supabase.py <file.db> --files-dir <disk>             # first load
python scripts/migrate_sqlite_to_supabase.py <file.db> --files-dir <disk> --reset    # replace a previous import
python scripts/migrate_sqlite_to_supabase.py <file.db> --skip-files                   # rows only; photos stay uncopied
python -m pytest tests/test_supabase_rls.py tests/test_supabase_storage.py            # need SUPABASE_* in .env; skipped without
```

`<disk>` is a copy of the old server's data folder (`DATA_DIR`: it must contain
`progress_photos/` and `analyze_videos/`), kept outside the repo like the export.
`/admin/export-db` carries only the database, so the files have to come off the Render
disk some other way: Render's shell (the export route's own comment mentions SSH) or
`scp`. A one-off owner-only download route would also work, but it is a change to the
frozen website, so it needs your say-so.

The project is empty again (all 37 tables, no auth users, no stored files): the dev
copy was removed after testing because this project becomes production.

**Findings from the data that shaped the importer**
- SQLite never enforced foreign keys, so rows of deleted accounts are left
  behind (the dev copy has 245 rows from 45 accounts that no longer exist).
  They are counted and NOT imported, not even to quarantine: a deleted
  account's data must not follow the migration. The same goes for an account
  whose 30-day deletion window has already passed.
- Older food entries have no `id`, use `name` instead of `food`, and carry an
  `hour` instead of `addedAt`; older coach turns have no `date`. The current
  website has no handling for the older shapes (its food page keys on `entry.id`
  and sorts by `addedAt`; nothing reads `hour`), but they are the user's data, so
  they are kept: id-less entries get a deterministic id (identical copies stay
  separate), `hour` is kept in `extra` and the time defaults to midnight.
- **Floats read back rounded.** Postgres stores a double exactly but prints it with
  15 significant digits on the pooler's sessions (`extra_float_digits = 0`), and the
  Data API does the same: a stored `79.83225712000001` comes back `79.83225712`.
  The importer's verification first read this as 28 corrupted rows and rolled back
  (correctly); it now reads at full precision. For the app it is harmless noise on
  computed values, but do not rely on a float round-tripping bit-exactly.
- The Data API returns at most 1000 rows per request (measured on this project: 1500
  rows in, 1000 back, no error), so a long food or workout log must be paged.
- **How Storage behaves** (all measured here): a refused upload is HTTP 400 with the
  real status (403, 404, 413, 415) inside the body; the project-wide upload cap allows
  at least 50 MiB (exactly 50 MiB went up, one byte more was refused by the bucket);
  bucket limits apply to the service role too; a user cannot even see a bucket, so
  update / delete policies alone would do nothing, and the loophole to guard against is
  SELECT plus a write policy; zero-byte files are accepted.

**Not done yet in phase 1**
- **Flask ported to Postgres, verifying Supabase JWTs**: foundation, accounts and the
  Storage purge are done; the remaining routes are in "The Flask port" above (photo
  and clip uploads and signed links, and the history prune through the Storage API, are
  the next slices).
- **Apple / Google providers** in the Supabase dashboard.
- **A true production copy and the files that go with it** (below): everything was
  run on the dev database and its dev disk, and a synthetic one.

**Open decisions (yours)**
1. **A real production copy.** The local `repcheck.db` is a dev database (28
   local-password accounts, no Google/Apple users, older schema). A true copy
   needs your admin login: open
   `https://repcheck-q0m4.onrender.com/admin/export-db` while signed in as the
   owner and save it **outside the repo** (for example `D:\RepCheck_Backups\`).
   `.gitignore` now also covers `*.db`, `*.sqlite*` and `repcheck_production*`,
   but the repo is public, so still keep it outside. Then copy the Render disk's
   `progress_photos/` and `analyze_videos/` next to it (see "Running it") and run
   `--dry-run --files-dir` on both before anything else.
2. Per-user row ceilings for the directly-writable tables (above).
3. Legacy `hour` entries: leave at midnight, or convert `hour` into a time.
4. **Sign-up and the display-name filter** (App Review 1.2): resolved by construction, see
   "The Flask port". An account created straight against Supabase Auth has no profile and so
   nowhere to put data; only `POST /api/profile` makes a profile, and it applies the filter.
   Still worth turning off "Allow new users to sign up" in the dashboard (Authentication →
   Sign In / Providers) until the app exists, to keep spam accounts out. Today it is on (checked
   2026-10-25: `disable_signup` false, `mailer_autoconfirm` false). Email confirmation is on,
   which is the setting the migration relies on (see "Passwords").
5. **Email verification and provider linking** (see "Passwords").

**Known website bug the data model inherits unchanged:** changing gender in
Settings can delete `bodyFatRangeId`, and the required-field rule then restores
the old-gender value, leaving an invalid gender / body-fat pair. Worth fixing in
the app's profile screen, not in the frozen website.

## Passwords

Supabase Auth can't import Werkzeug 3.1's **scrypt** hashes (only bcrypt and
argon2). So:

1. The import creates every user in `auth.users` without supplying a
   password. **Auth then stores a random one nobody knows** (checked on the live
   project: each account gets its own distinct bcrypt hash), so nobody can sign
   in until their real password is set. The old scrypt hash goes into
   `legacy_password_hashes`, a locked-down server-only table.
2. **A row in `legacy_password_hashes` is what marks an account as still
   needing migration**, not a missing Auth password (there is always one). The
   app's sign-in tries Supabase first. If the account has a legacy hash, it
   calls a Flask route that checks the password against it. If it matches,
   Flask sets that as the Supabase password through the admin API, deletes the
   legacy row, and the app signs in normally. A trigger also deletes the row when
   the password changes any other way (a recovery email, say), so a leaked old
   password cannot be put back.
3. After 90 days, anyone still on an old hash gets a password-reset email.

**Email verification.** The old website never verified an email, so an address on
a local account proves nothing. The importer therefore creates those accounts
**unconfirmed**; only Google and Apple addresses, which the provider vouched
for, are marked confirmed. Checked live: an unconfirmed account cannot sign in with
a password. That needs "Confirm email" to stay **on** in the dashboard, and it needs
**custom SMTP** before launch: Supabase's built-in mail sender is for testing and
heavily rate-limited, so confirmation and reset emails for the whole user base would
not get through. Open decision for phase 2, because it decides the first launch-day
experience of every local user: send them a confirmation email on their first
sign-in (safe, recommended: it stops someone who once registered another person's
address on the old site from owning the account a provider later links to), or
treat a matching legacy password as proof and confirm at that moment (no extra step,
but then provider linking by email must be switched off for those accounts).

**Google and Apple users** are imported with their provider and provider id in
`app_metadata` (admin-only; `user_metadata` is user-editable and is not used). The
provider identity itself cannot be created through the admin API, so it is not
imported. The plan relies on Supabase linking an existing account to a provider
sign-in that carries the same **verified** email; that must be tested with real
Google and Apple accounts in phase 2. Apple accounts that never shared an email have
a placeholder address (`...@no-email.repcheck.local`) and will not match; they need
a manual path.

## What survives the website

- **Privacy policy, terms, support and sources pages.** App Store Connect
  requires public URLs for privacy and support, and the AI citations link to
  `/sources`. Move them to the marketing site (`marketing/`) before
  launch, and update the App Store Connect URLs.
- **Moderation.** Guideline 1.2 needs reports acted on. Keep the Flask
  `/admin/reports` and `/admin/users` pages (owner-only, now reading
  Supabase), or use the Supabase dashboard. Decide in phase 5.
- **An "Update RepCheck" page.** After launch, old Capacitor installs still
  load the site. Every page route returns one screen telling them to update
  from the App Store.
- **Browser and Android users lose access.** If that matters, an Android
  build through Expo is a later, cheap addition.

## Launch day

One switchover. The data move and the new app go out together, so it gets
rehearsed.

1. **Before:** the native version is approved in App Store Connect and held
   for **manual release** (the way 0.12.10 shipped). The marketing site
   already hosts the legal pages.
2. **Rehearsal (the day before):** fresh production export
   (`/admin/export-db`) → import into a **second, temporary Supabase project**
   (not a schema: the importer writes to `public` and Auth accounts are
   project-wide, so a schema cannot isolate it; check what an extra project
   costs first) → the importer's own verification plus the per-user count check
   → sign in as test accounts on a TestFlight build.
3. **Switchover:** put the website in read-only mode → final export →
   import into the real project → verify counts and per-user totals →
   deploy the API-only Flask with the update page → **release the app in
   App Store Connect**. Confirm by Render deploy **status**, not the health
   check (see `CLAUDE.md`).
4. **Rollback:** keep the SQLite file and the Render disk for 30 days. Until
   the app release is pressed, rolling back means redeploying the old Flask.
   After that, the old app can't be restored, which is why the rehearsal
   matters.
5. Afterwards, retire `native/`, `capacitor.config.json`, the Capacitor
   parts of `codemagic.yaml`, `templates/` and `static/`.

## Costs and risks

- **Supabase cost.** Pro is $25 a month, plus storage and egress beyond the
  included amount. Form videos are the big storage consumer; the site already keeps
  only each user's newest 20 (`ANALYZE_HISTORY_KEEP`), and the Flask port must keep
  that prune, deleting the objects through the Storage API.
- **Everything happens on one day.** The data move, auth change and new app
  all land at once. The rehearsal and the manual-release hold are the
  mitigation.
- **RLS mistakes leak data.** The isolation suite is non-negotiable, and it
  gets extended with every new table.
- **The frozen website still matters until launch.** A breaking bug there
  is a breaking bug in the App Store app, so it still gets fixed.
- **Building from Windows.** Expo Go covers phases 2 to 5. Phase 6 needs a
  custom dev build. Local Supabase needs Docker Desktop. The widget's Swift
  can't be debugged locally.
- **Review scrutiny.** It's a new binary on an app with four rejections behind
  it. Before submitting, check the app against every fix in
  `IOS_APP_STORE.md`: camera permission strings, AI consent, citations,
  Report, block, calorie floors, FatSecret/OFF attribution and the HYROX
  trademark note.
