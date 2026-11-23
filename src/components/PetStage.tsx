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
 */
import { useEffect } from 'react';
import { Image, Pressable, StyleSheet, Text } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import Animated, {
  Easing,
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
}: PetStageProps) {
  const pet = ppPetById(petId);
  const isEgg = stageIndex === 0;
  // Hat sits on the head: sprite top + headTop fraction of the sprite.
  const hatTop = Math.max(0, size * (pet.headTop || 0.03) - 14);

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
        <AnimatedPet petId={petId} mood={mapMood(mood)} action={action} size={size} />
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
