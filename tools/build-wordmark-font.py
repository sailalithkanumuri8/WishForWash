"""Build the "Wish Wordmark" web font from the poster's traced wordmark.

The hero headline is real text ("WISH FOR WASH") so screen readers, search and
SplitType all work, but it should look exactly like the poster's pixel lettering.
This script turns the traced letters in assets/svg/wordmark.svg into a tiny font
containing W, I, S, H, F, O, R and A (lower-case maps to the same shapes).

Usage: python3 tools/build-wordmark-font.py [repo_root]
Writes assets/fonts/wish-wordmark.woff2
"""

import re
import sys
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
SVG = ROOT / "assets/svg/wordmark.svg"
OUT = ROOT / "assets/fonts/wish-wordmark.woff2"

UPM = 1000
CAP = 700          # cap height in font units
SVG_CAP = 113      # cap height of the traced art in SVG units
SCALE = CAP / SVG_CAP
SIDE = 5           # half of the poster's ~10 unit letter gap, in SVG units
SPACE = 26         # word space in SVG units (poster gap ~36 minus both side bearings)


def parse_path(d):
    """Parse the tracer's absolute M/H/V/Z path data into point lists."""
    contours, current = [], None
    x = y = 0.0
    for cmd, args in re.findall(r"([MHVZ])([^MHVZ]*)", d):
        nums = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", args)]
        if cmd == "M":
            x, y = nums[0], nums[1]
            current = [(x, y)]
            contours.append(current)
        elif cmd == "H":
            for n in nums:
                x = n
                current.append((x, y))
        elif cmd == "V":
            for n in nums:
                y = n
                current.append((x, y))
        elif cmd == "Z":
            if current and current[0] == current[-1]:
                current.pop()
    return contours


def signed_area(points):
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1])) / 2


def contains(outer, point):
    x, y = point
    inside = False
    for (x1, y1), (x2, y2) in zip(outer, outer[1:] + outer[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def main():
    svg = SVG.read_text()
    letters = re.findall(r'data-letter="([A-Z])" d="([^"]+)"', svg)
    shapes = {}
    for letter, d in letters:
        shapes.setdefault(letter, d)  # first occurrence of each letter

    glyph_order = [".notdef", "space"] + sorted(shapes)
    cmap = {32: "space"}
    for letter in shapes:
        cmap[ord(letter)] = letter
        cmap[ord(letter.lower())] = letter

    glyphs, metrics = {}, {}

    pen = TTGlyphPen(None)
    glyphs[".notdef"] = pen.glyph()
    metrics[".notdef"] = (round(SPACE * SCALE), 0)
    glyphs["space"] = TTGlyphPen(None).glyph()
    metrics["space"] = (round(SPACE * SCALE), 0)

    for letter, d in shapes.items():
        contours = parse_path(d)
        min_x = min(x for c in contours for x, _ in c)
        max_x = max(x for c in contours for x, _ in c)
        pen = TTGlyphPen(None)
        for contour in contours:
            # Font coordinates: y up, baseline at the bottom of the art.
            pts = [(round((x - min_x + SIDE) * SCALE), round((SVG_CAP - y) * SCALE)) for x, y in contour]
            others = [c for c in contours if c is not contour]
            is_hole = any(contains(o, contour[0]) for o in others)
            area = signed_area(pts)
            # TrueType: outer contours clockwise (negative area), holes counter-clockwise.
            if (not is_hole and area > 0) or (is_hole and area < 0):
                pts.reverse()
            pen.moveTo(pts[0])
            for p in pts[1:]:
                pen.lineTo(p)
            pen.closePath()
        glyphs[letter] = pen.glyph()
        advance = round((max_x - min_x + 2 * SIDE) * SCALE)
        metrics[letter] = (advance, round(SIDE * SCALE))

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=860, descent=-140)
    fb.setupNameTable(
        {
            "familyName": "Wish Wordmark",
            "styleName": "Regular",
            "uniqueFontIdentifier": "WishWordmark-Regular",
            "fullName": "Wish Wordmark",
            "psName": "WishWordmark-Regular",
            "version": "Version 1.0",
        }
    )
    fb.setupOS2(
        sTypoAscender=860,
        sTypoDescender=-140,
        sTypoLineGap=0,
        usWinAscent=860,
        usWinDescent=140,
        sCapHeight=CAP,
        sxHeight=CAP,
        fsType=0,
    )
    fb.setupPost()
    tmp = OUT.with_suffix(".ttf")
    fb.save(str(tmp))

    font = TTFont(str(tmp))
    font.flavor = "woff2"
    font.save(str(OUT))
    tmp.unlink()
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes) with glyphs: {', '.join(sorted(shapes))}")


if __name__ == "__main__":
    main()
