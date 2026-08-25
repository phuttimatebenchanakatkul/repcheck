# Shipping RepCheck to the iOS App Store

RepCheck is a server-rendered Flask app with no build step. This document is the
plan for wrapping it in a native iOS shell and getting it through App Review.

Status: **shell scaffolded, cannot be built until the Apple membership is
active.** The web-side blockers (account deletion, /privacy, /terms) shipped in
v0.4.0.0; the Capacitor shell and native camera bridge are in this repo now.
What is left needs an Apple Developer account and a macOS build machine.

## Architecture decision: Capacitor shell over the live server

The app is server-rendered -- there is no static bundle to ship inside an `.ipa`.
So the shell loads the production URL remotely:

    server: { url: "https://repcheck-q0m4.onrender.com", cleartext: false }

That alone is a **Guideline 4.2 (Minimum Functionality) rejection**: Apple does
not accept apps that are only a website in a wrapper. The shell has to add
native capability the browser cannot provide, and the web app has to actually
use it when it detects it is running inside the shell.

### Native capability (the 4.2 defence)

**Done.** `static/native.js` is the bridge (`RepCheckNative`). Inside the shell
the food-photo, photo-library and progress-photo flows open the real native
camera; in a browser every entry point clicks the same hidden `<input>` it
always did, so the web app is byte-for-byte unchanged. It reads
`window.Capacitor.Plugins` at runtime rather than importing the packages,
because this project has no build step. Covered by `tests-js/native.test.js`
(behaviour, in jsdom) and `tests/test_native_bridge_wiring.py` (that the call
sites are actually plugged in).

**Still to do, and blocked on the developer account:** push notifications need
an APNs key, and HealthKit needs an entitlement -- neither can be requested
without an active membership. The plugin packages are already in package.json
so `cap sync` picks them up once the native project exists.

### Plugin inventory

| Capability | Plugin | Replaces / adds |
|---|---|---|
| Camera + video capture | `@capacitor/camera` | the `<input capture>` fields in `templates/nutrition.html`, `templates/index.html`, `static/coaching.js` |
| Push notifications | `@capacitor/push-notifications` | streak + check-in reminders (no web equivalent on iOS) |
| HealthKit read/write | `@perfood/capacitor-healthkit` | bodyweight, workouts, active energy -- genuinely native, and a strong 4.2 argument for a fitness app |
| Offline shell | `@capacitor/preferences` | last-logged-day cache so the app opens to something without a network |
| Haptics | `@capacitor/haptics` | set completion, rep counting |

Web side: detect the shell (`window.Capacitor?.isNativePlatform()`) and branch to
the native path, falling back to the existing `<input>` flow in a browser. That
keeps the plain web app working unchanged.

## Hard blockers to fix in the Flask app first

These are required regardless of the wrapper and can all be done on Windows.

1. **Account deletion** -- Guideline 5.1.1(v). Any app with account creation must
   let a user delete their account *from inside the app*, not by emailing
   support. Needs a `DELETE /api/account` route, a destructive confirm flow in
   `templates/settings.html`, and cascading deletes across `database.py`
   (nutrition logs, workouts, weight, check-in photos on disk, custom foods,
   custom exercises, friends, challenges, hyrox results).
2. **Privacy policy** -- a real `/privacy` page, linked from settings and from the
   App Store Connect listing. Must specifically cover: progress photos of the
   user's body, lift videos, and the third-party AI processors those are sent to
   (Gemini / OpenAI, per `analyze_food_gemini.py`, `analyze_form_gpt.py`).
3. **Terms of service** -- `/terms`. Not strictly required by Apple, but required
   for the EULA field and expected for a paid-tier app later.
4. **Sign in with Apple** -- Guideline 4.8. `auth.py` offers Google OAuth, so an
   equivalent privacy-preserving option is required on iOS. Sign in with Apple
   is the safe route. Needs a new `/auth/apple` + callback pair, an Apple
   Services ID, and a private key from the developer account.
5. **App Privacy labels** -- declare health/fitness data, photos/video, email,
   and usage data in App Store Connect, and say whether it is linked to identity.

## What requires a Mac -- and how it is handled

`npx cap add ios` runs `pod install`, which is macOS-only, so the native Xcode
project cannot be generated on the Windows machine this repo is developed on.
`ios/` is therefore gitignored and treated as build output.

`codemagic.yaml` covers this: it rents a macOS runner, regenerates the iOS
project, writes the `Info.plist` usage strings, runs both test suites, and
builds a signed ipa. That is the answer to "connect GitHub so it deploys" --
Apple never pulls from GitHub; a CI Mac builds and uploads on your behalf.

Before it can run, three things need the active membership:

1. A bundle id registered at developer.apple.com, matching `appId` in
   `capacitor.config.json` (`com.repcheck.app`).
2. An App Store Connect API key (Users and Access -> Integrations -> Keys),
   added to Codemagic.
3. An App Store distribution certificate, which Codemagic generates once the
   key above is connected.

Then uncomment the `ios_signing` and `app_store_connect` blocks in
`codemagic.yaml`. Keep `submit_to_app_store: false` -- TestFlight first.

## Cost and time

- Apple Developer Program: **$99/yr**, and enrolment identity verification takes
  1-3 days (longer for an Organization account, which needs a D-U-N-S number --
  enrol as an Individual unless RepCheck is a registered company).
- App Review: typically 24-48h per submission. Budget for at least one rejection.
- Assets needed: 1024x1024 icon (no alpha, no rounded corners), 6.7" and 6.5"
  iPhone screenshots, an app description, keywords, a support URL.

## Order of work

1. ~~Flask-side blockers: account deletion, /privacy, /terms.~~ **Done, v0.4.0.0.**
2. ~~Capacitor scaffold + native camera bridge.~~ **Done.**
3. Enrol in the Apple Developer Program. **Paid, membership pending.**
4. Accept the Program License Agreement in App Store Connect (Business tab).
   Payment alone is not enough -- app creation and uploads stay blocked until
   someone accepts it.
5. Register the bundle id `com.repcheck.app`. Permanent; never reusable.
6. Connect this repo at codemagic.io, add the App Store Connect API key, and
   uncomment the signing blocks in `codemagic.yaml`.
7. First TestFlight build. Expect the first one to fail on something small.
8. Push notifications (APNs key) and HealthKit (entitlement) -- both need the
   live account, and both strengthen the 4.2 case beyond the camera.
9. App Store Connect listing: privacy labels (health data, photos, email),
   1024x1024 icon with no alpha, 6.7" and 6.5" screenshots, description,
   support URL.
10. Sign in with Apple, *if* review asks for it. Guideline 4.8 is triggered by
    the Google login, but the existing email/password option is commonly
    accepted as the required alternative -- so this is a contingency, not a
    prerequisite.
11. Once live: add the "Download on the App Store" badge to
    `marketing/index.html`.
