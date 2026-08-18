# Changelog

All notable changes to RepCheck are recorded here, newest first.

## [0.1.0.0] - 2026-08-18

### Fixed

- HYROX: you can start a race again after picking a category and format. If your
  profile had no gender saved, Start race was permanently greyed out and tapping
  it did nothing — and because the race length, training space, and race agenda
  steps all wait on that same answer, the page sat there as a near-empty card
  with a dead button. Race setup now asks the question itself when it has no
  answer to work from, and keeps asking until this race actually has one.
