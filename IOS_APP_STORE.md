# Shipping RepCheck to the iOS App Store

RepCheck is a server-rendered Flask app with no build step. This document is the
plan for wrapping it in a native iOS shell and getting it through App Review.

Status: **not started.** Nothing in this repo is iOS-related yet.

## Architecture decision: Capacitor shell over the live server

The app is server-rendered -- there is no static bundle to ship inside an `.ipa`.
So the shell loads the production URL remotely:

    server: { url: "https://repcheck-q0m4.onrender.com", cleartext: false }

That alone is a **Guideline 4.2 (Minimum Functionality) rejection**: Apple does
not accept apps that are only a website in a wrapper. The shell has to add
native capability the browser cannot provide, and the web app has to actually
use it when it detects it is running inside the shell.

### Native capability to add (the 4.2 defence)

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

## What requires a Mac

You are on Windows. These steps cannot happen here:

- `npx cap add ios` -> `pod install` (CocoaPods is macOS-only)
- Opening `ios/App/App.xcworkspace`, setting the bundle ID, signing team,
  `NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription` /
  `NSHealthShareUsageDescription` strings in `Info.plist`
- Archive + upload to App Store Connect

Options: a borrowed/rented Mac, a cloud Mac (MacStadium, Scaleway), or a hosted
build service (Codemagic, Expo EAS Build) which can build and upload from a
Windows-authored repo.

## Cost and time

- Apple Developer Program: **$99/yr**, and enrolment identity verification takes
  1-3 days (longer for an Organization account, which needs a D-U-N-S number --
  enrol as an Individual unless RepCheck is a registered company).
- App Review: typically 24-48h per submission. Budget for at least one rejection.
- Assets needed: 1024x1024 icon (no alpha, no rounded corners), 6.7" and 6.5"
  iPhone screenshots, an app description, keywords, a support URL.

## Order of work

1. Enrol in the Apple Developer Program (you; blocks everything native).
2. Flask-side blockers: account deletion, /privacy, /terms.  <- can start now
3. Sign in with Apple (needs the developer account from step 1).
4. Capacitor scaffold + native camera/push/health bridge in the web app.
5. Mac-side: `cap add ios`, Info.plist strings, signing, archive.
6. App Store Connect listing, privacy labels, screenshots, submit.
7. Once live: add the "Download on the App Store" badge to `marketing/index.html`.
