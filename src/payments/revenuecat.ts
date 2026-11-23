/**
 * Boba Buddies mobile — RevenueCat wrapper (react-native-purchases v11).
 *
 * Mirrors the working Punchslate pattern in
 * ~/workspace/apps/punchslate/src/services/purchases/:
 *   - Purchases.configure({ apiKey }) once, with the platform public key
 *     from EXPO_PUBLIC_REVENUECAT_ANDROID_KEY (Android) /
 *     EXPO_PUBLIC_REVENUECAT_IOS_KEY (iOS).
 *   - Purchases.addCustomerInfoUpdateListener so the Pals tab re-renders
 *     when a purchase, restore, or renewal lands.
 *   - Entitlement state is never persisted locally: it always comes from
 *     RevenueCat (CustomerInfo) via getOwnedPetIds() / the store below.
 *
 * UNCONFIGURED STATE: no RevenueCat project and no store products exist
 * yet (see docs/payments.md), so until the dashboard steps are done and
 * the key is set as a Codemagic environment variable, every function here
 * reports "payments unconfigured" as a value instead of crashing or
 * throwing. The UI must show that state; no purchase can be made yet.
 *
 * All functions catch their own errors and return values — nothing in
 * this module ever throws to the UI.
 */
import { Platform } from 'react-native';
import Purchases, {
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesStoreProduct,
} from 'react-native-purchases';
import { create } from 'zustand';
import {
  PET_ENTITLEMENT_ID,
  isKnownProductId,
  petIdsForPurchasedProductIds,
  productById,
  type PaidPetId,
} from './catalog';

export type PaymentsStatus = 'initializing' | 'ready' | 'unconfigured' | 'error';

export type PurchasePetResult =
  | { ok: true; productId: string }
  | {
      ok: false;
      reason: 'cancelled' | 'unconfigured' | 'error';
      message?: string;
    };

export type RestoreResult =
  | { ok: true; ownedPetIds: PaidPetId[] }
  | {
      ok: false;
      reason: 'unconfigured' | 'error';
      message?: string;
    };

export type ConfigureResult =
  | { ok: true }
  | { ok: false; reason: 'unconfigured' | 'error'; message?: string };

export const UNCONFIGURED_MESSAGE =
  'Payments are not set up yet — the RevenueCat project and store products still need to be created (see docs/payments.md).';

let sdkConfigured = false;
let configurePromise: Promise<ConfigureResult> | null = null;
let refreshPromise: Promise<PaidPetId[]> | null = null;

function currentPublicKey(): string | null {
  if (Platform.OS === 'ios') {
    return process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY?.trim() || null;
  }
  if (Platform.OS === 'android') {
    return process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY?.trim() || null;
  }
  // Web / other platforms have no store billing.
  return null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim()
  ) {
    return error.message;
  }
  return 'Something went wrong. Please try again or use Restore Purchases.';
}

function isUserCancelled(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'userCancelled' in error &&
    error.userCancelled === true
  );
}

/** The single source of truth for owned pets: RevenueCat CustomerInfo. */
function ownedPetIdsFromCustomerInfo(info: CustomerInfo): PaidPetId[] {
  return petIdsForPurchasedProductIds(info.allPurchasedProductIdentifiers);
}

/** True when the "pets" entitlement is active (adopt-all or any pet). */
export function hasPetsEntitlement(info: Pick<CustomerInfo, 'entitlements'>): boolean {
  return info.entitlements.active[PET_ENTITLEMENT_ID] !== undefined;
}

/** True once Purchases.configure has succeeded with a real key. */
export function isConfigured(): boolean {
  return sdkConfigured;
}

function applyCustomerInfo(info: CustomerInfo): void {
  usePaymentsStore.setState({
    ownedPetIds: ownedPetIdsFromCustomerInfo(info),
    hasPetsEntitlement: hasPetsEntitlement(info),
  });
}

/**
 * Configure the RevenueCat SDK. Safe to call repeatedly — only the first
 * call with a key configures the SDK; later calls are no-ops.
 * Pass an explicit key to override the EXPO_PUBLIC_REVENUECAT_* env var
 * (useful in tests); otherwise the key comes from the env var for the
 * current platform, exactly like Punchslate.
 */
export async function configure(apiKey?: string): Promise<ConfigureResult> {
  if (sdkConfigured) return { ok: true };
  if (configurePromise) return configurePromise;
  configurePromise = (async () => {
    const key = apiKey?.trim() || currentPublicKey();
    if (!key) {
      usePaymentsStore.setState({
        status: 'unconfigured',
        lastError: UNCONFIGURED_MESSAGE,
      });
      return { ok: false, reason: 'unconfigured', message: UNCONFIGURED_MESSAGE } as const;
    }
    usePaymentsStore.setState({ status: 'initializing', lastError: null });
    try {
      Purchases.configure({ apiKey: key });
      // Listener keeps the Pals tab fresh after any purchase/restore,
      // including ones completed outside this flow.
      Purchases.addCustomerInfoUpdateListener(applyCustomerInfo);
      sdkConfigured = true;
      // A missing offering must never prevent valid buyers being unlocked.
      const [info, offering] = await Promise.allSettled([
        Purchases.getCustomerInfo(),
        Purchases.getOfferings(),
      ]);
      if (info.status === 'fulfilled') applyCustomerInfo(info.value);
      const firstError = [info, offering].find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      usePaymentsStore.setState({
        status: 'ready',
        offering:
          offering.status === 'fulfilled' ? (offering.value.current ?? null) : null,
        lastError: firstError ? errorMessage(firstError.reason) : null,
      });
      return { ok: true } as const;
    } catch (error) {
      const message = errorMessage(error);
      usePaymentsStore.setState({ status: 'error', lastError: message });
      return { ok: false, reason: 'error', message } as const;
    }
  })();
  try {
    return await configurePromise;
  } finally {
    configurePromise = null;
  }
}

/**
 * The current RevenueCat offering (default offering, "pets" entitlement),
 * or null when unconfigured / no offering exists yet. Never throws.
 * The Shop UI should render store prices from the offering's packages
 * (PurchasesStoreProduct.priceString), never the catalog's target prices.
 */
export async function getOfferings(): Promise<PurchasesOffering | null> {
  if (!sdkConfigured) {
    const result = await configure();
    if (!result.ok) return null;
  }
  try {
    const offerings = await Purchases.getOfferings();
    const current = offerings.current ?? null;
    usePaymentsStore.setState({ offering: current });
    return current;
  } catch (error) {
    usePaymentsStore.setState({ lastError: errorMessage(error) });
    return null;
  }
}

/**
 * Fetch the store product for one catalog product ID, or null when it
 * does not exist in the store yet / cannot be fetched. Never throws.
 */
export async function getStoreProduct(
  productId: string,
): Promise<PurchasesStoreProduct | null> {
  if (!sdkConfigured) {
    const result = await configure();
    if (!result.ok) return null;
  }
  try {
    // One-time, non-consumable products (not subscriptions).
    const products = await Purchases.getProducts(
      [productId],
      Purchases.PRODUCT_CATEGORY.NON_SUBSCRIPTION,
    );
    return products[0] ?? null;
  } catch (error) {
    usePaymentsStore.setState({ lastError: errorMessage(error) });
    return null;
  }
}

/**
 * Buy one pet (or the adopt-all bundle) by store product ID.
 * Returns a value for every outcome — cancelled, unconfigured, error —
 * and never throws. On success the payments store (and therefore the
 * Pals tab) is updated from the returned CustomerInfo.
 *
 * NOTE: no real purchase can be tested yet — the 9 store products do not
 * exist in Google Play / RevenueCat until the dashboard steps in
 * docs/payments.md are done, so getStoreProduct() returns null until then
 * and this returns { ok: false, reason: 'error', ... }.
 */
export async function purchasePet(productId: string): Promise<PurchasePetResult> {
  if (!isKnownProductId(productId)) {
    return { ok: false, reason: 'error', message: `Unknown product: ${productId}.` };
  }
  if (usePaymentsStore.getState().busy) {
    return { ok: false, reason: 'error', message: 'A purchase is already in progress.' };
  }
  if (!sdkConfigured) {
    const result = await configure();
    if (!result.ok) {
      return {
        ok: false,
        reason: 'unconfigured',
        message: result.message ?? UNCONFIGURED_MESSAGE,
      };
    }
  }
  const product = await getStoreProduct(productId);
  if (!product) {
    return {
      ok: false,
      reason: 'error',
      message: `“${productById(productId)?.displayName ?? productId}” is not available in the store yet.`,
    };
  }
  usePaymentsStore.setState({ busy: true, lastError: null });
  try {
    // purchaseStoreProduct (not the deprecated purchaseProduct): the
    // non-consumable is bought by product, then verified by RevenueCat.
    const result = await Purchases.purchaseStoreProduct(product);
    applyCustomerInfo(result.customerInfo);
    const owned = ownedPetIdsFromCustomerInfo(result.customerInfo);
    const bought = productById(productId);
    const unlocked =
      bought?.isBundle === true
        ? owned.length > 0
        : bought !== undefined && owned.includes(bought.petId as PaidPetId);
    if (!unlocked) {
      // Pending/deferred transactions don't grant access until verified.
      return {
        ok: false,
        reason: 'error',
        message: 'The purchase is still pending verification. Check back shortly or use Restore Purchases.',
      };
    }
    return { ok: true, productId };
  } catch (error) {
    if (isUserCancelled(error)) return { ok: false, reason: 'cancelled' };
    const message = errorMessage(error);
    usePaymentsStore.setState({ lastError: message });
    return { ok: false, reason: 'error', message };
  } finally {
    usePaymentsStore.setState({ busy: false });
  }
}

/**
 * Restore previously purchased pets. Only call after an explicit tap of
 * "Restore Purchases". Returns the owned pet IDs (adopt-all expands to
 * all 8 paid pets). Never throws.
 */
export async function restorePurchases(): Promise<RestoreResult> {
  if (usePaymentsStore.getState().busy) {
    return { ok: false, reason: 'error', message: 'A purchase or restore is already in progress.' };
  }
  if (!sdkConfigured) {
    const result = await configure();
    if (!result.ok) {
      return {
        ok: false,
        reason: 'unconfigured',
        message: result.message ?? UNCONFIGURED_MESSAGE,
      };
    }
  }
  usePaymentsStore.setState({ busy: true, lastError: null });
  try {
    const info = await Purchases.restorePurchases();
    applyCustomerInfo(info);
    return { ok: true, ownedPetIds: ownedPetIdsFromCustomerInfo(info) };
  } catch (error) {
    if (isUserCancelled(error)) {
      // Restores are not user-cancellable on Android; treat as an error.
      return { ok: false, reason: 'error', message: errorMessage(error) };
    }
    const message = errorMessage(error);
    usePaymentsStore.setState({ lastError: message });
    return { ok: false, reason: 'error', message };
  } finally {
    usePaymentsStore.setState({ busy: false });
  }
}

/**
 * The paid pet IDs this user owns, derived from
 * CustomerInfo.allPurchasedProductIdentifiers (adopt-all maps to all 8
 * paid pets). Returns [] when unconfigured or when nothing is owned.
 * Never throws.
 */
export async function getOwnedPetIds(): Promise<PaidPetId[]> {
  if (!sdkConfigured) {
    const result = await configure();
    if (!result.ok) return [];
  }
  try {
    const info = await Purchases.getCustomerInfo();
    const owned = ownedPetIdsFromCustomerInfo(info);
    usePaymentsStore.setState({ ownedPetIds: owned });
    return owned;
  } catch (error) {
    usePaymentsStore.setState({ lastError: errorMessage(error) });
    return [];
  }
}

/**
 * Re-fetch CustomerInfo + the current offering and push the result into
 * the store, so the Pals tab re-renders. Call after app foreground /
 * after a purchase flow returns. Never throws.
 */
export async function refreshOwnedPets(): Promise<PaidPetId[]> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    if (!sdkConfigured) {
      const result = await configure();
      if (!result.ok) return [];
    }
    const [info, offering] = await Promise.allSettled([
      Purchases.getCustomerInfo(),
      Purchases.getOfferings(),
    ]);
    if (info.status === 'fulfilled') {
      applyCustomerInfo(info.value);
      return ownedPetIdsFromCustomerInfo(info.value);
    }
    usePaymentsStore.setState({ lastError: errorMessage(info.reason) });
    if (offering.status === 'fulfilled') {
      usePaymentsStore.setState({ offering: offering.value.current ?? null });
    }
    return usePaymentsStore.getState().ownedPetIds;
  })();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

type PaymentsState = {
  status: PaymentsStatus;
  /** Paid pet IDs owned by this user (adopt-all expands to all 8). */
  ownedPetIds: PaidPetId[];
  /** Whether the "pets" entitlement is active. */
  hasPetsEntitlement: boolean;
  /** Current RevenueCat offering, or null when unconfigured / none yet. */
  offering: PurchasesOffering | null;
  busy: boolean;
  lastError: string | null;
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  purchase: (productId: string) => Promise<PurchasePetResult>;
  restore: () => Promise<RestoreResult>;
};

/**
 * Zustand store for the Shop / Pals UI. Subscribe to `ownedPetIds` (or
 * `status`) and the tab re-renders automatically after a purchase,
 * restore, or CustomerInfo update from the RevenueCat listener.
 *
 * Never persist ownedPetIds in AsyncStorage: entitlement state comes
 * from RevenueCat on every launch.
 */
export const usePaymentsStore = create<PaymentsState>((set, get) => ({
  status: 'initializing',
  ownedPetIds: [],
  hasPetsEntitlement: false,
  offering: null,
  busy: false,
  lastError: null,

  initialize: async () => {
    await configure();
  },

  refresh: async () => {
    await refreshOwnedPets();
  },

  purchase: async (productId) => purchasePet(productId),

  restore: async () => restorePurchases(),
}));

/** Convenience for the Pals tab: the owned pet IDs, reactively. */
export function useOwnedPetIds(): PaidPetId[] {
  return usePaymentsStore((state) => state.ownedPetIds);
}
