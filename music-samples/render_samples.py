#!/usr/bin/env python3
"""Render 5 original cozy music-loop samples for Boba Buddies mobile.
Original melodies in the style of cozy games (Animal Crossing / Stardew /
Pokemon Center / Tamagotchi / Ghibli) - NOT copies of any copyrighted track.
Voices are synthesized with numpy: music-box tines, soft bass, square lead.
Outputs 16-bit mono WAVs, ~25-35s each (phrase played twice).
"""
import math
import os
import numpy as np
import wave

SR = 44100
OUT = os.path.dirname(os.path.abspath(__file__))


def midi_freq(m):
    return 440.0 * 2.0 ** ((m - 69) / 12.0)


def music_box(freq, dur, vol=0.5):
    """Music-box tine: inharmonic partials, fast exponential decay."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    env = np.exp(-t / 0.55)
    y = (np.sin(2 * np.pi * freq * t)
         + 0.35 * np.sin(2 * np.pi * freq * 2.76 * t) * np.exp(-t / 0.25)
         + 0.12 * np.sin(2 * np.pi * freq * 5.40 * t) * np.exp(-t / 0.12))
    return vol * env * y


def square_lead(freq, dur, vol=0.30):
    """Soft square wave (odd harmonics), short decay - chiptune lead."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    env = np.exp(-t / 0.35)
    y = np.zeros(n)
    for k, amp in ((1, 1.0), (3, 1 / 3), (5, 1 / 5), (7, 1 / 7)):
        y += amp * np.sin(2 * np.pi * freq * k * t)
    return vol * env * y


def soft_bass(freq, dur, vol=0.35):
    n = int(dur * SR)
    t = np.arange(n) / SR
    env = np.minimum(1.0, t / 0.05) * np.exp(-t / 1.2)
    y = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(2 * np.pi * freq * 2 * t)
    return vol * env * y


def pad(chord_midis, dur, vol=0.10):
    """Soft chord pad across a bar."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    env = np.minimum(1.0, t / 0.3) * np.exp(-t / (dur * 1.5))
    y = np.zeros(n)
    for m in chord_midis:
        f = midi_freq(m)
        y += np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 2 * t)
    return vol * env * y / max(1, len(chord_midis))


def render_track(name, bpm, beats_per_bar, melody_bars, bass_bars,
                 chord_bars=None, lead=music_box, repeats=2):
    """melody_bars: list of bars; bar = list of (midi_or_None, beats).
    bass_bars: list of (midi, beats) per bar. chord_bars: list of midi lists."""
    beat = 60.0 / bpm
    bar_dur = beats_per_bar * beat
    total_beats = beats_per_bar * len(melody_bars) * repeats
    total = int(total_beats * beat * SR) + int(1.5 * SR)
    mix = np.zeros(total)
    for rep in range(repeats):
        for bi, bar in enumerate(melody_bars):
            bar_start = (rep * len(melody_bars) + bi) * bar_dur
            t_in_bar = 0.0
            for note, d in bar:
                if note is not None:
                    sig = lead(midi_freq(note), d * beat + 0.9)
                    s = int((bar_start + t_in_bar * beat) * SR)
                    e = min(total, s + len(sig))
                    mix[s:e] += sig[:e - s]
                t_in_bar += d
            # bass note for the bar
            if bass_bars:
                bm, bd = bass_bars[bi]
                sig = soft_bass(midi_freq(bm), bar_dur + 0.4)
                s = int(bar_start * SR)
                e = min(total, s + len(sig))
                mix[s:e] += sig[:e - s]
            # chord pad
            if chord_bars:
                sig = pad(chord_bars[bi], bar_dur)
                s = int(bar_start * SR)
                e = min(total, s + len(sig))
                mix[s:e] += sig[:e - s]
    # gentle fade on the last 1.2s
    fade = int(1.2 * SR)
    mix[-fade:] *= np.linspace(1.0, 0.0, fade)
    # normalize to -3 dB peak
    peak = np.max(np.abs(mix))
    if peak > 0:
        mix *= (0.7 / peak)
    path = os.path.join(OUT, name)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((mix * 32767).astype(np.int16).tobytes())
    print(f"{name}: {len(mix)/SR:.1f}s peak {peak:.2f}")
    return path


# ---- Track 1: Morning Meadow (Animal Crossing vibe) C major 4/4 @104 ----
m1 = [
    [(76, 1), (79, 1), (81, 1), (79, 1)],
    [(76, 1), (74, 1), (72, 1), (74, 1)],
    [(76, 1), (79, 1), (84, 1), (83, 1)],
    [(81, 1), (79, 1), (76, 1), (74, 1)],
    [(76, 1), (79, 1), (81, 1), (84, 1)],
    [(83, 1), (81, 1), (79, 1), (76, 1)],
    [(74, 1), (76, 1), (79, 1), (76, 1)],
    [(72, 2), (67, 1), (72, 1)],
]
b1 = [(48, 4), (43, 4), (45, 4), (41, 4), (48, 4), (41, 4), (43, 4), (48, 4)]
c1 = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60],
      [60, 64, 67], [53, 57, 60], [55, 59, 62], [60, 64, 67]]
render_track("01-morning-meadow.wav", 104, 4, m1, b1, c1)

# ---- Track 2: Cozy Hearth (Stardew Valley vibe) G major waltz 3/4 @120 ----
m2 = [
    [(74, 1), (71, 1), (67, 1)],
    [(69, 1), (71, 1), (74, 1)],
    [(79, 1), (76, 1), (74, 1)],
    [(71, 1), (69, 1), (67, 1)],
    [(74, 1), (76, 1), (79, 1)],
    [(83, 1), (81, 1), (79, 1)],
    [(76, 1), (74, 1), (71, 1)],
    [(67, 2), (62, 1)],
]
b2 = [(43, 3), (38, 3), (40, 3), (48, 3), (43, 3), (38, 3), (40, 3), (43, 3)]
c2 = [[55, 59, 62], [50, 54, 57], [52, 55, 59], [48, 52, 55],
      [55, 59, 62], [50, 54, 57], [52, 55, 59], [55, 59, 62]]
render_track("02-cozy-hearth.wav", 120, 3, m2, b2, c2)

# ---- Track 3: Sleepy Lullaby (Pokemon Center vibe) F major 3/4 @90 ----
m3 = [
    [(72, 1), (77, 1), (81, 1)],
    [(79, 1), (77, 1), (76, 1)],
    [(77, 1), (81, 1), (84, 1)],
    [(81, 1), (79, 1), (77, 1)],
    [(76, 1), (77, 1), (79, 1)],
    [(81, 1), (84, 1), (81, 1)],
    [(79, 1), (77, 1), (76, 1)],
    [(77, 3)],
]
b3 = [(41, 3), (48, 3), (41, 3), (46, 3), (41, 3), (48, 3), (46, 3), (41, 3)]
c3 = [[53, 57, 60], [48, 52, 55], [53, 57, 60], [58, 62, 65],
      [53, 57, 60], [48, 52, 55], [58, 62, 65], [53, 57, 60]]
render_track("03-sleepy-lullaby.wav", 90, 3, m3, b3, c3)

# ---- Track 4: Bouncy Chiptune (Tamagotchi vibe) C major 4/4 @132 ----
e = 0.5
m4 = [
    [(72, e), (76, e), (79, e), (76, e), (81, e), (79, e), (76, e), (72, e)],
    [(74, e), (77, e), (81, e), (77, e), (79, e), (76, e), (74, e), (72, e)],
    [(76, e), (79, e), (84, e), (79, e), (81, e), (79, e), (76, e), (74, e)],
    [(72, 1), (67, 1), (72, 1), (67, 1)],
    [(77, e), (81, e), (84, e), (81, e), (79, e), (76, e), (74, e), (72, e)],
    [(74, e), (77, e), (81, e), (79, e), (77, e), (76, e), (74, e), (71, e)],
    [(72, e), (76, e), (79, e), (76, e), (81, e), (79, e), (84, e), (83, e)],
    [(84, 2), (79, 1), (72, 1)],
]
b4 = [(48, 1), (43, 1), (48, 1), (43, 1),
      (41, 1), (48, 1), (41, 1), (48, 1),
      (43, 1), (48, 1), (43, 1), (48, 1),
      (48, 1), (43, 1), (48, 1), (43, 1),
      (41, 1), (48, 1), (41, 1), (48, 1),
      (43, 1), (48, 1), (43, 1), (48, 1),
      (48, 1), (43, 1), (48, 1), (43, 1),
      (48, 1), (43, 1), (48, 1), (43, 1)]
# bass bars for track 4 are per-beat, so expand: use first note of each beat group
b4_bars = [(48, 4), (41, 4), (43, 4), (48, 4), (41, 4), (43, 4), (48, 4), (48, 4)]
render_track("04-bouncy-chiptune.wav", 132, 4, m4, b4_bars, lead=square_lead)

# ---- Track 5: Dream Waltz (Ghibli vibe) D major 3/4 @110 ----
m5 = [
    [(78, 1), (81, 1), (86, 1)],
    [(85, 1), (83, 1), (81, 1)],
    [(79, 1), (78, 1), (76, 1)],
    [(78, 1), (76, 1), (74, 1)],
    [(78, 1), (81, 1), (83, 1)],
    [(85, 1), (86, 1), (85, 1)],
    [(83, 1), (81, 1), (79, 1)],
    [(78, 2), (74, 1)],
]
b5 = [(38, 3), (43, 3), (45, 3), (38, 3), (47, 3), (43, 3), (45, 3), (38, 3)]
c5 = [[50, 54, 57], [55, 59, 62], [57, 61, 64], [50, 54, 57],
      [59, 62, 66], [55, 59, 62], [57, 61, 64], [50, 54, 57]]
render_track("05-dream-waltz.wav", 110, 3, m5, b5, c5)

print("done")
