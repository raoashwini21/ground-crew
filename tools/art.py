"""Turn the generated art into small WebP files for the single HTML build.

    python3 tools/art.py <folder with the original PNGs>

Cut-outs: clean the faint coloured haze around each figure (near-invisible
pixels carrying junk colour), trim a 1px fringe, slice sheets into single
poses, and save each as WebP with transparency. Scenes are resized and
compressed. The originals stay out of the repo; only the WebP files ship.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parent.parent / 'assets' / 'art'
OUT.mkdir(parents=True, exist_ok=True)


def clean(im):
    im = im.convert('RGBA')
    a = np.asarray(im.getchannel('A')).astype(np.float32)
    # Near-transparent haze to 0, solid body to 255, a short ramp between.
    a = np.clip((a - 60) * 255 / (200 - 60), 0, 255)
    # Drop specks: keep only sizeable connected shapes.
    mask = a > 0
    lab, n = ndimage.label(mask)
    if n:
        sizes = ndimage.sum(mask, lab, range(1, n + 1))
        keep = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s > 400])
        a = a * keep
    alpha = Image.fromarray(a.astype(np.uint8))
    # Shave the 1px edge where the junk colour lives, then soften slightly.
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.6))
    im.putalpha(alpha)
    return im


def pieces(im, min_area=20000):
    """Bounding boxes of the separate figures on a sheet, left to right, top to bottom."""
    a = np.asarray(im.getchannel('A')) > 0
    # Join each figure's own parts (wands, suitcases) before labelling.
    joined = ndimage.binary_closing(a, structure=np.ones((25, 25)))
    lab, n = ndimage.label(joined)
    boxes = []
    for sl in ndimage.find_objects(lab):
        ys, xs = sl
        area = (ys.stop - ys.start) * (xs.stop - xs.start)
        if area >= min_area:
            boxes.append((xs.start, ys.start, xs.stop, ys.stop))
    rows = sorted(boxes, key=lambda b: (round(b[1] / 300), b[0]))
    return rows


def save_cutout(im, name, height):
    bbox = im.getchannel('A').getbbox()
    im = im.crop(bbox)
    w = round(im.width * height / im.height)
    im = im.resize((w, height), Image.LANCZOS)
    im.save(OUT / f'{name}.webp', 'WEBP', quality=82, method=6)
    return im.size


def sheet(src, names, height):
    im = clean(Image.open(SRC / src))
    boxes = pieces(im)
    if len(boxes) != len(names):
        raise SystemExit(f'{src}: found {len(boxes)} figures, expected {len(names)}: {boxes}')
    for box, name in zip(boxes, names):
        print(name, save_cutout(im.crop(box), name, height))


def scene(src, name, width=1600):
    im = Image.open(SRC / src).convert('RGB')
    h = round(im.height * width / im.width)
    im = im.resize((width, h), Image.LANCZOS)
    im.save(OUT / f'{name}.webp', 'WEBP', quality=72, method=6)
    print(name, im.size)


sheet('marshal-sheet.png', ['marshal-wave', 'marshal-point', 'marshal-cheer', 'marshal-worried', 'marshal-headset'], 520)
sheet('handler-sheet.png', ['handler-ok', 'handler-alert'], 520)
sheet('controller-sheet.png', ['controller-ok', 'controller-alert'], 480)
sheet('security-sheet.png', ['security-ok', 'security-alert'], 480)
sheet('agent-sheet.png', ['agent-ok', 'agent-alert'], 480)
sheet('passengers.png', ['passenger-1', 'passenger-2', 'passenger-3', 'passenger-4'], 300)
sheet('suitcases.png', ['case-teal', 'case-coral', 'case-mustard', 'case-lilac', 'case-navy', 'case-green'], 200)
sheet('plane.png', ['plane'], 260)
print('marshal-hero', save_cutout(clean(Image.open(SRC / 'marshal-wave.png')), 'marshal-hero', 640))

for s in ['checkin', 'baggage', 'tower', 'security', 'gate', 'runway']:
    scene(f'scene-{s}.png', f'scene-{s}')
