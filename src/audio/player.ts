/**
 * Boba Buddies Mobile — audio player service (expo-audio, SDK 58).
 *
 * Plays the background music loop in `assets/audio/` (Cozy Hearth —
 * an original music-box waltz loop rendered by
 * `music-samples/render_loop_cozy.py`, 100% original, no downloaded
 * audio) and the short sound effects, with music mode switching, a
 * music on/off toggle, and a master mute, both persisted in AsyncStorage.
 * Cozy Hearth replaced Morning Meadow on Nov 24, 2026 (user pick).
 *
 * API verified against the installed expo-audio 58.0.12 typings
 * (node_modules/expo-audio/build/*.d.ts) and the SDK 58 Android
 * sources (packages/expo-audio/android/.../AudioModule.kt,
 * AudioPlayer.kt, BaseAudioPlayer.kt):
 *   - createAudioPlayer(source, options) -> AudioPlayer
 *   - player.play() / pause() / replace(source) / remove() / release()
 *   - player.loop, player.volume, player.muted, player.isLoaded,
 *     player.playing, player.isBuffering, player.currentTime
 *   - player.addListener('playbackStatusUpdate', (status: AudioStatus) => ...)
 *     (AudioPlayer extends SharedObject<AudioEvents>)
 *   - setAudioModeAsync({ playsInSilentMode, interruptionMode })
 *   - setIsAudioActiveAsync(active)
 *   - createAudioPlayer option keepAudioSessionActive: keeps the audio
 *     session/focus held when the player pauses.
 *
 * The expo-audio wiring itself is code-only until the app is run on a
 * device / dev build — the WAV files were proven to actually play in a
 * browser (see scripts/audio/VERIFY.md). Nothing here throws: a missing
 * audio file is logged and playback continues silently.
 *
 * NOV 25, 2026 BUG — all audio died mid-session and stayed dead
 * (user testing build #6 on Android; no call, notification, app
 * switch or lock — he was tapping around, possibly on the Play tab):
 * Two defects combined, both fixed here:
 *   1. SFX PLAYER LEAK. Every tap created a fresh native player
 *      (ExoPlayer + MediaSession) and "released" it with remove()
 *      only. On Android, remove() merely unregisters the player from
 *      expo-audio's module map — the native player is NOT freed; it
 *      is only destroyed when the JS SharedObject is released or
 *      garbage-collected (AudioModule.kt: Function("remove") calls
 *      removePlayer(id) only; the native release lives in
 *      BaseAudioPlayer.sharedObjectDidRelease -> releasePlayer()).
 *      A long play session therefore leaks one native player per
 *      tap until Android runs out of audio resources and ALL sound
 *      (music + SFX) goes silent for the rest of the session — the
 *      exact failure reported for expo-audio in Oct 2026 (dev.to,
 *      "Sound stops after a few minutes on Android in your Expo
 *      app"). Fix: call player.release() after remove() so the
 *      native player is destroyed promptly.
 *   2. GRATUITOUS replace() ON EVERY TAB SWITCH. All three music
 *      modes use the SAME Cozy Hearth file, yet every tab switch
 *      called player.replace(same file) — a destructive teardown +
 *      re-prepare of the playing pipeline (and a restart of the loop
 *      from the top) for zero audible difference. replace() is the
 *      flakiest call in expo-audio on Android (expo/expo#35670,
 *      "replace() not working on Android"; 58.0.0 fixed only the
 *      empty-source case), and a play() issued while the new source
 *      is still preparing can be swallowed with nothing ever
 *      retrying it. Fix: skip replace() when the target mode uses
 *      the same source already loaded, serialize mode switches so
 *      fire-and-forget calls can't interleave, and add a status
 *      listener + watchdog + foreground resume so a stopped player
 *      is restarted instead of staying silent forever.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import {
  createAudioPlayer,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  type AudioPlayer,
} from 'expo-audio';

export type MusicMode = 'daytime' | 'lullaby' | 'playtime';

export type SfxName =
  | 'button'
  | 'tap'
  | 'coin'
  | 'chew'
  | 'slurp'
  | 'gulp'
  | 'ding'
  | 'hatch'
  | 'squeak'
  | 'win'
  | 'lose'
  | 'yawn'
  | 'giggle'
  | 'footsteps'
  | 'scrub'
  | 'scold'
  | 'sparkle'
  | 'potty'
  | 'hop'
  | 'heart'
  | 'error';

export const MUSIC_MODES: MusicMode[] = ['daytime', 'lullaby', 'playtime'];
export const SFX_NAMES: SfxName[] = [
  'button', 'tap', 'coin', 'chew', 'slurp', 'gulp', 'ding', 'hatch',
  'squeak', 'win', 'lose', 'yawn', 'giggle', 'footsteps', 'scrub',
  'scold', 'sparkle', 'potty', 'hop', 'heart', 'error',
];

export const MUSIC_ON_KEY = 'bbMusicOn';
export const MUTED_KEY = 'bbMuted';

const MUSIC_VOLUME = 0.45;
const SFX_VOLUME = 0.9;
/** Max simultaneous SFX players — extra plays drop the oldest, never clip. */
const MAX_CONCURRENT_SFX = 8;
/** How often the watchdog checks the music player is still playing. */
const WATCHDOG_MS = 3000;
/** Minimum gap between music recovery attempts (avoids a hot retry loop). */
const RECOVERY_MIN_GAP_MS = 1500;
/** Delay before checking whether a fresh SFX player actually started. */
const SFX_START_CHECK_MS = 300;

/** Bundled music loop. Cozy Hearth plays in every mode (daytime /
 * lullaby / playtime all use the same track — picked by the user Nov 24,
 * 2026, replacing Morning Meadow). `require` returns the Metro asset id
 * (a number), which expo-audio accepts as an AudioSource. */
const MUSIC_SOURCES: Record<MusicMode, number> = {
  daytime: require('../../assets/audio/music-cozy-hearth.wav'),
  lullaby: require('../../assets/audio/music-cozy-hearth.wav'),
  playtime: require('../../assets/audio/music-cozy-hearth.wav'),
};

const SFX_SOURCES: Record<SfxName, number> = {
  button: require('../../assets/audio/sfx-button.wav'),
  tap: require('../../assets/audio/sfx-tap.wav'),
  coin: require('../../assets/audio/sfx-coin.wav'),
  chew: require('../../assets/audio/sfx-chew.wav'),
  slurp: require('../../assets/audio/sfx-slurp.wav'),
  gulp: require('../../assets/audio/sfx-gulp.wav'),
  ding: require('../../assets/audio/sfx-ding.wav'),
  hatch: require('../../assets/audio/sfx-hatch.wav'),
  squeak: require('../../assets/audio/sfx-squeak.wav'),
  win: require('../../assets/audio/sfx-win.wav'),
  lose: require('../../assets/audio/sfx-lose.wav'),
  yawn: require('../../assets/audio/sfx-yawn.wav'),
  giggle: require('../../assets/audio/sfx-giggle.wav'),
  footsteps: require('../../assets/audio/sfx-footsteps.wav'),
  scrub: require('../../assets/audio/sfx-scrub.wav'),
  scold: require('../../assets/audio/sfx-scold.wav'),
  sparkle: require('../../assets/audio/sfx-sparkle.wav'),
  potty: require('../../assets/audio/sfx-potty.wav'),
  hop: require('../../assets/audio/sfx-hop.wav'),
  heart: require('../../assets/audio/sfx-heart.wav'),
  error: require('../../assets/audio/sfx-error.wav'),
};

/** Rendered durations (seconds) from scripts/audio/synth.mjs — used only
 * to know when a one-shot SFX player can be released. */
const SFX_DURATIONS: Record<SfxName, number> = {
  button: 0.12, tap: 0.16, coin: 0.5, chew: 0.6, slurp: 0.6, gulp: 0.4,
  ding: 0.55, hatch: 0.95, squeak: 0.4, win: 1.05, lose: 0.6, yawn: 0.75,
  giggle: 0.7, footsteps: 0.55, scrub: 0.65, scold: 0.35, sparkle: 0.5,
  potty: 0.35, hop: 0.4, heart: 0.85, error: 0.55,
};

/** Minimal shape of the playback status this service reacts to — a
 * structural subset of expo-audio's AudioStatus, so no type import
 * from the package is needed (addListener infers the full type). */
type MusicStatus = {
  playing: boolean;
  isLoaded: boolean;
  isBuffering: boolean;
  error: string | null;
};

class AudioService {
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private musicPlayer: AudioPlayer | null = null;
  /** The source currently loaded in the music player (all modes share
   * one file today — see setMusicMode). */
  private currentMusicSource: number | null = null;
  private musicStatusSub: { remove(): void } | null = null;
  private sfxPlayers: AudioPlayer[] = [];
  private mode: MusicMode = 'daytime';
  private musicOn = true;
  private muted = false;
  /** Serializes fire-and-forget setMusicMode calls so two tab
   * switches can't interleave a replace + play sequence. */
  private modeQueue: Promise<void> = Promise.resolve();
  private watchdogId: ReturnType<typeof setInterval> | null = null;
  private appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;
  private lastMusicRecoveryAt = 0;
  private musicHadError = false;

  /** Load persisted prefs, configure the audio session, and build the
   * looping music player. Safe to call repeatedly; never throws. */
  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    await this.initPromise;
  }

  private async doInit(): Promise<void> {
    try {
      const [musicOnRaw, mutedRaw] = await Promise.all([
        AsyncStorage.getItem(MUSIC_ON_KEY),
        AsyncStorage.getItem(MUTED_KEY),
      ]);
      // Defaults: music ON, sound ON (muted=false). Only an explicit
      // stored 'false'/'true' overrides.
      this.musicOn = musicOnRaw !== 'false';
      this.muted = mutedRaw === 'true';
    } catch (e) {
      console.warn('[audio] Failed to load audio prefs, using defaults:', e);
    }

    await this.assertAudioSession();

    this.createMusicPlayer();
    this.initialized = true;
    this.applyMusicState();
    this.startWatchdog();
    this.startForegroundResume();
  }

  /** (Re-)assert the audio session: activate it and re-apply the
   * mode. Never throws. */
  private async assertAudioSession(): Promise<void> {
    try {
      await setIsAudioActiveAsync(true);
    } catch (e) {
      console.warn('[audio] setIsAudioActiveAsync failed:', e);
    }
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        interruptionMode: 'mixWithOthers',
      });
    } catch (e) {
      console.warn('[audio] setAudioModeAsync failed:', e);
    }
  }

  /**
   * Re-assert the audio session and re-apply the music state — the
   * recovery step after an interruption, a foreground return, or a
   * player that stopped for no visible reason. Never throws.
   */
  async resumeAudio(): Promise<void> {
    await this.init();
    await this.assertAudioSession();
    this.applyMusicState();
  }

  private createMusicPlayer(): void {
    try {
      const source = MUSIC_SOURCES[this.mode];
      if (source == null) {
        console.warn(`[audio] Missing music source for mode "${this.mode}"`);
        return;
      }
      // keepAudioSessionActive: hold the audio session/focus when the
      // player pauses, so a pause (replace, interruption) can't leave
      // the session torn down with nothing to re-assert it.
      this.musicPlayer = createAudioPlayer(source, {
        keepAudioSessionActive: true,
      });
      this.currentMusicSource = source;
      this.musicPlayer.loop = true;
      this.musicPlayer.volume = MUSIC_VOLUME;
      this.attachMusicStatusListener();
    } catch (e) {
      console.warn('[audio] Failed to create music player:', e);
      this.musicPlayer = null;
      this.currentMusicSource = null;
    }
  }

  private attachMusicStatusListener(): void {
    const player = this.musicPlayer;
    if (!player) return;
    try {
      this.musicStatusSub?.remove();
    } catch {
      /* already removed — ignore */
    }
    this.musicStatusSub = null;
    try {
      this.musicStatusSub = player.addListener(
        'playbackStatusUpdate',
        (status) => {
          this.onMusicStatusUpdate(status);
        },
      );
    } catch (e) {
      console.warn('[audio] Failed to attach music status listener:', e);
    }
  }

  /** Should the loop be audible right now? */
  private shouldBePlaying(): boolean {
    return this.initialized && this.musicOn && !this.muted;
  }

  private onMusicStatusUpdate(status: MusicStatus): void {
    if (status.error) {
      this.musicHadError = true;
      console.warn('[audio] Music player error:', status.error);
      this.recoverMusic();
      return;
    }
    // The OS (or a swallowed play() after a replace) stopped the loop
    // while it should be playing — restart it instead of staying
    // silent for the rest of the session.
    if (
      this.shouldBePlaying() &&
      !status.playing &&
      status.isLoaded &&
      !status.isBuffering
    ) {
      this.recoverMusic();
    }
  }

  /** Restart stalled music, throttled so a persistent failure can't
   * spin. A player that errored gets rebuilt; otherwise the session
   * is re-asserted and play() is issued again. */
  private recoverMusic(): void {
    const now = Date.now();
    if (now - this.lastMusicRecoveryAt < RECOVERY_MIN_GAP_MS) return;
    this.lastMusicRecoveryAt = now;
    if (!this.shouldBePlaying()) return;
    if (this.musicHadError) {
      this.musicHadError = false;
      this.recreateMusicPlayer();
      return;
    }
    void this.resumeAudio();
  }

  private recreateMusicPlayer(): void {
    const old = this.musicPlayer;
    this.musicPlayer = null;
    this.currentMusicSource = null;
    try {
      this.musicStatusSub?.remove();
    } catch {
      /* ignore */
    }
    this.musicStatusSub = null;
    if (old) {
      try {
        old.remove();
      } catch {
        /* ignore */
      }
      try {
        old.release();
      } catch {
        /* ignore */
      }
    }
    this.createMusicPlayer();
    this.applyMusicState();
  }

  /** Periodic safety net: if music should be playing but the player
   * reports otherwise (and isn't just buffering after a source
   * change), restart it. Only acts while the app is in the
   * foreground, so it never starts music behind the user's back. */
  private startWatchdog(): void {
    if (this.watchdogId !== null) return;
    this.watchdogId = setInterval(() => {
      try {
        if (!this.shouldBePlaying()) return;
        if (AppState.currentState !== 'active') return;
        const player = this.musicPlayer;
        if (!player) return;
        if (player.isBuffering) return;
        if (!player.playing) {
          console.warn(
            '[audio] Watchdog: music should be playing but is not — resuming',
          );
          void this.resumeAudio();
        }
      } catch (e) {
        console.warn('[audio] Watchdog check failed:', e);
      }
    }, WATCHDOG_MS);
  }

  /** Resume audio when the app comes back to the foreground — the
   * OS may have paused players while the app was backgrounded, and
   * nothing re-issued play() before this fix. */
  private startForegroundResume(): void {
    if (this.appStateSub !== null) return;
    try {
      this.appStateSub = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          void this.resumeAudio();
        }
      });
    } catch (e) {
      console.warn('[audio] Failed to subscribe to AppState:', e);
    }
  }

  /** Start or pause the loop to match musicOn/muted. Never throws. */
  private applyMusicState(): void {
    const player = this.musicPlayer;
    if (!player) return;
    try {
      if (this.musicOn && !this.muted) {
        player.play();
      } else {
        player.pause();
      }
    } catch (e) {
      console.warn('[audio] Failed to apply music state:', e);
    }
  }

  // -- Music ---------------------------------------------------------------

  getMode(): MusicMode {
    return this.mode;
  }

  isMusicOn(): boolean {
    return this.musicOn;
  }

  isMuted(): boolean {
    return this.muted;
  }

  /**
   * Switch the background loop. Daytime by default; call with 'lullaby'
   * while the pet sleeps and 'playtime' on the Play tab / in mini-games.
   * The new track starts from the top and loops; switching to the mode
   * already playing is a no-op. Calls are serialized: the screens
   * fire this with `void` from focus effects, so two tab switches in
   * quick succession used to interleave their replace + play steps.
   */
  async setMusicMode(mode: MusicMode): Promise<void> {
    const run = this.modeQueue.then(() => this.doSetMusicMode(mode));
    // A failed switch must never block later switches.
    this.modeQueue = run.catch(() => {});
    return run;
  }

  private async doSetMusicMode(mode: MusicMode): Promise<void> {
    await this.init();
    if (mode === this.mode && this.musicPlayer) return;
    const source = MUSIC_SOURCES[mode];
    if (source == null) {
      console.warn(`[audio] Missing music source for mode "${mode}"`);
      return;
    }
    this.mode = mode;
    const player = this.musicPlayer;
    // All modes currently share the one Cozy Hearth loop: replacing
    // the source would tear down and rebuild the playing pipeline
    // (and restart the loop from the top) for zero audible
    // difference — and player.replace() is the flakiest call in
    // expo-audio on Android (expo/expo#35670). Skip it when the
    // file is already loaded; the loop just keeps playing.
    if (player && source === this.currentMusicSource) {
      this.applyMusicState();
      return;
    }
    if (!player) {
      this.createMusicPlayer();
      this.applyMusicState();
      return;
    }
    try {
      player.replace(source);
      this.currentMusicSource = source;
      player.loop = true;
      player.volume = MUSIC_VOLUME;
    } catch (e) {
      console.warn(`[audio] Failed to switch music to "${mode}":`, e);
      return;
    }
    this.applyMusicState();
  }

  /** Music on/off toggle; persisted under 'bbMusicOn'. */
  async setMusicOn(on: boolean): Promise<void> {
    await this.init();
    this.musicOn = on;
    try {
      await AsyncStorage.setItem(MUSIC_ON_KEY, on ? 'true' : 'false');
    } catch (e) {
      console.warn('[audio] Failed to persist music pref:', e);
    }
    this.applyMusicState();
  }

  async toggleMusic(): Promise<boolean> {
    await this.setMusicOn(!this.musicOn);
    return this.musicOn;
  }

  /** Master mute (music + SFX); persisted under 'bbMuted'. */
  async setMuted(muted: boolean): Promise<void> {
    await this.init();
    this.muted = muted;
    try {
      await AsyncStorage.setItem(MUTED_KEY, muted ? 'true' : 'false');
    } catch (e) {
      console.warn('[audio] Failed to persist mute pref:', e);
    }
    this.applyMusicState();
  }

  async toggleMuted(): Promise<boolean> {
    await this.setMuted(!this.muted);
    return this.muted;
  }

  // -- Sound effects --------------------------------------------------------

  /**
   * Play a one-shot effect. Each call gets its own player, so rapid taps
   * overlap cleanly instead of cutting each other off; players are
   * released shortly after their sound ends. No-op (logged) when muted
   * or when the file is missing — never throws.
   */
  playSfx(name: SfxName): void {
    void this.playSfxAsync(name);
  }

  private async playSfxAsync(name: SfxName): Promise<void> {
    await this.init();
    if (this.muted) return;
    const source = SFX_SOURCES[name];
    if (source == null) {
      console.warn(`[audio] Missing SFX source for "${name}"`);
      return;
    }
    let player: AudioPlayer;
    try {
      player = createAudioPlayer(source);
      player.volume = SFX_VOLUME;
    } catch (e) {
      console.warn(`[audio] Failed to create SFX player for "${name}":`, e);
      return;
    }
    // Cap concurrency: drop the oldest still-playing effect first.
    while (this.sfxPlayers.length >= MAX_CONCURRENT_SFX) {
      const oldest = this.sfxPlayers.shift();
      if (oldest) {
        this.releaseSfxPlayer(oldest);
      }
    }
    this.sfxPlayers.push(player);
    try {
      player.play();
    } catch (e) {
      console.warn(`[audio] Failed to play SFX "${name}":`, e);
      this.releaseSfxPlayer(player);
      return;
    }
    // If the player never actually started (stale audio session after
    // a long session, swallowed play()), one retry after re-asserting
    // the session. Checked late enough that a normally-started effect
    // has advanced currentTime past 0, so a healthy play is never
    // doubled; a never-started player still sits at currentTime 0.
    let retried = false;
    setTimeout(() => {
      if (retried) return;
      try {
        if (!this.sfxPlayers.includes(player)) return; // released/evicted
        if (player.playing || player.currentTime !== 0) return; // started fine
        if (!player.isLoaded) return; // still preparing — it may yet start
        retried = true;
        console.warn(
          `[audio] SFX "${name}" did not start — re-asserting audio session and retrying once`,
        );
        void this.resumeAudio().then(() => {
          try {
            player.play();
          } catch {
            /* give up — the lifetime timer still releases the player */
          }
        });
      } catch {
        /* player already released — nothing to do */
      }
    }, SFX_START_CHECK_MS);
    const lifetimeMs = (SFX_DURATIONS[name] ?? 0.6) * 1000 + 400;
    setTimeout(() => this.releaseSfxPlayer(player), lifetimeMs);
  }

  private releaseSfxPlayer(player: AudioPlayer): void {
    this.sfxPlayers = this.sfxPlayers.filter((p) => p !== player);
    try {
      player.remove();
    } catch {
      /* already released — ignore */
    }
    // remove() alone does NOT free the native player on Android — it
    // only unregisters it from expo-audio's module map. The native
    // ExoPlayer + MediaSession survive until the JS SharedObject is
    // garbage-collected, so a tap-heavy session leaked one native
    // player per effect until Android ran out of audio resources and
    // all sound died (Nov 25, 2026 bug). release() destroys the
    // native player immediately.
    try {
      player.release();
    } catch {
      /* already released — ignore */
    }
  }

  /** Release all players (e.g. on app shutdown in tests). */
  dispose(): void {
    if (this.watchdogId !== null) {
      clearInterval(this.watchdogId);
      this.watchdogId = null;
    }
    try {
      this.appStateSub?.remove();
    } catch {
      /* ignore */
    }
    this.appStateSub = null;
    try {
      this.musicStatusSub?.remove();
    } catch {
      /* ignore */
    }
    this.musicStatusSub = null;
    for (const player of this.sfxPlayers) {
      try {
        player.remove();
      } catch {
        /* ignore */
      }
      try {
        player.release();
      } catch {
        /* ignore */
      }
    }
    this.sfxPlayers = [];
    if (this.musicPlayer) {
      try {
        this.musicPlayer.remove();
      } catch {
        /* ignore */
      }
      try {
        this.musicPlayer.release();
      } catch {
        /* ignore */
      }
      this.musicPlayer = null;
    }
    this.currentMusicSource = null;
    this.initialized = false;
    this.initPromise = null;
  }
}

/** Singleton — import and use from anywhere in the app. */
export const audioPlayer = new AudioService();
export default audioPlayer;
