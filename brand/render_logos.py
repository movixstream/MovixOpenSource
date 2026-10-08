"""Génère le kit de logos (groupe ix, Movix, Loadix) en SVG et en PNG.

Usage : python brand/render_logos.py   (Pillow requis)

Toute la géométrie vit dans un carré de 100 unités, relevée sur le logo
Loadix (crochets 12→88 × 15→85, épaisseur 8). Le script écrit les SVG et
PNG de brand/, puis réécrit chaque icône Movix du dépôt à sa taille
actuelle : seul le dessin change, jamais le nom ni les dimensions.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent

BG = "#F3F4EF"     # fond de Loadix
INK = "#000000"
RED = "#DC2626"    # rouge du « MOVIX » de l'en-tête du site
BLUE = "#3B6FFF"   # bleu de Loadix

BRACKET_L = [(12, 15), (36, 15), (36, 23), (20, 23), (20, 77), (36, 77), (36, 85), (12, 85)]
BRACKET_R = [(100 - x, y) for x, y in BRACKET_L]
# Perforations de pellicule, 5 par crochet, entre les deux bras.
HOLES = [(x, y, x + 4, y + 4.4) for x in (14, 82) for y in (28.3, 38.05, 47.8, 57.55, 67.3)]
HOLE_R = 0.9

GLYPH_M = [[(34.4, 34.75), (43.1, 34.75), (50, 53.05), (56.9, 34.75), (65.6, 34.75),
            (65.6, 65.25), (58.4, 65.25), (58.4, 49.34), (52.4, 65.25), (47.6, 65.25),
            (41.6, 49.34), (41.6, 65.25), (34.4, 65.25)]]
GLYPH_L = [[(42, 34.75), (49.2, 34.75), (49.2, 59.4), (62, 59.4), (62, 65.25), (42, 65.25)]]
GLYPH_IX = [
    [(34.7, 34.75), (41.9, 34.75), (41.9, 41.95), (34.7, 41.95)],
    [(34.7, 44.8), (41.9, 44.8), (41.9, 65.25), (34.7, 65.25)],
    [(45.3, 44.8), (52.9, 44.8), (65.3, 65.25), (57.7, 65.25)],
    [(57.7, 44.8), (65.3, 44.8), (52.9, 65.25), (45.3, 65.25)],
]

LOGOS = {
    "movix": {"title": "Movix", "frame": RED, "holes": True, "glyph": GLYPH_M},
    "loadix": {"title": "Loadix", "frame": BLUE, "holes": False, "glyph": GLYPH_L},
    "groupe-ix": {"title": "Groupe ix", "frame": INK, "holes": False, "glyph": GLYPH_IX},
}


def rgb(hex_color):
    return tuple(int(hex_color[i:i + 2], 16) for i in (1, 3, 5))


def num(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


def poly_d(points):
    return "M" + "L".join(f"{num(x)} {num(y)}" for x, y in points) + "Z"


def rrect_d(x0, y0, x1, y1, r):
    a = f"A{num(r)} {num(r)} 0 0 1"
    return (f"M{num(x0 + r)} {num(y0)}H{num(x1 - r)}{a} {num(x1)} {num(y0 + r)}"
            f"V{num(y1 - r)}{a} {num(x1 - r)} {num(y1)}"
            f"H{num(x0 + r)}{a} {num(x0)} {num(y1 - r)}"
            f"V{num(y0 + r)}{a} {num(x0 + r)} {num(y0)}Z")


def svg(logo):
    frame = poly_d(BRACKET_L) + poly_d(BRACKET_R)
    if logo["holes"]:
        frame += "".join(rrect_d(*hole, HOLE_R) for hole in HOLES)
    glyph = "".join(poly_d(p) for p in logo["glyph"])
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">\n'
        f'  <title>{logo["title"]}</title>\n'
        f'  <rect width="100" height="100" fill="{BG}"/>\n'
        f'  <path fill="{logo["frame"]}" fill-rule="evenodd" d="{frame}"/>\n'
        f'  <path fill="{INK}" d="{glyph}"/>\n'
        '</svg>\n'
    )


def render(logo, size, shape="square"):
    """Dessine en suréchantillonné puis réduit par moyenne de zone.

    Les sommets sont calés sur la grille de pixels de la taille finale pour
    garder des bords nets ; les perforations disparaissent sous 40 px, où
    elles ne seraient plus qu'un grain. La version ronde réduit le dessin
    pour que les coins des crochets tiennent dans le cercle.
    """
    k = max(4, -(-2048 // size))
    unit = size / 100
    inset = 0.86 if shape == "round" else 1.0

    def pt(x, y):
        x = 50 + (x - 50) * inset
        y = 50 + (y - 50) * inset
        return (round(x * unit) * k, round(y * unit) * k)

    bg = rgb(BG)
    big = size * k
    if shape == "round":
        im = Image.new("RGBA", (big, big), bg + (0,))
        draw = ImageDraw.Draw(im)
        draw.ellipse((0, 0, big - 1, big - 1), fill=bg + (255,))
    else:
        im = Image.new("RGB", (big, big), bg)
        draw = ImageDraw.Draw(im)

    for poly in (BRACKET_L, BRACKET_R):
        draw.polygon([pt(*p) for p in poly], fill=rgb(logo["frame"]))
    if logo["holes"] and size >= 40:
        # Taille fixe en pixels et centrage dans le crochet calé : sinon
        # l'arrondi donne des trous de hauteurs différentes d'une rangée à
        # l'autre.
        w = max(1, round(4 * unit * inset)) * k
        h = max(1, round(4.4 * unit * inset)) * k
        bar_x0, bar_x1 = pt(12, 50)[0], pt(20, 50)[0]
        left = bar_x0 + round((bar_x1 - bar_x0 - w) / k / 2) * k
        for x in (left, big - left - w):
            for top in sorted({y for _, y, _, _ in HOLES}):
                y = pt(50, top)[1]
                draw.rounded_rectangle((x, y, x + w - 1, y + h - 1),
                                       radius=HOLE_R * unit * inset * k, fill=bg)
    for poly in logo["glyph"]:
        draw.polygon([pt(*p) for p in poly], fill=rgb(INK))
    return im.reduce(k)


def write_png(image, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, optimize=True)


def main():
    # Kit de marque : un SVG maître et un PNG 1024 par logo.
    brand = ROOT / "brand"
    for name, logo in LOGOS.items():
        (brand / f"{name}.svg").write_text(svg(logo), encoding="utf-8", newline="\n")
        write_png(render(logo, 1024), brand / f"{name}.png")

    # Icônes Movix déjà présentes dans le dépôt : même nom, même taille.
    densities = ("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi")
    square = [
        "movix.png",
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
    round_ = [f"app/android/app/src/main/res/mipmap-{d}/ic_launcher_round.png" for d in densities]

    for rel, shape in [(r, "square") for r in square] + [(r, "round") for r in round_]:
        path = ROOT / rel
        with Image.open(path) as current:
            size = current.size[0]
        write_png(render(LOGOS["movix"], size, shape), path)
        print(f"{rel}  {size}px  {shape}  {path.stat().st_size // 1024} Ko")


if __name__ == "__main__":
    main()
