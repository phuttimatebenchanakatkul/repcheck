# Changelog

All notable changes to RepCheck are recorded here, newest first.

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
