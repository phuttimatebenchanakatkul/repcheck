# Changelog

All notable changes to RepCheck are recorded here, newest first.

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
