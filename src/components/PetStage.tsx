/**
 * PetStage — renders the pet on the Room screen.
 *
 * Uses src/components/AnimatedPet for all 10 pets (Momo, Kiki, Boba,
 * Yuki, Taro, Purin, Sora, Miso, Hana, Nori). The PngPet fallback below
 * is kept only for unknown ids — it renders the base PNG with a gentle
 * Reanimated translateY bob, so the stage never renders empty.
 *
 * The pet NEVER changes size (user rule): motion is translate/rotate
 * only, no scale transforms anywhere.
 *
 * Props:
 *   petId      — roster id from logic.ts (PP.PETS)
 *   mood       — derived store mood (logic.ts MoodId)
 *   action     — one-shot action animation ('idle' when none)
 *   size       — rendered size in px (width = height)
 *   stageIndex — growth stage 0..4 (0 = Egg)
 *   hatOn      — Pink Bow equipped (hat sits on the head via headTop)
 *   isSparkle  — sparkle adult form
 *   onPress    — tap the pet to give it a pat
 *   wander     — when true (Room screen), the pet wanders the room on its
 *     own: walks to a spot, then waits 15–30 s before the next walk.
 *     Code-driven movement using the existing art (translate/rotate
 *     only, never scale — the pet leans slightly into the walk and its
 *     body bobs once per step, in time with the walk-cycle frames; it
 *     does not flip, so it never changes size or mirrors). The walk
 *     frames are mood-matched (see AnimatedPet 'walk'): a sad pet walks
 *     sad, a grumpy pet stomps, a tired pet trudges. Pauses while
 *     sleeping, sick, sleepy, or during a one-shot action, and drifts
 *     back to centre first.
 */
import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text } from 'react-native';
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
import AnimatedPet from './AnimatedPet';
import type { MoodId as AnimMoodId, PetAction, PetId } from './AnimatedPet';
import { ppPetById } from '../game/logic';
import type { MoodId } from '../game/logic';

export type { PetAction };

export interface PetStageProps {
  petId: string;
  mood: MoodId;
  action?: PetAction;
  size?: number;
  stageIndex?: number;
  hatOn?: boolean;
  isSparkle?: boolean;
  onPress?: () => void;
  testID?: string;
  /** Let the pet wander the room on its own (Room screen only). */
  wander?: boolean;
}

/** How far (px) the pet drifts left/right of centre while wandering. */
const WANDER_RANGE = 64;

/** Shortest walk worth taking (px) — shorter hops read as fidgeting,
 *  not walking (Nov 24, 2026: the first proof run caught an 11 px
 *  shuffle). Every walk covers at least this far. */
const MIN_WALK_PX = 24;

/** Pause between walks, in ms — 15–30 s, random (Nov 24, 2026: the user
 *  said build #5's pet walked around far too much; the old 1.5–4 s pause
 *  had it marching every few seconds). */
const WANDER_PAUSE_MIN_MS = 15000;
const WANDER_PAUSE_MAX_MS = 30000;

/** Walk speed in px per second — the drift duration is distance / speed,
 *  so short hops are quick and long walks take longer, like a pet walking
 *  with purpose instead of drifting. */
const WANDER_SPEED_PX_PER_S = 55;

/**
 * One step's frame duration in ms for the current mood — MUST match the
 * walk-cycle step durations in AnimatedPet resolveSequence ('walk'), so
 * the body's step bob stays in time with the legs. Cheerful 160 ms,
 * grumpy 200 ms, sad / lonely / tired (hungry, thirsty, dirty, bored)
 * 300 ms — the trudge reads in the pace as well as the face.
 */
function walkStepMs(mood: MoodId): number {
  switch (mood) {
    case 'grumpy':
      return 200;
    case 'sad':
    case 'lonely':
    case 'hungry':
    case 'thirsty':
    case 'dirty':
    case 'bored':
      return 300;
    default:
      return 160;
  }
}

/** Static image map — Metro requires literal require() calls. */
export const PET_IMAGES: Record<string, ImageSourcePropType> = {
  momo: require('../../assets/pets/momo.png'),
  kiki: require('../../assets/pets/kiki.png'),
  boba: require('../../assets/pets/boba.png'),
  yuki: require('../../assets/pets/yuki.png'),
  taro: require('../../assets/pets/taro.png'),
  purin: require('../../assets/pets/purin.png'),
  sora: require('../../assets/pets/sora.png'),
  miso: require('../../assets/pets/miso.png'),
  hana: require('../../assets/pets/hana.png'),
  nori: require('../../assets/pets/nori.png'),
};

/** AnimatedPet has no 'potty' mood — the pet waits contentedly instead. */
function mapMood(mood: MoodId): AnimMoodId {
  if (mood === 'potty') return 'content';
  return mood;
}

const ANIMATED_PET_IDS: readonly PetId[] = [
  'momo',
  'kiki',
  'boba',
  'yuki',
  'taro',
  'purin',
  'sora',
  'miso',
  'hana',
  'nori',
];

function isAnimatedPetId(petId: string): petId is PetId {
  return (ANIMATED_PET_IDS as readonly string[]).includes(petId);
}

/** PNG fallback with a gentle bob (translateY only, never scale). */
function PngPet({ petId, size }: { petId: string; size: number }) {
  const bob = useSharedValue(0);
  useEffect(() => {
    bob.value = withRepeat(
      withSequence(
        withTiming(-6, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [bob]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: bob.value }] }));
  return (
    <Animated.View style={style}>
      <Image
        source={PET_IMAGES[petId] ?? PET_IMAGES.momo}
        fadeDuration={0}
        style={{ width: size, height: size, resizeMode: 'contain' }}
        accessibilityLabel={ppPetById(petId).name}
      />
    </Animated.View>
  );
}

export default function PetStage({
  petId,
  mood,
  action = 'idle',
  size = 240,
  stageIndex = 1,
  hatOn = false,
  isSparkle = false,
  onPress,
  testID,
  wander = false,
}: PetStageProps) {
  const pet = ppPetById(petId);
  const isEgg = stageIndex === 0;
  // Hat sits on the head: sprite top + headTop fraction of the sprite.
  const hatTop = Math.max(0, size * (pet.headTop || 0.03) - 14);

  // -- Wander (Nov 24, 2026; reworked after build #5 feedback) ---------
  // The pet walks to a spot, then waits 15–30 s before the next walk.
  // Only while idle, awake, and well; any one-shot action, sleep, or
  // sickness pauses it and drifts the pet back to centre first. No flip:
  // the pet never mirrors (that would be a scale transform, banned by
  // the user rule) — direction reads from the lean + drift instead.
  //
  // WHY IT LOOKED LIKE DANCING (build #5): the old code waddle-bobbed
  // ±3px on a fixed 280 ms loop while the pet drifted with an ease-in-out
  // (slow-fast-slow) — the body swayed independently of the legs, so the
  // pet rocked back and forth instead of walking. Now: (1) the drift runs
  // at a CONSTANT speed (linear easing, duration from distance), like a
  // pet walking with purpose; (2) the body bob is ONE small dip per step
  // (±2px, period = two step-frames), in time with the legs; (3) the lean
  // is a small STEADY 2° tilt held for the whole walk, not a sway.
  // PetStage drives all of this — AnimatedPet's walk motion is 'still',
  // so nothing stacks on top of the bob.
  const wanderX = useSharedValue(0);
  const wanderBob = useSharedValue(0);
  const wanderTilt = useSharedValue(0);
  const [wandering, setWandering] = useState(false);
  const wanderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wanderPos = useRef(0);

  const canWander =
    wander &&
    !isEgg &&
    action === 'idle' &&
    mood !== 'sleeping' &&
    mood !== 'sleepy' &&
    mood !== 'sick';

  // Stop wandering the moment it is no longer allowed — reset during
  // render (React's "adjusting state during render" pattern, same as
  // useFrameSequence in AnimatedPet); the effect below handles the
  // timers and shared values.
  if (!canWander && wandering) {
    setWandering(false);
  }

  useEffect(() => {
    if (!canWander) {
      if (wanderTimer.current) clearTimeout(wanderTimer.current);
      cancelAnimation(wanderX);
      cancelAnimation(wanderBob);
      cancelAnimation(wanderTilt);
      wanderX.value = withTiming(0, { duration: 400 });
      wanderBob.value = 0;
      wanderTilt.value = 0;
      wanderPos.current = 0;
      return undefined;
    }
    let cancelled = false;
    const pauseMs = () =>
      WANDER_PAUSE_MIN_MS + Math.random() * (WANDER_PAUSE_MAX_MS - WANDER_PAUSE_MIN_MS);
    const scheduleNext = (delayMs: number) => {
      wanderTimer.current = setTimeout(() => {
        if (cancelled) return;
        const from = wanderPos.current;
        // Pick a spot at least MIN_WALK_PX away: a 5 px shuffle reads as
        // fidgeting, not walking. Direction is random, biased away from
        // the edge the pet is already near.
        const dir =
          from > 40 ? -1 : from < -40 ? 1 : Math.random() < 0.5 ? -1 : 1;
        const target = Math.max(
          -WANDER_RANGE,
          Math.min(
            WANDER_RANGE,
            from + dir * (MIN_WALK_PX + Math.random() * 40),
          ),
        );
        const dist = Math.abs(target - from);
        // Constant walking speed: longer walks take longer.
        const dur = Math.min(3000, Math.max(900, (dist / WANDER_SPEED_PX_PER_S) * 1000));
        const stepMs = walkStepMs(mood);
        setWandering(true);
        // Steady small lean into the walk, held for the whole walk.
        wanderTilt.value = withTiming(dir * 2, {
          duration: 300,
          easing: Easing.inOut(Easing.ease),
        });
        // One small dip per step, in time with the walk-cycle frames
        // (two frames per step cycle, so the bob period is 2 * stepMs).
        wanderBob.value = withRepeat(
          withTiming(-2, { duration: stepMs, easing: Easing.inOut(Easing.ease) }),
          -1,
          true,
        );
        // Linear easing: constant speed, walking with purpose.
        wanderX.value = withTiming(target, { duration: dur, easing: Easing.linear });
        wanderPos.current = target;
        wanderTimer.current = setTimeout(() => {
          if (cancelled) return;
          setWandering(false);
          cancelAnimation(wanderBob);
          wanderBob.value = 0;
          wanderTilt.value = withTiming(0, { duration: 300 });
          scheduleNext(pauseMs());
        }, dur + 60);
      }, delayMs);
    };
    scheduleNext(pauseMs());
    return () => {
      cancelled = true;
      if (wanderTimer.current) clearTimeout(wanderTimer.current);
    };
    // Shared values + refs are stable; the cycle restarts when canWander
    // flips or the mood changes (the step bob period must match the new
    // mood's walk-cycle pace — see walkStepMs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canWander, mood]);

  const wanderStyle = useAnimatedStyle(() => ({
    // translate / rotate ONLY — never scale (user rule).
    transform: [
      { translateX: wanderX.value },
      { translateY: wanderBob.value },
      { rotate: `${wanderTilt.value}deg` },
    ],
  }));

  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityLabel={`${pet.name}, tap to pet`}
      style={[styles.wrap, { width: size + 24, height: size + 8 }]}
    >
      {isEgg ? (
        <Text style={{ fontSize: size * 0.55, lineHeight: size * 0.6 }}>🥚</Text>
      ) : isAnimatedPetId(petId) ? (
        <Animated.View style={wanderStyle}>
          <AnimatedPet
            petId={petId}
            mood={mapMood(mood)}
            action={action === 'idle' && wandering ? 'walk' : action}
            size={size}
          />
        </Animated.View>
      ) : (
        <PngPet petId={petId} size={size} />
      )}
      {!isEgg && hatOn && (
        <Text style={[styles.hat, { top: hatTop, fontSize: 30 }]}>🎀</Text>
      )}
      {!isEgg && isSparkle && <Text style={styles.sparkle}>✨</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    position: 'relative',
  },
  hat: {
    position: 'absolute',
    left: '50%',
    marginLeft: -15,
    transform: [{ rotate: '-8deg' }],
    zIndex: 4,
  },
  sparkle: {
    position: 'absolute',
    top: -4,
    right: 6,
    fontSize: 24,
    zIndex: 4,
  },
});
