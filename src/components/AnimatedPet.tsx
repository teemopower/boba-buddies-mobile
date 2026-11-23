/**
 * AnimatedPet — animated virtual-pet sprite for Boba Buddies mobile.
 *
 * PROOF OF CONCEPT — Momo + Kiki only. Do not roll out to the other 8 pets
 * until this proof is verified.
 *
 * Two layers:
 *  (a) Multi-frame sprite sequences (~8–12 fps feel): the base set is the
 *      per-pet stills in assets/pets/ (base / blink / eat / drink / happy /
 *      sad / sleep). New expression + action panels come from the sprite
 *      sheets (momo/kiki-expressions-sheet.png, 3x2 grid of 640px panels;
 *      momo/kiki-actions-sheet.png, 2x2 grid of 800px panels). Sheets are
 *      sliced in code — an overflow-hidden window shows one panel of the
 *      sheet at a time, so no pre-sliced files are needed.
 *  (b) Smooth code-driven motion at 60fps via react-native-reanimated.
 *
 * HARD RULE (user preference): the pet NEVER changes size. No
 * squash-and-stretch, no scale transforms anywhere — eating animates the
 * mouth/face via frame swaps only. All motion is translate/rotate.
 *
 * The component accepts an external `action` trigger and returns to idle
 * cleanly: changing `action`/`mood` resets the frame sequence to its first
 * frame and restarts the motion profile from neutral (no stuck frames).
 */

import { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

export type PetId = 'momo' | 'kiki';

/** Moods from DESIGN.md — every mood has its own animation + face. */
export type MoodId =
  | 'happy'
  | 'excited'
  | 'content'
  | 'hungry'
  | 'thirsty'
  | 'sleepy'
  | 'bored'
  | 'lonely'
  | 'dirty'
  | 'sick'
  | 'sad'
  | 'grumpy'
  | 'sleeping';

export type PetAction =
  | 'idle'
  | 'eat'
  | 'drink'
  | 'sleep'
  | 'play'
  | 'sick'
  | 'tantrum'
  | 'potty'
  | 'celebrate'
  | 'lonely';

export interface AnimatedPetProps {
  petId: PetId;
  mood: MoodId;
  action: PetAction;
  /** Rendered size in px (width = height). Default 240. */
  size?: number;
}

/* ------------------------------------------------------------------ */
/* Frames                                                              */
/* ------------------------------------------------------------------ */

/** A single drawable frame: a whole image, or one panel of a sheet. */
type Frame =
  | { kind: 'image'; source: ImageSourcePropType }
  | {
      kind: 'panel';
      sheet: ImageSourcePropType;
      col: number;
      row: number;
      cols: number;
      rows: number;
    };

interface SeqStep {
  frame: Frame;
  /** How long this frame is shown, in ms. */
  durationMs: number;
}

interface PetAssets {
  base: ImageSourcePropType;
  blink: ImageSourcePropType;
  eat: ImageSourcePropType;
  drink: ImageSourcePropType;
  happy: ImageSourcePropType;
  sad: ImageSourcePropType;
  sleep: ImageSourcePropType;
  expressionsSheet: ImageSourcePropType;
  actionsSheet: ImageSourcePropType;
}

const PET_ASSETS: Record<PetId, PetAssets> = {
  momo: {
    base: require('../../assets/pets/momo.png'),
    blink: require('../../assets/pets/momo-blink.png'),
    eat: require('../../assets/pets/momo-eat.png'),
    drink: require('../../assets/pets/momo-drink.png'),
    happy: require('../../assets/pets/momo-happy.png'),
    sad: require('../../assets/pets/momo-sad.png'),
    sleep: require('../../assets/pets/momo-sleep.png'),
    expressionsSheet: require('../../assets/pets/momo-expressions-sheet.png'),
    actionsSheet: require('../../assets/pets/momo-actions-sheet.png'),
  },
  kiki: {
    base: require('../../assets/pets/kiki.png'),
    blink: require('../../assets/pets/kiki-blink.png'),
    eat: require('../../assets/pets/kiki-eat.png'),
    drink: require('../../assets/pets/kiki-drink.png'),
    happy: require('../../assets/pets/kiki-happy.png'),
    sad: require('../../assets/pets/kiki-sad.png'),
    sleep: require('../../assets/pets/kiki-sleep.png'),
    expressionsSheet: require('../../assets/pets/kiki-expressions-sheet.png'),
    actionsSheet: require('../../assets/pets/kiki-actions-sheet.png'),
  },
};

/**
 * Sheet panel layouts (verified against the generated PNGs).
 * expressions sheet: 1920x1280, 3 cols x 2 rows (640px panels).
 *   row 0: chew-mid | chew-open | sick
 *   row 1: grumpy   | excited   | lonely
 * actions sheet: 1600x1600, 2 cols x 2 rows (800px panels).
 *   row 0: celebrate    | tantrum-stomp
 *   row 1: potty-wiggle | sleep-deep
 */
function sheetPanels(a: PetAssets): Record<string, Frame> {
  const expr = (col: number, row: number): Frame => ({
    kind: 'panel',
    sheet: a.expressionsSheet,
    col,
    row,
    cols: 3,
    rows: 2,
  });
  const act = (col: number, row: number): Frame => ({
    kind: 'panel',
    sheet: a.actionsSheet,
    col,
    row,
    cols: 2,
    rows: 2,
  });
  return {
    chewMid: expr(0, 0),
    chewOpen: expr(1, 0),
    sick: expr(2, 0),
    grumpy: expr(0, 1),
    excited: expr(1, 1),
    lonely: expr(2, 1),
    celebrate: act(0, 0),
    tantrum: act(1, 0),
    potty: act(0, 1),
    sleepDeep: act(1, 1),
  };
}

const img = (source: ImageSourcePropType): Frame => ({ kind: 'image', source });

/**
 * Resolve the frame sequence for a (mood, action) pair. Action wins when it
 * is not 'idle'; otherwise the mood picks the idle face. Every sequence is
 * short and loops; durations give the ~8–12 fps feel for the chew cycle.
 */
function resolveSequence(a: PetAssets, mood: MoodId, action: PetAction): SeqStep[] {
  const p = sheetPanels(a);
  const base = img(a.base);
  const blink: SeqStep[] = [
    { frame: base, durationMs: 3850 },
    { frame: img(a.blink), durationMs: 150 },
  ];

  if (action !== 'idle') {
    switch (action) {
      case 'eat':
        // Chew cycle — mouth only, body never changes size.
        return [
          { frame: base, durationMs: 220 },
          { frame: p.chewMid, durationMs: 220 },
          { frame: p.chewOpen, durationMs: 220 },
          { frame: p.chewMid, durationMs: 220 },
        ];
      case 'drink':
        // Sip loop: drink frame, brief return to base (gulp).
        return [
          { frame: img(a.drink), durationMs: 1000 },
          { frame: base, durationMs: 300 },
        ];
      case 'sleep':
        return [{ frame: img(a.sleep), durationMs: 1000 }];
      case 'play':
        return [
          { frame: base, durationMs: 300 },
          { frame: img(a.happy), durationMs: 300 },
        ];
      case 'sick':
        return [{ frame: p.sick, durationMs: 1000 }];
      case 'tantrum':
        return [
          { frame: p.tantrum, durationMs: 260 },
          { frame: p.grumpy, durationMs: 260 },
        ];
      case 'potty':
        return [{ frame: p.potty, durationMs: 1000 }];
      case 'celebrate':
        return [
          { frame: p.celebrate, durationMs: 450 },
          { frame: img(a.happy), durationMs: 450 },
        ];
      case 'lonely':
        return [{ frame: p.lonely, durationMs: 1000 }];
      default:
        return blink;
    }
  }

  switch (mood) {
    case 'happy':
      return [{ frame: img(a.happy), durationMs: 1000 }];
    case 'excited':
      return [{ frame: p.excited, durationMs: 1000 }];
    case 'sick':
      return [{ frame: p.sick, durationMs: 1000 }];
    case 'sad':
      return [{ frame: img(a.sad), durationMs: 1000 }];
    case 'grumpy':
      return [{ frame: p.grumpy, durationMs: 1000 }];
    case 'lonely':
      return [{ frame: p.lonely, durationMs: 1000 }];
    case 'sleepy':
      return [{ frame: img(a.sleep), durationMs: 1000 }];
    case 'sleeping':
      // Curled-up deep-sleep panel (has its own drawn Zzz).
      return [{ frame: p.sleepDeep, durationMs: 1000 }];
    case 'thirsty':
      return [{ frame: img(a.drink), durationMs: 1000 }];
    case 'hungry':
      // No dedicated hungry face yet: base with blink cycle.
      return blink;
    case 'content':
    case 'bored':
    case 'dirty':
    default:
      return blink;
  }
}

/** Advance through a looping frame sequence, resetting on sequence change. */
function useFrameSequence(sequence: SeqStep[], seqKey: string): Frame {
  const [state, setState] = useState({ seqKey, index: 0 });

  // Reset to frame 0 when the sequence changes (React's "adjusting state
  // during render" pattern — resetting in an effect would cascade renders).
  if (state.seqKey !== seqKey) {
    setState({ seqKey, index: 0 });
  }
  const index = state.seqKey === seqKey ? state.index : 0;

  useEffect(() => {
    if (sequence.length <= 1) {
      return undefined;
    }
    const step = sequence[index % sequence.length];
    const timeout = setTimeout(() => {
      setState((s) => ({ ...s, index: (s.index + 1) % sequence.length }));
    }, step.durationMs);
    return () => clearTimeout(timeout);
  }, [index, seqKey, sequence]);

  return sequence[index % sequence.length].frame;
}

/* ------------------------------------------------------------------ */
/* Motion (translate / rotate ONLY — never scale)                      */
/* ------------------------------------------------------------------ */

type MotionProfile =
  | 'breathe'
  | 'bounce'
  | 'hop'
  | 'wobble'
  | 'stomp'
  | 'deepBob'
  | 'wiggle'
  | 'sway'
  | 'nibble'
  | 'still';

function resolveMotion(mood: MoodId, action: PetAction): MotionProfile {
  if (action !== 'idle') {
    switch (action) {
      case 'eat':
        return 'nibble';
      case 'drink':
        return 'breathe';
      case 'sleep':
        return 'deepBob';
      case 'play':
      case 'celebrate':
        return 'hop';
      case 'sick':
        return 'wobble';
      case 'tantrum':
        return 'stomp';
      case 'potty':
        return 'wiggle';
      case 'lonely':
        return 'sway';
      default:
        return 'breathe';
    }
  }
  switch (mood) {
    case 'happy':
      return 'bounce';
    case 'excited':
      return 'hop';
    case 'sleepy':
    case 'sleeping':
      return 'deepBob';
    case 'sick':
      return 'wobble';
    case 'grumpy':
      return 'stomp';
    case 'lonely':
    case 'bored':
      return 'sway';
    default:
      return 'breathe';
  }
}

/* ------------------------------------------------------------------ */
/* Floating Zzz (sleep action)                                         */
/* ------------------------------------------------------------------ */

function FloatingZzz({ size }: { size: number }) {
  const rise = useSharedValue(0);
  const fade = useSharedValue(0);

  useEffect(() => {
    // Rise 18px over 2s while fading in, holding, then fading out; the
    // zero-duration reset at the end is invisible because opacity is 0.
    rise.value = withRepeat(
      withSequence(
        withTiming(-18, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 0 }),
      ),
      -1,
    );
    fade.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 300 }),
        withTiming(1, { duration: 900 }),
        withTiming(0, { duration: 600 }),
        withTiming(0, { duration: 200 }),
      ),
      -1,
    );
    return () => {
      cancelAnimation(rise);
      cancelAnimation(fade);
    };
  }, [rise, fade]);

  const style = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ translateY: rise.value }],
  }));

  return (
    <Animated.View style={[styles.zzz, { right: size * 0.06, top: -size * 0.02 }, style]}>
      <Text style={[styles.zzzText, { fontSize: size * 0.14 }]}>Zzz</Text>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function AnimatedPet({
  petId,
  mood,
  action,
  size = 240,
}: AnimatedPetProps) {
  const assets = PET_ASSETS[petId];

  const seqKey = `${petId}|${mood}|${action}`;
  const sequence = useMemo(
    () => resolveSequence(assets, mood, action),
    // assets is a stable module-level lookup per petId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seqKey],
  );
  const frame = useFrameSequence(sequence, seqKey);

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const rotation = useSharedValue(0);

  const motionKey = `${mood}|${action}`;
  useEffect(() => {
    // Clean return to neutral before starting the new profile — this is
    // what guarantees no stuck frames/poses when the action changes.
    cancelAnimation(translateX);
    cancelAnimation(translateY);
    cancelAnimation(rotation);
    translateX.value = 0;
    translateY.value = 0;
    rotation.value = 0;

    const inOut = Easing.inOut(Easing.ease);
    switch (resolveMotion(mood, action)) {
      case 'breathe':
        // Gentle idle bob, ±3px on a ~2s cycle.
        translateY.value = withRepeat(
          withTiming(-3, { duration: 1000, easing: inOut }),
          -1,
          true,
        );
        break;
      case 'bounce':
        // Happy soft bounce.
        translateY.value = withRepeat(withTiming(-6, { duration: 350, easing: inOut }), -1, true);
        break;
      case 'hop':
        // Play / celebrate hop: -20px up, slight ± tilt.
        translateY.value = withRepeat(
          withSequence(
            withTiming(-20, { duration: 200, easing: Easing.out(Easing.ease) }),
            withTiming(0, { duration: 200, easing: Easing.in(Easing.ease) }),
          ),
          -1,
        );
        rotation.value = withRepeat(withTiming(3, { duration: 400, easing: inOut }), -1, true);
        break;
      case 'wobble':
        // Sick slow wobble, rotate ±4°.
        rotation.value = withRepeat(
          withSequence(
            withTiming(4, { duration: 700, easing: inOut }),
            withTiming(-4, { duration: 1400, easing: inOut }),
            withTiming(0, { duration: 700, easing: inOut }),
          ),
          -1,
        );
        break;
      case 'stomp':
        // Tantrum / grumpy rapid small stomps, translateY ±4px fast.
        translateY.value = withRepeat(withTiming(-4, { duration: 130 }), -1, true);
        break;
      case 'deepBob':
        // Sleep slow deep bob.
        translateY.value = withRepeat(
          withTiming(-2, { duration: 1800, easing: inOut }),
          -1,
          true,
        );
        break;
      case 'wiggle':
        // Potty side-to-side wiggle.
        translateX.value = withRepeat(
          withSequence(
            withTiming(-6, { duration: 180, easing: inOut }),
            withTiming(6, { duration: 360, easing: inOut }),
            withTiming(-6, { duration: 180, easing: inOut }),
          ),
          -1,
        );
        break;
      case 'sway':
        // Lonely / bored slow sway, rotate ±2°.
        rotation.value = withRepeat(
          withSequence(
            withTiming(2, { duration: 1200, easing: inOut }),
            withTiming(-2, { duration: 2400, easing: inOut }),
            withTiming(0, { duration: 1200, easing: inOut }),
          ),
          -1,
        );
        break;
      case 'nibble':
        // Eating: tiny bob only — the mouth moves via frame swaps.
        translateY.value = withRepeat(withTiming(-2, { duration: 220 }), -1, true);
        break;
      case 'still':
      default:
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motionKey]);

  const animatedStyle = useAnimatedStyle(() => ({
    // translate / rotate ONLY — never scale (user rule).
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: `${rotation.value}deg` },
    ],
  }));

  const showZzz = action === 'sleep' || (action === 'idle' && mood === 'sleepy');

  return (
    <View style={[styles.stage, { width: size, height: size }]}>
      <Animated.View style={[styles.sprite, { width: size, height: size }, animatedStyle]}>
        {frame.kind === 'image' ? (
          <Image
            source={frame.source}
            style={{ width: size, height: size }}
            resizeMode="contain"
          />
        ) : (
          <View style={{ width: size, height: size, overflow: 'hidden' }}>
            <Image
              source={frame.sheet}
              style={{
                position: 'absolute',
                width: size * frame.cols,
                height: size * frame.rows,
                left: -frame.col * size,
                top: -frame.row * size,
              }}
              resizeMode="stretch"
            />
          </View>
        )}
      </Animated.View>
      {showZzz ? <FloatingZzz size={size} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  sprite: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  zzz: {
    position: 'absolute',
  },
  zzzText: {
    color: '#7C9EB2',
    fontWeight: 'bold',
  },
});
