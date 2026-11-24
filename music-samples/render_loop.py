#!/usr/bin/env python3
"""Render Morning Meadow as a SEAMLESS loop for the Boba Buddies app.

Same original melody as music-samples/01-morning-meadow.wav (Animal
Crossing-style, C major, 104 BPM), but rendered as a 16-bar loop with the
note tail crossfaded into the start so expo-audio's `loop = true` plays it
forever with no click or gap. Output: ../assets/audio/music-morning-meadow.wav
(44.1 kHz / 16-bit / mono, same format as the old music loops).
"""
import os
import numpy as np
import wave

SR = 44100
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "..", "assets", "audio", "music-morning-meadow.wav")


def midi_freq(m):
    return 440.0 * 2.0 ** ((m - 69) / 12.0)


def music_box(freq, dur, vol=0.5):
    n = int(dur * SR)
    t = np.arange(n) / SR
    env = np.exp(-t / 0.55)
    y = (np.sin(2 * np.pi * freq * t)
         + 0.35 * np.sin(2 * np.pi * freq * 2.76 * t) * np.exp(-t / 0.25)
         + 0.12 * np.sin(2 * np.pi * freq * 5.40 * t) * np.exp(-t / 0.12))
    return vol * env * y


def soft_bass(freq, dur, vol=0.35):
    n = int(dur * SR)
    t = np.arange(n) / SR
    env = np.minimum(1.0, t / 0.05) * np.exp(-t / 1.2)
    y = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(2 * np.pi * freq * 2 * t)
    return vol * env * y


def pad(chord_midis, dur, vol=0.10):
    n = int(dur * SR)
    t = np.arange(n) / SR
    env = np.minimum(1.0, t / 0.3) * np.exp(-t / (dur * 1.5))
    y = np.zeros(n)
    for m in chord_midis:
        f = midi_freq(m)
        y += np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 2 * t)
    return vol * env * y / max(1, len(chord_midis))


BPM = 104
BEATS_PER_BAR = 4
MELODY = [
    [(76, 1), (79, 1), (81, 1), (79, 1)],
    [(76, 1), (74, 1), (72, 1), (74, 1)],
    [(76, 1), (79, 1), (84, 1), (83, 1)],
    [(81, 1), (79, 1), (76, 1), (74, 1)],
    [(76, 1), (79, 1), (81, 1), (84, 1)],
    [(83, 1), (81, 1), (79, 1), (76, 1)],
    [(74, 1), (76, 1), (79, 1), (76, 1)],
    # Last bar ends on the tonic then rests 2 beats so the note has fully
    # decayed by the loop point (no click where the loop restarts).
    [(72, 2), (None, 2)],
]
BASS = [(48, 4), (43, 4), (45, 4), (41, 4), (48, 4), (41, 4), (43, 4), (48, 4)]
CHORDS = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60],
          [60, 64, 67], [53, 57, 60], [55, 59, 62], [60, 64, 67]]

REPEATS = 2  # 16 bars total
TAIL_S = 1.5  # tail crossfaded into the loop start

beat = 60.0 / BPM
bar_dur = BEATS_PER_BAR * beat
loop_beats = BEATS_PER_BAR * len(MELODY) * REPEATS
loop_n = int(loop_beats * beat * SR)
total = loop_n + int(TAIL_S * SR)
mix = np.zeros(total)

for rep in range(REPEATS):
    for bi, bar in enumerate(MELODY):
        bar_start = (rep * len(MELODY) + bi) * bar_dur
        t_in_bar = 0.0
        for note, d in bar:
            if note is not None:
                sig = music_box(midi_freq(note), d * beat + 0.9)
                s = int((bar_start + t_in_bar * beat) * SR)
                e = min(total, s + len(sig))
                mix[s:e] += sig[:e - s]
            t_in_bar += d
        bm, _ = BASS[bi]
        sig = soft_bass(midi_freq(bm), bar_dur + 0.4)
        s = int(bar_start * SR)
        e = min(total, s + len(sig))
        mix[s:e] += sig[:e - s]
        sig = pad(CHORDS[bi], bar_dur)
        s = int(bar_start * SR)
        e = min(total, s + len(sig))
        mix[s:e] += sig[:e - s]

# Seamless loop: crossfade the ringing tail into the first TAIL_S seconds.
tail_n = int(TAIL_S * SR)
tail = mix[loop_n:loop_n + tail_n]
fade = np.linspace(1.0, 0.0, tail_n)
mix[:tail_n] += tail * fade
loop = mix[:loop_n]

# Tiny 50 ms fade on the very last samples so the loop boundary is exactly
# zero (the tail is already quiet; this just removes the last 0.02 step).
fade_n = int(0.05 * SR)
loop[-fade_n:] *= np.linspace(1.0, 0.0, fade_n)

peak = np.max(np.abs(loop))
loop *= (0.7 / peak)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with wave.open(OUT, "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((loop * 32767).astype(np.int16).tobytes())
print(f"{OUT}: {len(loop)/SR:.2f}s loop, peak {peak:.2f}")
# Seam check: the step between the last and first sample is what the ear
# hears as a click at the loop point (want < ~0.05; the E5 attack masks it).
print(f"seam step |last - first| = {abs(loop[-1] - loop[0]):.4f}")
