/**
 * Boba Buddies — Zustand game store (mobile).
 *
 * Wraps the pure logic in ./logic.ts with AsyncStorage persistence
 * (key 'bobaBuddiesMobile') and the tick engine:
 *  - on load and on AppState foreground: decay + random events + daily
 *    bonuses (like reopening the extension popup);
 *  - while the app is open: a 60s interval applying decay + events and
 *    scheduling one low-meter local reminder when due.
 *
 * Reminders mirror background.js: meter < 25, at most once per meter per
 * 2 hours, quiet hours 22:00–08:00 local, only the most urgent meter
 * per tick. Local notifications only — no push. (expo-notifications
 * SDK 58 API, verified against
 * https://docs.expo.dev/versions/v58.0.0/sdk/notifications/.)
 *
 * ASSUMPTIONS (extension numbers that were ambiguous in the source):
 *  1. Blanket: the extension doubles sleep Energy recovery in popup.js's
 *     5s live tick (+4 per tick instead of +2), not in shared.js decay.
 *     The port instead doubles the decay-path recovery (+20/hr asleep
 *     instead of +10/hr) via ppApplyDecay's `blanket` option, so the
 *     benefit survives the app being closed. The verify script covers
 *     the no-blanket numbers, which match shared.js exactly.
 *  2. The extension's 5s live tick also adds +2 Energy per 5s while
 *     asleep and the popup is open (on top of decay). The port does NOT
 *     replicate that tick — the 60s interval here applies ppApplyDecay,
 *     whose +10/hr asleep is the documented tuning.
 *  3. Medicine gates on the derived mood being 'sick' (popup.js checks
 *     `mood !== 'sick'`), which implies health < 30 AND awake — so
 *     medicine is blocked while asleep, exactly as in the extension.
 *  4. Daily streak / all-green bonuses run on load and on foreground
 *     (like opening the popup), not on the 60s interval tick.
 */

import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  PP,
  ppApplyDailyBonuses,
  ppApplyDecay,
  ppBuyShopItem,
  ppClamp,
  ppDefaultPetState,
  ppDefaultSave,
  ppDeriveMood,
  ppDoBath,
  ppDoDrink,
  ppDoMeal,
  ppDoMedicine,
  ppDoPet,
  ppDoPotty,
  ppDoScold,
  ppDoSleepToggle,
  ppDoSnack,
  ppEquipBackground,
  ppGameReward,
  ppIsOwned,
  ppIsSparkle,
  ppLowMeterAlert,
  ppMarkOwnedPet,
  ppMaybeTriggerEvents,
  ppPetById,
  ppStageIndex,
  ppToggleHat,
} from './logic';
import type { MoodId, Save } from './logic';

export const STORAGE_KEY = 'bobaBuddiesMobile';
const TICK_MS = 60_000;
const NOTIFICATION_CHANNEL_ID = 'boba-buddies';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export interface GameStore {
  save: Save;
  loaded: boolean;
  mood: MoodId;
  stageIndex: number;
  isSparkle: boolean;
  meal(): void;
  snack(): void;
  drink(): void;
  toggleSleep(): void;
  bath(): void;
  medicine(): void;
  potty(): void;
  scold(): void;
  pet(): void;
  buyShopItem(id: string): boolean;
  equipBackground(id: string): void;
  toggleHat(): void;
  setActivePet(id: string): void;
  markOwnedPet(id: string): void;
  refresh(): void;
}

/** The persisted slice — only the save is stored, never derived fields. */
type PersistedGameState = Pick<GameStore, 'save'>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deep-clone a save (plain JSON data only, so stringify/parse is safe). */
function cloneSave(save: Save): Save {
  return JSON.parse(JSON.stringify(save)) as Save;
}

/** Active pet's state, or undefined when the save is somehow pet-less. */
function activeState(save: Save) {
  return save.pets[save.activePet];
}

function derive(save: Save, now: number): { mood: MoodId; stageIndex: number; isSparkle: boolean } {
  const state = activeState(save);
  if (!state) return { mood: 'content', stageIndex: 0, isSparkle: false };
  return {
    mood: ppDeriveMood(state, now),
    stageIndex: ppStageIndex(state, now),
    isSparkle: ppIsSparkle(state, now),
  };
}

/**
 * Forward-compat merge for a stored save (mirrors popup.js init()):
 * missing roster pets get a fresh state, missing fields get defaults,
 * stored values win everywhere else.
 */
function normalizeSave(stored: Save): Save {
  const base = ppDefaultSave(stored.createdAt || Date.now());
  const pets: Record<string, ReturnType<typeof ppDefaultPetState>> = {};
  for (const p of PP.PETS) {
    const d = ppDefaultPetState(stored.createdAt || Date.now());
    const s = stored.pets?.[p.id];
    pets[p.id] = s
      ? { ...d, ...s, meters: { ...d.meters, ...(s.meters || {}) } }
      : d;
  }
  return {
    ...base,
    ...stored,
    shop: { ...base.shop, ...(stored.shop || {}) },
    ownedPets: Array.isArray(stored.ownedPets) ? stored.ownedPets : [],
    pets,
  };
}

// ---------------------------------------------------------------------------
// Tick engine
// ---------------------------------------------------------------------------

let engineStarted = false;
let intervalId: ReturnType<typeof setInterval> | null = null;
let appStateSubscription: { remove(): void } | null = null;

async function ensureNotificationSetup(): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
        name: 'Pet care reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      await Notifications.requestPermissionsAsync();
    }
  } catch {
    // Notifications are best-effort; the game must never break over them.
  }
}

/**
 * One tick: decay + random events on the active pet, optionally the daily
 * bonuses (open/foreground only) and a low-meter reminder.
 */
async function applyTick(opts: { daily: boolean; notify: boolean }): Promise<void> {
  const now = Date.now();
  const { save } = useGameStore.getState();
  const next = cloneSave(save);
  const state = activeState(next);
  if (!state) return;
  ppApplyDecay(state, now, { blanket: next.shop.blanket });
  ppMaybeTriggerEvents(state, now);
  if (opts.daily) ppApplyDailyBonuses(next, now);
  if (opts.notify) {
    const alert = ppLowMeterAlert(state, ppPetById(next.activePet).name, now);
    if (alert) {
      state.notified[alert.meter] = now;
      try {
        await Notifications.scheduleNotificationAsync({
          content: { title: alert.title, body: alert.body, data: { meter: alert.meter } },
          trigger: null,
        });
      } catch {
        // Best-effort; the throttle timestamp is already recorded.
      }
    }
  }
  useGameStore.setState({ save: next, ...derive(next, now) });
}

/**
 * Starts the foreground tick engine (idempotent). Called automatically
 * once the store finishes loading; safe to call again from App code.
 * Applies decay + events + daily bonuses immediately on foreground, then
 * decay + events (+ reminders) every 60s while the app is open.
 */
export function startTickEngine(): void {
  if (engineStarted) return;
  engineStarted = true;
  void ensureNotificationSetup();
  intervalId = setInterval(() => {
    void applyTick({ daily: false, notify: true });
  }, TICK_MS);
  appStateSubscription = AppState.addEventListener('change', (appState) => {
    if (appState === 'active') {
      void applyTick({ daily: true, notify: true });
    }
  });
}

/** Stops the tick engine (tests / hot-reload cleanup). */
export function stopTickEngine(): void {
  engineStarted = false;
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  appStateSubscription?.remove();
  appStateSubscription = null;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const initialSave = ppDefaultSave(Date.now());
const initialNow = Date.now();

export const useGameStore: UseBoundStore<StoreApi<GameStore>> = create<GameStore>()(
  persist(
    (set, get) => {
      /**
       * Run a mutation against a cloned save, then recompute derived
       * fields and persist (via the middleware). `fn` returns false to
       * abort without writing (blocked action, e.g. medicine with no coins).
       */
      const update = (fn: (save: Save, now: number) => boolean | void): boolean => {
        const now = Date.now();
        const next = cloneSave(get().save);
        const result = fn(next, now);
        if (result === false) return false;
        set({ save: next, ...derive(next, now) });
        return true;
      };

      /** Mutation scoped to the active pet's state. */
      const updateActive = (fn: (state: NonNullable<ReturnType<typeof activeState>>, now: number) => boolean | void): boolean =>
        update((save, now) => {
          const state = activeState(save);
          if (!state) return false;
          return fn(state, now);
        });

      return {
        save: initialSave,
        loaded: false,
        ...derive(initialSave, initialNow),

        meal: () => {
          updateActive((state, now) => ppDoMeal(state, now));
        },
        snack: () => {
          updateActive((state, now) => ppDoSnack(state, now));
        },
        drink: () => {
          updateActive((state, now) => ppDoDrink(state, now));
        },
        toggleSleep: () => {
          updateActive((state, now) => ppDoSleepToggle(state, now));
        },
        bath: () => {
          updateActive((state, now) => ppDoBath(state, now));
        },
        medicine: () => {
          update((save, now) => ppDoMedicine(save, now));
        },
        potty: () => {
          update((save, now) => ppDoPotty(save, now));
        },
        scold: () => {
          updateActive((state, now) => ppDoScold(state, now));
        },
        pet: () => {
          updateActive((state, now) => ppDoPet(state, now));
        },

        buyShopItem: (id: string): boolean => {
          let ok = false;
          // update() needs the boolean result, so run the buy inside it.
          update((save, now) => {
            ok = ppBuyShopItem(save, id, now);
            return ok;
          });
          return ok;
        },

        equipBackground: (id: string) => {
          update((save) => ppEquipBackground(save, id));
        },

        toggleHat: () => {
          update((save) => ppToggleHat(save));
        },

        setActivePet: (id: string) => {
          update((save, now) => {
            if (id === save.activePet) return false;
            if (!ppIsOwned(save, id)) return false;
            save.activePet = id;
            const state = activeState(save);
            if (state) ppApplyDecay(state, now, { blanket: save.shop.blanket });
            return true;
          });
        },

        markOwnedPet: (id: string) => {
          update((save) => ppMarkOwnedPet(save, id));
        },

        refresh: () => {
          // Recompute decay + events + derived fields as of now.
          // (No daily bonuses or notifications — those run on load /
          // foreground / interval ticks, not on a manual refresh.)
          update((save, now) => {
            const state = activeState(save);
            if (!state) return false;
            ppApplyDecay(state, now, { blanket: save.shop.blanket });
            ppMaybeTriggerEvents(state, now);
            return true;
          });
        },
      };
    },
    {
      name: STORAGE_KEY,
      version: PP.VERSION,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ save: state.save }),
      merge: (persisted, current) => {
        const stored = (persisted as PersistedGameState | undefined)?.save;
        if (!stored) return current;
        return { ...current, save: normalizeSave(stored) };
      },
      onRehydrateStorage: () => (_rehydrated, _error) => {
        // Opened like the extension popup: decay + daily bonuses, then
        // mark loaded and start the foreground tick engine.
        useGameStore.setState({ loaded: true });
        void applyTick({ daily: true, notify: false }).then(() => {
          startTickEngine();
        });
      },
    },
  ),
);

/**
 * Mini-game reward (popup.js gameReward). Games are NOT in this module —
 * the UI agent builds them and calls this with the result.
 * Blocked when sick or sad (returns null, nothing changes).
 * Win: +15 coins, +12 happiness (+8 more with Star Toy), weight -1,
 * excited for 30s. Lose: +3 coins, +4 happiness.
 */
export function gameReward(won: boolean): { coins: number; happy: number } | null {
  const now = Date.now();
  const next = cloneSave(useGameStore.getState().save);
  const result = ppGameReward(next, won, now);
  if (!result) return null;
  useGameStore.setState({ save: next, ...derive(next, now) });
  return result;
}

/** Re-exported for the UI layer (e.g. showing a clamped meter value). */
export { ppClamp };
