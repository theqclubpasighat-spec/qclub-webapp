# The Q Club Pasighat — Android TWA

This folder is the Android shell for the Q Club production PWA.

## Architecture

- Android package: `com.theqclubpasighat.qclub`
- Production origin: `https://www.theqclubpasighat.com/`
- UI source of truth: the production website after the V2-to-production merge
- Backend source of truth: the same production APIs and Supabase services used by the website
- Android wrapper: Trusted Web Activity via Android Browser Helper

This deliberately avoids copying the current website UI into a second Android bundle. When the approved V2 UI becomes production, the Android app presents that same production UI and uses the same relative `/api/...` routes.

## Release safety

Do not publish a Play build until all of the following are true:

1. The approved V2 UI is live on the production domain.
2. The production PWA works correctly on phone widths.
3. A Play App Signing certificate SHA-256 fingerprint is available.
4. `https://www.theqclubpasighat.com/.well-known/assetlinks.json` is deployed with that fingerprint and package name `com.theqclubpasighat.qclub`.
5. TWA verification is tested from a Play-installed build.
6. Cashfree, MSG91, login, booking, Q Shop, F&B and public tournament flows are smoke-tested in the Android app.

## Local build

Use Android Studio with Android SDK 36. If a Gradle wrapper is not yet present, generate one with Gradle 9.4 before CI/release packaging.

The Android Browser Helper dependency is pinned to 2.7.3.

## Important

The signing fingerprint is intentionally not committed yet. The website-side Digital Asset Links file must be generated from the real Play signing certificate, not a guessed or temporary fingerprint.
