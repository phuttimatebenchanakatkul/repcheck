# Changelog

All notable changes to RepCheck are recorded here, newest first.

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
