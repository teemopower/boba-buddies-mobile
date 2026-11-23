/**
 * Boba Buddies mobile — shared UI theme for the screens.
 *
 * Colors are the extension's pink look (popup.css): soft pastel
 * pink/cream, kawaii. Room backgrounds change with the equipped shop
 * theme (Sunny Garden / Cozy Night / default pink).
 */
import { StyleSheet } from 'react-native';
import type { MeterKey } from '../game/logic';

export const COLORS = {
  bg: '#fff7f2',
  surface: '#ffffff',
  cardBorder: '#f6d9e2',
  pink: '#f9c6d8',
  pinkDark: '#e89bb4',
  pinkSoft: '#ffeef3',
  text: '#7c3f4d',
  textSoft: '#8a5a5a',
  muted: '#b08989',
  brand: '#a44a5e',
  coinBorder: '#ffd98e',
  coinText: '#8a6d1a',
  green: '#2e7d4f',
  red: '#c0392b',
  gardenBg: '#dff3d8',
  gardenFloor: '#a9d18e',
  nightBg: '#2b2b4a',
  nightSurface: '#3d3a5e',
  nightText: '#ffe9f0',
} as const;

export const METER_DEFS: { key: MeterKey; label: string; icon: string; color: string }[] = [
  { key: 'hunger', label: 'Hunger', icon: '🍡', color: '#f5a623' },
  { key: 'thirst', label: 'Thirst', icon: '🧋', color: '#4aa8e0' },
  { key: 'energy', label: 'Energy', icon: '⚡', color: '#f7c948' },
  { key: 'happiness', label: 'Happy', icon: '💗', color: '#ef6a9e' },
  { key: 'cleanliness', label: 'Clean', icon: '🧼', color: '#7bc8a4' },
  { key: 'health', label: 'Health', icon: '❤️', color: '#e74c3c' },
];

/** Room background for the equipped shop theme (null = default pink). */
export function roomBackground(bg: string | null): { bg: string; floor: string; dark: boolean } {
  if (bg === 'garden') return { bg: '#dff3d8', floor: '#a9d18e', dark: false };
  if (bg === 'night') return { bg: '#2b2b4a', floor: '#3a3a5e', dark: true };
  return { bg: '#ffeef3', floor: '#ffd9c9', dark: false };
}

export const sharedStyles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
  },
  brand: {
    fontSize: 19,
    fontWeight: '800',
    color: COLORS.brand,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconBtn: {
    borderWidth: 2,
    borderColor: '#f3c6d3',
    backgroundColor: '#fff',
    borderRadius: 999,
    minWidth: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  iconBtnText: {
    fontSize: 16,
  },
  coins: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: COLORS.coinBorder,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontWeight: '700',
    color: COLORS.coinText,
    fontSize: 13,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.text,
  },
  sub: {
    fontSize: 12,
    color: COLORS.muted,
    marginTop: 2,
    marginBottom: 10,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 2,
    borderColor: COLORS.cardBorder,
    borderRadius: 18,
    padding: 10,
  },
  hint: {
    fontSize: 12,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: 8,
  },
  toast: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 90,
    alignItems: 'center',
    pointerEvents: 'none',
  },
  toastBubble: {
    backgroundColor: COLORS.text,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    maxWidth: '92%',
  },
  toastText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
});
