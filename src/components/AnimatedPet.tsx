/**
 * AnimatedPet — animated virtual-pet sprite for Boba Buddies mobile.
 *
 * All 10 pets (Momo, Kiki, Boba, Yuki, Taro, Purin, Sora, Miso, Hana,
 * Nori) share the same animation system, proven on Momo + Kiki first.
 *
 * Two layers:
 *  (a) Multi-frame sprite sequences: the base set is the per-pet stills
 *      in assets/pets/ (base / blink / eat / drink / happy / sad / sleep).
 *      New expression + action panels come from the sprite sheets
 *      (momo/kiki-expressions-sheet.png, 3x2 grid of 640px panels;
 *      momo/kiki-actions-sheet.png, 2x2 grid of 800px panels). Sheets are
 *      sliced in code — an overflow-hidden window shows one panel of the
 *      sheet at a time, so no pre-sliced files are needed. Every frame
 *      change crossfades into the next over 80 ms (see PetLayer), so the
 *      eye sees an interpolated in-between frame between every pair of
 *      drawings — the motion reads fluid, like a cartoon.
 *  (b) Smooth code-driven motion at 60fps via react-native-reanimated.
 *      The 'walk' action is driven by PetStage's wander: the pet drifts
 *      around the room on its own, using the existing art.
 *
 * HARD RULE (user preference): the pet NEVER changes size. No
 * squash-and-stretch, no scale transforms anywhere — eating animates the
 * mouth/face via frame swaps only. All motion is translate/rotate.
 *
 * The component accepts an external `action` trigger and returns to idle
 * cleanly: changing `action`/`mood` resets the frame sequence to its first
 * frame and restarts the motion profile from neutral (no stuck frames).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

export type PetId =
  | 'momo'
  | 'kiki'
  | 'boba'
  | 'yuki'
  | 'taro'
  | 'purin'
  | 'sora'
  | 'miso'
  | 'hana'
  | 'nori';

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
  | 'bath'
  | 'sleep'
  | 'play'
  | 'sick'
  | 'tantrum'
  | 'potty'
  | 'celebrate'
  | 'lonely'
  | 'walk';

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

/** A single drawable frame: a whole image, or one panel of a sheet.
 *  `layer` / `sheet` name the always-mounted layer that renders it (see
 *  the layered rendering below) — frames never swap Image sources. */
type StillKey = 'base' | 'blink' | 'eat' | 'drink' | 'happy' | 'sad' | 'sleep';
type SheetKey = 'expressions' | 'actions';
type LayerKey = StillKey | SheetKey;

type Frame =
  | { kind: 'image'; source: ImageSourcePropType; layer: StillKey }
  | {
      kind: 'panel';
      sheet: SheetKey;
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
  boba: {
    base: require('../../assets/pets/boba.png'),
    blink: require('../../assets/pets/boba-blink.png'),
    eat: require('../../assets/pets/boba-eat.png'),
    drink: require('../../assets/pets/boba-drink.png'),
    happy: require('../../assets/pets/boba-happy.png'),
    sad: require('../../assets/pets/boba-sad.png'),
    sleep: require('../../assets/pets/boba-sleep.png'),
    expressionsSheet: require('../../assets/pets/boba-expressions-sheet.png'),
    actionsSheet: require('../../assets/pets/boba-actions-sheet.png'),
  },
  yuki: {
    base: require('../../assets/pets/yuki.png'),
    blink: require('../../assets/pets/yuki-blink.png'),
    eat: require('../../assets/pets/yuki-eat.png'),
    drink: require('../../assets/pets/yuki-drink.png'),
    happy: require('../../assets/pets/yuki-happy.png'),
    sad: require('../../assets/pets/yuki-sad.png'),
    sleep: require('../../assets/pets/yuki-sleep.png'),
    expressionsSheet: require('../../assets/pets/yuki-expressions-sheet.png'),
    actionsSheet: require('../../assets/pets/yuki-actions-sheet.png'),
  },
  taro: {
    base: require('../../assets/pets/taro.png'),
    blink: require('../../assets/pets/taro-blink.png'),
    eat: require('../../assets/pets/taro-eat.png'),
    drink: require('../../assets/pets/taro-drink.png'),
    happy: require('../../assets/pets/taro-happy.png'),
    sad: require('../../assets/pets/taro-sad.png'),
    sleep: require('../../assets/pets/taro-sleep.png'),
    expressionsSheet: require('../../assets/pets/taro-expressions-sheet.png'),
    actionsSheet: require('../../assets/pets/taro-actions-sheet.png'),
  },
  purin: {
    base: require('../../assets/pets/purin.png'),
    blink: require('../../assets/pets/purin-blink.png'),
    eat: require('../../assets/pets/purin-eat.png'),
    drink: require('../../assets/pets/purin-drink.png'),
    happy: require('../../assets/pets/purin-happy.png'),
    sad: require('../../assets/pets/purin-sad.png'),
    sleep: require('../../assets/pets/purin-sleep.png'),
    expressionsSheet: require('../../assets/pets/purin-expressions-sheet.png'),
    actionsSheet: require('../../assets/pets/purin-actions-sheet.png'),
  },
  sora: {
    base: require('../../assets/pets/sora.png'),
    blink: require('../../assets/pets/sora-blink.png'),
    eat: require('../../assets/pets/sora-eat.png'),
    drink: require('../../assets/pets/sora-drink.png'),
    happy: require('../../assets/pets/sora-happy.png'),
    sad: require('../../assets/pets/sora-sad.png'),
    sleep: require('../../assets/pets/sora-sleep.png'),
    expressionsSheet: require('../../assets/pets/sora-expressions-sheet.png'),
    actionsSheet: require('../../assets/pets/sora-actions-sheet.png'),
  },
  miso: {
    base: require('../../assets/pets/miso.png'),
    blink: require('../../assets/pets/miso-blink.png'),
    eat: require('../../assets/pets/miso-eat.png'),
    drink: require('../../assets/pets/miso-drink.png'),
    happy: require('../../assets/pets/miso-happy.png'),
    sad: require('../../assets/pets/miso-sad.png'),
    sleep: require('../../assets/pets/miso-sleep.png'),
    expressionsSheet: require('../../assets/pets/miso-expressions-sheet.png'),
    actionsSheet: require('../../assets/pets/miso-actions-sheet.png'),
  },
  hana: {
    base: require('../../assets/pets/hana.png'),
    blink: require('../../assets/pets/hana-blink.png'),
    eat: require('../../assets/pets/hana-eat.png'),
    drink: require('../../assets/pets/hana-drink.png'),
    happy: require('../../assets/pets/hana-happy.png'),
    sad: require('../../assets/pets/hana-sad.png'),
    sleep: require('../../assets/pets/hana-sleep.png'),
    expressionsSheet: require('../../assets/pets/hana-expressions-sheet.png'),
    actionsSheet: require('../../assets/pets/hana-actions-sheet.png'),
  },
  nori: {
    base: require('../../assets/pets/nori.png'),
    blink: require('../../assets/pets/nori-blink.png'),
    eat: require('../../assets/pets/nori-eat.png'),
    drink: require('../../assets/pets/nori-drink.png'),
    happy: require('../../assets/pets/nori-happy.png'),
    sad: require('../../assets/pets/nori-sad.png'),
    sleep: require('../../assets/pets/nori-sleep.png'),
    expressionsSheet: require('../../assets/pets/nori-expressions-sheet.png'),
    actionsSheet: require('../../assets/pets/nori-actions-sheet.png'),
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
    sheet: 'expressions',
    col,
    row,
    cols: 3,
    rows: 2,
  });
  const act = (col: number, row: number): Frame => ({
    kind: 'panel',
    sheet: 'actions',
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

const img = (source: ImageSourcePropType, layer: StillKey): Frame => ({
  kind: 'image',
  source,
  layer,
});

/**
 * Resolve the frame sequence for a (mood, action) pair. Action wins when it
 * is not 'idle'; otherwise the mood picks the idle face. Every sequence is
 * short and loops.
 *
 * SMOOTHNESS (Nov 24, 2026): steps run at ~100–260 ms (roughly 4–10
 * steps/s) and every step change crossfades into the next frame over
 * CROSSFADE_MS via the layered renderer below, so the eye sees an
 * interpolated in-between frame between every pair of drawings — the
 * motion reads fluid, like a cartoon, instead of hard-cutting between
 * stills. Sequences use as many distinct drawings as the art has (the
 * chew cycle, for example, is base → chew-mid → chew-open → chew-mid →
 * base, not just two frames).
 */
function resolveSequence(a: PetAssets, mood: MoodId, action: PetAction): SeqStep[] {
  const p = sheetPanels(a);
  const base = img(a.base, 'base');
  const blink: SeqStep[] = [
    { frame: base, durationMs: 3850 },
    { frame: img(a.blink, 'blink'), durationMs: 150 },
  ];

  if (action !== 'idle') {
    switch (action) {
      case 'eat':
        // Chew cycle — mouth only, body never changes size.
        return [
          { frame: base, durationMs: 100 },
          { frame: p.chewMid, durationMs: 100 },
          { frame: p.chewOpen, durationMs: 100 },
          { frame: p.chewMid, durationMs: 100 },
          { frame: base, durationMs: 100 },
        ];
      case 'drink':
        // Sip loop: drink frame, brief return to base (gulp).
        return [
          { frame: img(a.drink, 'drink'), durationMs: 800 },
          { frame: base, durationMs: 250 },
        ];
      case 'bath':
        // Scrub cycle — happy face alternating with base while the pet
        // wiggles (see 'scrub' motion) under floating soap bubbles.
        // Added Nov 24, 2026: Bath previously played no animation at all
        // (RoomScreen reset the action to 'idle'); parity with the
        // extension, which wiggles the sprite + shows 🫧 bubbles.
        return [
          { frame: img(a.happy, 'happy'), durationMs: 180 },
          { frame: base, durationMs: 180 },
          { frame: p.excited, durationMs: 180 },
        ];
      case 'sleep':
        return [{ frame: img(a.sleep, 'sleep'), durationMs: 1000 }];
      case 'play':
        return [
          { frame: base, durationMs: 160 },
          { frame: img(a.happy, 'happy'), durationMs: 160 },
          { frame: p.excited, durationMs: 160 },
        ];
      case 'sick':
        return [{ frame: p.sick, durationMs: 1000 }];
      case 'tantrum':
        return [
          { frame: p.tantrum, durationMs: 160 },
          { frame: p.grumpy, durationMs: 160 },
        ];
      case 'potty':
        return [{ frame: p.potty, durationMs: 1000 }];
      case 'celebrate':
        return [
          { frame: p.celebrate, durationMs: 220 },
          { frame: p.excited, durationMs: 220 },
          { frame: img(a.happy, 'happy'), durationMs: 220 },
        ];
      case 'lonely':
        return [{ frame: p.lonely, durationMs: 1000 }];
      case 'walk':
        // Wandering waddle — face bobs between base and happy while the
        // stage drifts the pet across the room (see PetStage wander).
        return [
          { frame: base, durationMs: 140 },
          { frame: img(a.happy, 'happy'), durationMs: 140 },
        ];
      default:
        return blink;
    }
  }

  switch (mood) {
    case 'happy':
      return [
        { frame: img(a.happy, 'happy'), durationMs: 400 },
        { frame: p.excited, durationMs: 400 },
      ];
    case 'excited':
      return [
        { frame: p.excited, durationMs: 300 },
        { frame: img(a.happy, 'happy'), durationMs: 300 },
      ];
    case 'sick':
      return [{ frame: p.sick, durationMs: 1000 }];
    case 'sad':
      return [{ frame: img(a.sad, 'sad'), durationMs: 1000 }];
    case 'grumpy':
      return [{ frame: p.grumpy, durationMs: 1000 }];
    case 'lonely':
      return [{ frame: p.lonely, durationMs: 1000 }];
    case 'sleepy':
      return [{ frame: img(a.sleep, 'sleep'), durationMs: 1000 }];
    case 'sleeping':
      // Curled-up deep-sleep panel (has its own drawn Zzz).
      return [{ frame: p.sleepDeep, durationMs: 1000 }];
    case 'thirsty':
      return [{ frame: img(a.drink, 'drink'), durationMs: 1000 }];
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
  | 'scrub'
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
      case 'bath':
        return 'scrub';
      case 'walk':
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
/* Floating soap bubbles (bath action)                                 */
/* ------------------------------------------------------------------ */

/** One bubble rising and fading on a loop, offset by `delayMs`. */
function Bubble({
  size,
  leftPct,
  topPct,
  fontSize,
  delayMs,
}: {
  size: number;
  leftPct: number;
  topPct: number;
  fontSize: number;
  delayMs: number;
}) {
  const rise = useSharedValue(0);
  const fade = useSharedValue(0);

  useEffect(() => {
    // Rise ~14px over 1.4s while fading in, holding, then fading out;
    // the zero-duration reset at the end is invisible (opacity 0).
    // Matches the extension's `.bath-bubbles span` floaty 1.4s loop.
    rise.value = withRepeat(
      withSequence(
        withDelay(delayMs, withTiming(-14, { duration: 1400, easing: Easing.inOut(Easing.ease) })),
        withTiming(0, { duration: 0 }),
      ),
      -1,
    );
    fade.value = withRepeat(
      withSequence(
        withDelay(delayMs, withTiming(1, { duration: 250 })),
        withTiming(1, { duration: 700 }),
        withTiming(0, { duration: 450 }),
        withTiming(0, { duration: 200 }),
      ),
      -1,
    );
    return () => {
      cancelAnimation(rise);
      cancelAnimation(fade);
    };
  }, [rise, fade, delayMs]);

  const style = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ translateY: rise.value }],
  }));

  return (
    <Animated.View
      style={[
        styles.bubble,
        { left: `${leftPct}%`, top: `${topPct}%` },
        style,
      ]}
    >
      <Text style={{ fontSize }}>🫧</Text>
    </Animated.View>
  );
}

function FloatingBubbles({ size }: { size: number }) {
  return (
    <View style={styles.bubbles} pointerEvents="none">
      <Bubble size={size} leftPct={14} topPct={58} fontSize={size * 0.09} delayMs={0} />
      <Bubble size={size} leftPct={52} topPct={38} fontSize={size * 0.11} delayMs={450} />
      <Bubble size={size} leftPct={74} topPct={62} fontSize={size * 0.08} delayMs={900} />
      <Bubble size={size} leftPct={32} topPct={22} fontSize={size * 0.09} delayMs={200} />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Crossfaded layer rendering (Nov 24, 2026)                           */
/* ------------------------------------------------------------------ */

/**
 * How long one frame blends into the next. Every frame change crossfades
 * the outgoing layer out and the incoming layer in over this long, so the
 * eye sees an interpolated in-between frame between every pair of
 * drawings — that is what makes the animation read fluid, like a cartoon,
 * instead of hard-cutting between stills. Kept just under the shortest
 * sequence step (eat, 100 ms) so blends never queue up.
 */
const CROSSFADE_MS = 80;

type PanelPos = { col: number; row: number } | null;

interface PetLayerProps {
  size: number;
  source: ImageSourcePropType;
  sheet: boolean;
  cols: number;
  rows: number;
  isActive: boolean;
  isPrev: boolean;
  /** Current panel offset on this sheet (null when the active frame is
   *  not a panel of this sheet). */
  panel: PanelPos;
  /** Previous panel offset on this sheet (for crossfading two panels of
   *  the same sheet). */
  prevPanel: PanelPos;
  /** Shared 0→1 progress of the current crossfade. */
  fade: SharedValue<number>;
}

/**
 * One always-mounted layer (a still, or one sprite sheet). A frame change
 * never mounts, unmounts, or swaps an image src — it only animates
 * opacities (the Nov 23 blink fix, kept), and now the outgoing layer
 * fades out while the incoming layer fades in instead of flipping
 * instantly. When the outgoing and incoming frames are two panels of
 * the SAME sheet, the sheet is rendered twice at different offsets, one
 * fading out and one fading in.
 */
function PetLayer({
  size,
  source,
  sheet,
  cols,
  rows,
  isActive,
  isPrev,
  panel,
  prevPanel,
  fade,
}: PetLayerProps) {
  const mainStyle = useAnimatedStyle(() => ({
    opacity: isActive ? fade.value : isPrev ? 1 - fade.value : 0,
  }));
  const prevStyle = useAnimatedStyle(() => ({ opacity: 1 - fade.value }));
  const currStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  const windowStyle = {
    position: 'absolute' as const,
    width: size,
    height: size,
    overflow: 'hidden' as const,
  };
  const sheetImageStyle = (col: number, row: number) => ({
    position: 'absolute' as const,
    width: size * cols,
    height: size * rows,
    left: -col * size,
    top: -row * size,
  });

  if (
    sheet &&
    panel &&
    prevPanel &&
    (panel.col !== prevPanel.col || panel.row !== prevPanel.row)
  ) {
    return (
      <View style={windowStyle}>
        <Animated.View style={[StyleSheet.absoluteFill, prevStyle]}>
          <Image
            source={source}
            fadeDuration={0}
            style={sheetImageStyle(prevPanel.col, prevPanel.row)}
            resizeMode="stretch"
          />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, currStyle]}>
          <Image
            source={source}
            fadeDuration={0}
            style={sheetImageStyle(panel.col, panel.row)}
            resizeMode="stretch"
          />
        </Animated.View>
      </View>
    );
  }

  const offset = panel ?? prevPanel;
  return (
    <Animated.View style={[windowStyle, mainStyle]}>
      <Image
        source={source}
        fadeDuration={0}
        style={
          sheet
            ? sheetImageStyle(offset?.col ?? 0, offset?.row ?? 0)
            : { width: size, height: size }
        }
        resizeMode={sheet ? 'stretch' : 'contain'}
      />
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
      case 'scrub':
        // Bath scrub-wiggle: rapid small side-to-side scrub, mirroring
        // the extension's `scrub-wiggle .28s` CSS animation.
        translateX.value = withRepeat(
          withSequence(
            withTiming(-4, { duration: 140, easing: inOut }),
            withTiming(4, { duration: 280, easing: inOut }),
            withTiming(-4, { duration: 140, easing: inOut }),
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

  // CROSSFADE (Nov 24, 2026): when the frame changes, keep the outgoing
  // frame mounted as `prevFrame` and animate `fade` 0→1 over
  // CROSSFADE_MS — PetLayer fades the old layer out while the new one
  // fades in. The blink fix still holds: nothing ever mounts, unmounts,
  // or swaps src mid-animation, and fadeDuration={0} kills the native
  // fade-in, so the pet is visible in every single frame.
  const [prevFrame, setPrevFrame] = useState<Frame | null>(null);
  const fade = useSharedValue(1);
  const frameRef = useRef(frame);
  useEffect(() => {
    if (frameRef.current !== frame) {
      const old = frameRef.current;
      frameRef.current = frame;
      setPrevFrame(old);
      fade.value = 0;
      fade.value = withTiming(1, { duration: CROSSFADE_MS });
      const t = setTimeout(() => setPrevFrame(null), CROSSFADE_MS + 30);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [frame, fade]);

  // BLINK FIX (Nov 23, 2026): the pet used to vanish for a split second on
  // every frame change. Two causes, both fixed here by layered rendering:
  //  (1) the old code conditionally rendered either a still <Image> or a
  //      sheet <Image> inside an overflow-hidden window, so every
  //      image<->panel switch UNMOUNTED one image and mounted another —
  //      the new image was blank until it loaded/decoded (on web the
  //      sprite sheets load on first use, mid-animation);
  //  (2) on Android, every <Image> source change fades in from transparent
  //      over the default fadeDuration of 300ms.
  // Now ALL of the pet's frames are mounted from the first render — 7
  // stills + 2 sheets — and a frame change only flips which layer has
  // opacity 1. Nothing ever mounts, unmounts, or swaps src mid-animation,
  // and fadeDuration={0} kills the native fade-in, so the pet is visible
  // in every single frame on web, Android, and iOS.
  const panel: PanelPos =
    frame.kind === 'panel' ? { col: frame.col, row: frame.row } : null;
  const prevPanel: PanelPos =
    prevFrame?.kind === 'panel' ? { col: prevFrame.col, row: prevFrame.row } : null;
  const activeLayer: LayerKey = frame.kind === 'image' ? frame.layer : frame.sheet;
  const prevLayer: LayerKey | null = prevFrame
    ? prevFrame.kind === 'image'
      ? prevFrame.layer
      : prevFrame.sheet
    : null;
  const layers: {
    key: LayerKey;
    source: ImageSourcePropType;
    sheet: boolean;
    cols: number;
    rows: number;
  }[] = [
    { key: 'base', source: assets.base, sheet: false, cols: 1, rows: 1 },
    { key: 'blink', source: assets.blink, sheet: false, cols: 1, rows: 1 },
    { key: 'eat', source: assets.eat, sheet: false, cols: 1, rows: 1 },
    { key: 'drink', source: assets.drink, sheet: false, cols: 1, rows: 1 },
    { key: 'happy', source: assets.happy, sheet: false, cols: 1, rows: 1 },
    { key: 'sad', source: assets.sad, sheet: false, cols: 1, rows: 1 },
    { key: 'sleep', source: assets.sleep, sheet: false, cols: 1, rows: 1 },
    { key: 'expressions', source: assets.expressionsSheet, sheet: true, cols: 3, rows: 2 },
    { key: 'actions', source: assets.actionsSheet, sheet: true, cols: 2, rows: 2 },
  ];

  return (
    <View style={[styles.stage, { width: size, height: size }]}>
      <Animated.View style={[styles.sprite, { width: size, height: size }, animatedStyle]}>
        {layers.map((layer) => (
          <PetLayer
            key={layer.key}
            size={size}
            source={layer.source}
            sheet={layer.sheet}
            cols={layer.cols}
            rows={layer.rows}
            isActive={layer.key === activeLayer}
            isPrev={layer.key === prevLayer}
            panel={layer.key === activeLayer ? panel : null}
            prevPanel={layer.key === prevLayer ? prevPanel : null}
            fade={fade}
          />
        ))}
      </Animated.View>
      {showZzz ? <FloatingZzz size={size} /> : null}
      {action === 'bath' ? <FloatingBubbles size={size} /> : null}
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
  bubbles: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  bubble: {
    position: 'absolute',
  },
});
