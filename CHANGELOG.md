# Changelog

All notable changes to RepCheck are recorded here, newest first.

## [0.53.0.0] - 2026-10-29

### Added

The waitlist and the owner's tools on the new Supabase server (step 8c2 of moving off Render). Nothing the app does changes yet: it still talks to the Render server until the last step, and the marketing site still posts to the old address.

- **The waitlist** the marketing site posts to: the same two allowed origins, five tries an hour per visitor address, an address that is already on the list answered exactly like a new one, and a source label with control characters dropped.
- **The owner's routes**, each a 404 to anyone not in `ADMIN_EMAILS` (the review account included): open reports against accounts and against AI replies, reset a reported name, mark a report handled, the waitlist as JSON or as a CSV a spreadsheet cannot run formulas from, delete an address on request, signups for today (Bangkok's day), the week, the month or all time, and one account's detail.
- **Proven:** 418 Deno tests, including cases whose answers the old Python code gave (the CSV, the signup ranges across Bangkok's midnight, the usage labels), run offline and side by side with the Python; a live run in which a throwaway visitor joined the real waitlist, hit the hourly limit and was removed by a throwaway owner account; then deliberate breakages of the new code (all 87 caught). Not deployed: that needs your Supabase login.
- **Worth checking after you deploy:** the per-visitor limit counts tries by the address the platform's proxy reports; if Supabase puts it in a header the code does not read, every visitor shares one budget.

## [0.52.0.0] - 2026-10-29

### Added

Food on the new Supabase server (step 8f of moving off Render, first part). Nothing the app does changes yet: it still talks to the Render server until the last step.

- **The meal photo scan**, with the note you type after picking the photo told to the model as more reliable than its own look; one scan a day, given back if the model cannot read the photo.
- **Barcode lookup by the digits** from the phone's scanner: your own saved food for that barcode first, then Open Food Facts, then FatSecret (the second database is used only when its keys are set), with the same checks for kilojoules entered as calories and impossible amounts, and a barcode nobody knows still a normal "offer to create it".
- **Online food search**, a person's **own foods** and **own exercises** (500 each, calories worked out from the macros, one food per barcode).
- **Proven:** 397 Deno tests, including ~3,000 cases whose answers the old Python code gave, run offline and side by side with the Python (every lookup also has to make the same requests in the same order); a live run against the real database, the real Open Food Facts and the real model; then deliberate breakages of the new code (294 of 305 caught; the rest change nothing anyone can observe). Not deployed: that needs your Supabase login.
- **Not yet moved:** reading a barcode out of a PHOTO of one (the old server used an image library the new one lacks). The app's live barcode scanner is unaffected; the photo path needs a decision (see MOBILE_APP_PLAN.md, 8f2).

### Fixed

- A hand-typed text field that held `true` was read as "true" where the old server read "True"; it now follows Python.
- One authentication test could fail about once in 4,096 runs by tampering with a signature that already ended the way the test wrote it.

## [0.51.0.0] - 2026-10-29

### Added

The HYROX race analysis on the new Supabase server (step 8e4 of moving off Render). Nothing the app does changes yet: it still talks to the Render server until the last step.

- **Analyse a race** from its split times: a one-sentence read of where the time went, the bullets behind it, and a rating and tip for each of the eight stations in race order. Eight races per five hours, as before; past that, the same friendly "check back in" message.
- **If the model cannot help**, the app gets the neutral tips it always accepted and the use is given back, so a Google hiccup never costs one of the eight.
- **Proven:** 353 Deno tests, including ~700 cases whose answers the old Python code gave (race prompts with odd names and times, model answers read in many broken shapes, the clock's rounding, Python's capitalising rules over every letter Unicode has), run offline and side by side with the Python; a live run in which the real model analysed a race; then deliberate breakages of the new code (all killed except one change with no observable effect). Not deployed: that needs your Supabase login.

## [0.50.0.0] - 2026-10-29

### Added

The workout-split generator on the new Supabase server (step 8e3 of moving off Render). Nothing the app does changes yet: it still talks to the Render server until the last step.

- **Build a split** (Push/Pull/Legs, Upper/Lower, Full Body, Bro, or your own days) with the same rules as before: your goal words can add a mobility, athletic, balance or low-impact day, pregnancy makes every day low-impact, a "hybrid" gym adds conditioning, and an exercise you picked by hand is never changed. If the model is down or sends something unusable, the plan without it is returned.
- **"Let AI build it"** picks the split type for a beginner, in the shorter sessions that suit how many days a week you train, and returns it in the shape the model is held to.
- **One plan a day** is kept, with the same 429 and "check back in" message.
- **Proven:** 334 Deno tests, including ~3,800 cases whose answers the old Python code gave (plans, prompts, a model's answer broken in many ways, the weight lines), run offline against saved answers and side by side with the Python; a live run in which the real model built a plan through the real schema; then deliberate breakages of the new code (every survivor either killed by a new test or a change with no observable effect). Not deployed: that needs your Supabase login.

### Fixed

- The same split request could give the model a differently ordered list of your hand-picked exercises from one run to the next; the order is now the one you gave.
- The size check on chat context counted the DEL character as one character where the old server counted six.

## [0.49.0.0] - 2026-10-29

### Added

The coaching targets and the weekly check-in on the new Supabase server (step 8e2 of moving off Render). Nothing the app does changes yet: it still talks to the Render server until the last step.

- **Calorie and macro targets, the weekly spread and the weekly tune** on the new server, with the same arithmetic as before, down to how a .5 is rounded (Python rounds to the even number, JavaScript does not).
- **The weekly check-in review.** The trend-based number is always worked out first; with consent the model may refine it, looking at your front and back photos, and if it cannot the trend-based
  number stands and your use is given back.
- **A fix on the way:** the old check-in told the model your bodyweight was "None kg" because it looked for it under the wrong name. It is now told your real weight.
- **Proven:** 296 Deno tests, including ~1,000 cases whose answers the old Python code gave (profiles, targets, weekly spreads and tunes at the edges of every band, applied deltas, prompts, rounding, number reading), run both
  beside the Python and offline against saved answers; a live run in which the real model reviewed a real photo; then deliberate breakages of the new code (every survivor killed by a new test, removed as
  redundant, or a change with no observable effect). Not deployed: that needs your Supabase login.

## [0.48.0.0] - 2026-10-28

### Added

The three AI chats on the new Supabase server (step 8e1 of moving off Render). Nothing the app does changes yet: it still talks to the Render server until the last step.

- **Coach, analysis follow-up and workout chat** on the new server, with the same rules: consent first, one shared budget of three messages a day (given back when
  the model cannot be reached), every reply ending in real, checked sources, and the same input limits.
- **A model client that tries again.** When Google says the model is busy (the common "high demand" answer), it now tries up to three times before telling the person
  the coach is unreachable. The model can be changed without a code change by setting the `GEMINI_MODEL` secret.
- **Proven:** 252 Deno tests; the sources, request checks and prompts give identical answers from the old and new code over seeded corpora; a live run asks the real
  model all three chats and checks the cited sources; then deliberate breakages of the new code (every survivor killed by a new test, removed as redundant, or a
  change with no observable effect). Not deployed: that needs your Supabase login.
- **A warning found on the way:** on 2026-10-28 the website's model (`gemini-3.1-flash-lite`) answered every request with "high demand" (503), so the website's chats were
  probably failing as well; `gemini-3.5-flash-lite` answered.

## [0.47.0.0] - 2026-10-28

### Added

Friends, blocking and the leaderboards on the new Supabase server (step 8d of moving off Render). Nothing the app does changes yet: it still talks to the Render server until the last step.

- **On the new server:** adding a friend by code (30 wrong codes an hour, and a blocked person looks exactly like a wrong code), reporting and blocking, reporting an AI reply,
  the daily challenge list and today's exercise, the reps leaderboard, HYROX results and the HYROX leaderboard, and the streak's dates. Not yet: recording a challenge clip,
  which needs the video grader.
- **Proven:** 218 Deno tests; a live run in which two real accounts befriend, challenge, score, report and block each other against the real project (removed afterwards);
  the helpers that read text give the same answers as the old code over seeded corpora; then deliberate breakages of the new code (every survivor killed by a new test, removed
  as redundant, or a change with no observable effect). Not deployed: that needs your Supabase login.

## [0.46.0.0] - 2026-10-28

### Added

Photos and the old-password sign-in on the new Supabase server (step 8c of moving off Render). Nothing the app does changes yet: it still talks to the Render server until the last step.

- **Check-in photos.** Upload (with the same date, size and 500-photo rules), list, a five-minute link to your own photo, and delete (the file goes first, so a failure
  leaves the photo in place to try again). Pictures are checked from their bytes: PNG, JPEG and WebP are taken, GIF, BMP and TIFF are "unsupported", anything else is
  "not a readable image", as before.
- **The imported-password sign-in.** People whose accounts came from the website still get their old password carried across on first sign-in, with the same limits per
  address and per caller, and the same single answer whether or not the address exists.
- **Proven:** 179 Deno tests; the images and password hashes run through both the old and new code and agree (Pillow-made pictures and damaged copies of them; hashes
  Werkzeug wrote, of every kind and cost); a live run that signs in with a real token and does all of the above against the real project, then removes its throwaway
  account; then deliberate breakages of the new code (every survivor killed by a new test, removed as redundant, or a change with no observable effect). Not deployed:
  that needs your Supabase login.

## [0.45.0.0] - 2026-10-28

### Added

Accounts on the new Supabase server (step 8b of moving off Render). Nothing the app does changes yet: it still talks to the Render server until the last step.

- **Profiles, rename, delete and restore** on the new server: the same rules as before (a name is filtered and bounded, an email account must give one, a Google or
  Apple account gets its own, deleting starts 30 days of grace that asking again cannot push back, restoring ends it).
- **The purge of deleted accounts.** After 30 days a person's files are removed through the Storage service first and the sign-in account after, so a file that
  will not go leaves the person in place for the next try. With no scheduler, any request starts the check, at most once an hour, after the reply has gone.
- **The same name filter.** Its word list and its table of accent marks are generated from the Python filter, and a test runs ~1,600 names (bad words dressed up with
  numbers, accents, spacing and stretched letters, odd whitespace, emoji, controls) through both and demands the same answer for every one.
- **Proven:** 112 Deno tests, a live run on the real project (two throwaway accounts, one purged and the other left alone, both removed afterwards), checks that the
  numbers and routes match the Flask server's, then deliberate breakages of the new code (every survivor killed by a new test, removed as redundant, or a change with no
  observable effect). Not deployed: that needs your Supabase login.

## [0.44.0.0] - 2026-10-28

### Added

The first step of moving the native app's server off Render, onto Supabase. Nothing the app does changes yet: it still talks to the Render server until the last step.

- **The foundations of the new server.** `supabase/functions/` holds the start of the app's API as a Supabase Edge Function: the sign-in check (the same
  ES256 token rules as before), the database connection, the per-account AI limits, the AI-consent check, and the first two routes (health and AI consent).
- **Proven:** 49 tests in Deno, a live run against the real database with one throwaway account (removed afterwards), 6 checks that the limits, messages and routes
  match the Flask server's, then deliberate breakages of the new code (every survivor killed by a new test, removed as redundant, or a change with no
  observable effect). Not deployed: that needs your Supabase login.

## [0.43.0.0] - 2026-10-28

### Added

Build configuration for the native app. Nothing in the website or the current App Store app changes.

- **Ready for EAS.** `mobile/eas.json` defines a development client, an internal preview and the App Store build (build numbers counted up by EAS), with
  the app's three public settings kept out of the file. The steps that need your Expo and Apple accounts are written down in the plan.
- **Packages level with the SDK.** Five Expo packages were a patch version behind; they are now the ones SDK 58 pins, and `expo-doctor` passes 20 of 20.
- **Proven:** 2492 app tests, a build export for iOS, and a test that fails if a secret reaches `eas.json` or the store profile stops being a store build.
  Not yet built on EAS or run on a phone: it needs your Expo account.

## [0.42.1.0] - 2026-10-28

### Fixed

A correction to 0.42.0.0 (the HYROX custom race builder). Nothing in the website or the current App Store app changes.

- **The 0.42.0.0 "proven" line was wrong.** It said every deliberate breakage of the new code was caught; the full run was 142 breakages with
  20 not caught (I had read a partial result). This release adds the missing tests (the station picker opening and shutting, the selected group,
  the block numbers, a Doubles setup not leaking into a hand-made race) and removes three checks that could never matter. The re-run: 65 breakages
  of the changed code, 61 caught, 4 with no observable effect (two are types, two are fallbacks no key can reach).
- Behaviour is unchanged for anyone using the builder.

## [0.42.0.0] - 2026-10-28

### Added

The HYROX custom race builder in the native app. Nothing in the website or the current App Store app changes.

- **Build your own race.** Choose Custom when setting up a race: start from the whole standard race or from nothing, add any station any number
  of times, move blocks up and down, remove them, and set each one's distance (or wall-ball reps). The race runs block by block with the laps for
  each sled or carry, and is saved to your history as a Custom Race. It never counts as a personal best or goes on the leaderboard.
- **Proven:** app tests for the builder and the run, a check of the station list and defaults against the website's own, then deliberate
  breakages of the new code (every survivor killed by a new test, removed as redundant, or a change with no observable effect). Not yet run on a phone.

## [0.41.0.0] - 2026-10-28

### Added

More of the HYROX race tracker in the native app. Nothing in the website or the current App Store app changes.

- **Practise with a lighter weight.** In Pro Singles, the sleds, the farmers carry and the sandbag lunges can be set lighter; the laps grow to keep the
  work comparable.
- **Split a Doubles race.** Say how many rounds of each loaded station are yours and how many your partner's; the race shows your share.
- **How to do each station.** Tap a station for what it is, three steps, the tip that saves most time, and a tutorial video.
- **Proven:** 2466 app tests (including a run of the website's own scaling and how-to code against ours), then 270 deliberate
  breakages of the new code (every survivor killed by a new test, removed as redundant, or a change with no observable effect). Not yet run on a phone.

## [0.40.0.0] - 2026-10-28

### Added

Reminders in the native app. Nothing in the website or the current App Store app changes.

- **Reminders from your phone.** *Settings > Reminders* turns on two: one in the evening when you have gone three days without logging a weight or
  food, and one on the morning your weekly check-in is due. They come from the phone itself (nothing is sent anywhere), and turning them off cancels them.
- **Proven:** 2416 app tests, then 65 deliberate breakages of the new code (every survivor killed by a new test, removed as
  redundant, or a change with no observable effect). Not yet run on a phone, which this one most needs: the notifications themselves are
  mocked in the tests.

## [0.39.0.0] - 2026-10-28

### Added

The "it's been N days" nudge in the native app. Nothing in the website or the current App Store app changes.

- **A nudge when you have been away.** After three days without logging a weight or food, Home and Nutrition say how long it has been and why it matters
  for your calorie target. *Dismiss* hides it for the day.
- **Proven:** 2360 app tests, then 28 deliberate breakages of the new code (every survivor killed by a new test, removed as
  redundant, or a change with no observable effect). Not yet run on a phone.

## [0.38.0.0] - 2026-10-28

### Added

The HYROX leaderboard and AI race analysis in the native app. Nothing in the website or the current App Store app changes.

- **The HYROX leaderboard.** Everyone's fastest time for each of the four boards (Open or Pro, Singles or Doubles), for men or women, with your
  place marked. Every other name has a *More options* button to report or block it.
- **A coach for your race.** After a race the AI says where to gain time, what was strong and what is already solid, station by station, and
  your breakdown's bars show it. It is saved with the race. You are asked before anything is sent to the AI.
- **Proven:** 2336 app tests, then 135 deliberate breakages of the new code (every survivor killed by a new test, removed as
  redundant, or a change with no observable effect). Not yet run on a phone.

## [0.37.0.0] - 2026-10-27

### Added

The HYROX race tracker in the native app. Nothing in the website or the current App Store app changes.

- **Run a HYROX race against the clock.** *HYROX* (on Home): choose Open or Pro, Singles or Doubles, Full or Half; see the race in order with the
  weight, laps and reps each station asks; then tap through the sixteen segments. You get your time, whether it is a new personal best, and
  where the time went.
- **Your races, saved.** Every finished race goes into your history with its splits, and a counting time goes on the leaderboard.
  *Personal bests* ranks your fastest five for each combo; open a race for its breakdown, or remove it.
- **Your lane.** Say how long your gym lane is once and every station shows its laps for it.
- **Proven:** 2271 app tests (including a run of the website's own station, weight, lap and clock code against ours), then 300
  deliberate breakages of the new code (every survivor killed by a new test, removed as redundant, or a change with no observable effect).
  Not yet run on a phone.

## [0.36.0.0] - 2026-10-27

### Added

The daily challenge and leaderboard in the native app. Nothing in the website or the current App Store app changes.

- **A rep challenge every day.** *Challenges* (on Home) shows today's exercise. *Record an attempt* gives you a countdown to get in
  position, films up to 25 seconds, counts your reps and shows how many counted.
- **A leaderboard.** Everybody, or just your friends; your place is pinned at the top and every other name has a *More options* button to
  report or block them.
- **Proven:** 2126 app tests, then 148 deliberate breakages of the new code (every survivor killed by a new test, removed as
  redundant, or a change with no observable effect). Not yet run on a phone, which this one most needs: the recorder is mocked in the tests.

## [0.35.0.0] - 2026-10-27

### Added

Friends, with the safety tools App Review asks for, in the native app. Nothing in the website or the current App Store app changes.

- **Add friends.** *Friends* (on Home) shows your code and QR. Type a friend's code, or scan their QR, to add them. Your friends are listed.
- **Report or block.** Every friend has a *More options* button: report the name (offensive, impersonation, spam, other) or block the account.
  Reporting also blocks, so you stop seeing them at once.
- **Undo a block.** *Blocked accounts* in Settings lists who you blocked, with *Unblock*.
- **Proven:** 2022 app tests, then 74 deliberate breakages of the new code (every survivor killed by a new test, removed as
  redundant, or a change with no observable effect). Not yet run on a phone.

## [0.34.0.0] - 2026-10-27

### Added

The weekly check-in in the native app. Nothing in the website or the current App Store app changes.

- **Check in once a week.** A week after your last check-in, Home and Nutrition offer it. Correct any day that was incomplete or a fast, add
  today's weight, and optionally front and back progress photos, then *Complete check-in*.
- **A target that follows your week.** You see whether you are on track, or your new daily calories, why, and what changed in protein, fat
  and carbs; the new numbers become your goals.
- **Reaching your goal is noticed.** Hit your goal weight and the check-in comes early, with *Set new goals* to start the questions again.
- **Fails safe.** If the check-in cannot be worked out, nothing is saved and you can try again; a photo that cannot be kept never blocks it.
- **Proven:** 1924 app tests, then 304 deliberate breakages of the new code (every survivor killed by a new test, removed as
  redundant, or a change with no observable effect). Not yet run on a phone.

## [0.33.0.0] - 2026-10-27

### Added

The coaching questions in the native app. Nothing in the website or the current App Store app changes.

- **Get a calorie and macro target built for you.** A card on Home (and a row in Settings) opens a short set of questions: your goal,
  weight, goal weight and pace, height, body type, activity, protein, diet, and whether to spread calories through the week. You see
  your targets before anything is saved, then *Save & start tracking* sets your daily calories and macros.
- **A safe pace.** Choosing to lose weight faster than the standard pace shows what that costs and who should not do it alone.
- **Edit it any time.** *Edit profile* in Settings opens the same questions with your answers already in.
- **Proven:** 1826 app tests (including a run of the website's own goal-weight and goal-date code against ours), then 307
  deliberate breakages of the new code (every survivor killed by a new test, removed as redundant, or a change that has no observable
  effect). Not yet run on a phone.

## [0.32.0.0] - 2026-10-27

### Added

Settings in the native app. Nothing in the website or the current App Store app changes.

- **Settings.** Open it from Home. Change your name; choose light, dark or the device's appearance; English or Thai; kilograms or pounds,
  centimetres or feet and inches, kilometres or metres, a 12- or 24-hour clock. They are saved to your account, so they follow you to
  another device, and apply at once.
- **AI features switch.** See whether you have allowed AI processing and turn it off, or back on, in one tap, with a link to what is sent.
- **Delete your account.** Ask, confirm, and it is scheduled for deletion in 30 days; *Keep my account* undoes it any time before. Home
  shows a banner while a deletion is scheduled.
- **Legal and help links** (contact, privacy, terms, cookies, refunds, sources) open inside the app. **Log out** is here too.
- **Proven:** 1666 app tests, then 48 deliberate breakages of the new code (every survivor killed by a new test, removed as
  redundant, or a change that has no observable effect). Not yet run on a phone.

## [0.31.0.0] - 2026-10-27

### Added

The workout chat in the native app. That completes Phase 4 (Analyze and the AI chats). Nothing in the website or the current App
Store app changes.

- **Workout AI Chat.** On the Workouts tab, once you have logged something on the day you are looking at, a card opens a chat about your
  training: progressive overload, form, whether you are training a muscle enough. The AI is told your last week and your last four
  sessions of each exercise, in your own units (kg or lb).
- **One conversation per day.** Today's takes questions; earlier days can be read but not added to. *New chat* clears one day only.
- **Same safeguards as the other chats.** Sources under every answer, the AI-generated line, *Report this reply*, the daily limit
  countdown, and the question about allowing AI features before anything is sent.
- **Proven:** 1616 app tests, including a run of the website's own summary code against ours on seeded histories, then 63
  deliberate breakages of the new code (every survivor killed by a new test, removed as redundant, or a change that has no observable
  effect). Not yet run on a phone.

## [0.30.0.0] - 2026-10-27

### Added

Ask about an analysis, in the native app. Nothing in the website or the current App Store app changes.

- **Ask about this analysis.** A button on every result and every past analysis opens a chat about that one: ask why a score was low,
  what to focus on next, whether to add weight. The AI is told the scores, the rep count and the report.
- **Same safeguards as the coach.** Sources under every answer, the AI-generated line, *Report this reply*, the daily limit countdown,
  and the question about allowing AI features before anything is sent.
- **Closes after a day.** As on the website, a chat takes new questions for 24 hours after the analysis; after that you can still read it.
- **Proven:** 1549 app tests, then 29 deliberate breakages of the new code (every survivor killed by a new test, removed as
  redundant, or a change that has no observable effect). Not yet run on a phone.

## [0.29.0.0] - 2026-10-27

### Added

The Coach tab in the native app. Nothing in the website or the current App Store app changes.

- **Ask the coach.** Muscle, fat loss, recovery, form. One conversation a day, kept when you close the app, cleared with *New chat*.
- **Every answer shows where it came from.** Up to three sources you can open, a link to all of them, a line saying it is AI-generated
  general fitness information and not medical advice, and a *Report this reply* button with four reasons.
- **Ask first.** Before your first message is sent you are asked to allow AI features; the question now also names chat messages.
- **Daily limit.** When the day's messages are used up you see how long until they reset, and your unsent question stays in the box.
- **Proven:** 1508 app tests, then 152 deliberate breakages of the new code (every survivor killed by a new test, removed as
  redundant, or a change that has no observable effect). Not yet run on a phone; the keyboard behaviour and the new Thai strings need a
  look on a device.

## [0.28.0.0] - 2026-10-27

### Added

The Analyze tab in the native app. Nothing in the website or the current App Store app changes.

- **Analyze a set.** Choose the exercise, film your set or choose a clip from your library, and send it. While it is graded you see the
  same progress lines the website shows. The result has your form score, a one-line verdict, the reps counted, what went well and your
  next step up front, the rest under *Full report*, a link to a how-to video, and your clip playing back.
- **Recent analyses and history.** The five latest are on the Analyze tab; *View full logs* lists everything the server keeps (your last
  20), by month. Open any of them to read its report again, with your clip.
- **Ask first.** Before the first clip leaves your phone you are asked to allow AI features, and the question now names videos.
- **Proven:** 1378 app tests, then 363 deliberate breakages of the new code (every survivor killed by a new test, removed as
  redundant, or a change that has no observable effect). Not yet run on a phone; the camera, playback and a real upload need Expo Go,
  and the new Thai strings need a native read.

## [0.27.0.0] - 2026-10-27

### Added

Nutrition history in the native app, and a way to remove your own foods and exercises. Nothing in the
website or the current App Store app changes.

- **Logging History.** Open it from the Nutrition page: a calendar of the month with each day as
  logged, fasting, incomplete or not logged, and the month's counts. Tap a day to mark it fasting
  (a day with no food) or incomplete (a day with food), or put it back to automatic. Works offline.
- **Full stats.** This week's calories day by day against your goal, your daily average, how many
  days landed within 10% of the goal, and any day's protein, fat and carbs against your goals.
- **Remove your own items.** A × beside a food you created (in the Custom list) or an exercise you
  created (in the plan's exercise list); each asks first.
- **Proven:** 1181 app tests, then 165 deliberate breakages of the new code (every survivor killed
  by a new test, removed as redundant, or a change that has no observable effect). That is the end of
  Phase 3. Not yet run on a phone; the new Thai strings need a native read.

## [0.26.0.0] - 2026-10-26

### Added

Two history pages in the native app. Nothing in the website or the current App Store app changes.

- **Streak history.** Tap the streak card on Home: your current and longest streak, and a calendar
  of the days that counted, month by month.
- **Weight history.** Tap "View history" under the weigh-in: a month or a year at a time with your
  latest, average and change, a line chart, and each day's change. Below it, a calendar of the days
  you logged your weight; tap a day to see it, and today to log or replace it.
- **A long weight history is read in full.** It was cut off after 1000 entries before.
- **Proven:** 1135 app tests, then 153 deliberate breakages of the new code (each survivor killed by
  a new test or a change with no observable effect). Not yet run on a phone; the new Thai strings need
  a native read.

## [0.25.0.0] - 2026-10-26

### Added

The native app can now plan your training week. Nothing in the website or the current App Store
app changes.

- **Plan my split.** Let the AI build it (where you train, your goal, how many days a week) or
  build it yourself: name your days, or start from Push / Pull / Legs, Upper / Lower, Full Body or
  a bro split, then tick the exercises for each day. Building it yourself uses no AI.
- **Look it over before you keep it.** Choose which day falls on which weekday (or Rest), add and
  remove exercises, and set the sets and reps for each one, with the standard shown and a reset.
- **Edit later.** The saved plan opens on today. Changes save as you make them, offline too, and
  "Edit split" starts the wizard over.
- **Today's plan** now logs an exercise for today with one tap and shows a tick once it is logged.
- **AI consent** is asked before the first plan is built, in the website's words.
- **Proven:** 1082 app tests, then 241 deliberate breakages of the planner (every survivor
  killed by a new test or a change that has no observable effect). Tests found two real faults on the
  way: tapping Allow on the consent question asked it again instead of building the plan, and a
  ticked exercise was hidden inside a collapsed category. Not yet run on a phone.

## [0.24.0.0] - 2026-10-26

### Added

The native app can now scan food: photograph a meal for an estimate, or scan a barcode. Nothing in
the website or the current App Store app changes.

- **Scan a meal.** Take a photo or choose one; the AI estimates the dish's ingredients, calories
  and macros. You see the estimate, can rename it, change the amount (servings, grams or ounces)
  and pick a serving size where the food has several, then add it. It is logged as a dish, so each
  ingredient can be adjusted afterwards.
- **Scan a barcode** with the live camera. The product's figures come from Open Food Facts or
  FatSecret, with the credit their terms ask for. A product nobody knows offers to make the food
  yourself, with that barcode saved on it.
- **AI consent first.** The first photo asks "Allow AI features?" in the website's words, and
  nothing is sent until you say yes.
- **Proven:** 976 app tests, then 131 deliberate breakages of the scan code (every
  survivor was either killed by a new test or changes nothing observable). Not yet run on a phone;
  the camera itself needs Expo Go or a development build, and the new Thai strings need a native read.

## [0.23.0.0] - 2026-10-26

### Added

The native app's three main tabs now work: Home, Nutrition and Workouts, on the same data as the
account, online or offline. Nothing in the website or the current App Store app changes, and
neither deploy image includes the new code.

- **Nutrition.** Log food from the shared library of 744 foods or your own, with the amount in
  grams, ounces or millilitres; a dish scales every ingredient together. Calories and macros against
  your goals, a week strip, favourites, "recent" and "what you usually eat at this hour", quick add
  from typed macros, create your own food, edit goals.
- **Workouts.** Today's split plan, then log exercises set by set: weight and reps, each side
  separately where that makes sense, reps only for bodyweight movements. A tick appears when every
  set has its reps. Search 735 exercises, star favourites, make your own.
- **Home.** Your streak (current, longest, the last seven days), today's calories and macros, a
  weigh-in in kilograms or pounds.
- **Works without signal.** What you log shows at once and is sent when there is signal, in the
  order you did it. A workout you shorten while offline can no longer bring back its old sets.
- **Haptics** on logging a food, adding an exercise or set, a favourite, and finishing an exercise.
- **Proven:** 929 app tests, plus the website's own code run against every rule that was
  ported (all 744 foods, seeded random days), then 991 deliberate breakages (in two passes; each survivor was killed by a new test, fixed, or is a change with no effect: a type, a tuning constant, a style number, a counter).
  The Thai strings added are not yet read by a native speaker; nothing has run on a phone yet.

## [0.22.0.0] - 2026-10-26

### Added

People who signed up on the old website can now sign in to the new app with the password they
already have, and anyone can reset a forgotten one. Nothing in the website or the current App
Store app changes.

- **Your old password still works.** The first time you sign in, the server checks it against
  the old website's stored hash, moves it across, and from then on it is an ordinary password.
  The old hash is deleted the moment it is used, so an old leaked password can't be put back.
- **It can't be used to find out who has an account.** An unknown address, an account that was
  never on the old site and a wrong password all get the identical answer, take the same time,
  and count the same toward a limit (10 tries per address, 30 per phone, every 15 minutes).
- **Forgot password** emails a reset link that opens the app and asks for a new password
  before anything else; "resend confirmation email" appears when an address is unconfirmed. A
  password the new system won't accept (too short, or known to have leaked) is offered a reset
  instead of a dead end. Sign-up now asks for at least 8 characters, as the website did.
- **Proven:** 56 server tests and 50 app tests, then 88 deliberate
  breakages (all noticed except 2 that change nothing observable). A real throwaway account
  with a real old hash was moved across and then signed in through Supabase itself.

## [0.21.0.0] - 2026-10-26

### Added

The native app now exists: `mobile/`, a React Native (Expo) app that will replace the App Store
wrapper at launch. It signs in, shows the five tabs and works offline, but the tabs themselves are
placeholders until the next phases. Nothing in the website or the current App Store app changes,
and neither deploy image includes the new folder.

- **Sign in or sign up** with email or Apple, with the same "you agree to our Terms and Privacy
  Policy, including that photos, videos and messages go to Google Gemini" notice the website shows,
  word for word. Your session lives in the iPhone Keychain.
- **The five tabs** (Home, Workouts, Analyze, Nutrition, Coach) as the system's own tab bar, in
  English or Thai, in light or dark, on phone or iPad.
- **Works with no signal.** What you last saw stays on screen, and changes you make wait in a queue
  and are sent in order when you are back online. Signing out wipes all of it from the device.
- **Safe by construction:** the app refuses to start with a Supabase secret key (only the public
  one belongs in an app), and repository tests fail if a secret or a non-public setting gets in.
- **Proven:** 217 app tests, 12 repository tests and 116 deliberate breakages of the app's logic, each
  noticed except two that change nothing visible. The whole app compiles to an iOS bundle. It has
  **not yet run on a phone**; see the plan's "Phase 2 status" for what that needs.

## [0.20.1.0] - 2026-10-26

### Added

The native app's server now has its own container image, so it can be deployed as a
separate Render service. Nothing in the website or the current App Store app changes, and
the website's image is untouched.

- **`Dockerfile.api`**: installs the API's own dependencies, adds the video and barcode
  tools it needs, and runs with a worker timeout long enough to grade a clip inside the
  request (the default would cut it off after 30 seconds).
- **A step-by-step setup** in `MOBILE_APP_PLAN.md`: which options to pick in Render, the
  environment variables to copy over, the health URL to check, and the one thing that must
  be true of the proxy in front of it.
- **A test that guards the contract** without needing Docker: every library the API imports
  is installed by its requirements file, the command and timeout are right, and no secret is
  baked into the image. Ten deliberate breakages of the Dockerfile were each caught.

## [0.20.0.0] - 2026-10-25

### Added

The last slice of the native app's server: everything that reaches across people, plus
the waitlist and the owner's tools. As before, nothing in the website or the current App
Store app changes.

- **Friends, blocks and reports.** Add a friend by code (wrong guesses are limited and
  counted even when requests arrive together), block or report an account (reporting
  blocks too), report an AI reply. A block hides each person from the other everywhere:
  friends, challenges, both leaderboards.
- **Challenges and leaderboards.** Today's exercise, recording an attempt (the clip is
  counted by the AI and thrown away), the friends and global rep boards, HYROX results
  and their board, and the days the streak counts from server records.
- **You can only join challenges you can see.** The website let anyone post a score to
  any challenge number; here it has to be yours or a friend's. Two uploads at once can no
  longer both be graded.
- **The waitlist form posts here**, from the marketing site's two addresses only. Five
  tries an hour per visitor, counted exactly; a repeat address looks the same as a new one.
- **Owner endpoints** for the moderation queue (mark handled, replace an offensive name and
  close every report on that account), the waitlist (JSON, CSV, erase an address) and the
  signup list and per-account usage. Anyone else gets a plain "not found", including App
  Review's demo account. The CSV can no longer run a formula from a malicious address.
- **Hardened:** a HYROX time of NaN or over a day is refused, wrong-typed bodies are clean
  400s, and the per-person ceilings hold when requests race.
- **Proven:** 346 new tests, then 181 deliberate breakages of the new code,
  all noticed by a test except 4 that change nothing observable (a second check behind the first).

## [0.19.0.0] - 2026-10-25

### Added

The native app's server can now run the three AI chats, HYROX race analysis, split
generation, the coaching calculations, the weekly check-in, and everything to do with
food. As before, nothing in the website or the current App Store app changes.

- **The coach, analysis follow-up and workout chats**, sharing one 3-a-day allowance as
  before. A message over the limit is still a normal reply saying when to come back, so
  the chat widgets keep working.
- **HYROX race analysis** (8 per 5 hours), **split generation** (one a day; only the
  AI-suggested kind needs consent), and the **coaching targets and body-fat ranges**.
- **The weekly check-in is now metered** (5 a day). Past the limit, without consent, or if
  the AI fails, the check-in still finishes with the plain trend adjustment, so you only
  lose the AI refinement. Your own progress photos can go to the AI with it; nobody
  else's can.
- **Food:** the one-a-day photo scan, barcode scanning and lookup, online food search,
  and your own foods and exercises (500 of each, calories always worked out from the
  macros). A food you saved for a barcode still beats any outside database.
- **A call that fails no longer costs you a use.** The allowance is held before the AI
  call and handed back if it can't answer, for every one of these.
- **Hardened:** messages, histories and race data are length-limited before they reach an
  AI prompt (a malformed one is a clean 400 that costs nothing); every number is bounded
  (an `Infinity` macro or a 1e308 serving was accepted before); barcode and photo
  uploads are size-limited and food routes now need a sign-in (barcode lookups didn't);
  the 500-item ceilings hold even when requests race; printing the server's settings in
  a log or traceback no longer shows the service key or the database password.
- **Proven:** 381 new tests, then 151 deliberate breakages of the new code. Every
  one is noticed by a test except 11 that change nothing observable (a second check that
  the database's own rules also enforce, for example).

## [0.18.0.0] - 2026-10-25

### Added

The native app's server can now grade a set, keep the clip and the result, and show
your history. As before, nothing in the website or the current App Store app changes.

- **Upload a set and get graded.** Same upload rules as the website (a video up to
  300 MB, in any of the formats it accepts). The server trims and grades it with the
  existing AI pipeline, keeps the trimmed clip in private storage, saves the result,
  and hands back a short-lived link to replay it (seeking works).
- **AI features need your say-so first.** Turning them on is recorded with the time you
  first agreed; turning them off stops the next request before anything is read or
  sent. Only an explicit "yes" counts.
- **A failed analysis never costs you your one-a-day.** The allowance is held before the
  AI call and handed back if the video can't be graded or anything goes wrong, and
  several requests at once can no longer sneak past the limit. The owner and App
  Review's demo account can be exempted by configuration.
- **History keeps your newest 20.** Older ones go, with their clips and chat threads. If
  a clip can't be deleted its analysis stays so the next analysis tries again, rather
  than leaving a video nobody can see or remove.
- **Hardened against odd input:** exercise names are length- and character-checked
  before they reach the AI prompt, and stray unprintable characters in the AI's reply no
  longer lose a finished analysis.
- **Proven:** 221 new tests, then 61 deliberate breakages of the new code, each noticed
  by a test except four that change nothing observable. One real run through the actual
  video trimmer and Gemini confirmed an unscorable clip is refused with the AI's own
  reason, the allowance refunded and nothing left behind.

## [0.17.0.0] - 2026-10-25

### Added

The native app's server can now take, show and delete weekly progress photos. As
before, nothing in the website or the current App Store app changes.

- **Progress photos upload to private storage.** Same rules as the website: front or
  back, a real date no earlier than the day the account was made and no later than
  tomorrow, up to 12 MB, must genuinely be a JPEG, PNG or WebP, up to 500 per person.
  A file that merely claims to be a photo (text, a damaged image, a GIF, a script
  renamed `.jpg`) is turned away.
- **A refused upload leaves nothing behind.** Not a stored file without a record, and
  not a record without a file: every step undoes the one before it if something goes
  wrong, including when the storage service or the database fails midway.
- **Safer than the website in three ways.** The photo's real type is read from its
  contents, not its filename (so a phone that sends no filename works); the 500-photo
  limit can no longer be slipped past by uploading several at once; and deleting a
  photo removes the file first, so a failed delete never leaves a photo you can't see
  and can't remove.
- **Only you can see your photos.** You get a short-lived link to your own photo; nobody
  can get one for someone else's, and one person's full album never blocks another's.
- **Proven against the real project:** 65 tests, then 36 deliberate breakages of the new
  code, each noticed by a test except four that change nothing anyone could observe.

## [0.16.0.0] - 2026-10-25

### Added

The start of the native app's server, built **next to** the website rather than inside
it. Nothing in the website or the current App Store app changes, and nothing in
production can load it yet.

- **A new, separate API for the native app**, with its own sign-in check: it accepts
  only genuine, current sessions from this project, and turns away expired,
  forged, anonymous, wrong-project and service-level tokens (all tested one by one).
- **Creating an account now has one door.** A profile can only be created through the
  API, which applies the same display-name filter as the website (and now also rejects
  invisible or direction-flipping characters and names over 60 characters). Signing up
  directly against Supabase without going through it gives an account with nowhere to
  keep any data, so the filter cannot be bypassed.
- **Deleting your account actually deletes your photos and videos.** After the 30-day
  grace period the server removes every stored file first, checks none are left, and
  only then removes the account and all its data. If a file won't go, the account stays
  and the next sweep finishes the job. Asking to delete twice never extends the
  grace period, and restoring cancels it.
- **Proven against the real project:** 120 new tests, then every important line of the
  new code broken on purpose to make sure a test notices (72 of 74 were noticed; the
  other two change nothing observable).

## [0.15.0.0] - 2026-10-25

### Added

More groundwork for the native iPhone and iPad app: **a place for your photos and
form-check videos**. Nothing in the website or the current App Store app changes.

- **Two private storage areas** for progress photos and trimmed form-check clips,
  with the same size and file-type limits the website always enforced. Each person
  can open their own files and nothing else: not other people's, not signed out, not
  by guessing paths, and nobody can make a link to someone else's file. The app cannot
  upload, replace or delete files itself; that stays with the server, which checks
  them first.
- **Tested the hard way.** Real users trying to read, overwrite, delete, move and copy
  each other's files, with every protection loosened on purpose one at a time to prove
  the tests notice (all 22 were noticed).
- **The move-everything script now copies the photos and videos too.** It copies only
  the files that imported accounts actually point at (never a deleted account's),
  refuses names or links that could reach outside the folder, checks every copy against
  what Storage says it holds, and undoes the whole run if anything differs. On the
  development data it copied the two real photos byte for byte and ignored 357 stray test
  files beside them.
- **It won't quietly leave photos behind.** If accounts have photos and you give it
  neither the photo folders nor `--skip-files`, or a folder where none of the files
  turn up, it stops before changing anything.

## [0.14.0.0] - 2026-10-25

### Added

Groundwork for the native iPhone and iPad app. **Nothing in the website or the
current App Store app changes**: it is not wired to any of this yet.

- **A new home for your data, built and tested.** The Supabase database now has
  every table the app keeps (food, workouts, weigh-ins, HYROX races, chats, the
  coaching profile, settings and the rest), laid out as proper rows instead of
  one big blob per person.
- **Each person can only ever see their own rows.** Tested by signing in as two
  real users and trying to read, change, delete and forge each other's data in
  every table. Every guard was then loosened on purpose, one at a time, to prove
  the tests notice (25 of 25 did).
- **A move-everything script** that copies the live website's data across without
  losing or changing any of it. It counts every item, checks the new database
  against its own plan before it saves anything, and undoes the whole run if a
  single row differs. Run on the 28-account development database it agrees with a
  separate count taken straight from the raw data, and it can be re-run safely.
- **Safe by default.** The script refuses to run over accounts that have already
  signed in, never carries the data of deleted accounts across, and parks
  anything it can't store instead of failing the run.
- A written plan for the rest of the move (`MOBILE_APP_PLAN.md`), including what
  is built, what is proven, what still needs doing and what needs a decision.

### Changed

- The repo now ignores database exports and SQLite files by extension, so a
  production export saved inside the project can't be committed by accident.

## [0.13.0.3] - 2026-10-14

### Changed

- **repcheck-marketing.onrender.com is the full-size website again.** It
  showed the page squeezed into a fixed 1080×566 Instagram frame, centred in
  white. It now fills the window like repcheckofficials.onrender.com. The
  Instagram frame is still there for when it's needed: add `?canvas=1` to
  either address.

## [0.13.0.2] - 2026-10-14

### Fixed

The marketing site on phones, measured on the live site at seven phone sizes
before and after.

- **repcheck-marketing now works on a phone at all.** Swiping scrolled the
  page, but the scroll animation never noticed. The opening screen stayed on
  top of everything, and a phone visitor never saw a single feature. (A mouse
  wheel happened to work, which is why it looked fine on a laptop.) The
  features now play on touch, and so do Page Down, Home and End from the
  margin.
- **The phone mockup no longer covers the HYROX description.** While the
  race's Apple Watch was out, the phone stayed full size and the two
  together overflowed the column: up over the HYROX text (about 100px) and
  down off the bottom of the screen, taking the watch's "In design, not
  shipped" note with them. The phone is now sized to the space it actually
  has, minus the watch. It shrinks and grows smoothly as the watch comes and
  goes, and on screens too short for both the watch stands down.
- **Friends & Challenges gets a full-size phone.** It was sized as if the
  watch were still out, 24% smaller than every other feature.
- **The phone stays off "Scroll down".** It overlapped the cue on some
  screens, and a desktop-only short-screen rule was shrinking it on small
  phones (375×667 now 0.595, from 0.569).

## [0.13.0.1] - 2026-10-14

### Fixed

Scrolling on the marketing site, measured frame by frame in Chromium before
and after.

- **Friends & Challenges gets its own turn.** The feature panel unpinned at
  the exact scroll position where feature 06 starts, so Friends faded in
  while the whole panel was already sliding off the page, and its title had
  half faded out again by the time the stats arrived. The panel now stays
  pinned through the whole of feature 06, and then scrolls up into the stats
  with Friends still showing.
- **The handset no longer jumps when you leave HYROX.** The race demo's
  watch sits beside the handset. When it left, the handset jumped 104px
  sideways in a single frame (and changed width) right in the middle of the
  HYROX to Friends handover. It now slides across over half a second, at most
  about 6px a frame, and keeps its width while the watch is out.
- **Scrolling from the white margin is smooth.** On the canvas host the
  wheel and Page Down over the margin jumped 100px a step instead of
  scrolling smoothly. That showed from feature 05 onwards, where the page
  starts actually moving. They now ease the way the browser's own scrolling
  does, still cover the full distance on a fast scroll, and stop as soon as
  you scroll the page any other way.

## [0.13.0.0] - 2026-10-09

### Fixed

An audit of RepCheck against every section of the App Store Review
Guidelines (`appstoreguid.txt`). These are the places the app fell short,
and what changed for each.

- **5.1.2(i): explicit consent before anything reaches Google Gemini.**
  Photos, videos, chat messages, workout logs and body stats used to go to
  Gemini on the strength of one line under the sign-up button. Now, the
  first time any AI feature is used, a dialog names Google Gemini and lists
  what each feature sends, before anything leaves the device. "Not now"
  sends nothing. **Settings → AI features** turns it back off. Every AI
  route on the server also refuses an account without consent
  (`users.ai_consent_at`). The weekly check-in falls back to its non-AI
  calculation instead of refusing.
- **4.7.1: chatbot output is filtered and can be reported.** The coach,
  workout chat and Analyze chat pass explicit Gemini safety settings
  (`ai_safety.py`). Every AI reply has a **Report this reply** control,
  and reports land on `/admin/reports` for review.
- **1.4.1: estimates say what they are.** Form scores, rep counts,
  challenge reps and food-photo calories are now labelled as AI estimates
  where they're shown, with the see-a-doctor advice. Every chat reply is
  marked "AI-generated · not medical advice". "AI counts the calories" and
  "exact nutrition" copy is toned down.
- **1.4: safer calorie floors.** The unsupervised minimums are raised to
  1,500 kcal for men and 1,200 for women (were 1,400 / 1,000). A caution
  now appears when the weight-loss rate slider is set above the standard
  zone.
- **1.2: reports can be acted on.** Admins can reset a reported display
  name, which closes every open report against that account.
- **1.6: security.** The weekly check-in route called Gemini for anonymous
  callers; it now requires sign-in. The food scan put the AI's note and
  confidence into the page unescaped; both are now escaped.
- **5.1.1(i): the privacy policy matches the code.** It no longer names
  OpenAI, which the app never calls. It now lists every AI feature and
  what each one sends, including check-in photos, workout logs and body
  stats. It describes the consent flow, per-account usage counts, stored
  AI reports, and how long video clips are really kept.
- **2.1: no dead controls.** Removed the Friends page's "Scan QR" button,
  which never scanned, and "Suggest from contacts", which can't work on
  iOS and did nothing with contacts anywhere. Removed the YouTube
  search-list embed, which YouTube no longer serves.
- **5.2.1: HYROX trademark.** The HYROX page now says the app isn't
  affiliated with HYROX. The "official HYROX race" wording is gone.
- **5.2.2: data attribution.** Barcode and search results now credit
  their database ("Powered by fatsecret", Open Food Facts under ODbL).
  `/sources` has a data and content credits section.

## [0.12.11.0] - 2026-10-09

### Fixed

App Review rejected 0.12.10 (35) under **Guideline 1.4.1 - Safety -
Physical Harm** on 2026-10-06 (iPad Air 11-inch, M3): the AI coach gave
health and training recommendations without citations, and Apple asks that
citations be links that are easy for the user to find. Every AI answer now
shows its sources.

- **Every AI chat reply lists its sources, with links, directly under the
  bubble.** This covers the Coach page, the workout chat and the Analyze
  chat. The model picks 1-3 ids from a fixed catalog (`health_sources.py`)
  and ends its reply with a `SOURCES:` line. The server strips that line and
  sends back the matching title, publisher and link. The model never writes
  a URL, so it cannot cite a study that does not exist. Every PubMed id in
  the catalog was checked against NCBI when it was added. If the model
  leaves the line out or names an unknown id, a keyword match on the
  question and reply picks the sources instead.
- **New public `/sources` page** listing all 24 citations by topic, with a
  "not medical advice" section and a note on how calorie and macro targets
  are calculated. It needs no sign-in, so App Review can open it. Three
  places link to it: a Sources button in the coach's corner, a note on the
  coach's empty screen, and Settings → Legal.
- **Inside the iOS app, citation links open in the in-app browser** (the
  Browser plugin, via `RepCheckNative.openExternal`) instead of throwing the
  user out to Safari.
- The coach's message list now starts below its floating corner buttons,
  so the first bubble is no longer drawn underneath them.

This is a web-only change. The app loads production, so deploying is the
fix; no new build is needed.

## [0.12.10.0] - 2026-09-28

### Fixed

App Review's own screenshot of the 2.1(a) rejection (0.10.2 build 34, iPad
Air 11-inch, 2026-09-15) shows the "Camera unavailable — take a photo
instead" screen. That build rendered it only from the getUserMedia `catch`,
so WKWebView refused the in-app camera on their iPad. Its "Take photo" row
(the native camera) then did nothing. Both halves are now traced to proven
causes where one exists:

- **The native camera could never open in the app (binary; needs a new
  build).** Build 34's own App.ipa, pulled from Codemagic and read, lacks
  `NSPhotoLibraryAddUsageDescription`. The Camera plugin checks all three of
  its keys before showing any UI and rejects every call when one is missing,
  so "Take photo", "Upload photo" and check-in photos all silently failed in
  the app. `codemagic.yaml` now adds the key, and a new build step fails the
  build if the final Info.plist lacks any key the plugin requires. The list
  is read from the plugin's own source, so an upgrade can't reintroduce this.
- **Native photos could never reach the page, even with the key.**
  `native.js` fetched the plugin's `webPath` (`capacitor://localhost/...`),
  and the page's CSP `connect-src` refuses that fetch. Verified in a browser:
  "Refused to connect because it violates the document's Content Security
  Policy". It now asks for `resultType: "base64"` and decodes locally, so no
  fetch is needed.
- **Inside the app, "Take photo" goes to Apple's camera first.** The in-app
  getUserMedia viewfinder, which App Review's iPad refused for a reason that
  can't be recovered, is now the browser route and the app's fallback. A
  plugin that can't open (build 34 and earlier) falls through to the
  viewfinder, so the currently shipped build keeps working. A refused
  camera permission goes straight to a message pointing at Settings, with
  Upload photo.

Verified end to end in a browser with a faked Capacitor bridge running the
real `native.js`: new binary, straight to the note prompt; build 34, falls
back to the viewfinder and captures; permission refused, Settings message;
browser, unchanged.

### Added

- `tests/test_ios_camera_usage_strings.py`: pins all three keys in
  `codemagic.yaml`, and runs the build's verification step, extracted from
  the YAML, against build 34's key set (fails) and a full set (passes).
- `native.test.js`: base64 is requested and decoded byte-exact.
- `nutritionPhotoCamera.test.js`: native-first routing, build-34
  fall-through, a refused permission, and a native cancel.
- All new guards are mutation-checked.

## [0.12.9.0] - 2026-09-26

### Fixed

The last three silent failures from the iPad audit. Each was reproduced on an
emulated iPad and verified fixed.

- **A camera that never starts no longer leaves a tap that did nothing.**
  iOS answers a second concurrent camera request by hanging rather than
  rejecting, and nothing in the app put a limit on getUserMedia. Every camera
  now does two things:
  - It shows "Starting camera..." the moment it's tapped (with Cancel on the
    food photo and barcode sheets).
  - It gives up after 15 seconds and moves to its fallback: "Camera
    unavailable" with Take photo / Upload photo, the upload route on Analyze,
    or "Your camera isn't sending a picture" on Challenges.

  The 15-second limit is generous on purpose: the first request also waits
  behind iOS's own "Allow camera" alert. A camera that turns up late, or after
  Cancel, is stopped as soon as it arrives, so its indicator light can't stay
  on behind the fallback. This covers the food photo, the flip, the barcode
  scanner, Analyze a lift and the challenge recorder. The challenge Start
  button is also disabled while the camera starts, so a double-tap can't ask
  for two streams.
- **The barcode scanner stops when its feed freezes.** A frozen frame still
  has a size, so none of the three scan loops noticed: they decoded (or
  uploaded) the same frame forever behind a live-looking viewfinder. Each
  loop now watches the feed and moves to "Camera unavailable" once it goes
  4s without a new frame, or the track ends or stays muted.
  `requestVideoFrameCallback` is trusted only after it has fired on the
  element, so a WebKit that never calls it for camera streams can't make
  every scan look stalled.
- **"Copy code" on Friends always does something.** With the async clipboard
  missing or refused, it now selects the code and falls back to
  `execCommand("copy")`. If that also fails, it says "Code selected — tap it
  to copy". Before, the button stayed silent.
- **The Analyze camera hint stops snapping back.** The hint element kept its
  markup `data-i18n` key, so the i18n pass overwrote "Starting camera..." or a
  warning with the idle recording hint. `setHint` now updates the key along
  with the text.

### Added

- Tests: a pending getUserMedia shows the starting screen, gives up only at
  the 15s limit (not at 10s), releases a late stream, and lets Cancel win the
  race. The recorder's `open()` is covered the same way.
- `tests/test_camera_previews_are_started.py` requires every barcode loop to
  end on a frozen feed.
- All new guards are mutation-checked.

## [0.12.8.0] - 2026-09-26

### Fixed

The same failure App Review hit on the food camera (a camera that hands back
a live stream but never delivers a picture) existed in every other camera in
the app. Each case below was reproduced on an emulated iPad before being
fixed, except where noted.

- **Analyze a lift no longer records an empty clip behind a black preview.**
  The shutter was armed as soon as getUserMedia resolved. On a frameless
  stream it recorded, stopped, and put a zero-byte clip on the review screen
  (the browser could not even load it), and tapping Analyze would have sent
  that empty clip to the server. The viewfinder now waits up to 4s for a
  real frame before arming the shutter, and falls back to "Upload a video"
  otherwise. A take that still comes back empty says so and reopens the
  camera.
- **A failed lens flip no longer locks the Analyze shutter.** If neither lens
  reopened, `start()` returned a rejected promise that slipped past its
  try/catch. The shutter jumped to "Recording" with the timer stuck at 0:00,
  every later tap threw "camera is not open" and leaked another timer, and
  the button stayed dead until reload. `start()` now throws, and a flip that
  leaves no picture ends the camera and offers the upload route.
- **The challenge recorder won't count down over a dead camera.** It now
  waits for a frame first and says "Your camera isn't sending a picture"
  instead of recording nothing. A MediaRecorder that throws, or a take with
  no data, now reports the failure; before, the modal was left with neither
  a Start nor a Stop button.
- **"Record an attempt" says when it fails.** A login redirect, server error
  or dropped connection used to throw inside the click handler and do
  nothing. It now shows "Couldn't process that video." (Found by reading the
  code, not reproduced.)
- **Native picker failures are reported in two more places.** The check-in
  photo slots and the quick-choice "Upload photo" row now say so when the iOS
  camera or photo library fails (permission refused, plugin missing), using
  v0.12.7.0's `onFail`. (Found by reading the code, not reproduced.)

### Added

- `videoRecorder.test.js`: `start()` throws without a camera, an empty take
  rejects, and an empty take that was cancelled still resolves null. The fake
  MediaRecorder now flushes a chunk on stop the way a real one does, and has
  an `emptyRecording` mode.
- `tests/test_camera_previews_are_started.py` now also requires the analyze
  and challenge cameras to wait for a frame through their helper, and fails
  if any camera file awaits `play()` again (mutation-checked).

## [0.12.7.0] - 2026-09-25

### Fixed

- **"Scan a meal" on iPad: a camera that never delivers a frame can no longer
  leave a dead shutter on screen.** App Review rejected 0.10.2 (34) on an
  iPad Air 11-inch (iPadOS 26.6.2): *Home -> + -> Scan a meal -> Take photo ->
  Take photo, "the take a photo button does not respond"*. Reproduced by
  following those exact steps on an emulated iPad Air with a camera track
  that is live but never delivers a frame (what WebKit hands back when its
  capture session is interrupted): on the code Apple reviewed, the shutter
  receives the tap and nothing happens -- no photo, no message.
  v0.12.4.0 fixed the silent return but kept `await video.play()` before its
  4-second ceiling, and on a frameless track `play()` never settles, so the
  ceiling never started and the dead viewfinder stayed up for good.
  `waitForCameraFrame()` now calls `play()` without awaiting it and times the
  frame wait from the start; the barcode scanner shares it (it had the same
  hang). After 4s with no frame the sheet moves to "Camera unavailable".
- **The camera-unavailable screen always gives you a way in.** It now offers
  *Upload photo* next to *Take photo*, and when the native camera or library
  genuinely fails inside the iOS app -- camera permission refused, no camera,
  plugin missing -- it says so (with a pointer to Settings for a refused
  permission) instead of silently doing nothing. `RepCheckNative.openCamera`
  / `openLibrary` take an optional `onFail(reason)` for this; cancels and
  browsers never call it.
- A shutter tap whose frame could not be encoded (`canvas.toBlob` -> `null`)
  now lands on the same fallback screen instead of returning quietly.

### Added

- Harness support for a `play()` that never settles, plus tests for the hang,
  the `toBlob` failure, the fallback screen's error line and upload row, and
  `onFail` in `native.test.js`. `tests/test_camera_previews_are_started.py`
  pins that no nutrition camera preview awaits `play()` again.

## [0.12.6.0] - 2026-09-16

### Fixed

- **The challenge recorder starts its preview instead of hoping it starts.**
  It was the last camera in the app still trusting the `autoplay` attribute on
  its own, and it asked at the worst possible moment: the stream was attached
  while `#ch-preview-wrap` was still `display: none`, and the wrap was unhidden
  on the next line. WebKit decides autoplay from what is rendered at attach
  time, and a muted `playsinline` video is *allowed* to autoplay, not
  guaranteed to. Now the wrap is shown first, the stream attached second, and
  `play()` called explicitly -- the same order `templates/index.html`'s
  viewfinder and the food-photo viewfinder (v0.12.4.0) already use. Recording
  reads the stream rather than the element, so the symptom was a black preview
  through the whole 10-second countdown, not a lost clip.

- **Toasts and the tour's mini bar cap against the app, not the screen.**
  Above 721px `<body>` is a fixed-size box carrying a `transform`, so a
  `position: fixed` element's containing block is that box while `vw` is still
  the whole display. Measured on an 1180px iPad in landscape: the nutrition,
  coaching and HYROX save-error toasts capped at 1062px and the tour mini bar
  at 1156px, against a 720px column -- the inset each one exists to keep had
  simply stopped applying, so long copy could run the full width of the column.
  All four now use `%`, which equals `vw` below 721px, so the phone is
  untouched.

### Added

- `tests/test_camera_previews_are_started.py` pins the rule across every camera
  in the app: a stream attached to a `<video>` must be followed by a `play()`.
  It covers all five attachment sites and would have caught the food-photo
  shutter bug fixed in v0.12.4.0.
- `tests/test_overlays_measure_the_app_box.py` fails on any `vw` in the app's
  own styles, allowing only the app box's own `min(100vw, 720px)` width.

## [0.12.5.0] - 2026-09-16

### Fixed

- **The phone mockups on the pre-launch site no longer take your keyboard
  focus.** Feature 02's food log walks through logging a meal on a loop, and
  it used to do that by really focusing the mock search field and the "+ Log
  a food" button. So a reader who was doing nothing but scrolling watched the
  focus jump into a picture of the app, twice every nine seconds, with no way
  to predict it and nothing they had done to cause it. On the 1080x566
  canvas the cost was larger than it sounds: Page Down, Page Up, Home and End
  are forwarded to the canvas by a handler that stands down as soon as
  anything is focused, so for two seconds out of every nine the page keys
  quietly stopped working.

  The walkthrough now draws the focused field with a class instead of
  focusing it, and every control inside the handset and the watch beside it
  is out of the tab order. Tabbing the page goes nav, waitlist, footer --
  not twenty mock app controls in between. Clicking into the food log still
  works exactly as before, still shows a real focus ring, and closing a sheet
  no longer leaves focus stranded on a panel that has just been hidden.

- **And the demo no longer acts on you when you use it.** Two related faults
  the same review turned up. One click on a mock button used to leave it
  holding focus for good -- nothing re-renders that markup -- which on the
  canvas meant the page keys stopped working until you clicked the white
  margin; a button in the handset now hands focus straight back, while the
  two text fields keep it, because someone typing owns the keys. And the
  walkthrough only stood down for a click on one of its own controls, so
  clicking *into* the search or amount field and typing left it running: nine
  seconds later it took the caret out of the field mid-keystroke, logged
  whatever amount was typed as if Add had been pressed, and wiped it on the
  next cycle. Focus landing anywhere in that screen now ends the loop for
  good, which also stops it reopening a sheet that was dismissed with Escape.

- **"Add to log" with no amount now says so out loud.** The shake and the
  highlighted field are both pictures; moving focus used to be the one part
  a screen reader could follow, so the message goes to the status line
  instead.

## [0.12.4.0] - 2026-09-16

### Fixed

- **"Analyze a food photo" no longer opens a viewfinder whose shutter does
  nothing.** The camera screen attached the live stream to its `<video>` and
  stopped there: it never called `play()`, and it never waited for the frame
  size. A MediaStream goes live *before* the element reports a `videoWidth` --
  that number only arrives with `loadedmetadata` -- and the shutter handler
  opens with `if (!video.videoWidth) return`. Every tap inside that window was
  swallowed silently: no photo, no error, no sign the button was wired to
  anything. A stream that never produced a frame at all left that dead screen
  permanently.

  `startLiveBarcodeScan()`, three hundred lines further down the same file,
  already had all of this. The photo path now shares it: an explicit `play()`,
  a `loadedmetadata` wait with the same 4s ceiling, and the real "Camera
  unavailable" screen (camera released) when no frame lands, instead of a
  viewfinder that cannot take a picture. Flipping to the other lens goes
  through the same start, and the shutter now reports a feed that died rather
  than returning quietly.

- **The scan sheet is sized to the app box rather than the browser window.**
  Every skin above 721px makes `<body>` a fixed-size box carrying a
  `transform`, which makes it the containing block for the sheet -- but `vh`
  still means the window. In the desk skin (a desktop with a mouse) the box is
  a 390x844 phone, so `.af-modal.is-camera`'s `height: 92vh` measured against
  the desktop instead: at 1440x1080 the camera sheet came out 994px inside an
  844px box with `overflow: hidden`, clipping the drag handle and the entire
  header -- title and close button -- off the top. The three rules that size
  the sheet now derive from `--app-h`, the token that exists for this, which
  keeps the dynamic-viewport behaviour on a phone for free.

## [0.12.3.0] - 2026-09-13

### Fixed

- **The pose overlay now uses MediaPipe's full landmarker instead of lite.**
  The previous fix (v0.12.2.0) put the skeleton on the right clock; this
  fixes the other half of "doesn't align" -- the model itself losing track
  of limbs. Measured on a real clip from this repo, lite's worst-case
  off-track jitter was 118.5px on a 284px-wide frame (a limb snapping nearly
  half the frame away from the body); full's was 25.9px, with the average
  case improving too (5.0px -> 3.5px). Costs ~3.6MB on first load (cached
  after) and detects at roughly half the rate, which the v0.12.2.0 renderer
  already absorbs by placing the body between detections rather than only on
  arrival.

  The gap tolerance that decides when to give up on a pair of samples moved
  from 0.5s to 0.9s to match full's slower, less regular detection cadence --
  at 0.5s an ordinary slow stretch was tripping it and falling back to the
  old, worse placement on 42% of frames.

## [0.12.2.0] - 2026-09-13

### Fixed

- **The skeleton on the "Analyzing" screen now moves with the clip.** Two
  reports about that overlay -- it did not line up with the video, and it was
  not smooth -- turned out to be one cause: it was drawn on the wrong clock.

  Detection and rendering were the same rate, and it was the slow one. A
  result only landed every so often, and the canvas was repainted only when
  one did, so the skeleton held still for several video frames and then
  jumped. Worse, a result describes the frame it was computed from, not the
  one on screen by the time it arrives, so each repaint showed the body where
  it had been a moment earlier.

  The two rates are now separate. Every result is filed against the video
  time of the frame it came from, and the overlay is redrawn every animation
  frame, placing the body at `previewVideo.currentTime` from the last two
  results. Measured on a real clip from this repo (`shoulder press.mp4`, both
  wrists, 3299 rendered frames): the skeleton is repositioned **66 times a
  second instead of about 5**, and its average distance from the body dropped
  **17.6px to 14.8px** on a 284px-wide frame.

  Detection also ran into a 120ms floor that no longer made sense once it
  moved off the main thread in v0.8.4.0 -- the worker finished in 25-80ms and
  then waited longer than it had worked. The floor is now 33ms, which on a
  phone never binds; the main-thread fallback keeps the old 120ms, because
  there every detection is time the video spends not being decoded.

  How far the renderer may carry motion past the newest result was chosen
  from that measurement rather than guessed, and the table is in the code.
  Smoothing the landmarks was tried and rejected the same way: at 86-143ms
  between detections a causal filter cost more lag than the jitter it
  removed. The error that remains is the model's own noise floor (7.5px of
  jitter against 10.7px of real movement between detections), which is a
  case for a heavier model, not a better renderer.

## [0.12.1.0] - 2026-09-13

### Added

- **An upload button on the analyze screen**, so you can grade a lift you
  already filmed instead of only one recorded in the app. The page could
  always accept a video file, but the control for it was hidden inside the
  "we can't reach your camera" fallback -- so if your camera worked, you had
  no way to use a clip from your camera roll. The button sits opposite the
  flip-camera button, in the space that was already empty.

  **This is temporary, at the owner's request** -- it is meant for one clip
  and is expected to be reverted. It is deliberately a single commit so
  `git revert` takes it out cleanly.

### Fixed

- Picking a video while the camera preview was live left the camera running
  behind the review screen, with the indicator light on. Every route to the
  review screen now releases it.

## [0.12.0.0] - 2026-09-13

### Added

- **The marketing site's nutrition-log demo is now something you can actually
  use, not just watch.** Feature 02 used to be a screen recording; it now
  searches a real food table, lets you pick a food, set an amount in
  servings, grams or ounces, and add it to a day -- the calorie ring, the
  three macro bars and the entry list all move the way the app's own does,
  and entries can be removed again. Every number quoted is lifted from the
  app's own food library, and a compliance test keeps it that way.

### Fixed

- The marketing feature switcher no longer swaps the phone's screen out from
  under you on a stray hover while a sheet is open in the new food-log demo
  -- a click still switches, since that one is deliberate.
- Closing a sheet in the food log now hands keyboard focus back to the
  button that opened it, instead of leaving it stranded on a field that just
  went `visibility: hidden`.
- Tapping "Add to log" with a blank or zero amount now nudges the amount
  card and refocuses it, instead of silently doing nothing.
- An absurdly large typed amount is capped instead of producing a
  multi-billion-calorie number while the ring and macro bars stay correctly
  clamped at a full circle -- the figures on screen can no longer disagree
  with the picture.
- Two hardcoded `#d1453b` reds on the marketing site's dark race-simulator
  mockup now use the same `--red` token the rest of the palette does.
- Fixed a pre-existing failure in `tests/test_split_ai_suggest.py`: the
  test file's shared account had no reset for its daily AI-plan rate limit,
  so repeated suite runs within the same day eventually exhausted it and
  every test in the file -- including ones asserting a 400 for bad input --
  got a 429 instead.

### Removed

- The unused `foodlog-demo.{mp4,webm}` video and its poster image, now that
  the feature they illustrated is interactive instead.

## [0.11.2.0] - 2026-09-13

### Fixed

- **The app was downloading a megabyte of logo on every first visit.** The
  browser tab icon was a 1254x1254 image weighing 700KB, displayed at 16
  pixels across. The RepCheck wordmark on the login, sign-up and onboarding
  screens was 1774x887 and 376KB, displayed at 88x44. Together that was
  1,076KB of images delivering about 230 pixels of anything you could
  actually see. Both are now sized for where they appear -- 35KB for the
  pair, a 97% reduction -- and look identical, including on a high-density
  phone screen and in dark mode.
- The full-resolution originals are kept, outside the folder the browser
  downloads from, so the App Store icon can still be regenerated from them.

## [0.11.1.0] - 2026-09-13

### Fixed

- **The bottom nav no longer stretches across the screen in Split View.** On a
  tablet sharing the screen with another app, RepCheck's five destinations
  were spread across the full width of the window rather than sitting in the
  compact pill they do everywhere else: at a 720px-wide window the bar was
  696px, which is a long way for a thumb to travel. It was already capped on a
  full-screen tablet, but the cap only applied from 721px up, so the entire
  range a split screen actually uses was missed. Dragging the divider across
  that line also jumped the bar 276px in one frame. The bar is now the same
  centred pill at every width above a phone.
- Phones are deliberately unchanged in portrait. A phone held sideways is
  wider than the cutoff and does now get the centred bar, which is the right
  outcome for the same reason it is on a tablet.

## [0.11.0.0] - 2026-09-12

A legal, privacy and accessibility pass over both the app and the pre-launch
site at repcheck.app, so that neither one is making a claim it cannot stand
behind. Written to Thailand's PDPA as the primary law, and granting the
equivalent GDPR / UK GDPR rights, because the App Store distributes worldwide.

### Added

- A **Cookie Policy** at `/cookies`. It lists every cookie the app sets and
  what it is for, explains what is kept in your browser and why, and sets out
  the reasoning for there being no cookie banner: RepCheck has no advertising
  and no third-party analytics, so there is nothing that requires consent.
  Every figure on it — the cookie lifetimes, the SameSite and Secure and
  HttpOnly flags — is rendered from the configuration that actually sets the
  cookie, so the page cannot drift from the app.
- A **Refund Policy** at `/refunds`, which says plainly that RepCheck is free,
  that there is nothing to buy and nothing to refund, and what will happen if
  a paid plan is added later (Apple handles App Store refunds; we cannot).
- **Who we are** on the Privacy Policy and Terms: the operator named, the
  country, and one address to reach them. A policy with no identifiable
  controller is itself a defect under both the PDPA and the GDPR.
- The Privacy Policy now states **why** we are allowed to process each kind of
  data, that health and body data rests on your explicit consent, how long
  each kind is kept, that the AI providers and our host are in the United
  States, the full list of companies your data reaches, your rights, and your
  right to complain to the PDPC or your own regulator without going through us.
- **Cookie Policy** and **Refund Policy** links in Settings → Legal, in both
  English and Thai.
- The pre-launch site at repcheck.app has its own **privacy notice, cookie
  policy and website terms**, scoped to that site and the waitlist, plus the
  operator's identity and those links in the footer of every page. It had no
  legal pages at all and collected an email address.
- A consent notice beside the waitlist field saying what the address is used
  for and linking the privacy notice, because the notice has to be where the
  data is collected, not only in a footer.

### Changed

- **Inter and Noto Sans Thai are now served from RepCheck's own servers**
  rather than from Google's font CDN, on every page of the app and on the
  marketing site. Loading them from Google meant every visitor's IP address
  was sent to Google before they had agreed to anything — including on the
  sign-up screen, which is where we ask for consent. A German court has held
  that this alone breaches the GDPR. The Content-Security-Policy no longer
  allowlists Google's font hosts either, so it cannot quietly come back.
- The marketing site now makes **no third-party requests at all** when it
  loads, which is why it needs no cookie banner.
- Clearer labels on the pre-launch site: the hero button said "Download with
  Apple" and led nowhere, for an app that is not on the App Store yet. It now
  says what is true. The nav said "Download" for a link to a waitlist.

### Fixed

- **A cache header could be applied to the wrong file.** The rule that keeps
  the new font files cached matched the requested path rather than the file
  actually served, so `/static/fonts/%2e%2e/i18n.js` returned the app's
  JavaScript with a one-year, never-revalidated cache header. One such URL
  stored by any shared proxy would have pinned stale app code for a year.
- **The Terms and Privacy links you agree to at sign-up were too faint to
  read on the dark theme** — 3.39:1 against the card, below the accessibility
  minimum, on the one piece of text you are being asked to agree to. Now
  6.20:1.
- **Keyboard focus was invisible in three places.** The waitlist email field
  on the marketing site had its focus ring removed with nothing in its place;
  the analyze chat box had none at all; and the sign-up fields showed only a
  faint border change. All three now show a visible ring when you tab to them.
- The success and error messages under the waitlist form failed the contrast
  minimum on white (3.01:1 for the success message). Both now pass, and the
  form announces its result to screen readers, which it previously did not.
- The feature switcher on the marketing site changed the phone's contents with
  no indication to a screen reader of which of the six was showing.
- `HttpOnly` on the session cookie is now set explicitly rather than left to a
  framework default, because the Cookie Policy publishes it as a promise.
- **Figures on the pre-launch site now match the app.** It advertised 527
  exercises; the library holds 735, and had for months. The waitlist also
  claimed "limited early-access slots" when nothing limits it, and the phone
  mockup showed invented race times and calorie totals with nothing saying so.
- The app's own third-party requests are now disclosed: the pose-detection
  code and model downloaded from jsDelivr and Google's storage when you start
  an analysis, and one illustration loaded from Unsplash.

## [0.10.9.0] - 2026-09-12

### Added

- You can now report or block someone from your friends list, using the same
  menu the leaderboards have. Before this the only way in was a leaderboard
  row, so if someone added themselves with your friend code and never posted
  a score, there was no way to block them anywhere in the app.
- A **Contact us** link in Settings, under Legal. The support page has always
  been there; nothing in the app pointed at it.
- The sign-up and log-in screens now say, before you create an account, that
  photos, videos and messages you send are processed by third-party AI
  providers, and link the Terms and Privacy Policy.

### Fixed

- A display name coming from Google or Apple skipped the word filter that
  names typed into RepCheck go through, so an offensive one could reach the
  global leaderboard. Both now use the same filter.
- A Google account with a blank name broke the friends list of everyone who
  had added it: the list rendered no rows at all, including the button you
  would have used to block them.
- Long names no longer push the report button off the edge of the row. This
  showed up in Thai, which is written without spaces between words.
- The report/block button is now a full-size tap target on all three screens
  that have one.
- The support page said to use a "Forgot password" link. There isn't one. It
  now describes what actually works: signing in with Google or Apple on the
  same email opens your existing account, and it says when that will not
  work rather than leaving you in an empty account wondering.

## [0.10.8.0] - 2026-09-10

### Fixed

- Dates that do not exist, like 31 February, could be saved against a food,
  weight or workout entry and would then show up as a broken point on your
  charts. Logging a day ahead still works.

## [0.10.7.0] - 2026-09-10

### Fixed

- HYROX times saved before the last release's check could still sit at the
  top of the leaderboard. They no longer appear. Nothing was deleted, and
  if one of your own races was affected, your other times still rank
  normally.

## [0.10.6.0] - 2026-09-10

### Fixed

- A made-up HYROX time could top the leaderboard everyone sees. The app
  already knew what an impossible time looks like and refused to save one
  locally, but the server accepted anything over 20 minutes, so a doctored
  request went straight to first place ahead of a real 57:30 finish. The
  server now applies the same limits the app does, per gender and format.

## [0.10.5.0] - 2026-09-10

### Security

- Friend codes could be guessed in bulk. There was no limit on how many
  wrong codes one account could try, and adding a friend happens in both
  directions without the other person agreeing, so someone working through
  codes could have put themselves in strangers' friends lists. Wrong codes
  are now limited to 30 an hour per account; a correct code is unaffected.

## [0.10.4.0] - 2026-09-10

### Security

- Progress photo upload only checked the file's name, not what was in it.
  A 100 MB file that was not an image at all, just named ".jpg", was
  accepted and saved. Uploads are now capped at 12 MB and have to actually
  be a readable JPEG, PNG or WebP.

## [0.10.3.0] - 2026-09-10

### Security

- The limits on wrong-password attempts and on new accounts, added
  yesterday, were not actually working once the app was live. They counted
  attempts per internet address, but took that address from a value the
  caller sends, so anyone could change it on each try and get a fresh
  allowance. Measured: 20 accounts created and 25 password guesses made
  with the limits fully in place. The address now comes from the hosting
  layer instead, which a caller cannot set.
- Nothing capped how much one account could store. A single sync request
  was able to save 50 MB, and there are around twenty such keys, so one
  account could have parked roughly a gigabyte. Saved items like custom
  foods had no limit either. Both are now bounded, well above anything
  normal use reaches.

## [0.10.2.0] - 2026-09-09

### Added

- RepCheck now runs properly on an iPad. It used to install there only as a
  magnified iPhone app: the App Store build was iPhone-only, so iPadOS drew
  the phone-sized screen and scaled the picture up to fit, which is why
  everything looked blurry and oversized. The app now ships for iPad as
  well, and lays itself out for the screen it is on.
- On a tablet the app fills the height of the screen in a comfortable
  reading column, instead of the little phone-on-a-desk mockup a wide
  browser window gets. That mockup was only ever meant for a desktop with
  a mouse, and it now stays there.

### Fixed

- Onboarding could not be scrolled on a tablet. On the longer questions the
  page simply ended, with the Next button below the edge and no way to
  reach it. Signing up on an iPad now works all the way through.
- The Log in and Sign up cards sat off to one side on a tablet, and the
  keyboard covered the password field and the Log in button in landscape
  with no way to move them. Both are fixed.
- The coach's message box was hidden behind the tab bar. On a desktop it
  was worse than hidden -- it rendered outside the phone frame entirely, so
  there was no way to type at all.
- The "more questions below" hint in onboarding, and its tap-to-scroll
  button, did nothing on a tablet.
- The first-run tour's step counter sat behind the tab bar on anything
  wider than a phone.
- On the analyze screen, dragging up and down could grab the coach panel
  instead of scrolling the page.
- On a tablet, the dimming behind the welcome tour and behind any pop-up
  panel stopped partway across the screen, leaving a bright strip down both
  sides. It now covers the whole screen.

## [0.10.1.0] - 2026-09-09

### Security

- Two features that call the AI service could be used by anyone on the
  internet, without an account. Building a workout split had no limit at
  all, and the HYROX race analysis only counted attempts against your
  browser session, which resets if you clear it. Both now require you to be
  signed in, and both count against a daily allowance per account like the
  other AI features already did.
- Signing in had no limit on wrong-password attempts, so someone could
  guess at an account's password as fast as they could send requests. After
  10 failed attempts, sign-in from that place pauses for 15 minutes. Getting
  your password right clears the count, so ordinary typos never build up.
  Account creation is capped per location per hour for the same reason.
- A few smaller endpoints (food search, the calorie calculator, the
  navigation diagnostic) answered anyone who asked, even signed out. They
  gave nothing away, but they each cost the server something, and every one
  of them is only used from a page you have to be signed in to see.
- The app now sends the standard browser security headers. The one doing
  the most work stops the app being loaded inside someone else's page,
  which is how a signed-in person can be tricked into clicking something
  like Delete account without realising.

## [0.9.0.1] - 2026-09-04

### Fixed

- Challenges is back in the "+" menu. The daily challenge, the attempt
  recorder and the reps leaderboard have all still been there, but nothing
  in the app has linked to them since the tile was removed, so the only way
  in was to type the address by hand.

## [0.9.0.0] - 2026-09-04

### Added

- You can now report or block anyone whose name you see on a leaderboard.
  Tap the "..." on their row: reporting sends it to us with a reason and
  blocks them at the same time, so you stop seeing the name straight away
  rather than after a second step. We review reports within 24 hours.
- A blocked account disappears completely, both ways round. Not just from
  the leaderboard you were looking at, but from the other one, from your
  friends list, from challenges and their notes, and they cannot add you
  back with your friend code. They stop seeing you too.
- Settings has a Blocked accounts list, so a block is something you can look
  at later and undo.

## [0.8.4.0] - 2026-09-04

### Fixed

- The "ask" bar you pull down on an analysis was slowing the scroll of the
  whole result page. The pull only ever works from the very top, but the
  listener that makes it work was answering every swipe anywhere on the
  page -- on the longest-scrolling screen in the app. It now steps aside as
  soon as you have scrolled past the top, and comes back when you return.
- Recording a challenge attempt and then leaving that screen left the camera
  running. Nothing on screen said so, the indicator light stayed on, and
  every camera in the rest of the app -- form analysis, food photos, the
  barcode scanner -- silently refused to open from then on, until the app
  was force-quit. Leaving the screen now puts the camera down, along with
  the countdown and the recording it belonged to.

## [0.8.3.0] - 2026-09-04

### Fixed

- Scrolling on a phone was never as smooth as it should have been, on every
  screen, and the reason had nothing to do with the screen you were on. Every
  bottom sheet in the app -- the "+" quick actions, log weight, log food, the
  exercise picker -- keeps its overlay in the page between uses, invisible but
  full-screen, and each one was listening for the finger movement that drags a
  sheet closed. That kind of listener has to be answered before the phone is
  allowed to scroll anything, so three of them on most screens (six on
  Nutrition) sat in front of every swipe you made. They are now attached only
  while the sheet they belong to is actually open.
- Two more costs on the same path went with it. The code that measures the
  visible screen area, so a sheet can size itself around the keyboard, was
  recalculating and rewriting page-wide styling on every scroll event of every
  screen -- it now runs only while a sheet is up. And those invisible overlays,
  each a full-screen box, were still being laid out on every screen; they are
  taken out of the layout entirely until opened.
- Closing a sheet sometimes cut its animation short, so it blinked out of
  existence instead of sliding away. The close was being triggered by small
  animations finishing inside the sheet -- a button losing its highlight, a
  search box losing focus -- rather than by the sheet's own. Most visible on
  the food search and exercise picker, which put the cursor in their search box
  as they open.
- Opening a sheet twice in quick succession could leave the page unable to
  scroll at all, with no sheet in sight and nothing to do but reload. Reachable
  by a fast double-tap on any sheet button, and reached in ordinary use by the
  barcode photo flow, which reopens the sheet it is already inside.
- Leaving a screen while one of its sheets was still opening left the next
  screen frozen: it could not scroll, and it was still holding the position of
  the screen you left.

## [0.8.2.0] - 2026-09-04

### Fixed

- Moving between screens still reloaded the whole page, and still stalled
  for a moment when it did. Two separate causes, both measured rather than
  guessed. The in-place swap only ever watched the five bottom-tab links,
  so every other way into a screen -- the "+" sheet's Coach, Friends,
  Settings, "Scan a meal" and "Analyze a lift" tiles, the home cards, the
  analyze result's back arrow, the weight and logging history links --
  loaded a document, blanking the screen. (The server log confirmed it:
  swapping has reported itself running on every page load since the
  reporting shipped and has never once reported falling back, so the
  reloads left could only be links it was not watching.) Every same-origin
  page link now swaps; anything else -- another site, a download, a new
  tab, or a path that does not render the app shell -- still navigates,
  and so does everything while the first-run tour is walking you around.
  Second, each swap parsed the incoming page three times over: 258ms of
  frozen screen for Nutrition, which is 360 KB of HTML. It is parsed once
  now and the nodes are moved across -- 90ms for the same page, and a
  phone is several times slower than the machine that was measured on.

## [0.8.1.1] - 2026-09-04

### Fixed

- The Log food sheet could follow you off the Nutrition page. Opening it
  and then tapping another tab left the whole sheet -- title, close
  button, the food's name, the macro donut, the calories -- sitting at the
  bottom of every screen after it, unstyled and fully readable. A sheet is
  moved out to the page body when it opens, so it escapes the stacking
  context it would otherwise be trapped in; that also took it out of the
  part of the page a tab switch replaces, and the sheet's own styling went
  with the switch while the sheet itself stayed. Sheets now leave with the
  page they belong to.
- Leaving a page with a sheet still open no longer freezes the next
  screen. Opening a sheet pins the page behind it so it cannot scroll, and
  only closing the sheet unpinned it -- a back-swipe out of the page did
  not, so the screen you arrived on would not scroll, with nothing on it to
  explain why.
## [0.8.1.0] - 2026-09-04

### Changed

- The "Log food" confirmation screen listed a dish's ingredients as dead
  text ("Glass Noodles 180g"), so re-logging a meal meant logging the old
  amounts first and correcting them in the timeline afterwards -- a second
  helping is rarely the same plate. Each ingredient is now the same
  editable card the timeline's ingredients panel uses: emoji or photo,
  name, its own amount field and unit picker, and a remove button. The
  ring, the per-ingredient macros and the "Ng total" line follow every
  edit, and the "Log again" button writes exactly what is on screen. The
  meal it was opened from is untouched -- the screen edits a copy.

## [0.8.0.0] - 2026-09-02

### Fixed

- Recording a set and watching it being analyzed both stuttered. The
  viewfinder now asks the camera for 720p at 30fps instead of accepting
  whatever mode the phone preferred (some hand back 1080p or 60fps), and
  the recorder writes at a fixed 1.5 Mbps, so the encoder and the live
  preview stop competing for the same phone while you lift. The clip is
  also a fraction of the size, which is most of what the "Analyzing" wait
  actually is.
- While a set is being graded, the skeleton overlay is now computed off the
  main thread, so the video underneath plays at full frame rate instead of
  hitching every time a pose is detected. The clip you just filmed no longer
  keeps decoding invisibly behind the analysis, the results, or an error, and
  the sweeping scan line animates on the compositor rather than re-laying-out
  the page 60 times a second. Under "reduce motion" the sweep is hidden
  entirely.
- The skeleton now lines up with your body on portrait clips. The video used
  to be cropped to fit the card while the overlay was drawn against the full
  frame, which pushed the joints roughly a tenth of the screen off.
- Leaving the analyze tab mid-analysis no longer strands the app: the result
  arriving afterwards can no longer strip the tab bar off whatever page you
  moved to, and the camera, the pose model and the recorded clip are all
  released on the way out instead of being held for the rest of the session.

## [0.7.1.1] - 2026-08-31

### Fixed

- The in-app camera only covered the top of the Log food sheet, with a
  band of black between the feed and the shutter. The sheet is sized by
  its content and 92vh was only a ceiling, so nothing in it had a real
  height to fill -- the feed fell back to drawing at its own aspect ratio
  and the black behind it showed through. Both the photo viewfinder and
  the barcode scanner now fill the sheet from the header down to the
  controls, whatever shape the camera hands back.

## [0.7.1.0] - 2026-08-31

### Changed

- The Log food sheet now speaks one visual language on every screen it
  can show. "Take photo", "Upload photo", "Scan barcode", "Open camera"
  and both camera-unavailable fallbacks are all the same tappable row --
  icon, label, chevron -- instead of the coloured tile grid some of those
  screens used and others didn't. Rows also read at a size you can scan
  without leaning in.
- Recent scans lost their per-row camera badge and now show the calorie
  count on its own. "412g / 1081 kcal" was one long run of digits, and
  the amount was never what tells two logs of the same dish apart at a
  glance. Calories line up in a column (tabular figures), and the exact
  amount plus the full ingredient breakdown are still one tap away on the
  confirm screen that "Log again" opens, before anything is written.
- The barcode scanner's guide frame is now white on a deeper dim, rather
  than the app blue -- a mid-tone accent was the one colour that could
  vanish against whatever the camera happened to be pointed at. Cancel is
  a full-width button under both the barcode scanner and the photo
  viewfinder, instead of a small pill floating under a full-bleed feed.

### Removed

- The gradient-badge tile styling behind the old choice screens, now that
  nothing renders it.

## [0.7.0.1] - 2026-08-31

### Fixed

- The home page hero showed the last form score (e.g. "38 form") in its
  top-right badge; the daily-use streak had no badge in the hero at all,
  only a smaller chip further down next to the "Today" section title. The
  streak chip now sits in the hero instead, replacing the form-score
  badge -- the streak is the "look what you already did today" signal
  users actually check the hero for. The now-unused `home.hero.formPill`
  i18n key and `.hm-hero-score-pill` styles/JS are removed.

## [0.7.0.0] - 2026-08-31

### Changed

- Redesigned every question screen in the "Personalized coaching" wizard
  (`static/coaching.js`, opened from the nutrition page's "Edit goals"
  button) and the matching first-time onboarding wizard (`static/onboarding.js`)
  to a monochrome design language: no accent color anywhere -- a per-step
  progress dot row is now a single fill bar, choice rows lose their blue
  border/gradient/checkmark in favor of a plain row surface with the
  selection communicated through the border and an inverted (black-on-white
  / white-on-black) icon chip and checkmark, and the body-type photo grid
  and Back/Next buttons follow the same treatment. The height ruler's
  indicator changes from a blue two-line band to a single line, with a
  small live readout added beside it. Both wizards ask largely the same
  questions (goal, weight/gender, height, body type, activity, protein,
  diet, calorie distribution) through two independently duplicated
  implementations, so both got the same treatment for consistency.

## [0.6.1.0] - 2026-08-31

### Changed

- The "+" quick-actions sheet is a flat list of full-width rows (icon, label,
  chevron) instead of a 2x2 grid of colour-coded launcher tiles. The "More"
  pane (Coach/Friends/Settings/Signups/Log out) now shares the same row
  style -- plain icons, no colour badges -- so the whole sheet reads as one
  list, and a close ("x") button was added next to the "Quick actions" title
  alongside the existing bottom Cancel row.

## [0.6.0.0] - 2026-08-31

### Changed

- Redesigned the "Log food" choice screen (opened from nutrition's "Analyze a
  food photo" button): the old one-dominant-CTA-plus-secondary-row layout
  (Take photo / Upload / Barcode / Create / Macros, plus a recent-scans list)
  is replaced with three equal monochrome action rows -- Take photo, Scan
  barcode, Create manually. Upload photo remains reachable from the FAB/home
  quick-action screen; manual macro entry remains reachable from the bottom
  of the "Log a food" sheet, so nothing is actually lost, just decluttered.
- Simplified the weight-change rate readout in both the onboarding wizard and
  the "Edit goals" wizard (two independent, duplicated implementations --
  `static/onboarding.js` and `static/coaching.js`) from two rows (weekly and
  monthly, each showing both kg and % of bodyweight) down to a single line:
  `<amount> lost/gained Per Week`.

## [0.5.1.0] - 2026-08-31

### Changed

- The marketing landing page's "What it does" section now names each feature
  the way the app itself does -- "Analyze a Workout," "Nutrition Log," "Weekly
  Check-in," "Workout Log," "HYROX Race Simulator," "Friends" -- instead of
  taglines like "It watches you lift," and drops the paragraph under each one.
- The playable HYROX race simulator moved out of its own standalone section
  and into the phone mockup for the HYROX feature itself, so tapping it there
  now runs the same start-to-finish race (setup, running clock, splits, finish
  breakdown, Apple Watch companion) that used to live further down the page.

### Removed

- The "Form analysis" section (headline, rep-by-rep bar chart, and its hover
  interaction), the "Race day" station-grid section, and the FAQ section are
  gone from the marketing page, along with the HYROX link in the top nav and
  the "Pre-launch - early access opening soon / Move your cursor" hero line.
  Dead CSS selectors and JS left behind by these removals were cleaned up too.

## [0.5.0.9] - 2026-08-31

### Fixed

- The analyze page's "Recent analyses" cards are properly wide now instead of
  squeezed wall-to-wall. Two things were crushing them and neither had been
  touched: the section sits inside the camera card, which carries no padding so
  the viewfinder can go full-bleed, leaving the strip flush against both edges;
  and each card was locked to exactly one third of the row, so the previous
  attempt at breathing room (a wider gap and more inner padding) actually made
  every card 4px narrower. Cards now size to the row rather than to a count --
  132px on a small phone up from 91px, 147px on an iPhone 15 up from 115px --
  two fit with the third peeking to show the strip scrolls, and exercise names
  like "Tricep Pushdown" fit on one line instead of wrapping. Name and date
  text nudged up a point each now that there is room.

## [0.5.0.8] - 2026-08-31

### Fixed

- The analyze page works when you reach it from the tab bar. Its entire body
  was one `<script type="module">`, and `pagenav.js` -- which swaps tab pages
  in without loading a document -- can only re-run inline scripts through
  `new Function`, so `runInlineScripts()` skips anything that is not classic
  JavaScript. The whole page therefore never executed: no camera, no recent
  analyses, no exercise picker, no upload wiring. It failed silently, so there
  was not even a fallback to a real navigation. Reaching the same route from
  home's "Upload a set" link always worked, because that is a plain link and
  pagenav only intercepts tab-bar clicks.

  The page is a classic script now. MediaPipe was the only reason it was a
  module, and it is pulled in with a dynamic `import()` inside
  `getPoseLandmarker()` -- where the pose overlay was already loaded lazily --
  so nothing about that behaviour changes.

  A guard test pins the invariant for every tab page: the largest inline
  script, the one carrying the page logic, must be one pagenav can actually
  run. It reads the type gate out of `pagenav.js` rather than copying it, so
  the two cannot drift apart.

## [0.5.0.7] - 2026-08-31

### Fixed

- The nutrition page kept its cameras running after you tapped another tab.
  Both the in-app food-photo viewfinder and the barcode scanner hold a live
  getUserMedia stream that only an explicit close released, and a tab-bar tap
  is not a navigation -- pagenav swaps `<main>` in place, so `pagehide` and
  `visibilitychange` never fire and nav_scope then unbinds them anyway. The
  camera indicator light stayed on, and the next `getUserMedia` collided with
  the stream still held open (iOS refuses a second camera in that state). Both
  streams are now stopped from a `repcheck:page-will-swap` listener, the same
  fix the analyze viewfinder got in 0.5.0.5.

## [0.5.0.6] - 2026-08-31

### Changed

- Gave the analyze page's "Recent analyses" cards room to breathe: the gap
  between cards goes 10px -> 16px and each card's padding 12px/8px -> 16px/10px,
  with the inner icon-to-label gap 6px -> 8px. The three-up width calc is
  adjusted to match the wider gap, so exactly three still fit at any screen
  width and the fourth still scroll-snaps.

## [0.5.0.5] - 2026-08-31

### Fixed

- The analyze page's camera now works on every visit, not just the first one.
  Tapping another tab is not a navigation -- `pagenav.js` swaps `<main>` in
  place -- so the `pagehide` and `visibilitychange` handlers that were meant to
  release the camera never fired, and `RepCheckNavScope.release()` then unbound
  them outright. The stream was never stopped: the camera indicator stayed lit
  while the user was on another tab, and returning to Analyze asked for a
  second camera while the first was still held. iOS refuses that, so
  `getUserMedia` rejected and the viewfinder was replaced by the upload
  dropzone for the rest of the session. The page now releases the camera on
  `repcheck:page-will-swap`, which `pagenav.js` dispatches in the one moment a
  departing page can still run its own teardown -- immediately before
  `release()`. This also clears the 90s auto-stop `setTimeout`, which
  `nav_scope.js` does not track (it records `setInterval` only).

## [0.5.0.4] - 2026-08-29

### Changed

- `main`'s `marketing/` directory is the live pre-launch site's source again.
  It had quietly drifted out of sync: the Render static site has actually
  been deploying from a separate `marketing-analyze-demo` branch for a while,
  so merges to `main` weren't reaching production. That branch's content
  (hero video, nutrition demo, nav, copy) is now folded into `main`, and the
  Render service is being pointed back at `main` so the two stay in sync
  going forward. The four tests that guarded the old design's specific
  markup/CSS/JS (`test_marketing_contrast`, `test_marketing_kicker_not_overridden`,
  `test_marketing_page_head`, `marketingWaitlist.test.js`) are removed, since
  they asserted on implementation details of a page that no longer exists.
- Widened the `*.mp4` gitignore negation from `marketing/*.mp4` to
  `marketing/**/*.mp4` -- the incoming design's demo clips live under
  `marketing/assets/`, one level deeper than the old negation reached, so a
  future new clip with a new filename in that folder would otherwise be
  silently dropped by `git add`.

## [0.5.0.3] - 2026-08-29

### Fixed

- The report added in 0.5.0.2 never reached the logs: it was written at a
  level the live server discards, so it looked exactly like a phone that had
  said nothing. Sent at a level that survives now, and checked against the
  real server rather than assumed.

## [0.5.0.4] - 2026-08-29

### Fixed

- The phone reported back, and it said the in-place screen switching IS
  running -- and yet it reported twice for one tab tap, which it can only do
  if the tab tap loaded a whole new screen anyway. So it starts up fine and
  then gives up part-way through every switch, silently, exactly as before.
  It now says why it gave up -- the server said no, the answer came back as
  the login page, whatever it was -- instead of only saying that it started.
- The phone was also being logged as a desktop browser, because the check
  looked for the app's name in something that does not carry it. It is
  recognised properly now, which matters when the whole point is telling the
  phone's report apart from everyone else's.

## [0.5.0.2] - 2026-08-29

### Fixed

- The in-place screen switching added in 0.4.13.0 is not running on the iPhone
  app, and a recording proved it: every tab tap there is still a full page
  load, with the whole screen -- bottom bar included -- going black for around
  a seventh of a second. It refuses to run when something is not right, and it
  does so silently on purpose, so the app keeps working. That silence made it
  impossible to find out why from here. Each screen now says whether it is
  running, and if not what stopped it, so the answer can be read from the
  server instead of guessed at.
- One thing already found and removed: leaving the guided tour half-finished
  switched the new navigation off permanently, on a note to itself that
  nothing ever cleared. The tour never needed that; it moves between screens
  its own way, which was never affected.

## [0.5.0.1] - 2026-08-29

### Fixed

- Swiping back really does stop refreshing now. The last attempt fixed the
  wrong half: the screen was already being restored instantly, but the phone
  was showing a blank one on the way there. iOS takes a picture of the screen
  when you leave it and replays that picture during the back-swipe -- and the
  screen was being faded out for the transition at exactly that moment, so the
  picture it kept was of a screen mid-fade. Swiping back slid that blank in,
  which is what looked like a reload. The screen you are leaving is no longer
  faded at all, so there is nothing blank for the phone to keep, whenever it
  takes the picture.

### Changed

- Only the arriving screen animates now. It slides in from the side the tab
  order says, the one you are leaving simply stays put until it is replaced.
  Tabs also change slightly faster as a result -- the old fade-out had to
  finish before the new screen could go up.

## [0.5.0.0] - 2026-08-29

### Added

- **Record your set in the app.** Opening Analyze now opens the camera. Two
  controls, the way a camera app does it: the shutter, and a button to switch
  between the front and back lens. Tap the shutter to start, tap it again when
  the set is done. Until now the only way in was the file picker, which meant
  leaving RepCheck, filming in the phone's camera app, coming back, and then
  hunting for the clip -- four steps around the app to do the one thing the app
  is for.
- When you finish a take, the clip plays on a loop while you pick the exercise
  from the same search sheet the rest of the app uses, then **Analyze workout**
  sends it. Not happy with the take? Retake sits on the clip and puts you back
  in front of a live camera.
- The front camera mirrors itself in the preview, the way a mirror does, so you
  can see where to stand. The recording itself is never mirrored -- if it were,
  every left/right note in your form report would come back the wrong way round.

### Changed

- The upload box is no longer the way in. It is still there, and it still takes
  MP4, MOV, AVI and MKV, but it now appears only when the camera cannot be used
  at all -- permission declined, no camera on the device, or a browser too old
  to record. It leads to the same review screen, so an uploaded clip and a
  recorded one are analyzed identically.

### Fixed

- Recorded clips are measured correctly. A clip recorded in the browser carries
  no length in its file header, so nothing could read how long it was: the
  analysis skipped the first five seconds of a set that might only have lasted
  eight, and told the AI it was looking at a full minute of footage. Its real
  length is now read from the video itself.
- A recording made anywhere except an iPhone was rejected on upload with a
  message naming a file format the user had never chosen.

## [0.4.13.1] - 2026-08-29

### Fixed

- Swiping back to a previous screen no longer reloads it. The swipe was going
  off to the server for a screen the app had already had a moment earlier, and
  because the phone animates the swipe first and hands over afterwards, that
  trip landed late and looked like the screen refreshing itself under your
  thumb. Screens you have already visited are now kept for the session and put
  straight back, with nothing to wait for. Tapping a tab still asks the server,
  so a tab always shows what is actually there.

### Changed

- Screens now slide as they change. The one you are leaving fades out towards
  the side you are heading, the new one arrives from the other side -- so
  moving through the tabs reads as one row of pages rather than a screen being
  replaced. Small and quick on purpose; this happens dozens of times a
  session. Turned off entirely if you have Reduce Motion on.

## [0.4.13.0] - 2026-08-29

### Changed

- **Switching tabs no longer loads a page.** The screen is replaced in place
  instead, so the app never blanks between screens -- the tab bar, the sidebar
  and the sheets stay on screen the whole time, because they are no longer
  thrown away and rebuilt on every tap.
  This is what the last three attempts were circling. A recording of seven tab
  switches showed every one of them blanking the phone completely, and while
  caching the files, keeping the pages and fetching the next screen early all
  made the gap shorter, none of them could remove it: during a page load there
  is nothing on screen to look at, and that is the thing that reads as a
  refresh.
  Everything else about a tab tap is unchanged -- the address, the back
  button, and what each screen shows and does. If a screen ever fails to
  arrive, the app quietly falls back to loading it the old way rather than
  showing you half a page.

## [0.4.12.3] - 2026-08-29

### Fixed

- Less black between screens. A screen recording of seven tab switches showed
  every one of them blanking the phone completely -- for between a twelfth and
  a fifth of a second each -- and a trip to the server for the next screen was
  sitting inside that gap. The bottom bar now starts fetching the next screen
  the moment your thumb touches a tab, about a tenth of a second before the tap
  actually goes anywhere, so the screen is usually already on the phone by the
  time it is needed. It is the same request the tap was going to make, only
  earlier: it is only made on a real press of a tab you are not already on,
  once per screen, and never when Data Saver is on.
  Pages are also reusable for five seconds now, without asking the server,
  which is what lets that head start count for anything. A deploy is still
  never more than those five seconds away.

## [0.4.12.2] - 2026-08-29

### Fixed

- Switching tabs no longer blanks the whole screen, tab bar and all, before
  the next one appears. Every screen was asking the server about all thirteen
  of its stylesheets and scripts before it could draw anything -- thirteen
  network round trips, on every single tap, for files the phone already had
  and that had not changed. Nothing could paint until the last one answered,
  which is what made it look like the app was reloading itself.
  Those files already have their version stamped into their address, so a
  changed file is a different address and can never be mistaken for an old
  one. The phone is now allowed to keep them and reuse them without asking,
  the way it already did for the food and exercise libraries. A deploy still
  arrives immediately: the screen itself is still checked with the server
  every time, and it is the screen that names which version of each file to
  use.

## [0.4.12.1] - 2026-08-29

### Fixed

- The RepCheck wordmark on the onboarding screens is visible again in dark
  mode. It shares its logo file with the header wordmark but never got the
  same dark-theme color flip, so it rendered as black text on a black
  background.

## [0.4.12.0] - 2026-08-29

### Fixed

- Removed the thin scroll indicator bar that flashed along the right edge of
  every screen in the iPhone app. It could not be turned off from the
  website's own styling -- the technique that works everywhere else on the
  web does not work inside the app's webview -- so it now gets switched off
  at the native level when the app is built instead.

## [0.4.11.2] - 2026-08-29

### Changed

- **Rounder top corners on every bottom sheet.** "Scan a barcode", "Analyze
  a food photo", the split editor, and the other slide-up sheets now round
  their top corners more (22px → 34px), including on phones, where a
  leftover rule used to square them off at the exact viewport this app is
  used on most.

## [0.4.11.1] - 2026-08-29

### Fixed

- Changing screens stopped looking like a page refresh again. The tab bar was
  made smooth in 0.4.9.1, and then 0.4.9.2 -- fixing the iPhone app showing an
  old version of a screen after a deploy -- told the phone never to keep a page
  at all. So every tap of the tab bar downloaded the whole screen over the
  network again, ~300 KB for the food and workout logs, even for a screen you
  had just been looking at, and going back re-fetched it too. The smooth
  cross-fade was still there, waiting on that download every time.
  The phone still asks the server before showing any screen, so a screen can
  never be out of date -- that guarantee is unchanged. What is new is that the
  server can now answer "nothing changed" in a few hundred bytes instead of
  resending the whole page, and the phone can go back to a screen instantly.
  The tradeoff: pages are now kept in the app's own private storage between
  visits, the way every other app on the phone works.

## [0.4.11.0] - 2026-08-29

### Fixed

- The iPhone app no longer shows a black bar above the status bar and below
  the home indicator. The webview was configured to let iOS pad the page
  itself around the notch/Dynamic Island and home indicator, and the app's
  own background never got to paint that gap -- so iOS's own background
  showed through instead, on every screen. RepCheck now draws all the way to
  the edges, with the app's own content kept clear of the notch and home
  indicator instead.
- A pre-existing, unrelated bug turned up while fixing the above: on every
  real iPhone, a narrow-screen style rule was silently overriding the
  spacing that kept content from being hidden behind the floating tab bar.
  Confirmed live and fixed.

## [0.4.10.4] - 2026-08-29

### Fixed

- The keyboard no longer squashes the log in / sign up screen into the strip
  above it. The screen was resizing itself to whatever the keyboard left over,
  which squeezed the card and cut it off mid-field, and left iOS's little
  arrows-and-tick bar sitting against a hard edge with the app stopping dead
  underneath it. The screen now stays full size and the keyboard simply covers
  part of it.
- Tapping a field goes to that field: tap Email and the screen moves to Email,
  tap Password and it moves to Password. It brings the Log in / Sign up button
  up with the last field too, so the button you are heading for is never left
  behind the keyboard.

## [0.4.10.3] - 2026-08-29

### Fixed

- The one place left in the app that visibly refreshed the page on its own.
  After pulling in data saved from another device, the sync layer used to
  just reload -- guarded to once per browser session, but that guard doesn't
  survive the iPhone app being closed and reopened, so it could resurface on
  every cold start. Every page that shows synced data (food log, workout log,
  home, HYROX, coach, weight and logging history, streaks, challenges) now
  redraws itself in place with the new data instead; the reload still exists
  as a fallback for anything that doesn't handle it, so nothing is ever left
  showing data that's known to be wrong.

## [0.4.10.1] - 2026-08-29

### Fixed

- auth_viewport.js -- which repositions the pinned log in / sign up card
  under the on-screen keyboard -- could pin the card to a height of zero if
  it measured the viewport before the browser had finished its first layout,
  collapsing the whole screen with nothing left to correct it. It now ignores
  any measurement below a real phone's shortest possible height and keeps the
  last good geometry instead.

## [0.4.10.0] - 2026-08-29

### Added

- **"Continue with Apple" on the login and signup pages, and in the iPhone
  app.** A real Sign in with Apple flow this time, not the placeholder button
  that was pulled in 0.2.3.0 for going nowhere. Tapping it signs you in with
  your Apple ID, including Apple's Hide My Email addresses, which arrive
  verified and work like any other address. If you already have a RepCheck
  account under the same verified email, the Apple login takes you into that
  account rather than making a second one. Apple hands over your name exactly
  once, on the very first sign-in, so that is when it is saved; you can change
  it in Settings afterwards.
- Inside the iPhone app the Apple button gets the same treatment the Google
  button got in 0.4.9.0: it opens in Safari and hands a one-time token back to
  the app over the repcheck:// link, instead of signing you into a browser the
  app cannot read. This is also App Store groundwork -- Apple requires apps that
  offer another provider's sign-in to offer Sign in with Apple too.
- The button shows a "setup needed" badge and stays inert until
  `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY`
  are set (see `.env.example` for where each one comes from in the Apple
  developer portal). Nothing about the existing email/password or Google
  sign-in changes while those are unset.

## [0.4.9.3] - 2026-08-29

### Fixed

- Tapping a field on log in or sign up no longer slides the whole screen up out
  of sight, so you can see what you are typing again. Holding those screens
  still (0.4.7.0) pinned them to the phone, and iOS shifts what you can SEE
  when the keyboard opens without telling a pinned screen it moved -- so the
  card ended up above the top of the display, leaving a black screen with just
  the keyboard bar on it. The screen now follows the visible part of the phone,
  and the field you tapped is brought into view.

## [0.4.9.2] - 2026-08-29

### Fixed

- The iPhone app could keep showing an old version of a screen after a deploy,
  even though the deploy had landed and the website was already updated. Pages
  were sent with no caching instructions at all, so iOS was free to decide for
  itself how long to hold on to them -- and the version stamps that force fresh
  styling live inside those pages, so a held-back page also pinned every
  stylesheet and script to its old version. It looked exactly like a deploy that
  never shipped. Pages are now marked as never-store, so the app always picks up
  the current version on launch.

## [0.4.9.1] - 2026-08-29

### Changed

- Switching between the food log, the workout log and the other tabs used to
  land with a visible reload every time: the bar sat still until the whole next
  page had arrived, then the highlight appeared on the new tab. The highlight is
  now its own element that slides, and it starts sliding the moment your thumb
  lands rather than when the page finishes loading, so tapping a tab answers
  immediately. Built on a plain CSS transform rather than the View Transitions
  API, so it works on every iOS version instead of only 18.2 and up.
- Every tab switch was also re-downloading the food and exercise libraries,
  which were pasted into each page: 155 KB of them on the Nutrition page, 250 KB
  on Workouts, identical bytes every single time and impossible for the browser
  to cache. They are now served as their own files and fetched once. The
  Nutrition page dropped from 488 KB to 325 KB per visit, Workouts from 530 KB
  to 282 KB. That is a real saving on the iPhone app, which loads the live site
  over the network on every tap.

## [0.4.9.0] - 2026-08-29

### Fixed

- **"Continue with Google" now signs you into the iPhone app.** Before, tapping
  it took you through the whole Google flow and then dropped you on the
  website, still logged out in the app. Google does not allow its sign-in
  screen inside an app's own browser, so the flow has to happen in Safari --
  and the app could not see the account you had just signed into. It now hands
  the sign-in back to the app when Safari closes, and you land where you
  started, logged in.
- Signing in with Google on the website is completely unchanged.

## [0.4.8.0] - 2026-08-29

### Changed

- The barcode scanner now fills the screen instead of sitting in a small box
  near the top of the sheet, and a Scan / Upload photo switch sits under it.
  A bigger preview puts more pixels on the bars, which is what decides whether
  a barcode reads at all, and the switch means a code that will not scan live
  can be read from a photo -- taken now, or one already in the library --
  without hunting for the fallback.

## [0.4.7.0] - 2026-08-29

### Fixed

- The log in and sign up screens no longer scroll or bounce. They were a normal
  scrolling page, so on a phone -- and in the iPhone app, which loads these same
  screens -- you could drag the whole thing around and it would rubber-band back.
  They now sit still.
- Sign up no longer runs off the bottom of a smaller iPhone. It was 47px taller
  than a 375x667 screen, and taller again once an error message was showing, so
  the Sign up button could sit below the fold. The layout tightens on shorter
  screens and whenever an error is on screen, and both pages now fit every
  iPhone size Apple still supports.
- The Sign up and Log in buttons stay reachable with the keyboard open. Holding
  the page still would otherwise have hidden them behind the keyboard with no
  way to scroll down to them, so the screen now sizes itself to the part of the
  phone the keyboard leaves visible.

## [0.4.5.8] - 2026-08-29

### Fixed

- Every iPhone build arrived at Apple flagged as missing export compliance and
  had to have a questionnaire answered by hand before anyone could install it.
  The build now declares this itself.

## [0.4.5.7] - 2026-08-29

### Fixed

- The iPhone build had the right signing files but never told Xcode to use
  them, so the final packaging step had nothing to work from.

## [0.4.5.6] - 2026-08-29

### Fixed

- The iPhone build now signs the app with a named certificate and profile
  rather than asking Apple to work out which ones to use, which it could not.

## [0.4.5.5] - 2026-08-29

### Fixed

- The iPhone build could never sign the app, because no signing certificate
  had ever been created for it. The build now uses a stored certificate rather
  than trying and silently failing to make one each run.

## [0.4.5.4] - 2026-08-28

### Fixed

- The iPhone build reached the real compile step and then refused to sign the
  app. It now pins the app identifier into the Xcode project rather than
  trusting it to already be set, and prints what it found so the next failure
  explains itself.

## [0.4.5.3] - 2026-08-28

### Fixed

- The iPhone build got all the way to the final compile and then failed
  looking for a project file that the tooling no longer creates. Corrected,
  along with the notes that described the old layout.

## [0.4.5.2] - 2026-08-28

### Fixed

- The iPhone build was running an older version of Node than the app tooling
  needs, and stopped as soon as it tried to generate the iOS project.

## [0.4.5.1] - 2026-08-28

### Fixed

- The first iPhone build failed before it started, with "no matching profiles
  found". The build was set up to look for Apple's signing files rather than to
  create them, and on an app that has never been built there is nothing to find.
  It now creates them on the first run.

## [0.4.5.0] - 2026-08-28

### Changed

- **The iPhone build pipeline is now armed.** With the Apple account verified,
  the signing and TestFlight upload steps in the build config are live rather
  than commented out, so a build can actually produce a signed app and send it
  to TestFlight once the account-side setup is done.
- The build now installs RepCheck's own 1024x1024 App Store icon over the
  placeholder the tooling ships. Apple rejects uploads whose icon has a
  transparency channel, and the placeholder has one, so this would otherwise
  have failed at upload with a message that does not mention the icon.
- The app's internal identifier changed from `com.repcheck.app` to
  `com.benchanakatkul.repcheck`. These are unique across every Apple developer
  worldwide and the original was already taken. It is never shown to anyone
  using the app.
- Each build stamps its own version and build number automatically. Apple
  refuses any upload whose build number is not higher than the last one, which
  is the most common way a second TestFlight upload fails.

## [0.4.4.0] - 2026-08-26

### Changed

- **Suggestions now live where you actually log things, not on the home page.**
  The home screen no longer shows a "Suggestions" card on days with nothing
  logged. The same suggestions were already waiting inside the two search
  sheets -- open the food log's add sheet and it opens on your recent foods
  plus what you usually eat around this hour; open the workout log's exercise
  picker and it opens on your favourites, your custom exercises, today's
  planned split, and what you logged recently. That is where you are already
  headed when you want to log something, so the home page stops repeating it.

## [0.4.3.0] - 2026-08-25

### Added

- **Groundwork for RepCheck as an actual iPhone app.** Nothing changes on the
  website -- every camera and photo button behaves exactly as it did. What is
  new is that when the same app runs inside the iOS shell, those buttons open
  the real iPhone camera instead of the browser's file picker: photographing a
  meal, picking one from your library, and taking your weekly progress photos.
  Apple rejects apps that are just a website in a wrapper, so this is the part
  that makes RepCheck a real app rather than a bookmark.
- Progress photos taken this way are never edited and never saved to your
  camera roll -- they go straight to your private check-in and nowhere else.
- A build pipeline that produces the iPhone app from this repo, and an offline
  screen so a phone with no signal shows a RepCheck message rather than a
  browser error.

None of it is live yet: the app cannot be built until the Apple Developer
membership is active.

## [0.4.2.1] - 2026-08-25

### Fixed

- **The "More questions below" prompt no longer exists for keyboard and
  screen-reader users when it isn't on screen.** It was only made
  see-through when there was nothing below the fold, which hides it from
  eyes but not from anything else -- so tabbing through setup could land on
  an invisible button, and a screen reader would read out a prompt about
  questions further down when every question was already in view. It is now
  properly hidden, and skipped along with everything else that isn't there.
  It still fades in and out exactly as before.

## [0.4.2.0] - 2026-08-25

### Fixed

- **Setup no longer tells you there are more questions below when there
  aren't.** The "More questions below" prompt appeared on every question
  screen and lit up whenever the page could still be scrolled -- so on a
  screen with one question and a long list of answers it pointed you down
  the page to look for a question that was never there. It now appears only
  on the two screens that really do ask a second question further down:
  body fat + activity level, and protein + diet. The soft fade above the
  Next button is unchanged; it only ever meant "this page scrolls".

## [0.4.1.1] - 2026-08-25

### Changed

- Internal only, nothing user-facing: the project's deploy notes said no
  Render API key was available and told you to check deploys by loading the
  site. That is not enough -- a failed deploy rolls back and the rolled-back
  site answers exactly like a healthy one, which is how the v0.4.0.0 failure
  went unnoticed. The notes now say how to read the real deploy status.

## [0.4.1.0] - 2026-08-25

### Fixed

- **Account deletion, the privacy policy and the terms page are actually
  live now.** They merged as 0.4.0.0 but never reached the site: the new
  database column they need was added on startup by a check-then-act
  migration, and the server runs several worker processes that all start at
  once. Two of them raced, the second one crashed on a column the first had
  just added, and the deploy failed and rolled back -- so the site kept
  serving the previous release with none of the new pages on it.
- The same race was present in every other startup migration in the app and
  had simply never been triggered, because it can only fire on the very
  first start after a column is introduced. All ten now go through one
  race-safe path.
- A failed cleanup sweep can no longer stop the app from starting or break a
  request. Nothing that runs at startup should be able to take the site down.

## [0.4.0.0] - 2026-08-25

### Added

- **You can now delete your account yourself, from Settings.** Until now the
  only way to get your data out of RepCheck was to ask. Settings has a new
  Delete account card at the bottom: confirm once, and the account is
  scheduled for deletion. It is not instant on purpose -- you have 30 days to
  change your mind, and a banner on every page tells you the exact date your
  data goes with a "Keep my account" button next to it. Log back in any time
  in those 30 days and one tap puts everything back.
- After the 30 days, everything really goes: workouts, nutrition logs, weight
  history, progress photos (the image files too, not just the rows), saved
  form analyses and their clips, custom foods and exercises, friends,
  challenges and HYROX race times.
- **A privacy policy and terms of service, at /privacy and /terms.** Both are
  readable without logging in, and linked from a new Legal card in Settings.
  The privacy policy is specific about the parts that matter: that progress
  photos are private to your account, and that food photos, lift videos and
  coach messages are sent to Google and OpenAI to produce their results.

### Changed

- The stated deletion window is rendered from the code's own setting rather
  than typed into the copy, so the policy page, the settings card and the
  confirm dialog can never disagree with what actually happens.

## [0.3.13.0] - 2026-08-25

### Added

- **The pre-launch site now walks through adding an exercise, screen by
  screen.** A new "Adding an exercise" section on the marketing page steps
  through the real flow from `templates/workouts.html`: tap "+ Log an
  exercise" on the day, pick the exercise out of the bottom sheet (search,
  or the All / Favorites / Recent tabs, or create a custom one under the
  name you typed), type weight x reps into Set 1, then "+ Add Set" until
  the card ticks green and folds back to `60 kg - 3 sets - 8, 8, 6 reps`.
  The four phone screens are mocked from the site's own tokens rather than
  screenshots, so they follow the light/dark toggle, and every label in
  them is the app's own string from `static/i18n.js`.
- The step list auto-advances while the section is on screen and stops the
  moment you tap a step yourself. The step buttons ship `disabled` and
  `app.js` enables them, so with JS off the section degrades to four
  written steps and the first screen instead of four dead controls;
  `prefers-reduced-motion` turns the cycling off entirely and leaves the
  steps clickable.
- `marketing/exercise-icons/` holds four SVGs copied out of
  `static/exercise_icons/` so the marketing folder stays deployable on its
  own.

### Fixed

- The stats band claimed 527 exercises in the library. It's 735 -- the
  number `marketing/README.md` already recorded from `workout_library.py`.

## [0.3.12.0] - 2026-08-25

### Fixed

- **The three deep-dive sections on the pre-launch site have their coloured
  labels back.** "Form analysis", "Nutrition" and "Workout logging" were
  meant to sit above each section as small green, blue and amber eyebrows.
  Instead all three rendered as grey body text at the same size as the
  paragraph underneath them, so each section opened with two lines that
  looked identical and nothing marked where one topic ended and the next
  began. A body-copy rule further down the stylesheet was quietly winning
  against the label styling; it now leaves the labels alone. The rest of the
  page is unchanged, and the fix applies to any deep-dive section added
  later without needing a second edit.

- **The small green and amber text on the pre-launch site is readable now.**
  The accent colours are picked to sit under white text on a button, and used
  the other way round -- as coloured text on a pale background -- they were
  washing out. The "Pre-launch" and "Limited early access" chips, the
  "Rep-by-rep" tag, the waitlist success message, and the green and amber
  section labels were all landing around 2.7-3.1:1 against their backgrounds,
  where the accessibility bar for text that size is 4.5:1. The blue "Nutrition"
  label had the same problem in dark mode. All of them now use an adjusted
  shade of the same colour -- deeper on light, lighter on dark where that was
  the failing side -- and clear the bar in both themes. Buttons, icons and
  progress bars keep the original accent, so nothing else on the page shifts.

## [0.3.11.0] - 2026-08-25

### Changed

- **Setting up a new account is now seven shorter screens instead of six.**
  The last screen used to ask three things at once -- how much protein you
  want to prioritise, what kind of diet you follow, and whether to spread
  calories through the week or keep them stable. The calorie-spread question
  now gets a screen of its own at the end, so no screen in the whole setup
  asks more than two things. The questions themselves, and the plan they
  produce, are unchanged.
## [0.3.9.0] - 2026-08-25

### Fixed

- **The weekly check-in no longer keeps asking after you've already done
  it.** The real problem was that the check-in could never finish. Tapping
  "Complete check-in" left the button sitting on "Loading..." forever, with
  no error and nothing to retry — and because the check-in only records
  itself (`lastAdjustmentDate`) at the very end of a successful submit, one
  that can't finish never advances the 7-day cadence. So the home banner
  kept advertising the check-in and the deep link kept re-opening the sheet.
- The cause: `fetch` has no default timeout, and submitting a check-in makes
  four requests in a row (profile recovery, the weigh-in, each progress
  photo, then the calorie adjustment). Only the last one had a 45-second
  abort, and even that one stopped watching once the response headers
  arrived — a stalled response body still hung. On a dropped mobile
  connection or a backgrounded tab, any one of them could stay pending
  forever. Every request coaching.js makes now goes through one wrapper that
  bounds both the request and the body read, so the check-in always ends in
  either a result or an error you can retry.

## [0.3.7.0] - 2026-08-24

### Added

- **The pre-launch site now shows workout logging happening for real.** A new
  section between the nutrition block and the HYROX band plays a 16-second
  recording of the app: today's plan sitting ready, tapping Log an exercise,
  weight and reps going into two sets, then the Workout AI chat being asked
  how to progressively overload and answering with the actual plan — hold
  30kg, hit 10 reps on every set, then add 1.25-2.5kg. The clip is cropped to
  the app itself, with the phone's status bar, Safari's bars, and every
  stretch where the keyboard covered the screen cut out. The AI chat is
  written up in the same section rather than a separate one, labelled with
  what it actually does: it reads the last four sessions you logged of an
  exercise before it answers.

## [0.3.6.0] - 2026-08-24

### Fixed

- **The food-logging demo clip in the nutrition section no longer flashes
  motion at people who've asked their phone for less of it.** It landed
  with its own autoplay wiring, separate from the hero video's, so a brief
  moment of playback slipped through before prefers-reduced-motion caught
  up and paused it. Both demo videos now start and stop the same way.

## [0.3.5.0] - 2026-08-24

### Changed

- **The pre-launch marketing site's hero now shows a real analysis**, not a
  drawn mockup. The phone in the hero used to play a hand-built CSS animation
  of a squat score screen; it now plays an actual 24-second recording of the
  app scoring a tricep-pushdown set — picking the exercise, tapping Analyze,
  the pose-tracking overlay running, and the scored report landing. The clip
  is cropped to just the app itself, with the phone's status bar and the
  browser's own address bar and keyboard cut out, and the AI-processing wait
  is trimmed down to keep the loop tight.

## [0.3.4.0] - 2026-08-24

### Changed

- **The pre-launch marketing site's nutrition section now shows a real
  screen recording of food logging** (search, pick a food, adjust the
  amount, add to log) instead of a hand-drawn macro-ring mockup. The clip
  is cropped to the app's own viewport, with the iOS status bar, Safari's
  bars, and the stretch where the system keyboard covers the screen all
  cut out.

## [0.3.3.0] - 2026-08-24

### Fixed

- **The Workout AI chat now hides on days you haven't logged anything,
  not just when your whole history is empty.** A single workout logged
  days ago used to leave the chat card pinned open forever, so it kept
  showing up under the "Nothing logged yet" empty state on every rest
  day. It now tracks whichever day you're actually looking at in the
  date strip: it appears the moment you log that day's first exercise
  and disappears again the moment you navigate to (or empty out) a day
  with nothing on it.

## [0.3.2.0] - 2026-08-24

### Added

- **Searching for an exercise on the Analyze page now returns a full list**,
  not a stray handful. Common movements like bench press, dips, step-ups,
  hip thrusts, and shrugs used to come back with as few as one or two
  results; the exercise library grew by over 200 named variations so a
  search for any well-known movement fills the sheet.
- **The search also understands what you actually type.** "Curls" now finds
  Bicep Curl, "abs" or "quads" returns that whole muscle group, and "twist"
  also surfaces movements filed under different names like Rotation and
  Chop — on top of the existing exact-name matching.

## [0.3.1.1] - 2026-08-24

### Fixed

- **A logged exercise in Today's plan now shows a green checkmark**, not a
  green dot. The tick was there, but it was drawn small and white inside a
  filled green circle, and on a phone the circle was the only thing that read.
  The circle is gone: the checkmark itself is the icon now, stroked in green
  and sized up.

## [0.3.1.0] - 2026-08-24

### Added

- **The home screen now suggests what to log when today is empty.** If you
  haven't logged food or a workout yet, a Suggestions card offers a few things
  to start with, each one tap from being logged. Nothing is invented: food
  suggestions are what you actually tend to eat around this hour, and workout
  suggestions come from your own split plan, falling back to what you've
  logged before. With no history at all it points you at your first log rather
  than guessing on your behalf.

### Changed

- **The "recent" and "usual for this hour" rules now live in one place**
  (`static/suggestions.js`). The food sheet, the exercise picker and the new
  home suggestions all read from it, so what counts as a recent or habitual
  pick can't drift apart between screens.

### Removed

- **The play button no longer sits on top of your set** on the analysis
  result screen. The clip already starts playing on its own, and tapping it
  still turns on sound and the normal video controls; if a browser refuses to
  autoplay, you now get the native controls instead of a button covering the
  footage.

## [0.3.0.0] - 2026-08-24

### Added

- **A pre-launch page for RepCheck**, deployed separately from the app: what it
  does, who it's for, and a waitlist form. It's a plain static site with no
  build step and no dependency on the app, so it can go live on its own domain
  without touching anything users are already running.
- **Setup now tells you when there are more questions below.** The taller
  onboarding screens run past the bottom of a phone display, and the Next
  button sitting at the bottom made them look finished — people answered the
  one question they could see and moved on. A "More questions below" cue and
  a soft fade above the buttons now say there's more, and tapping the cue
  scrolls down. It only appears when the screen actually has more to show.

### Fixed

- **The setup card is rounded on all four corners again.** The button bar at
  the bottom was squaring off the two bottom corners while the top two stayed
  round.
- **The Log out pill no longer covers your answers during setup.** It scrolls
  with the page instead of floating over whichever option sat underneath it.
- **Sharing the pre-launch page no longer produces a blank preview card**, and
  the site stopped pointing crawlers at a sitemap that doesn't exist yet.
- **A markup slip in one waitlist form can no longer silently disable the
  other.** The wiring threw part-way through, leaving the second form dead and
  sending an address into the URL bar on submit instead of to the waitlist.

### Changed

- The HYROX personal-bests board now ends with a single line telling you what
  to do about the times on it.

## [0.2.5.1] - 2026-08-23

### Changed

- Workout form analysis now records how long the AI grading call itself took,
  separate from video upload/trim time, so a slow analysis can be diagnosed
  with real numbers instead of guesswork.

## [0.2.5.0] - 2026-08-23

### Fixed

- **You can reach the Next button again during setup.** On a phone, the
  "Tell us about yourself" screen put two scroll wheels across the middle of
  the display. Because those wheels scrolled vertically, a downward flick was
  swallowed by the wheel instead of scrolling the page — so Next stayed below
  the fold and unreachable, and the flick silently changed your weight on the
  way past. Weight and height are now picked on rulers that slide sideways,
  which cannot swallow a vertical swipe, and the Next/Back bar sticks to the
  bottom of the screen so it is always in reach.
- **Your weight and height can no longer be silently rewritten.** Moving off a
  measurement screen reset its ruler, and that reset could be recorded as an
  answer — saving the lowest value on the dial (35 kg / 130 cm) over what you
  actually chose. Seen on a run whose targets had just been calculated from
  98 kg / 183 cm. A ruler that has left the screen, or has not been positioned
  yet, is now ignored.

### Changed

- Setup is 6 screens instead of 5, and each one asks less. Gender has its own
  screen again, height and weight share the next one, and both now fit a phone
  screen whole with nothing to scroll past. Users maintaining their weight
  still see one screen fewer, since goal weight is skipped for them.

## [0.2.4.0] - 2026-08-21

### Changed

- First-run onboarding now takes 5 screens instead of 10. The same ten questions
  are asked and the same nutrition targets come out — related questions simply
  share a screen (your goal; gender/weight/height; goal weight & pace; body type
  & activity; food preferences), with a sub-heading labeling each question on the
  combined screens, and Next unlocks once everything on the screen is answered.
  Users maintaining their weight see 4 screens, since the goal-weight question is
  still skipped for them.
- The body-type photos load as soon as their screen appears instead of lazily,
  so the cards no longer pop in after the rest of the screen.
- Tapping an option on the taller combined screens keeps your scroll position
  (and keyboard focus) instead of snapping back to the top, while moving to the
  next screen always starts it from the top.

### Fixed

- The progress bar now shows as complete on the results screen instead of
  resetting to empty, and is hidden on the error screen rather than showing a
  contradictory "all done" bar.
- The "You're all set!" checkmark badge lost its green glow, matching the flat
  gradient badges used everywhere else in the app.

## [0.2.3.0] - 2026-08-19

### Removed

- The "Continue with Apple" / "Sign up with Apple" buttons are gone from the login
  and signup screens, along with the /auth/apple route and the APPLE_* env vars.
  Apple Sign In was never implemented past the redirect (it needs a paid Apple
  Developer account), so the button only ever showed a "setup needed" badge and a
  dead end. Google sign-in and email/password are unchanged.

## [0.2.2.0] - 2026-08-19

### Changed

- HYROX: the setup screen no longer shows a second copy of your personal bests.
  The same board lives on the history screen, one tap away behind the hero's
  "Personal bests" link, so the setup screen was saying it twice.

## [0.2.1.0] - 2026-08-19

### Added

- "Continue with Google" on the login and signup screens is live. The OAuth flow itself
  was already written; what was missing was a Google Cloud OAuth client, so the button
  rendered with a "setup needed" badge and went nowhere. Set GOOGLE_CLIENT_ID and
  GOOGLE_CLIENT_SECRET and it signs people in for real, pulling their name and profile
  picture from Google. A new .env.example documents both those keys and every other
  variable the app needs, including the exact redirect URIs the Cloud Console has to
  hold or Google refuses the callback.

### Fixed

- Google sign-in would have failed on every production attempt with
  redirect_uri_mismatch. Render terminates TLS at its edge and forwards to gunicorn over
  plain HTTP, so Flask built the callback URL as http:// while the Cloud Console can
  only hold https:// for a real host, and Google compares the two byte for byte. The app
  now reads X-Forwarded-Proto behind Render's proxy, so the URL it hands Google matches
  what is registered. Local dev over http://localhost is unaffected.
- A Google login for an email address that already had a password account adopted that
  account on an email match alone. Google does not always report an address as verified,
  and an unverified one there means anyone able to attach that address to a Google
  account walks into the RepCheck account registered under it. Verified addresses still
  merge into the existing account; unverified ones now get their own account keyed on
  the Google user id instead.
- The page you were headed to before logging in survives signing in with Google. Google's
  callback carries only its own code and state, so a /login?next=/nutrition dropped the
  destination and landed everyone on home.

## [0.2.0.0] - 2026-08-19

### Added

- HYROX: the landing card's second link now reads "Personal bests" and opens a ranked
  board of your five fastest times in one category, instead of a flat list of everything
  you have logged. Your best sits at the top with the gap to it on every row below, so
  the screen answers "am I getting faster" rather than only "what have I run". Tap any
  time to open its full breakdown, the same one the history rows open. Categories you
  have raced more than once get tabs, and the board opens on whichever one you have run
  the most.

### Changed

- HYROX: the saved-times list moved under that board and is now called History. It still
  lists every race, including the custom and flagged ones the board cannot rank — a
  custom race is its own mix of stations, so no two of them share a standard to be
  ranked against. Half races get their own board rather than beating every full-distance
  time on half the distance.
- The personal-bests trophy badge lost the colored glow behind it, and DESIGN.md no
  longer asks for that glow on new icon badges. The rest of the app still has it in
  about 45 places; that sweep is tracked separately.

### Fixed

- HYROX: a race stored with an unexpected category, format, or gender can no longer
  inject markup into the new board through the unescaped translation layer.

## [0.1.1.0] - 2026-08-18

### Fixed

- HYROX: a flagged race no longer tells you it wasn't saved. Beat the realistic-time
  floor and the finish screen said the race was "not saved to your history" — then the
  history screen listed it, under a heading reading "Saved times". It always was saved;
  what it doesn't do is count toward your personal bests or the leaderboard, which is
  what the message says now.
- HYROX: the landing card no longer counts your races and calls you a first-timer in the
  same breath. If every race you'd run was a custom one (or got flagged), the header
  showed "11 races" directly above "Your first race awaits", and it never resolved no
  matter how many more you ran. It now says you have no ranked time yet, and why.

## [0.1.0.0] - 2026-08-18

### Fixed

- HYROX: you can start a race again after picking a category and format. If your
  profile had no gender saved, Start race was permanently greyed out and tapping
  it did nothing — and because the race length, training space, and race agenda
  steps all wait on that same answer, the page sat there as a near-empty card
  with a dead button. Race setup now asks the question itself when it has no
  answer to work from, and keeps asking until this race actually has one.
