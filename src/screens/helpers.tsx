/**
 * Shared screen helpers: toast + audio prefs.
 * Toast copy matches the extension (popup.js) — 2.6s, one at a time.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { audioPlayer } from '../audio/player';
import { sharedStyles } from './theme';

export function useToast() {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const ToastView = toast ? (
    <View style={sharedStyles.toast} pointerEvents="none">
      <View style={sharedStyles.toastBubble}>
        <Text style={sharedStyles.toastText}>{toast}</Text>
      </View>
    </View>
  ) : null;

  return { toast, showToast, ToastView };
}

/** Mute + music-on state from the audio service (persisted in AsyncStorage). */
export function useAudioPrefs() {
  const [muted, setMuted] = useState(false);
  const [musicOn, setMusicOn] = useState(true);

  const refresh = useCallback(async () => {
    try {
      await audioPlayer.init();
      setMuted(audioPlayer.isMuted());
      setMusicOn(audioPlayer.isMusicOn());
    } catch {
      // Audio is best-effort; the game must never break over it.
    }
  }, []);

  // Load persisted prefs on mount. setState runs in the async continuation
  // (not synchronously in the effect body) so the effect only subscribes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await audioPlayer.init();
        if (cancelled) {
          return;
        }
        setMuted(audioPlayer.isMuted());
        setMusicOn(audioPlayer.isMusicOn());
      } catch {
        // Audio is best-effort; the game must never break over it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleMute = useCallback(async () => {
    const next = await audioPlayer.toggleMuted();
    setMuted(next);
    return next;
  }, []);

  const toggleMusic = useCallback(async () => {
    const next = await audioPlayer.toggleMusic();
    setMusicOn(next);
    return next;
  }, []);

  return { muted, musicOn, toggleMute, toggleMusic, refresh };
}

/** Map a store mood + current action to the toast bubble after an action. */
export const ACTION_BUBBLES: Record<string, string> = {
  meal: 'Yum! That hit the spot! 🍡',
  snack: 'A snack! My favorite! 🍪',
  snackHeavy: 'Tasty… but I feel heavy. 🍪',
  drink: 'Glug glug… ahh! 🧋',
  bath: 'Squeaky clean! 🧼',
  medicineBetter: 'I feel better already! 💊',
  medicineMore: 'Still sick… one more dose! 💊',
  sleep: 'Good night… 💤',
  wake: 'Good morning! ☀️',
  potty: 'Phew! All done! 🚽',
  scold: 'Okay… sorry… 🥺',
};
