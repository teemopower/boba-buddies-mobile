/**
 * Boba Buddies Mobile — audio player service (expo-audio, SDK 58).
 *
 * Plays the background music loop in `assets/audio/` (Morning Meadow —
 * an original music-box loop rendered by `music-samples/render_loop.py`,
 * 100% original, no downloaded audio) and the short sound effects, with
 * music mode switching, a music on/off toggle, and a master mute, both
 * persisted in AsyncStorage.
 *
 * API verified against the installed expo-audio 58.0.12 typings
 * (node_modules/expo-audio/build/*.d.ts):
 *   - createAudioPlayer(source, options) -> AudioPlayer
 *   - player.play() / pause() / replace(source) / remove()
 *   - player.loop, player.volume, player.muted, player.isLoaded
 *   - setAudioModeAsync({ playsInSilentMode, interruptionMode })
 *
 * The expo-audio wiring itself is code-only until the app is run on a
 * device / dev build — the WAV files were proven to actually play in a
 * browser (see scripts/audio/VERIFY.md). Nothing here throws: a missing
 * audio file is logged and playback continues silently.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createAudioPlayer,
  setAudioModeAsync,
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

/** Bundled music loop. Morning Meadow plays in every mode (daytime /
 * lullaby / playtime all use the same track — picked by the user Nov 23,
 * 2026, replacing the three synthesized loops). `require` returns the
 * Metro asset id (a number), which expo-audio accepts as an AudioSource. */
const MUSIC_SOURCES: Record<MusicMode, number> = {
  daytime: require('../../assets/audio/music-morning-meadow.wav'),
  lullaby: require('../../assets/audio/music-morning-meadow.wav'),
  playtime: require('../../assets/audio/music-morning-meadow.wav'),
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

class AudioService {
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private musicPlayer: AudioPlayer | null = null;
  private sfxPlayers: AudioPlayer[] = [];
  private mode: MusicMode = 'daytime';
  private musicOn = true;
  private muted = false;

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

    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        interruptionMode: 'mixWithOthers',
      });
    } catch (e) {
      console.warn('[audio] setAudioModeAsync failed:', e);
    }

    this.createMusicPlayer();
    this.initialized = true;
    this.applyMusicState();
  }

  private createMusicPlayer(): void {
    try {
      const source = MUSIC_SOURCES[this.mode];
      if (source == null) {
        console.warn(`[audio] Missing music source for mode "${this.mode}"`);
        return;
      }
      this.musicPlayer = createAudioPlayer(source);
      this.musicPlayer.loop = true;
      this.musicPlayer.volume = MUSIC_VOLUME;
    } catch (e) {
      console.warn('[audio] Failed to create music player:', e);
      this.musicPlayer = null;
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
   * already playing is a no-op.
   */
  async setMusicMode(mode: MusicMode): Promise<void> {
    await this.init();
    if (mode === this.mode && this.musicPlayer) return;
    this.mode = mode;
    const player = this.musicPlayer;
    if (!player) {
      this.createMusicPlayer();
      this.applyMusicState();
      return;
    }
    try {
      const source = MUSIC_SOURCES[mode];
      if (source == null) {
        console.warn(`[audio] Missing music source for mode "${mode}"`);
        return;
      }
      player.replace(source);
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
      try {
        oldest?.remove();
      } catch {
        /* already released — ignore */
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
  }

  /** Release all players (e.g. on app shutdown in tests). */
  dispose(): void {
    for (const player of this.sfxPlayers) {
      try {
        player.remove();
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
      this.musicPlayer = null;
    }
    this.initialized = false;
    this.initPromise = null;
  }
}

/** Singleton — import and use from anywhere in the app. */
export const audioPlayer = new AudioService();
export default audioPlayer;
