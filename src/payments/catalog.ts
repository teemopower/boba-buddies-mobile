/**
 * Boba Buddies mobile — product catalog for platform-native payments.
 *
 * ExtensionPay does NOT work on mobile, so paid pets are sold through
 * RevenueCat + Google Play Billing (Android first) / Apple IAP (iOS later).
 *
 * ⚠️ PROPOSED PRICES — AWAITING USER APPROVAL. The extension's pet prices
 * ($0.96/$0.97/$0.98) CANNOT be used on mobile: Google Play and the App
 * Store both have a $0.99 minimum, so the cheapest pets move up to $0.99.
 * Do not create store products from this list until the user approves it
 * (see docs/payments.md).
 *
 * Prices below are US launch targets for dashboard setup verification only,
 * NOT checkout prices. The Shop / Pals UI must always display the localized
 * price from the store (PurchasesStoreProduct.priceString), never these.
 *
 * Every product is a one-time, non-consumable purchase. There are no
 * subscriptions. All 9 products attach to the single RevenueCat
 * entitlement "pets" and the default offering.
 */

export const PET_ENTITLEMENT_ID = 'pets';

/** The two free starters — never sold, never in this catalog. */
export const FREE_PET_IDS = ['momo', 'kiki'] as const;

/** The 8 paid pets (one store product each). */
export const PAID_PET_IDS = [
  'boba',
  'yuki',
  'taro',
  'purin',
  'sora',
  'miso',
  'hana',
  'nori',
] as const;

export type PaidPetId = (typeof PAID_PET_IDS)[number];
export type PetId = (typeof FREE_PET_IDS)[number] | PaidPetId;

/** The pet a product unlocks, or 'adopt-all' for the bundle. */
export type ProductPetId = PaidPetId | 'adopt-all';

export type ProductDefinition = {
  /** Store product ID — identical in Google Play, App Store Connect, and RevenueCat. */
  productId: string;
  /** Which pet this unlocks ('adopt-all' unlocks all 8 paid pets). */
  petId: ProductPetId;
  /** Display name shown in the Shop / Pals UI (next to the store price). */
  displayName: string;
  /** Proposed US price in dollars — see the approval warning above. */
  priceUsd: number;
  /** "$0.99" style label for the dashboard checklist only. */
  priceLabel: string;
  /** True only for the bundle. */
  isBundle: boolean;
};

export const ADOPT_ALL_PRODUCT_ID = 'boba_buddies_adopt_all';

export const PRODUCT_CATALOG: readonly ProductDefinition[] = [
  { productId: 'boba_buddies_boba', petId: 'boba', displayName: 'Boba', priceUsd: 0.99, priceLabel: '$0.99', isBundle: false },
  { productId: 'boba_buddies_yuki', petId: 'yuki', displayName: 'Yuki', priceUsd: 0.99, priceLabel: '$0.99', isBundle: false },
  { productId: 'boba_buddies_taro', petId: 'taro', displayName: 'Taro', priceUsd: 1.49, priceLabel: '$1.49', isBundle: false },
  { productId: 'boba_buddies_purin', petId: 'purin', displayName: 'Purin', priceUsd: 0.99, priceLabel: '$0.99', isBundle: false },
  { productId: 'boba_buddies_sora', petId: 'sora', displayName: 'Sora', priceUsd: 1.49, priceLabel: '$1.49', isBundle: false },
  { productId: 'boba_buddies_miso', petId: 'miso', displayName: 'Miso', priceUsd: 1.49, priceLabel: '$1.49', isBundle: false },
  { productId: 'boba_buddies_hana', petId: 'hana', displayName: 'Hana', priceUsd: 1.99, priceLabel: '$1.99', isBundle: false },
  { productId: 'boba_buddies_nori', petId: 'nori', displayName: 'Nori', priceUsd: 0.99, priceLabel: '$0.99', isBundle: false },
  { productId: ADOPT_ALL_PRODUCT_ID, petId: 'adopt-all', displayName: 'Adopt All', priceUsd: 7.99, priceLabel: '$7.99', isBundle: true },
] as const;

const BY_PRODUCT_ID = new Map(PRODUCT_CATALOG.map((p) => [p.productId, p]));
const BY_PET_ID = new Map(PRODUCT_CATALOG.map((p) => [p.petId, p]));

export function productById(productId: string): ProductDefinition | undefined {
  return BY_PRODUCT_ID.get(productId);
}

export function productForPet(petId: ProductPetId): ProductDefinition | undefined {
  return BY_PET_ID.get(petId);
}

export function isPaidPetId(petId: string): petId is PaidPetId {
  return (PAID_PET_IDS as readonly string[]).includes(petId);
}

export function isKnownProductId(productId: string): boolean {
  return BY_PRODUCT_ID.has(productId);
}

/**
 * Map purchased store product IDs to the paid pet IDs they unlock.
 * The adopt-all bundle expands to all 8 paid pets. Unknown IDs are
 * ignored — a stray product must never unlock a pet it doesn't map to.
 */
export function petIdsForPurchasedProductIds(purchasedProductIds: readonly string[]): PaidPetId[] {
  const unlocked = new Set<PaidPetId>();
  for (const productId of purchasedProductIds) {
    const product = BY_PRODUCT_ID.get(productId);
    if (!product) continue;
    if (product.isBundle) {
      for (const petId of PAID_PET_IDS) unlocked.add(petId);
    } else {
      unlocked.add(product.petId as PaidPetId);
    }
  }
  // Keep roster order (Boba, Yuki, Taro, Purin, Sora, Miso, Hana, Nori).
  return PAID_PET_IDS.filter((petId) => unlocked.has(petId));
}
