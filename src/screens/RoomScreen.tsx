/**
 * Room screen — the pet's home. Portrait-first, safe-area aware.
 *
 * Copy, button rules and hints are the extension's (popup.js render()):
 *  - no actions while sleeping except Wake;
 *  - Medicine only when sick (and 10 coins);
 *  - Scold only during a tantrum (button hidden otherwise);
 *  - Potty is highlighted while a potty need is pending.
 * Tapping the pet gives it a pat (+2 happiness, blocked while asleep).
 *
 * Music: daytime, or lullaby while the pet sleeps.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import PetStage from '../components/PetStage';
import type { PetAction } from '../components/PetStage';
import { audioPlayer } from '../audio/player';
import { PP, ppAgeDays, ppHatchInMs, ppPetById } from '../game/logic';
import { useGameStore } from '../game/store';
import { COLORS, METER_DEFS, roomBackground, sharedStyles } from './theme';
import { ACTION_BUBBLES, useAudioPrefs, useToast } from './helpers';

export default function RoomScreen() {
  const insets = useSafeAreaInsets();
  const save = useGameStore((s) => s.save);
  const mood = useGameStore((s) => s.mood);
  const stageIndex = useGameStore((s) => s.stageIndex);
  const isSparkle = useGameStore((s) => s.isSparkle);
  const meal = useGameStore((s) => s.meal);
  const snack = useGameStore((s) => s.snack);
  const drink = useGameStore((s) => s.drink);
  const toggleSleep = useGameStore((s) => s.toggleSleep);
  const bath = useGameStore((s) => s.bath);
  const medicine = useGameStore((s) => s.medicine);
  const potty = useGameStore((s) => s.potty);
  const scold = useGameStore((s) => s.scold);
  const petAction = useGameStore((s) => s.pet);

  const state = save.pets[save.activePet];
  const pet = ppPetById(save.activePet);
  const { showToast, ToastView } = useToast();
  const { muted, musicOn, toggleMute, toggleMusic } = useAudioPrefs();
  const [bubble, setBubble] = useState<string | null>(null);
  const [action, setAction] = useState<PetAction>('idle');
  const actionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sleeping = state?.lightsOut ?? false;
  const sick = mood === 'sick';
  const sad = mood === 'sad';
  // Ticking clock: drives the tantrum check, age + hatch countdowns.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const grumpy = now < (state?.tantrumUntil ?? 0);
  const room = roomBackground(save.shop.bg);

  const playAction = useCallback((a: PetAction, ms = 1500) => {
    setAction(a);
    if (actionTimer.current) clearTimeout(actionTimer.current);
    actionTimer.current = setTimeout(() => setAction('idle'), ms);
  }, []);

  const say = useCallback((text: string, ms = 2500) => {
    setBubble(text);
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => setBubble(null), ms);
  }, []);

  useEffect(
    () => () => {
      if (actionTimer.current) clearTimeout(actionTimer.current);
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    },
    [],
  );

  // Music: lullaby while sleeping, daytime otherwise (Room/Shop/Pals).
  useFocusEffect(
    useCallback(() => {
      void audioPlayer.setMusicMode(sleeping ? 'lullaby' : 'daytime');
      return () => {
        void audioPlayer.setMusicMode('daytime');
      };
    }, [sleeping]),
  );

  if (!state) {
    return (
      <View style={[sharedStyles.page, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={sharedStyles.title}>Loading your pal… 🐾</Text>
      </View>
    );
  }

  const stageName = PP.STAGES[stageIndex];
  const days = ppAgeDays(state, now);
  let sub = stageName + (isSparkle ? ' ✨ Sparkle' : '') + ' · Day ' + days;
  if (stageIndex === 0) {
    const msLeft = ppHatchInMs(state, now);
    sub += msLeft > 5000 ? ' · hatches in ' + Math.ceil(msLeft / 1000) + 's' : ' · hatching any second… 🐣';
  } else if (stageIndex < PP.STAGES.length - 1) {
    sub += ' · next: ' + PP.STAGES[stageIndex + 1] + ' tomorrow';
  }
  if (state.streak.count >= 2) sub += ' · 🔥 ' + state.streak.count + '-day streak';

  const hint = sleeping
    ? 'Sleeping… energy is coming back. 💤'
    : sick
      ? 'Sick! Give medicine (10 coins) to feel better. 🤒'
      : sad
        ? 'Too sad to play — fix a need and give a pat. 🥺'
        : mood === 'potty'
          ? "Potty time! Hit 🚽 before there's a mess!"
          : mood === 'grumpy'
            ? 'Tantrum! A gentle scold will calm things down. 😤'
            : 'Tip: tap your pet to give it a pat! ♡';

  const doMeal = () => {
    meal();
    say(ACTION_BUBBLES.meal);
    audioPlayer.playSfx('chew');
    playAction('eat', 1400);
  };
  const doSnack = () => {
    const heavy = state.weight + 2 > 30;
    snack();
    say(heavy ? ACTION_BUBBLES.snackHeavy : ACTION_BUBBLES.snack);
    audioPlayer.playSfx('chew');
    playAction('eat', 1400);
  };
  const doDrink = () => {
    drink();
    say(ACTION_BUBBLES.drink);
    audioPlayer.playSfx('slurp');
    playAction('drink', 1600);
  };
  const doBath = () => {
    bath();
    say(ACTION_BUBBLES.bath);
    audioPlayer.playSfx('scrub');
    playAction('bath', 1800);
  };
  const doMedicine = () => {
    if (mood !== 'sick' || save.coins < 10) return;
    medicine();
    const after = useGameStore.getState().save.pets[save.activePet];
    say(after && after.meters.health >= 30 ? ACTION_BUBBLES.medicineBetter : ACTION_BUBBLES.medicineMore, 3000);
    audioPlayer.playSfx('gulp');
    playAction('sick', 1500);
  };
  const doSleep = () => {
    const goingToSleep = !sleeping;
    toggleSleep();
    say(goingToSleep ? ACTION_BUBBLES.sleep : ACTION_BUBBLES.wake);
    audioPlayer.playSfx(goingToSleep ? 'yawn' : 'button');
    playAction('sleep', 1600);
  };
  const doPotty = () => {
    if (sleeping) return;
    if (!state.pottyPending) {
      showToast('No potty needed right now 🚽');
      return;
    }
    potty();
    say(ACTION_BUBBLES.potty);
    audioPlayer.playSfx('ding');
    playAction('potty', 1300);
  };
  const doScold = () => {
    scold();
    say(ACTION_BUBBLES.scold);
    showToast('Tantrum over — all calm again. 💕');
    audioPlayer.playSfx('scold');
    playAction('tantrum', 1300);
  };
  const doPet = () => {
    if (sleeping) return;
    petAction();
    audioPlayer.playSfx('squeak');
    playAction('pet', 1200);
  };

  const onMute = async () => {
    const next = await toggleMute();
    if (!next) audioPlayer.playSfx('button');
    showToast(next ? 'Sound off 🔇' : 'Sound on 🔊');
  };
  const onMusic = async () => {
    const next = await toggleMusic();
    showToast(next ? 'Music on 🎵' : 'Music off 🎵');
  };

  const btn = (disabled: boolean, primary = false) => [
    styles.act,
    disabled && styles.actDisabled,
    primary && !disabled && styles.actPrimary,
  ];

  return (
    <View style={[sharedStyles.page, { paddingTop: insets.top, backgroundColor: room.dark ? COLORS.nightBg : COLORS.bg }]}>
      <View style={sharedStyles.header}>
        <Text style={[sharedStyles.brand, room.dark && { color: COLORS.nightText }]}>🐾 Boba Buddies</Text>
        <View style={sharedStyles.headerRight}>
          {state.streak.count >= 2 && (
            <Text style={sharedStyles.coins}>🔥 {state.streak.count}</Text>
          )}
          <Text style={sharedStyles.coins} testID="coins">🪙 {save.coins}</Text>
          <Pressable style={sharedStyles.iconBtn} onPress={onMusic} accessibilityLabel="Toggle music">
            <Text style={sharedStyles.iconBtnText}>{musicOn ? '🎵' : '🔇'}</Text>
          </Pressable>
          <Pressable style={sharedStyles.iconBtn} onPress={onMute} accessibilityLabel="Toggle sound">
            <Text style={sharedStyles.iconBtnText}>{muted ? '🔇' : '🔊'}</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={sharedStyles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={[sharedStyles.card, room.dark && { backgroundColor: COLORS.nightSurface, borderColor: '#55518a' }]}>
          <View style={styles.petTop}>
            <View>
              <Text style={[styles.petName, room.dark && { color: COLORS.nightText }]} testID="pet-name">{pet.name}</Text>
              <Text style={styles.petSub}>{sub}</Text>
            </View>
            <Text style={styles.moodChip} testID="mood-chip">
              {PP.MOODS[mood].label}
              {isSparkle && stageIndex === 4 ? ' ✨' : ''}
            </Text>
          </View>

          <View style={[styles.room, { backgroundColor: room.bg }]}>
            <Text style={styles.decor}>{save.shop.bg === 'night' ? '🌟' : save.shop.bg === 'garden' ? '🌷' : '🪴'}</Text>
            <Text style={styles.window}>{save.shop.bg === 'night' ? '🌙' : save.shop.bg === 'garden' ? '🌸' : '☀️'}</Text>
            <View style={styles.speechWrap}>
              <Text style={[styles.speech, room.dark && styles.speechDark]} numberOfLines={1}>
                {bubble ?? PP.MOODS[mood].bubble}
              </Text>
            </View>
            <View style={styles.stageWrap}>
              <PetStage
                petId={save.activePet}
                mood={mood}
                action={action}
                size={230}
                stageIndex={stageIndex}
                hatOn={state.hatOn && save.shop.owned.includes('bow')}
                isSparkle={isSparkle}
                onPress={doPet}
                testID="pet-stage"
                wander
              />
            </View>
            {state.pottyPending && <Text style={styles.pottyBadge}>🚽</Text>}
            {state.mess && <Text style={styles.mess}>💩</Text>}
            {sleeping && (
              <View style={styles.sleepVeil}>
                <Text style={styles.zzz}>Zzz 💤</Text>
                <Pressable style={styles.wakeBtn} onPress={doSleep}>
                  <Text style={styles.wakeBtnText}>☀️ Wake</Text>
                </Pressable>
              </View>
            )}
            <View style={[styles.floor, { backgroundColor: room.floor }]} />
          </View>

          <View style={styles.meters}>
            {METER_DEFS.map(({ key, label, icon, color }) => {
              const v = state.meters[key];
              return (
                <View key={key} style={styles.meter}>
                  <View style={styles.mLabel}>
                    <Text style={[styles.mLabelText, v < 30 && styles.mLabelLow]}>
                      {icon} {label}
                    </Text>
                    <Text style={[styles.mValue, v < 30 && styles.mLabelLow]}>{v}</Text>
                  </View>
                  <View style={styles.bar}>
                    <View style={[styles.fill, { width: `${v}%`, backgroundColor: v < 30 ? '#e74c3c' : color }]} />
                  </View>
                </View>
              );
            })}
          </View>
          <Text style={[styles.weight, state.weight > 30 && styles.weightHeavy]}>
            ⚖️ Weight: {state.weight}
            {state.weight > 30 ? ' · feeling heavy…' : ' · feeling good'}
          </Text>
        </View>

        <View style={styles.actions}>
          <Pressable style={btn(sleeping)} disabled={sleeping} onPress={doMeal} testID="btn-meal">
            <Text style={styles.actText}>🍡 Meal</Text>
          </Pressable>
          <Pressable style={btn(sleeping)} disabled={sleeping} onPress={doSnack} testID="btn-snack">
            <Text style={styles.actText}>🍪 Snack</Text>
          </Pressable>
          <Pressable style={btn(sleeping)} disabled={sleeping} onPress={doDrink} testID="btn-drink">
            <Text style={styles.actText}>🧋 Drink</Text>
          </Pressable>
          <Pressable style={btn(false)} onPress={doSleep} testID="btn-sleep">
            <Text style={styles.actText}>{sleeping ? '☀️ Wake' : '🌙 Sleep'}</Text>
          </Pressable>
          <Pressable style={btn(sleeping)} disabled={sleeping} onPress={doBath} testID="btn-bath">
            <Text style={styles.actText}>🧼 Bath</Text>
          </Pressable>
          <Pressable
            style={btn(!sick || sleeping || save.coins < 10)}
            disabled={!sick || sleeping || save.coins < 10}
            onPress={doMedicine}
            testID="btn-medicine"
          >
            <Text style={styles.actText}>{sick ? '💊 Medicine · 10🪙' : '💊 Medicine'}</Text>
          </Pressable>
          <Pressable
            style={btn(sleeping, state.pottyPending)}
            disabled={sleeping}
            onPress={doPotty}
            testID="btn-potty"
          >
            <Text style={styles.actText}>🚽 Potty</Text>
          </Pressable>
          {grumpy && (
            <Pressable style={btn(sleeping)} disabled={sleeping} onPress={doScold} testID="btn-scold">
              <Text style={styles.actText}>😤 Scold</Text>
            </Pressable>
          )}
          <Pressable style={btn(sleeping)} disabled={sleeping} onPress={doPet} testID="btn-pet">
            <Text style={styles.actText}>💗 Pet</Text>
          </Pressable>
        </View>
        <Text style={sharedStyles.hint}>{hint}</Text>
      </ScrollView>
      {ToastView}
    </View>
  );
}

const styles = StyleSheet.create({
  petTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  petName: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.text,
  },
  petSub: {
    fontSize: 11,
    color: COLORS.muted,
    marginTop: 1,
  },
  moodChip: {
    backgroundColor: '#ffe9f0',
    borderWidth: 2,
    borderColor: '#f3b8cc',
    color: COLORS.brand,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    fontSize: 11,
    fontWeight: '800',
    overflow: 'hidden',
  },
  room: {
    position: 'relative',
    height: 300,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#fbe3da',
  },
  decor: {
    position: 'absolute',
    left: 10,
    top: 8,
    fontSize: 22,
    zIndex: 1,
  },
  window: {
    position: 'absolute',
    right: 10,
    top: 8,
    fontSize: 22,
    zIndex: 1,
  },
  speechWrap: {
    position: 'absolute',
    top: 10,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 3,
  },
  speech: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#f3c6d3',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    maxWidth: '92%',
    overflow: 'hidden',
  },
  speechDark: {
    backgroundColor: COLORS.nightSurface,
    color: COLORS.nightText,
    borderColor: '#6a639e',
  },
  stageWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 22,
    alignItems: 'center',
    zIndex: 2,
  },
  floor: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 34,
    borderTopWidth: 2,
    borderTopColor: '#f7bfa9',
  },
  pottyBadge: {
    position: 'absolute',
    top: 44,
    right: 14,
    fontSize: 26,
    zIndex: 4,
  },
  mess: {
    position: 'absolute',
    left: 14,
    bottom: 8,
    fontSize: 26,
    zIndex: 3,
  },
  sleepVeil: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(43, 32, 68, 0.72)',
    zIndex: 5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  zzz: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 4,
  },
  wakeBtn: {
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
    minHeight: 48,
    justifyContent: 'center',
  },
  wakeBtnText: {
    fontWeight: '800',
    color: COLORS.text,
    fontSize: 15,
  },
  meters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  meter: {
    width: '48%',
    flexGrow: 1,
  },
  mLabel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  mLabelText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSoft,
  },
  mValue: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.text,
  },
  mLabelLow: {
    color: COLORS.red,
  },
  bar: {
    height: 9,
    backgroundColor: '#f6e3e8',
    borderRadius: 99,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 99,
  },
  weight: {
    fontSize: 12,
    color: COLORS.muted,
    marginTop: 7,
    textAlign: 'right',
  },
  weightHeavy: {
    color: COLORS.red,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 10,
  },
  act: {
    borderWidth: 2,
    borderColor: '#f3c6d3',
    backgroundColor: '#fff',
    borderRadius: 13,
    minHeight: 52,
    paddingHorizontal: 4,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
    flexBasis: '30%',
  },
  actPrimary: {
    backgroundColor: COLORS.pink,
    borderColor: COLORS.pinkDark,
  },
  actDisabled: {
    opacity: 0.45,
  },
  actText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
  },
});
