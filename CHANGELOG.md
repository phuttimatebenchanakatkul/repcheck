# Changelog

All notable changes to RepCheck are recorded here, newest first.

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
