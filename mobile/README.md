# FIRM phone app (iPhone and Android)

A Capacitor 8 shell around F.I.R.M. Home Care. The app opens the Home Care Worker at `https://home.firm.vip/app`,
so tenants see the same pages as the web version and page changes go live without a store update. What the app
adds on top (all in `../src/app.ts`, which serves `/app` and `/app.js`):

- **Sign in once.** Cell or email on file, then a 6-digit code by text or email. The phone stays signed in.
  Opening a Home Care link from an email inside the app also signs it in.
- **Work orders in the app.** The same guided work order as the web: photos from the camera, filed in Rentec
  through the API with the photos attached. No need to open Rentec's app for repairs.
- **Resident Connect button.** "Open Resident Connect" (rent, lease, insurance upload) opens Rentec's tenant app
  if it's installed, otherwise its store page. Android opens it directly; on iPhone it goes through the App
  Store page, which shows "Open" when it's installed (Rentec doesn't publish a link that opens their app).
- **Push reminders.** Air filters, detector tests, insurance renewal: the same reminders as the emails, also as
  push notifications through Firebase Cloud Messaging. Tapping one opens the tenant's page.
- **No signal.** The emergency line, water shutoff and breaker steps ship inside the app (`www/offline.html`).
- **Email links open the app** once `APPLE_TEAM_ID` and `ANDROID_CERT_SHA256` are set on the Worker.

## Files

| Path | What it is |
| --- | --- |
| `capacitor.config.ts` | App ID `vip.firm.app`, name FIRM, the start address, splash and push settings. |
| `www/offline.html` | Shown when there's no connection. |
| `make-icons.mjs`, `assets/` | The FIRM icon and splash, rendered from `../assets/icon.svg`. `npm run icons` regenerates every size. |
| `android/`, `ios/` | The native projects. Edited by hand: camera and photo permission text, push setup, the Rentec app lookup, the notification icon, and the link domains. |
| `../.github/workflows/android-app.yml` | Test APK on every push; signed Play Store bundle on demand. |
| `../.github/workflows/ios-app.yml` | Builds on a GitHub Mac and uploads to TestFlight. No Mac needed. |

## Build

```sh
npm ci
npm run sync          # writes www/start.js, then copies config and plugins into android/ and ios/
npm run android       # opens Android Studio (or let GitHub Actions build it)
npm run ios           # opens Xcode, on a Mac
```

Both builds need the Firebase config files first: `android/app/google-services.json` and
`ios/App/App/GoogleService-Info.plist` (CI writes them from secrets). To try the app against `wrangler dev`, run
`FIRM_APP_URL=http://10.0.2.2:8787 npm run sync` for the Android emulator.

## Before the first store upload

1. Host the Worker at `home.firm.vip` (or change the address in `capacitor.config.ts`, `www`, the Android
   manifest link filter and `ios/App/App/App.entitlements`).
2. Firebase project (free): add an Android app `vip.firm.app` and an iOS app `vip.firm.app`, download the two
   config files into GitHub secrets, upload an APNs key from the Apple Developer account, and create a service
   account key for the Worker's `FCM_SERVICE_ACCOUNT` secret.
3. Set the Worker vars `APPLE_TEAM_ID`, `ANDROID_CERT_SHA256`, `WEBSITE_URL`, and the review sign-in
   (`APP_REVIEW_EMAIL` var, `APP_REVIEW_CODE` secret) for a test tenant in Rentec.
4. Run `npm run db:migrate` for `migrations/0008_app.sql`.
