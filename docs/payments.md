# Boba Buddies mobile — Payments

Platform-native payments via **RevenueCat + Google Play Billing** (Android
first) / **Apple IAP** (iOS later). ExtensionPay does **not** work on mobile.

Status: **NOT SET UP YET.** No RevenueCat project exists, no Google Play
app exists, and none of the 9 store products below exist. Until the
dashboard checklist is done and the key is set, `src/payments/` reports
`unconfigured` and the Shop / Pals UI must show "payments are not set up
yet" — no purchase can be made.

Code lives in `src/payments/`:

- `catalog.ts` — the 9-product catalog (IDs, pets, proposed prices).
- `revenuecat.ts` — the RevenueCat wrapper (configure / offerings /
  purchase / restore / owned pets) plus the `usePaymentsStore` zustand
  store the Pals tab subscribes to. Mirrors Punchslate's
  `src/services/purchases/` pattern.

## Proposed mobile price list — ⚠️ AWAITING USER APPROVAL

Do **not** create any store products from this table until the user
approves it. The extension's prices ($0.96 / $0.97 / $0.98) **cannot** be
used on mobile — Google Play and the App Store both have a **$0.99
minimum**, so the three cheapest pets move up to $0.99. All products are
one-time, non-consumable; there are no subscriptions. Every product
attaches to the single RevenueCat entitlement **`pets`** and the default
offering.

| Store product ID | Pet | Proposed price (USD) | Extension price (for reference) |
|---|---|---|---|
| `boba_buddies_boba` | Boba | $0.99 | $0.98 |
| `boba_buddies_yuki` | Yuki | $0.99 | $0.99 |
| `boba_buddies_taro` | Taro | $1.49 | $1.49 |
| `boba_buddies_purin` | Purin | $0.99 | $0.97 |
| `boba_buddies_sora` | Sora | $1.49 | $1.48 |
| `boba_buddies_miso` | Miso | $1.49 | $1.47 |
| `boba_buddies_hana` | Hana | $1.99 | $1.99 |
| `boba_buddies_nori` | Nori | $0.99 | $0.96 |
| `boba_buddies_adopt_all` | Adopt All (all 8 paid pets) | $7.99 | $7.99 |

Free starters Momo and Kiki are never sold and have no store product.

## Dashboard checklist (parent agent — run in the browser AFTER approval)

Prerequisites: signed in as jimmykim925@gmail.com; a RevenueCat account
and a Google Play developer account. Nothing below is done in code.

### 1. Create the RevenueCat project

1. Go to https://app.revenuecat.com and sign in.
2. Create a new project named **Boba Buddies**.
3. Note the project's public SDK keys (Dashboard → Project settings →
   API keys): one **Google Play** key (`goog_…`) and one **Apple App Store**
   key (`appl_…`). The Android key is needed now; the iOS key comes with
   the iOS phase.

### 2. Create the Google Play Console app

The Play app does **not** exist yet.

1. Go to Google Play Console → Create app.
2. App name: **Boba Buddies**.
3. Package name (must match `app.json` exactly):
   `com.adaptationapps.bobabuddies`
4. App type: App; Free; (declarations as prompted). Do **not** submit the
   app for review in this step — just create it so in-app products can be
   added. Uploading the AAB / submitting the listing is a separate,
   user-approved step (see `codemagic.yaml`).

### 3. Link Google Play to RevenueCat

1. In Play Console, create a Google Cloud service account with Play
   Billing access and download its JSON key (Play Console → Setup →
   API access), following RevenueCat's "Google Play" setup docs.
2. In the RevenueCat project → Apps → Add app → Google Play, enter the
   package name `com.adaptationapps.bobabuddies` and upload the
   service-account JSON key.

### 4. Create the 9 Google Play one-time products

In Play Console → the Boba Buddies app → Monetize → In-app products →
Create product, one per row (type: **one-time product**, not a
subscription). Use the exact IDs and US prices from the table above:

| Product ID | Price (USD) |
|---|---|
| `boba_buddies_boba` | $0.99 |
| `boba_buddies_yuki` | $0.99 |
| `boba_buddies_taro` | $1.49 |
| `boba_buddies_purin` | $0.99 |
| `boba_buddies_sora` | $1.49 |
| `boba_buddies_miso` | $1.49 |
| `boba_buddies_hana` | $1.99 |
| `boba_buddies_nori` | $0.99 |
| `boba_buddies_adopt_all` | $7.99 |

Give each product a user-facing name matching the pet (e.g. "Boba",
"Adopt All") and a short description. Set each product to **Active**.
(Play prices are set per currency; set at least USD — the app displays
the store's localized price at checkout.)

### 5. Import the products into RevenueCat

1. In the RevenueCat project → Products, import/sync the 9 products from
   Google Play (they appear after the Play sync; create them manually in
   RevenueCat with the same IDs if sync hasn't picked them up).
2. Create the entitlement **`pets`** (Entitlements → New).
3. Attach all 9 products to the `pets` entitlement.
4. Add all 9 products to the **default offering** (Offerings → Default):
   each product as its own package (one-time purchase type).
5. Verify in RevenueCat that the offering lists all 9 products and the
   `pets` entitlement shows them.

### 6. Set the Android key in Codemagic

**Codemagic does not read `eas.json`.** Set it as a Codemagic environment
variable:

1. Codemagic → Boba Buddies app → Environment variables.
2. Add `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` = the `goog_…` public SDK key
   from step 1. Mark it **secure**.
3. Re-run the `android-production-aab` workflow so the key is baked into
   the build at build time (Expo `EXPO_PUBLIC_*` vars are inlined at
   build time — changing the variable alone does not update existing
   builds).

### 7. Verify (after a build with the key)

1. Install the new build on an Android device with a Play test account.
2. Open the Shop / Pals tab: the "payments unconfigured" state must be
   gone and the 9 products must list with store prices.
3. Buy the cheapest pet in Play's license-tester sandbox, confirm the pet
   unlocks in the Pals tab, then refund it from Play Console.
4. Tap Restore Purchases on a fresh install and confirm the pet returns.

## iOS — deferred

Do not do any of this until the iOS phase (Android first):

- Create the App Store Connect app (bundle ID
  `com.adaptationapps.bobabuddies`, already in `app.json`).
- Create the same 9 non-consumable IAP products with the same IDs and
  prices in App Store Connect.
- In RevenueCat, add the iOS app, upload the App Store Connect In-App
  Purchase Key (.p8), and import the 9 products into the same `pets`
  entitlement + default offering.
- Set `EXPO_PUBLIC_REVENUECAT_IOS_KEY` (the `appl_…` key) as a Codemagic
  environment variable the same way as step 6.
- The code already reads the iOS key on iOS
  (`EXPO_PUBLIC_REVENUECAT_IOS_KEY`); no code change is needed.
