#!/usr/bin/env python3
"""Generate the UserTasks brand SVGs in public/brand/ and app/icon.svg.

The mark ("user -> task"): a cream user dot, a connector that runs down and
turns right through a rounded elbow, and the bronze task block it leads into
(a small gap keeps the stroke and block distinct). Two drawings:

  * the 64-unit mark: glyph centred in the tile (bounds 10..54); dot, stroke
    and block edges land on whole pixels at 32 px (every edge is an even
    unit: dot r7 on x/y 17, stroke 6 on x 17 / y 45, block 18 at 36..54);
  * the 16-unit favicon cut: dot r2, a 2-unit connector with square ends and
    a 6-unit block, every straight edge on a whole pixel at 16, 32 and 48 px;
    used for app/icon.svg and favicon.ico.

The wordmark sets "usertasks" in DM Sans Bold (lib/brand/fonts), converted to
outlines so the SVG renders the same everywhere. Requires fontTools.

  python3 scripts/brand/build-svgs.py && node scripts/brand/build-pngs.mjs
"""
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "brand"

INK = "#17150F"
CREAM = "#FAF8F3"
BRONZE = "#C7A575"
BRONZE_TEXT = "#977443"  # bronze for text / small marks on light backgrounds


def glyph64(fg: str, accent: str) -> str:
    """The mark's glyph on the 64-unit grid (no tile)."""
    return (
        f'<circle cx="17" cy="17" r="7" fill="{fg}"/>'
        f'<path d="M17 31v6a8 8 0 0 0 8 8h6" fill="none" stroke="{fg}" stroke-width="6" stroke-linecap="round"/>'
        f'<rect x="36" y="36" width="18" height="18" rx="5" fill="{accent}"/>'
    )


def glyph16(fg: str, accent: str) -> str:
    """Pixel-grid cut for favicons: 2-unit connector, edges on whole pixels."""
    return (
        f'<circle cx="4" cy="4" r="2" fill="{fg}"/>'
        f'<path d="M3 7h2v2a1 1 0 0 0 1 1h1v2H6a3 3 0 0 1-3-3z" fill="{fg}"/>'
        f'<rect x="8" y="8" width="6" height="6" rx="1.5" fill="{accent}"/>'
    )


def svg(view_box: str, body: str, extra: str = "") -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_box}"{extra}>{body}</svg>\n'


def tile64(tile: str = INK, fg: str = CREAM, accent: str = BRONZE) -> str:
    return f'<rect width="64" height="64" rx="15" fill="{tile}"/>' + glyph64(fg, accent)


def word_paths(text_parts, font_size: float, x0: float, baseline: float) -> tuple[str, float]:
    """Outline `text_parts` [(text, fill)] in DM Sans Bold; returns (svg, end x)."""
    font = TTFont(ROOT / "lib" / "brand" / "fonts" / "DMSans-Bold.ttf")
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    upm = font["head"].unitsPerEm
    scale = font_size / upm
    tracking = -0.025 * upm  # matches Tailwind tracking-tight on the HTML wordmark
    out = []
    x = x0
    for text, fill in text_parts:
        paths = []
        for ch in text:
            name = cmap[ord(ch)]
            pen = SVGPathPen(glyph_set, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
            glyph_set[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, baseline)))
            paths.append(pen.getCommands())
            x += (hmtx[name][0] + tracking) * scale
        out.append(f'<path fill="{fill}" d="{"".join(paths)}"/>')
    return "".join(out), x - tracking * scale


def wordmark(tile: str, fg: str, accent: str, user: str, tasks: str) -> str:
    text, end = word_paths([("user", user), ("tasks", tasks)], 44, 78, 46)
    width = round(end + 1)
    return svg(f"0 0 {width} 64", tile64(tile, fg, accent) + text, f' width="{width}" height="64"')


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    files = {
        "mark.svg": svg("0 0 64 64", tile64()),
        # Glyph only, cropped to its bounds (10..54) + 2 units.
        "mark-transparent.svg": svg("8 8 48 48", glyph64(INK, BRONZE_TEXT)),
        "mark-transparent-light.svg": svg("8 8 48 48", glyph64(CREAM, BRONZE)),
        "mark-16.svg": svg("0 0 16 16", f'<rect width="16" height="16" rx="3.75" fill="{INK}"/>' + glyph16(CREAM, BRONZE)),
        # Full-bleed (no rounded corners) for platforms that mask the icon
        # themselves: apple-touch-icon and the maskable manifest icon. The
        # glyph sits inside the central 80% safe zone.
        "mark-full-bleed.svg": svg("0 0 64 64", f'<rect width="64" height="64" fill="{INK}"/><g transform="translate(6.4 6.4) scale(.8)">{glyph64(CREAM, BRONZE)}</g>'),
        "wordmark.svg": wordmark(INK, CREAM, BRONZE, INK, BRONZE_TEXT),
        "wordmark-light.svg": wordmark(CREAM, INK, BRONZE_TEXT, CREAM, BRONZE),
    }
    for name, content in files.items():
        (OUT / name).write_text(content)
    (ROOT / "app" / "icon.svg").write_text(files["mark-16.svg"])
    print("wrote", ", ".join(files), "+ app/icon.svg")


if __name__ == "__main__":
    main()
