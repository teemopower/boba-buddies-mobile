# Boba Buddies — Google Play Data Safety form (draft answers)

Source of truth: the mobile privacy policy at
https://teemopower.github.io/boba-buddies/mobile/privacy/
(effective November 23, 2026) and RevenueCat's own Data Safety guidance at
https://www.revenuecat.com/docs/platform-resources/google-platform-resources/google-plays-data-safety

The app itself has no accounts, no servers, no ads, no analytics and no
tracking. All game data (pets, growth stages, meters, coins, shop purchases,
room backgrounds, mute setting) is stored only on the device and is never
transmitted to the developer or any third party. The only data that leaves
the device is purchase-verification data sent to RevenueCat (see below).
Notifications are optional, generated on-device from the player's own game
data; no other permissions are used.

## Section 1 — Data collection and security

**Does your app collect or share any of the required user data types?**
Yes — purchase history, via the RevenueCat SDK (see Section 2).

**Is all of the user data collected by your app encrypted in transit?**
Yes. Purchase-verification data is sent to RevenueCat over encrypted
connections. (RevenueCat's guidance: select 'Yes'.)

**Do you provide a way for users to request that their data be deleted?**
Yes.
- On-device game data: deleting the app erases all game data stored on
  the device; the developer holds no copy, so there is nothing to delete
  on the developer's side.
- Purchase records: held by Google Play and RevenueCat. A user can ask
  for their RevenueCat customer data to be deleted — the developer can
  delete a customer directly from the RevenueCat dashboard or via the
  RevenueCat REST API. Contact: hangrygrogu@gmail.com.

## Section 2 — Data types

Answer every type below. Only the two listed as collected apply; everything
else is not collected and not shared.

### Financial info — Purchase history: COLLECTED, NOT shared
- Collected: Yes. When a player buys or restores a pet, the RevenueCat
  SDK sends the store transaction identifiers needed to verify the
  purchase (transaction ID and product ID) to RevenueCat. No payment
  card details are collected by the app or by RevenueCat — payment
  details go to Google Play Billing only.
- Shared: No. RevenueCat is a service provider processing purchase
  verification on the developer's behalf; it does not receive data for
  its own purposes, and no ad-network attribution integration is enabled.
  (RevenueCat's own guidance: 'Financial Info — RevenueCat collects
  purchase history from users' is the one required disclosure.)
- Purposes: App functionality (verifying purchases and unlocking pets).
- Optional or required: Required — purchases cannot be verified without
  it. It is not linked to a named identity: RevenueCat uses an anonymous
  app user ID (see below).
- Ephemeral: No — purchase records are kept by Google Play / RevenueCat
  so entitlements survive reinstalls.

### Device or other IDs: COLLECTED, NOT shared
- Collected: Yes. With each purchase verification the RevenueCat SDK
  sends an anonymous app user ID (RevenueCat's `$RCAnonymousID`, generated
  on first launch — not tied to any name, email, or account) plus device
  platform and operating-system version, country, locale, and currency.
  The app itself has no accounts and never asks for a name, email, or
  phone number.
- Shared: No — service provider only (same reasoning as above).
- Purposes: App functionality (identifying the anonymous customer so
  purchases and entitlements sync).
- Judgment call, flagged for the submitter: RevenueCat's own Data Safety
  guide lists this category as required only 'if you are using
  integrations that utilize an advertising identifier, like gpsAdId and
  androidId' — this app uses no such integrations. Declaring the
  anonymous app user ID and device metadata here is the conservative
  answer, since the SDK does transmit them. If Play's reviewer questions
  it, the fallback position (per RevenueCat's guide) is to drop this
  row; the Purchase history row is the one RevenueCat marks required.
- Ephemeral: No.

### Everything else: NOT collected, NOT shared
- Location (approximate or precise): No. RevenueCat receives only a
  country/locale/currency code with purchases, not location data.
- Personal info (name, email address, user IDs tied to identity, phone
  number, address): No. The app has no accounts or sign-in and collects
  no contact information. (The anonymous RevenueCat app user ID is
  declared above under Device or other IDs, not here.)
- Health and fitness: No.
- Messages: No.
- Photos and videos: No.
- Audio files: No. Music and sound effects are generated inside the app;
  no audio is recorded or uploaded.
- Files and docs: No.
- Calendar: No.
- Contacts: No.
- App activity (including app interactions): No. No analytics SDK is
  included; the app does not record how the player uses it.
- Web browsing: No.
- App info and performance (crash logs, diagnostics): No. No crash
  reporting or diagnostics SDK is included.

## Notes for the submitter
- The app requests the notifications permission only (optional care
  reminders, generated on-device). Notification permission does not add
  a data type to this form, and no push token leaves the device — the
  app uses local reminders only.
- The app contains in-app purchases (one-time pet purchases). That is
  declared in the store listing and in the IARC questionnaire, not in
  this form beyond the Purchase history row above.
- If Play flags the 'Device or other IDs' row, see the judgment-call note
  above before removing it.
