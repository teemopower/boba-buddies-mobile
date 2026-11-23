/**
 * Pals screen — the 10-pet roster.
 *
 *  - Momo + Kiki are FREE: adopt / switch with setActivePet.
 *  - The 8 paid pets show the price from the RevenueCat offering
 *    (PurchasesStoreProduct.priceString) — NEVER the catalog's target
 *    prices. Buy calls purchasePet() from src/payments/revenuecat.ts;
 *    on success the pet is also recorded in the game store
 *    (markOwnedPet) so the Room can switch to it.
 *  - Adopt All bundle unlocks all 8 paid pets in one purchase.
 *  - Restore Purchases calls restorePurchases().
 *
 * When payments are unconfigured (no RevenueCat key yet) the screen
 * shows the plain-language "payments not set up yet" state from the
 * payments module instead of prices — no buy button that cannot work.
 */
import { useCallback, useEffect } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { audioPlayer } from '../audio/player';
import { PP, ppIsOwned, ppPetById } from '../game/logic';
import { useGameStore } from '../game/store';
import {
  ADOPT_ALL_PRODUCT_ID,
  productForPet,
} from '../payments/catalog';
import {
  UNCONFIGURED_MESSAGE,
  usePaymentsStore,
} from '../payments/revenuecat';
import { COLORS, sharedStyles } from './theme';
import { useToast } from './helpers';
import { PET_IMAGES } from '../components/PetStage';

export default function PalsScreen() {
  const insets = useSafeAreaInsets();
  const save = useGameStore((s) => s.save);
  const setActivePet = useGameStore((s) => s.setActivePet);
  const markOwnedPet = useGameStore((s) => s.markOwnedPet);
  const status = usePaymentsStore((s) => s.status);
  const offering = usePaymentsStore((s) => s.offering);
  const ownedPetIds = usePaymentsStore((s) => s.ownedPetIds);
  const busy = usePaymentsStore((s) => s.busy);
  const lastError = usePaymentsStore((s) => s.lastError);
  const initialize = usePaymentsStore((s) => s.initialize);
  const refresh = usePaymentsStore((s) => s.refresh);
  const purchase = usePaymentsStore((s) => s.purchase);
  const restore = usePaymentsStore((s) => s.restore);
  const { showToast, ToastView } = useToast();

  useFocusEffect(
    useCallback(() => {
      void audioPlayer.setMusicMode('daytime');
      void refresh();
    }, [refresh]),
  );

  useEffect(() => {
    void initialize();
  }, [initialize]);

  // Keep the game store's owned-pets cache in step with RevenueCat
  // (additive only — a failed check never locks a pet).
  useEffect(() => {
    for (const id of ownedPetIds) {
      if (!save.ownedPets.includes(id)) markOwnedPet(id);
    }
  }, [ownedPetIds, markOwnedPet, save.ownedPets]);

  const unconfigured = status === 'unconfigured';

  /** Store price for a catalog product, or null when it isn't for sale yet. */
  const storePrice = (productId: string): string | null => {
    const pkg = offering?.availablePackages.find((p) => p.product.identifier === productId);
    return pkg?.product.priceString ?? null;
  };

  const adopt = (petId: string) => {
    setActivePet(petId);
    showToast(`You adopted ${ppPetById(petId).name}! 🎉`);
    audioPlayer.playSfx('ding');
  };

  const buyPet = async (petId: string) => {
    const product = productForPet(petId as Parameters<typeof productForPet>[0]);
    if (!product) return;
    const result = await purchase(product.productId);
    if (result.ok) {
      markOwnedPet(product.petId);
      showToast('Unlocked! Welcome to the family! 🎉');
      audioPlayer.playSfx('ding');
    } else if (result.reason === 'cancelled') {
      // User backed out of checkout — nothing to say.
    } else if (result.reason === 'unconfigured') {
      showToast(UNCONFIGURED_MESSAGE);
    } else {
      showToast(result.message ?? 'Could not complete the purchase. Please try again. 💳');
      audioPlayer.playSfx('error');
    }
  };

  const buyBundle = async () => {
    const result = await purchase(ADOPT_ALL_PRODUCT_ID);
    if (result.ok) {
      markOwnedPet('adopt-all');
      showToast('Unlocked! Welcome to the family! 🎉');
      audioPlayer.playSfx('ding');
    } else if (result.reason === 'cancelled') {
      // User backed out — nothing to say.
    } else if (result.reason === 'unconfigured') {
      showToast(UNCONFIGURED_MESSAGE);
    } else {
      showToast(result.message ?? 'Could not complete the purchase. Please try again. 💳');
      audioPlayer.playSfx('error');
    }
  };

  const onRestore = async () => {
    const result = await restore();
    if (result.ok) {
      for (const id of result.ownedPetIds) markOwnedPet(id);
      showToast(
        result.ownedPetIds.length > 0
          ? `Restored ${result.ownedPetIds.length} pet${result.ownedPetIds.length > 1 ? 's' : ''}! 🎉`
          : 'No purchases found to restore.',
      );
      audioPlayer.playSfx('ding');
    } else if (result.reason === 'unconfigured') {
      showToast(UNCONFIGURED_MESSAGE);
    } else {
      showToast(result.message ?? 'Could not restore purchases. Please try again. 📧');
      audioPlayer.playSfx('error');
    }
  };

  const allPaidOwned = PP.PETS.filter((p) => p.price > 0).every((p) => ppIsOwned(save, p.id));
  const bundlePrice = storePrice(ADOPT_ALL_PRODUCT_ID);

  return (
    <View style={[sharedStyles.page, { paddingTop: insets.top }]}>
      <View style={sharedStyles.header}>
        <Text style={sharedStyles.brand}>🐾 Pals</Text>
        <Text style={sharedStyles.coins} testID="coins">🪙 {save.coins}</Text>
      </View>
      <ScrollView contentContainerStyle={sharedStyles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={sharedStyles.title}>Choose your pal</Text>
        <Text style={sharedStyles.sub}>
          Momo and Kiki are free. Paid pals are one-time purchases — coins never buy pets.
        </Text>

        {unconfigured ? (
          <View style={styles.notice} testID="payments-unconfigured">
            <Text style={styles.noticeTitle}>💳 Payments not set up yet</Text>
            <Text style={styles.noticeBody}>{UNCONFIGURED_MESSAGE}</Text>
            <Text style={styles.noticeBody}>
              Momo and Kiki are free to adopt right now — paid pals will appear here once payments are ready.
            </Text>
          </View>
        ) : (
          <View style={styles.bundle} testID="bundle-card">
            <Text style={styles.bundleIcon}>🎁</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.bundleName}>Adopt all 8 pets</Text>
              <Text style={styles.bundleDesc}>Every paid pet, one purchase — saves $2.43.</Text>
            </View>
            {allPaidOwned ? (
              <Pressable style={[styles.miniBtn, styles.miniBtnDisabled]} disabled>
                <Text style={styles.miniBtnText}>All adopted ✓</Text>
              </Pressable>
            ) : bundlePrice ? (
              <Pressable
                style={[styles.miniBtn, busy && styles.miniBtnDisabled]}
                disabled={busy}
                onPress={buyBundle}
                testID="buy-bundle"
              >
                <Text style={styles.miniBtnText}>Buy · {bundlePrice}</Text>
              </Pressable>
            ) : (
              <Pressable style={[styles.miniBtn, styles.miniBtnDisabled]} disabled>
                <Text style={styles.miniBtnText}>Not available yet</Text>
              </Pressable>
            )}
          </View>
        )}

        {status === 'error' && lastError && !unconfigured ? (
          <View style={styles.notice}>
            <Text style={styles.noticeBody}>⚠️ {lastError}</Text>
          </View>
        ) : null}

        <View style={styles.grid}>
          {PP.PETS.map((p) => {
            const isActive = p.id === save.activePet;
            const owned = ppIsOwned(save, p.id);
            const free = p.price === 0;
            const product = free ? undefined : productForPet(p.id as Parameters<typeof productForPet>[0]);
            const price = product ? storePrice(product.productId) : null;
            return (
              <View
                key={p.id}
                style={[styles.cell, isActive && styles.cellActive, !owned && styles.cellLocked]}
                testID={`pal-${p.id}`}
              >
                <Image source={PET_IMAGES[p.id] ?? PET_IMAGES.momo} style={styles.petImg} />
                <Text style={styles.pName}>{p.name}</Text>
                <Text style={styles.pBlurb}>{p.blurb}</Text>
                <Text style={[styles.pPrice, !owned && styles.pPriceLocked]}>
                  {free ? 'FREE' : owned ? 'Owned ✓' : price ?? 'Not available yet'}
                </Text>
                {isActive ? (
                  <Pressable style={[styles.miniBtn, styles.miniBtnDisabled]} disabled>
                    <Text style={styles.miniBtnText}>Current pal ✓</Text>
                  </Pressable>
                ) : owned ? (
                  <Pressable style={styles.miniBtn} onPress={() => adopt(p.id)} testID={`adopt-${p.id}`}>
                    <Text style={styles.miniBtnText}>Adopt</Text>
                  </Pressable>
                ) : unconfigured ? (
                  <Pressable style={[styles.miniBtn, styles.miniBtnDisabled]} disabled>
                    <Text style={styles.miniBtnText}>Coming soon</Text>
                  </Pressable>
                ) : price ? (
                  <Pressable
                    style={[styles.miniBtn, busy && styles.miniBtnDisabled]}
                    disabled={busy}
                    onPress={() => buyPet(p.id)}
                    testID={`buy-${p.id}`}
                  >
                    <Text style={styles.miniBtnText}>Buy · {price}</Text>
                  </Pressable>
                ) : (
                  <Pressable style={[styles.miniBtn, styles.miniBtnDisabled]} disabled>
                    <Text style={styles.miniBtnText}>Not available yet</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>

        <View style={styles.foot}>
          <Pressable
            style={[styles.miniBtn, busy && styles.miniBtnDisabled]}
            disabled={busy || unconfigured}
            onPress={onRestore}
            testID="restore-purchases"
          >
            <Text style={styles.miniBtnText}>Restore Purchases</Text>
          </Pressable>
        </View>
        {unconfigured ? (
          <Text style={sharedStyles.hint}>Restore is unavailable until payments are set up.</Text>
        ) : null}
        <Text style={styles.fineprint}>Prices shown are the store prices for your region.</Text>
      </ScrollView>
      {ToastView}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    backgroundColor: '#fff7e0',
    borderWidth: 2,
    borderColor: '#ffd98e',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  noticeTitle: {
    fontWeight: '800',
    color: COLORS.text,
    fontSize: 14,
    marginBottom: 4,
  },
  noticeBody: {
    fontSize: 12,
    color: COLORS.textSoft,
    marginTop: 2,
  },
  bundle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff7e0',
    borderWidth: 2,
    borderColor: '#ffd98e',
    borderRadius: 14,
    padding: 10,
    marginBottom: 10,
  },
  bundleIcon: {
    fontSize: 26,
  },
  bundleName: {
    fontWeight: '800',
    color: COLORS.text,
    fontSize: 14,
  },
  bundleDesc: {
    fontSize: 12,
    color: COLORS.muted,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  cell: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#f3c6d3',
    borderRadius: 14,
    padding: 8,
    alignItems: 'center',
    gap: 3,
  },
  cellActive: {
    borderColor: COLORS.pinkDark,
    backgroundColor: COLORS.pinkSoft,
  },
  cellLocked: {
    opacity: 0.8,
  },
  petImg: {
    width: 84,
    height: 84,
    resizeMode: 'contain',
  },
  pName: {
    fontWeight: '800',
    color: COLORS.text,
    fontSize: 13,
  },
  pBlurb: {
    fontSize: 11,
    color: COLORS.muted,
    textAlign: 'center',
    minHeight: 26,
  },
  pPrice: {
    fontWeight: '800',
    color: COLORS.green,
    fontSize: 12,
  },
  pPriceLocked: {
    color: COLORS.muted,
  },
  miniBtn: {
    borderWidth: 2,
    borderColor: '#f3c6d3',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  miniBtnDisabled: {
    opacity: 0.45,
  },
  miniBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
  foot: {
    alignItems: 'center',
    marginTop: 12,
  },
  fineprint: {
    fontSize: 11,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 8,
  },
});
