/**
 * Shop screen — the 7 shop items from logic.ts SHOP, with the
 * extension's exact behavior (popup.js renderShop buy handler):
 *
 *  - Pink Bow 40: buy, then Wear / Take off (hat shows on the pet).
 *  - Star Toy 25: passive, +8 happiness on a game win.
 *  - Boba Tea 10: consumable, +40 thirst / +8 happy; jumps to the Room
 *    so the pet is seen sipping it.
 *  - Cozy Blanket 60: passive, sleep energy recovery doubled.
 *  - Treat Jar 15: consumable, +30 hunger / +10 happy; jumps to the Room.
 *  - Sunny Garden 60 / Cozy Night 60: room backgrounds, Buy then
 *    Equip / Equipped.
 *
 * Buy is disabled when coins are insufficient; consumables are
 * re-buyable; durables already owned show Owned ✓.
 */
import { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { audioPlayer } from '../audio/player';
import { PP } from '../game/logic';
import type { ShopItem } from '../game/logic';
import { useGameStore } from '../game/store';
import { COLORS, sharedStyles } from './theme';
import { useToast } from './helpers';
import type { TabParamList } from '../navigation/AppNavigator';

export default function ShopScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<BottomTabNavigationProp<TabParamList>>();
  const save = useGameStore((s) => s.save);
  const buyShopItem = useGameStore((s) => s.buyShopItem);
  const equipBackground = useGameStore((s) => s.equipBackground);
  const toggleHat = useGameStore((s) => s.toggleHat);
  const { showToast, ToastView } = useToast();

  useFocusEffect(
    useCallback(() => {
      void audioPlayer.setMusicMode('daytime');
    }, []),
  );

  const buy = (item: ShopItem) => {
    // Bow already owned toggles the hat instead of buying.
    if (item.id === 'bow' && save.shop.owned.includes('bow')) {
      toggleHat();
      const hatOn = useGameStore.getState().save.pets[save.activePet]?.hatOn;
      showToast(hatOn ? 'Looking cute! 🎀' : 'Bow off. 🎀');
      audioPlayer.playSfx('button');
      return;
    }
    if (save.coins < item.price) {
      showToast('Not enough coins — win a game! 🪙');
      audioPlayer.playSfx('error');
      return;
    }
    const ok = buyShopItem(item.id);
    if (!ok) {
      showToast('Not enough coins — win a game! 🪙');
      audioPlayer.playSfx('error');
      return;
    }
    if (item.kind === 'drink') {
      showToast('Slurp! Boba tea! 🧋 +40 Thirst');
      audioPlayer.playSfx('ding');
      setTimeout(() => audioPlayer.playSfx('slurp'), 250);
      navigation.navigate('Room');
      return;
    }
    if (item.kind === 'food') {
      showToast('Crunch! Treats! 🍪 +30 Hunger');
      audioPlayer.playSfx('ding');
      setTimeout(() => audioPlayer.playSfx('chew'), 250);
      navigation.navigate('Room');
      return;
    }
    audioPlayer.playSfx('ding');
    if (item.id === 'bow') showToast('Pink Bow bought + worn! 🎀');
    else if (item.id === 'starToy') showToast('Star Toy! Playing earns more happiness. ⭐');
    else if (item.id === 'blanket') showToast('Cozy Blanket! Sleep heals faster. 🛏️');
    else if (item.kind === 'bg') showToast(`${item.name} bought + equipped! ${item.icon}`);
    else showToast(`${item.name} bought! 🎉`);
  };

  const equip = (item: ShopItem) => {
    equipBackground(item.id);
    showToast(`Room theme changed! ${item.id === 'garden' ? '🌸' : '🌙'}`);
    audioPlayer.playSfx('ding');
  };

  const renderButton = (item: ShopItem) => {
    const owned = save.shop.owned.includes(item.id);
    const state = save.pets[save.activePet];
    const cantAfford = save.coins < item.price;
    if (item.id === 'bow' && owned) {
      return (
        <Pressable style={styles.miniBtn} onPress={() => buy(item)} testID="shop-bow-toggle">
          <Text style={styles.miniBtnText}>{state?.hatOn ? 'Take off' : 'Wear 🎀'}</Text>
        </Pressable>
      );
    }
    if (item.kind === 'drink' || item.kind === 'food') {
      return (
        <Pressable
          style={[styles.miniBtn, cantAfford && styles.miniBtnDisabled]}
          disabled={cantAfford}
          onPress={() => buy(item)}
          testID={`shop-buy-${item.id}`}
        >
          <Text style={styles.miniBtnText}>Buy · {item.price} 🪙</Text>
        </Pressable>
      );
    }
    if (item.kind === 'bg') {
      if (owned) {
        const equipped = save.shop.bg === item.id;
        return equipped ? (
          <Pressable style={[styles.miniBtn, styles.miniBtnDisabled]} disabled>
            <Text style={styles.miniBtnText}>Equipped ✓</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.miniBtn} onPress={() => equip(item)} testID={`shop-equip-${item.id}`}>
            <Text style={styles.miniBtnText}>Equip</Text>
          </Pressable>
        );
      }
      return (
        <Pressable
          style={[styles.miniBtn, cantAfford && styles.miniBtnDisabled]}
          disabled={cantAfford}
          onPress={() => buy(item)}
          testID={`shop-buy-${item.id}`}
        >
          <Text style={styles.miniBtnText}>Buy · {item.price} 🪙</Text>
        </Pressable>
      );
    }
    if (owned) {
      return (
        <Pressable style={[styles.miniBtn, styles.miniBtnDisabled]} disabled>
          <Text style={styles.miniBtnText}>Owned ✓</Text>
        </Pressable>
      );
    }
    return (
      <Pressable
        style={[styles.miniBtn, cantAfford && styles.miniBtnDisabled]}
        disabled={cantAfford}
        onPress={() => buy(item)}
        testID={`shop-buy-${item.id}`}
      >
        <Text style={styles.miniBtnText}>Buy · {item.price} 🪙</Text>
      </Pressable>
    );
  };

  return (
    <View style={[sharedStyles.page, { paddingTop: insets.top }]}>
      <View style={sharedStyles.header}>
        <Text style={sharedStyles.brand}>🛍️ Shop</Text>
        <Text style={sharedStyles.coins} testID="coins">🪙 {save.coins}</Text>
      </View>
      <ScrollView contentContainerStyle={sharedStyles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={sharedStyles.title}>Treats, toys &amp; themes</Text>
        <Text style={sharedStyles.sub}>Win mini-games to earn coins. Food and drinks are re-buyable — enjoy!</Text>
        <View style={styles.list}>
          {PP.SHOP.map((item) => (
            <View key={item.id} style={styles.item} testID={`shop-item-${item.id}`}>
              <Text style={styles.icon}>{item.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.desc}>{item.desc}</Text>
              </View>
              {renderButton(item)}
            </View>
          ))}
        </View>
        <Text style={sharedStyles.hint}>Pets are real-money purchases — find them on the Pals tab. 🐾</Text>
      </ScrollView>
      {ToastView}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#f3c6d3',
    borderRadius: 14,
    padding: 10,
    minHeight: 64,
  },
  icon: {
    fontSize: 26,
  },
  name: {
    fontWeight: '800',
    color: COLORS.text,
    fontSize: 14,
  },
  desc: {
    fontSize: 12,
    color: COLORS.muted,
    marginTop: 1,
  },
  miniBtn: {
    borderWidth: 2,
    borderColor: '#f3c6d3',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
});
