#!/usr/bin/env python3
"""Compose the FINAL walk-fix proof video from the re-recorded walk2 cases.

Reads proof/animations/walk2-windows.json (written by analyze-walk2.py),
clips the first detected walk of each showcase case, and builds:
  1. a 2 s title card
  2. real-time section: Momo happy, Momo sad, Kiki happy, Kiki sad
  3. half-speed section: the same four walks at 0.5x
Each clip carries a burned-in label (pet + mood + speed).
Output: proof/animations/walk-proof-final.mp4 (H.264, plays anywhere).

Usage: python3 bb-proof/make-proof-video.py
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'proof' / 'animations'
WINDOWS = json.loads((OUT / 'walk2-windows.json').read_text())
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
SHOWCASE = [
    ('momo-happy', 'Momo — happy walk'),
    ('momo-sad', 'Momo — sad walk'),
    ('kiki-happy', 'Kiki — happy walk'),
    ('kiki-sad', 'Kiki — sad walk'),
]

def run(cmd):
    print('+', ' '.join(cmd))
    subprocess.run(cmd, check=True)

def label(text):
    # drawtext needs colons/backslashes escaped
    return text.replace('\\', '\\\\').replace(':', '\\:').replace("'", "\\'")

def make_clip(case, label_text, speed, seg_path):
    """Clip the first walk of `case` from its source webm into seg_path.
    speed 1.0 = real time, 0.5 = half speed."""
    w = WINDOWS[case]['walks'][0]
    start = max(0, w['start_s'] - 0.5)
    dur = (w['end_s'] - w['start_s']) + 1.0
    src = OUT / f'walk2-{case}.webm'
    vf = (
        f"trim=start={start:.2f}:duration={dur:.2f},setpts=PTS-STARTPTS,"
        f"scale=390:844:force_original_aspect_ratio=decrease,pad=390:844:(ow-iw)/2:(oh-ih)/2,"
        f"drawbox=y=0:x=0:w=390:h=34:color=black@0.65:t=fill,"
        f"drawtext=fontfile={FONT}:text='{label(label_text)}':fontsize=20:"
        f"fontcolor=white:x=10:y=7"
    )
    if speed != 1.0:
        vf += f",setpts={1.0 / speed}*PTS,fps=25"
    run(['ffmpeg', '-y', '-v', 'error', '-i', str(src),
         '-vf', vf, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
         '-r', '25', str(seg_path)])

def main():
    tmp = OUT / 'proof-tmp'
    tmp.mkdir(exist_ok=True)
    segs = []
    # Title card (2 s).
    title = tmp / '00-title.mp4'
    run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi',
         '-i', 'color=c=0xFDF3F6:s=390x844:d=2',
         '-vf', f"drawtext=fontfile={FONT}:text='Boba Buddies — walk fix':fontsize=26:"
         f"fontcolor=black:x=(w-text_w)/2:y=380,"
         f"drawtext=fontfile={FONT}:text='real time, then half speed':fontsize=20:"
         f"fontcolor=0x666666:x=(w-text_w)/2:y=420",
         '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '25', str(title)])
    segs.append(title)
    # Real-time section.
    for i, (case, name) in enumerate(SHOWCASE):
        seg = tmp / f'10-rt-{case}.mp4'
        make_clip(case, f'{name} — real time', 1.0, seg)
        segs.append(seg)
    # Half-speed section.
    for i, (case, name) in enumerate(SHOWCASE):
        seg = tmp / f'20-hs-{case}.mp4'
        make_clip(case, f'{name} — half speed', 0.5, seg)
        segs.append(seg)
    # Concatenate.
    concat_list = tmp / 'concat.txt'
    concat_list.write_text(''.join(f"file '{s}'\n" for s in segs))
    out_path = OUT / 'walk-proof-final.mp4'
    run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0',
         '-i', str(concat_list), '-c', 'copy', str(out_path)])
    # Report.
    probe = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration,size',
         '-of', 'json', str(out_path)], capture_output=True, text=True, check=True)
    info = json.loads(probe.stdout)['format']
    print(f'WROTE {out_path}  duration={float(info["duration"]):.1f}s  '
          f'size={int(info["size"]) / 1e6:.1f} MB')

if __name__ == '__main__':
    main()
