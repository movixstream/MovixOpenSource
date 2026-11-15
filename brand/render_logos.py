"""Génère le kit de logos (groupe ix, Movix, Loadix) en SVG et en PNG.

Usage :
    python brand/render_logos.py                     # kit + icônes du dépôt Movix
    python brand/render_logos.py --loadix ../Loadix  # met aussi à jour Loadix
    python brand/render_logos.py --redirection ../../Movix-OS/movixredirection  # et movix.online

Requis : Pillow, numpy, fontTools, et `npm install` fait à la racine (la
police vient de node_modules/@fontsource/inter : Inter ExtraBold, celle
de Loadix).

Repères relevés sur Loadix :
- icône : carré de 100 unités, crochets 12→88 × 15→85, épaisseur 8,
  lettre Inter 800 de 42 centrée ;
- logo long : mise en page de loadix-brackets-horizontal.svg (110 de
  haut, texte Inter 800 de 88 posé à x 44 sur la ligne 92, approche -3,
  crochets de 7, point carré de 18 à la place du point du i).

Chaque PNG existant est réécrit à son nom et à sa taille actuels : seul
le dessin change. Le script régénère aussi le composant React du logo long
(src/components/brand/MovixWordmark.tsx : en-tête, écran d'erreur), l'icône
SVG du site et des extensions et, avec --loadix, les logos SVG de Loadix
(contours vectorisés), son favicon, son avatar rond et l'icône Movix de son
bouton de connexion.
"""
import argparse
import math
import shutil
from pathlib import Path

import numpy as np
from fontTools.pens.basePen import BasePen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "brand"

BG = "#F4F4F0"     # fond de Loadix
LIGHT = "#F4F4F0"  # texte des versions inverses
INK = "#000000"
RED = "#DC2626"    # rouge du « MOVIX » de l'en-tête du site
BLUE = "#3B6EFF"   # bleu de Loadix

AVATAR_SCALE = 0.84  # avatars ronds (Discord, Telegram…) : les coins tiennent dans le cercle
ROUND_SCALE = 0.86   # icône ronde Android, détourée en cercle

FONT = TTFont(ROOT / "node_modules/@fontsource/inter/files/inter-latin-800-normal.woff")
GLYPHS = FONT.getGlyphSet()
CMAP = FONT.getBestCmap()
UPM = FONT["head"].unitsPerEm
CAP = FONT["OS/2"].sCapHeight

# Point carré du i, relevé sur Loadix (18 de côté pour un corps de 88,
# de 60 à 78 au-dessus de la ligne de base).
DOT_SIZE = 18 / 88
DOT_TOP = 78 / 88


def rgb(hex_color):
    return tuple(int(hex_color[i:i + 2], 16) for i in (1, 3, 5))


def num(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


# --- Police ------------------------------------------------------------

class FlattenPen(BasePen):
    """Contours en polygones (courbes découpées en segments) pour le tramage."""

    def __init__(self, glyph_set, steps=16):
        super().__init__(glyph_set)
        self.steps = steps
        self.contours = []
        self._points = []

    def _moveTo(self, p):
        self._points = [p]

    def _lineTo(self, p):
        self._points.append(p)

    def _curveToOne(self, p1, p2, p3):
        x0, y0 = self._points[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps
            u = 1 - t
            self._points.append((
                u ** 3 * x0 + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
                u ** 3 * y0 + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1],
            ))

    def _qCurveToOne(self, p1, p2):
        x0, y0 = self._points[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps
            u = 1 - t
            self._points.append((
                u * u * x0 + 2 * u * t * p1[0] + t * t * p2[0],
                u * u * y0 + 2 * u * t * p1[1] + t * t * p2[1],
            ))

    def _closePath(self):
        if len(self._points) > 2:
            self.contours.append(self._points)
        self._points = []

    _endPath = _closePath


def kern(left, right):
    """Approche de paire GPOS (fonctionnalité kern), comme le navigateur."""
    if "GPOS" not in FONT:
        return 0
    table = FONT["GPOS"].table
    indices = sorted({i for rec in table.FeatureList.FeatureRecord
                      if rec.FeatureTag == "kern" for i in rec.Feature.LookupListIndex})
    total = 0
    for index in indices:
        lookup = table.LookupList.Lookup[index]
        for sub in lookup.SubTable:
            kind = lookup.LookupType
            if kind == 9:
                kind, sub = sub.ExtensionLookupType, sub.ExtSubTable
            if kind != 2 or left not in sub.Coverage.glyphs:
                continue
            if sub.Format == 1:
                pairs = sub.PairSet[sub.Coverage.glyphs.index(left)].PairValueRecord
                value = next((p.Value1 for p in pairs if p.SecondGlyph == right), None)
                if value is None:
                    continue
            else:
                c1 = sub.ClassDef1.classDefs.get(left, 0)
                c2 = sub.ClassDef2.classDefs.get(right, 0)
                value = sub.Class1Record[c1].Class2Record[c2].Value1
            total += getattr(value, "XAdvance", 0) or 0
            break
    return total


def place(text, size, x, spacing):
    """Origine de chaque glyphe : chasse + approche de paire + espacement."""
    s = size / UPM
    names = [CMAP[ord(c)] for c in text]
    placed = []
    for i, name in enumerate(names):
        placed.append((name, x))
        x += GLYPHS[name].width * s + spacing
        if i + 1 < len(names):
            x += kern(name, names[i + 1]) * s
    return placed, s


def outline(name, s, ox, baseline):
    """Tracé SVG (courbes) et polygones (tramage) d'un glyphe, mêmes coordonnées."""
    transform = (s, 0, 0, -s, ox, baseline)
    svg_pen = SVGPathPen(GLYPHS, ntos=num)
    GLYPHS[name].draw(TransformPen(svg_pen, transform))
    flat = FlattenPen(GLYPHS)
    GLYPHS[name].draw(TransformPen(flat, transform))
    return svg_pen.getCommands(), flat.contours


def ink_box(contours):
    xs = [x for c in contours for x, _ in c]
    ys = [y for c in contours for _, y in c]
    return min(xs), min(ys), max(xs), max(ys)


# --- Formes ------------------------------------------------------------

def poly_d(points):
    return "M" + "L".join(f"{num(x)} {num(y)}" for x, y in points) + "Z"


def rrect_d(x, y, w, h, r):
    a = f"A{num(r)} {num(r)} 0 0 1"
    x1, y1 = x + w, y + h
    return (f"M{num(x + r)} {num(y)}H{num(x1 - r)}{a} {num(x1)} {num(y + r)}"
            f"V{num(y1 - r)}{a} {num(x1 - r)} {num(y1)}"
            f"H{num(x + r)}{a} {num(x)} {num(y1 - r)}"
            f"V{num(y + r)}{a} {num(x + r)} {num(y)}Z")


def rrect_poly(x0, y0, x1, y1, r, seg=6):
    r = max(0, min(r, (x1 - x0) / 2, (y1 - y0) / 2))
    pts = []
    for cx, cy, start in ((x1 - r, y0 + r, -90), (x1 - r, y1 - r, 0),
                          (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180)):
        for i in range(seg + 1):
            a = math.radians(start + 90 * i / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def frame_layer(color, brackets, perforations=None):
    """Crochets (et perforations de pellicule) : un seul tracé pair-impair.

    perforations = (barres [(x0, x1)], hauts des trous, largeur, hauteur,
    rayon) : chaque trou est centré dans sa barre.
    """
    d = "".join(poly_d(b) for b in brackets)
    rects = []
    if perforations:
        bars, tops, w, h, r = perforations
        for x0, x1 in bars:
            for top in tops:
                rects.append({"x": (x0 + x1 - w) / 2, "y": top, "w": w, "h": h, "r": r,
                              "bar": (x0, x1), "min_px": 40})
                d += rrect_d((x0 + x1 - w) / 2, top, w, h, r)
    return {"color": color, "rule": "evenodd", "d": d, "polys": brackets, "rects": rects, "snap": True}


def text_layer(color, glyphs):
    d = "".join(svg for svg, _ in glyphs)
    polys = [c for _, contours in glyphs for c in contours]
    return {"color": color, "rule": "nonzero", "d": d, "polys": polys, "rects": [], "snap": False}


def dot_layer(color, x, y, size):
    rect = {"x": x, "y": y, "w": size, "h": size, "r": 0}
    return {"color": color, "rule": "nonzero", "d": poly_d([(x, y), (x + size, y), (x + size, y + size), (x, y + size)]),
            "polys": [], "rects": [rect], "snap": True}


# --- Icônes carrées (100 unités) -----------------------------------------

ICON_BRACKET_L = [(12, 15), (36, 15), (36, 23), (20, 23), (20, 77), (36, 77), (36, 85), (12, 85)]
ICON_BRACKET_R = [(100 - x, y) for x, y in ICON_BRACKET_L]
ICON_PERFORATIONS = ([(12, 20), (80, 88)], (28.3, 38.05, 47.8, 57.55, 67.3), 4, 4.4, 0.9)
ICON_FONT = 42
ICON_SPACING = -3


def icon(name):
    s = ICON_FONT / UPM
    baseline = 50 + CAP * s / 2  # hauteur de capitale centrée, comme l'icône Loadix
    brackets = [ICON_BRACKET_L, ICON_BRACKET_R]
    if name == "loadix":
        # Comme le PNG Loadix : text-anchor middle compte l'approche -3 dans
        # la chasse, d'où le L décalé de 1,5 vers la droite.
        glyph = CMAP[ord("L")]
        ox = 50 - (GLYPHS[glyph].width * s + ICON_SPACING) / 2
        return [frame_layer(BLUE, brackets), text_layer(INK, [outline(glyph, s, ox, baseline)])]
    if name == "movix":
        # Le M est symétrique : on centre son encre entre les crochets.
        glyph = CMAP[ord("M")]
        x0, _, x1, _ = ink_box(outline(glyph, s, 0, baseline)[1])
        ox = 50 - (x0 + x1) / 2
        return [frame_layer(RED, brackets, ICON_PERFORATIONS), text_layer(INK, [outline(glyph, s, ox, baseline)])]

    # Groupe : « ıx » noir, point carré façon Loadix, encre centrée.
    placed, s = place("ıx", ICON_FONT, 0, ICON_SPACING)
    glyphs = [outline(g, s, ox, baseline) for g, ox in placed]
    x0, _, x1, _ = ink_box([c for _, contours in glyphs for c in contours])
    shift = 50 - (x0 + x1) / 2
    glyphs = [outline(g, s, ox + shift, baseline) for g, ox in placed]
    i0, _, i1, _ = ink_box(glyphs[0][1])
    size = DOT_SIZE * ICON_FONT
    dot = dot_layer(INK, (i0 + i1) / 2 - size / 2, baseline - DOT_TOP * ICON_FONT, size)
    return [frame_layer(INK, brackets), text_layer(INK, glyphs), dot]


# --- Logo long, mise en page de loadix-brackets-horizontal.svg ----------

LOCKUP_H = 110
LOCKUP_OFFSET = (5, -0.75)
LOCKUP_FONT = 88
LOCKUP_TEXT_X = 44
LOCKUP_BASELINE = 92
LOCKUP_SPACING = -3
LOCKUP_SCALE = 6  # les PNG Loadix font 6 fois le viewBox (2220 × 660)


def lockup_bracket(bar_x, side):
    """Crochet en trait de 7 à bouts carrés (polyligne Loadix), en contour plein."""
    outer, inner = (bar_x - 3.5, bar_x + 3.5) if side == "left" else (bar_x + 3.5, bar_x - 3.5)
    tip = bar_x + 23.5 if side == "left" else bar_x - 23.5
    return [(tip, 24.5), (outer, 24.5), (outer, 97.5), (tip, 97.5),
            (tip, 90.5), (inner, 90.5), (inner, 31.5), (tip, 31.5)]


def lockup_text(text):
    placed, s = place(text, LOCKUP_FONT, LOCKUP_TEXT_X, LOCKUP_SPACING)
    return [outline(g, s, ox, LOCKUP_BASELINE) for g, ox in placed]


def lockup_right_gap():
    """Écart du dernier glyphe au crochet droit chez Loadix (bras à 324,5)."""
    glyphs = lockup_text("Loadıx")
    return (348 - 23.5) - ink_box(glyphs[-1][1])[2]


def lockup(word, frame_color, text_color, perforated):
    dx, dy = LOCKUP_OFFSET
    glyphs = lockup_text(word)
    right_bar = ink_box(glyphs[-1][1])[2] + lockup_right_gap() + 23.5
    width = right_bar + 3.5 + dx + 13.5

    def move(points):
        return [(x + dx, y + dy) for x, y in points]

    brackets = [move(lockup_bracket(12, "left")), move(lockup_bracket(right_bar, "right"))]
    perforations = None
    if perforated:
        bars = [(12 - 3.5 + dx, 12 + 3.5 + dx), (right_bar - 3.5 + dx, right_bar + 3.5 + dx)]
        tops = tuple(t + dy for t in (38.17, 48.63, 59.1, 69.57, 80.03))
        perforations = (bars, tops, 3.4, 3.8, 0.7)
    placed, s = place(word, LOCKUP_FONT, LOCKUP_TEXT_X + dx, LOCKUP_SPACING)
    glyphs = [outline(g, s, ox, LOCKUP_BASELINE + dy) for g, ox in placed]
    i_index = word.index("ı")
    i0, _, i1, _ = ink_box(glyphs[i_index][1])
    size = DOT_SIZE * LOCKUP_FONT
    dot = dot_layer(frame_color, (i0 + i1) / 2 - size / 2, LOCKUP_BASELINE + dy - DOT_TOP * LOCKUP_FONT, size)
    layers = [frame_layer(frame_color, brackets, perforations), text_layer(text_color, glyphs), dot]
    return layers, (width, LOCKUP_H)


# --- Sorties -----------------------------------------------------------

def svg_doc(layers, viewbox, title, bg=None, size=None, scale=1.0):
    w, h = viewbox
    width, height = size or viewbox
    lines = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {num(w)} {num(h)}" '
             f'width="{num(width)}" height="{num(height)}">',
             f"  <title>{title}</title>"]
    if bg:
        lines.append(f'  <rect width="{num(w)}" height="{num(h)}" fill="{bg}"/>')
    indent = "  "
    if scale != 1.0:
        lines.append(f'  <g transform="translate({num(w / 2)} {num(h / 2)}) scale({num(scale)}) '
                     f'translate({num(-w / 2)} {num(-h / 2)})">')
        indent = "    "
    for layer in layers:
        rule = ' fill-rule="evenodd"' if layer["rule"] == "evenodd" else ""
        lines.append(f'{indent}<path fill="{layer["color"]}"{rule} d="{layer["d"]}"/>')
    if scale != 1.0:
        lines.append("  </g>")
    lines.append("</svg>")
    return "\n".join(lines) + "\n"


def wordmark_component(layers, viewbox):
    """Composant React du logo long, régénéré avec le reste du kit."""
    paths = "\n".join(
        f'      <path fill="{layer["color"]}"'
        + (' fillRule="evenodd"' if layer["rule"] == "evenodd" else "")
        + f' d="{layer["d"]}" />'
        for layer in layers
    )
    return f"""// Généré par brand/render_logos.py : ne pas modifier à la main.
import type {{ SVGProps }} from 'react';

/**
 * Logo long [Movix] : crochets perforés et point du i en rouge, lettres en
 * currentColor pour suivre la couleur du texte autour.
 */
export function MovixWordmark(props: SVGProps<SVGSVGElement>) {{
  return (
    <svg viewBox="0 0 {num(viewbox[0])} {num(viewbox[1])}" role="img" aria-label="Movix" {{...props}}>
{paths}
    </svg>
  );
}}
"""


def rasterize(layers, viewbox, out, bg=None, scale=1.0, circle=False):
    """Trame chaque calque en suréchantillonné puis compose en alpha.

    Les formes droites sont calées sur la grille de pixels de la taille
    finale (bords nets aux petites tailles) ; un trou garde la même taille
    en pixels sur toute la colonne. `scale` réduit le dessin autour du
    centre (versions rondes).
    """
    W, H = out
    k = max(4, -(-2048 // max(W, H)))
    unit = W / viewbox[0]
    cx, cy = viewbox[0] / 2, viewbox[1] / 2

    def tx(x):
        return ((x - cx) * scale + cx) * unit

    def ty(y):
        return ((y - cy) * scale + cy) * unit

    def coverage(polys_px, rule):
        # Chaque contour est tramé dans son seul rectangle englobant : un
        # masque pleine taille par contour épuisait la mémoire à 4096 px.
        acc = np.zeros((H * k, W * k), np.int8)
        for poly in polys_px:
            xs, ys = [p[0] for p in poly], [p[1] for p in poly]
            x0, y0 = max(0, math.floor(min(xs))), max(0, math.floor(min(ys)))
            x1, y1 = min(W * k, math.ceil(max(xs)) + 1), min(H * k, math.ceil(max(ys)) + 1)
            if x1 <= x0 or y1 <= y0:
                continue
            mask = Image.new("L", (x1 - x0, y1 - y0), 0)
            ImageDraw.Draw(mask).polygon([(x - x0, y - y0) for x, y in poly], fill=1)
            area = sum(a * d - c * b for (a, b), (c, d) in zip(poly, poly[1:] + poly[:1]))
            acc[y0:y1, x0:x1] += np.asarray(mask, np.int8) * (1 if rule == "evenodd" or area >= 0 else -1)
        filled = (acc % 2 != 0) if rule == "evenodd" else (acc != 0)
        # Reste en octets : `filled * 255` passait par un tableau int64 de
        # plus de 500 Mo pour les images de 2100 px.
        return Image.fromarray(filled.view(np.uint8) * np.uint8(255), "L").reduce(k)

    result = Image.new("RGBA", out, (0, 0, 0, 0))
    if bg:
        base = Image.new("L", (W * k, H * k), 0)
        draw = ImageDraw.Draw(base)
        if circle:
            draw.ellipse((0, 0, W * k - 1, H * k - 1), fill=255)
        else:
            draw.rectangle((0, 0, W * k, H * k), fill=255)
        paint = Image.new("RGBA", out, rgb(bg) + (255,))
        paint.putalpha(base.reduce(k))
        result.alpha_composite(paint)

    for layer in layers:
        snap = layer["snap"]

        def px(x, y):
            x, y = tx(x), ty(y)
            if snap:
                x, y = round(x), round(y)
            return (x * k, y * k)

        polys = [[px(x, y) for x, y in poly] for poly in layer["polys"]]
        for r in layer["rects"]:
            if W < r.get("min_px", 0):
                continue
            w, h = r["w"] * scale * unit, r["h"] * scale * unit
            y = ty(r["y"])
            if "bar" in r:
                bx0, bx1 = tx(r["bar"][0]), tx(r["bar"][1])
                x = (bx0 + bx1 - w) / 2
            else:
                x = tx(r["x"])
            if snap:
                w, h, y = max(1, round(w)), max(1, round(h)), round(y)
                if "bar" in r:
                    bx0, bx1 = round(bx0), round(bx1)
                    x = bx0 + round((bx1 - bx0 - w) / 2)
                else:
                    x = round(x)
            polys.append(rrect_poly(x * k, y * k, (x + w) * k, (y + h) * k, r["r"] * scale * unit * k))
        paint = Image.new("RGBA", out, rgb(layer["color"]) + (255,))
        paint.putalpha(coverage(polys, layer["rule"]))
        result.alpha_composite(paint)
    return result


def text_image(text, size, color):
    """Texte en Inter 800 tramé au plus juste, sur fond transparent."""
    placed, s = place(text, size, 0, 0)
    glyphs = [outline(g, s, ox, size) for g, ox in placed]
    contours = [c for _, cs in glyphs for c in cs]
    x0, y0, x1, y1 = ink_box(contours)
    pad = 2
    polys = [[(x - x0 + pad, y - y0 + pad) for x, y in c] for c in contours]
    w, h = math.ceil(x1 - x0) + 2 * pad, math.ceil(y1 - y0) + 2 * pad
    layer = {"color": color, "rule": "nonzero", "d": "", "polys": polys, "rects": [], "snap": False}
    return rasterize([layer], (w, h), (w, h))


def og_image():
    """Image de partage 1200 × 630 du site d'adresses, en PNG.

    Discord, Telegram, X et Facebook n'affichent pas les images de partage
    en SVG. Le fond reprend l'ancienne image : noir, lueur rouge en haut.
    """
    W, H = 1200, 630
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    t = np.clip(np.hypot((xx - W / 2) / (0.8 * W), yy / (0.8 * H)), 0, 1)[..., None]
    base, glow = np.array(rgb("#0A0A0A"), np.float32), np.array(rgb("#7F1D1D"), np.float32)
    image = Image.fromarray((base + (glow - base) * 0.55 * (1 - t)).astype(np.uint8), "RGB").convert("RGBA")

    layers, box = lockup("Movıx", RED, LIGHT, perforated=True)
    mark_w = 640
    mark = rasterize(layers, box, (mark_w, round(mark_w * box[1] / box[0])))
    image.alpha_composite(mark, ((W - mark_w) // 2, 140))
    for text, size, color, top in (("Adresse officielle et miroirs", 40, "#D1D5DB", 370),
                                   ("movix.online", 34, "#F87171", 435)):
        line = text_image(text, size, color)
        image.alpha_composite(line, ((W - line.width) // 2, top))
    return image


def save_png(image, path, opaque):
    path.parent.mkdir(parents=True, exist_ok=True)
    (image.convert("RGB") if opaque else image).save(path, optimize=True)
    shown = path.relative_to(ROOT.parent) if path.is_relative_to(ROOT.parent) else path
    print(f"{shown.as_posix()}  {image.size[0]}×{image.size[1]}  {path.stat().st_size // 1024} Ko")


def current_size(path):
    with Image.open(path) as im:
        return im.size


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--loadix", type=Path, help="dossier du dépôt Loadix à mettre à jour aussi")
    parser.add_argument("--redirection", type=Path,
                        help="dossier du site d'adresses movix.online (movixredirection) à mettre à jour aussi")
    args = parser.parse_args()

    names = {"groupe-ix": "Groupe ix", "movix": "Movix", "loadix": "Loadix"}
    icons = {name: icon(name) for name in names}

    # Kit : icône (SVG + PNG 1024) et avatar rond (PNG 1024) pour chacun.
    for name, title in names.items():
        layers = icons[name]
        (BRAND / f"{name}.svg").write_text(svg_doc(layers, (100, 100), title, bg=BG, size=(512, 512)),
                                           encoding="utf-8", newline="\n")
        save_png(rasterize(layers, (100, 100), (1024, 1024), bg=BG), BRAND / f"{name}.png", True)
        save_png(rasterize(layers, (100, 100), (1024, 1024), bg=BG, scale=AVATAR_SCALE),
                 BRAND / f"{name}-rond.png", True)

    # Logo long Movix, clair et inverse, comme loadix-brackets-horizontal/inverse.
    for variant, text_color, bg in (("horizontal", INK, BG), ("inverse", LIGHT, None)):
        layers, viewbox = lockup("Movıx", RED, text_color, perforated=True)
        out = (round(viewbox[0] * LOCKUP_SCALE), LOCKUP_H * LOCKUP_SCALE)
        (BRAND / f"movix-{variant}.svg").write_text(svg_doc(layers, viewbox, f"[Movix] {variant}"),
                                                    encoding="utf-8", newline="\n")
        save_png(rasterize(layers, viewbox, out, bg=bg), BRAND / f"movix-{variant}.png", bg is not None)

    # Logo long du site (en-tête, écran d'erreur) : lettres en currentColor.
    layers, viewbox = lockup("Movıx", RED, "currentColor", perforated=True)
    component = ROOT / "src/components/brand/MovixWordmark.tsx"
    component.parent.mkdir(exist_ok=True)
    component.write_text(wordmark_component(layers, viewbox), encoding="utf-8", newline="\n")

    # Icône en SVG pour le site et les extensions : favicon, page À propos,
    # page OAuth, fenêtre des extensions. Les PNG restent pour les manifestes,
    # les notifications et les e-mails, qui n'acceptent pas le SVG.
    icon_svg = svg_doc(icons["movix"], (100, 100), "Movix", bg=BG, size=(512, 512))
    for rel in ("public/movix.svg", "src/assets/brand/movix.svg",
                "extension/Chrome/movix.svg", "extension/Firefox/movix.svg"):
        path = ROOT / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(icon_svg, encoding="utf-8", newline="\n")
    # Logo du groupe pour le site (popup d'annonce du Telegram ix).
    (ROOT / "src/assets/brand/groupe-ix.svg").write_text(
        svg_doc(icons["groupe-ix"], (100, 100), "Groupe ix", bg=BG, size=(512, 512)),
        encoding="utf-8", newline="\n")

    # Icônes Movix déjà présentes dans le dépôt : même nom, même taille.
    densities = ("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi")
    square = [
        "public/movix.png",
        "public/movix512.png",
        "public/movix-192.png",
        "public/apple-touch-icon-180.png",
        "public/favicon-48.png",
        "extension/Chrome/movix.png",
        "extension/Firefox/movix.png",
        "app/ios/Movix/Images.xcassets/MovixLogo.imageset/movix512.png",
        *[f"app/android/app/src/main/res/mipmap-{d}/ic_launcher.png" for d in densities],
        *sorted(p.relative_to(ROOT).as_posix()
                for p in (ROOT / "app/ios/Movix/Images.xcassets/AppIcon.appiconset").glob("icon-*.png")),
    ]
    for rel in square:
        path = ROOT / rel
        save_png(rasterize(icons["movix"], (100, 100), current_size(path), bg=BG), path, True)
    for d in densities:
        path = ROOT / f"app/android/app/src/main/res/mipmap-{d}/ic_launcher_round.png"
        save_png(rasterize(icons["movix"], (100, 100), current_size(path), bg=BG,
                           scale=ROUND_SCALE, circle=True), path, False)

    if args.redirection:
        site = args.redirection.resolve()
        # Favicon SVG, icône PNG (écran d'accueil Apple, navigateurs sans
        # favicon SVG, données structurées) et image de partage en PNG.
        (site / "public/favicon.svg").write_text(icon_svg, encoding="utf-8", newline="\n")
        save_png(rasterize(icons["movix"], (100, 100), (1024, 1024), bg=BG), site / "public/movix.png", True)
        save_png(og_image(), site / "public/og-image.png", True)
        # Logo long (barre du haut, pied de page) et logos de la section du groupe ix.
        layers, viewbox = lockup("Movıx", RED, "currentColor", perforated=True)
        component = site / "src/components/brand/MovixWordmark.tsx"
        component.parent.mkdir(parents=True, exist_ok=True)
        component.write_text(wordmark_component(layers, viewbox), encoding="utf-8", newline="\n")
        for name in ("groupe-ix", "loadix"):
            path = site / f"src/assets/brand/{name}.svg"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(svg_doc(icons[name], (100, 100), names[name], bg=BG, size=(512, 512)),
                            encoding="utf-8", newline="\n")

    if args.loadix:
        loadix = args.loadix.resolve()
        # Avatar rond de Loadix, rangé avec ses autres logos.
        avatar = loadix / "logos/loadix-brackets-avatar"
        avatar.with_suffix(".svg").write_text(
            svg_doc(icons["loadix"], (100, 100), "Loadix avatar", bg=BG, size=(100, 100), scale=AVATAR_SCALE),
            encoding="utf-8", newline="\n")
        size = current_size(loadix / "logos/loadix-brackets-icon.png")
        save_png(rasterize(icons["loadix"], (100, 100), size, bg=BG, scale=AVATAR_SCALE),
                 avatar.with_suffix(".png"), True)
        # Copie servie par le site (avatar rond du bot officiel).
        for suffix in (".svg", ".png"):
            shutil.copyfile(avatar.with_suffix(suffix),
                            loadix / f"loadix-web/public/logos/loadix-brackets-avatar{suffix}")
        # Logos Loadix en SVG à contours vectorisés : même dessin que les PNG,
        # sans dépendre du chargement d'Inter (le texte SVG plaçait mal le
        # point carré et les crochets tant que la police n'était pas là).
        horizontal, lockup_box = lockup("Loadıx", BLUE, INK, perforated=False)
        inverse, _ = lockup("Loadıx", BLUE, LIGHT, perforated=False)
        files = {
            "loadix-brackets-horizontal.svg": svg_doc(horizontal, lockup_box, "[Loadix]"),
            "loadix-brackets-inverse.svg": svg_doc(inverse, lockup_box, "[Loadix] inverse"),
            "loadix-brackets-icon.svg": svg_doc(icons["loadix"], (100, 100), "Loadix", size=(100, 100)),
        }
        for folder in (loadix / "logos", loadix / "loadix-web/public/logos"):
            for name, content in files.items():
                (folder / name).write_text(content, encoding="utf-8", newline="\n")
        # Favicon sur fond clair, comme l'icône PNG.
        (loadix / "loadix-web/public/favicon.svg").write_text(
            svg_doc(icons["loadix"], (100, 100), "Loadix", bg=BG, size=(100, 100)),
            encoding="utf-8", newline="\n")
        # Bouton « Continuer avec Movix » de la page de connexion Loadix.
        path = loadix / "loadix-web/public/icons/movix.png"
        save_png(rasterize(icons["movix"], (100, 100), current_size(path), bg=BG), path, True)


if __name__ == "__main__":
    main()
