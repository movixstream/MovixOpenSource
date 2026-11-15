"""Génère les textures du thème Halloween : brume, ciel, arbres morts, toiles
d'araignée (coins de page, HeroSlider, petites toiles), cadres lumineux,
parchemin et fantôme de la page 404.
Usage : python scripts/generate-halloween-assets.py src/assets/halloween [noms…]
Sans nom, tout est régénéré ; sinon seulement les textures nommées (ex. ghost).
Besoin de numpy et Pillow, et de SciPy pour les arbres. Les graines sont
fixes : le résultat est stable.
Les fichiers passent par Vite (nom hashé, cache d'un an côté serveur)."""
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)


def save(img, name, quality=78, alpha_quality=70):
    # Transparence compressée à 70 : deux à quatre fois plus léger, sans écart
    # visible même zoomé, y compris sur les fils fins des toiles et des arbres.
    # Les grands dégradés de transparence (halo du fantôme) y font des bandes :
    # ceux-là la gardent sans perte.
    img.save(OUT / f'{name}.webp', 'WEBP', quality=quality, alpha_quality=alpha_quality, method=6)


# ─── Bruit ───────────────────────────────────────────────────────────────────

def smooth(t):
    return t * t * (3 - 2 * t)


def value_noise(h, w, cy, cx, rng, wrap_x=True):
    """Bruit de valeur lissé, périodique en x si wrap_x."""
    grid = rng.random((cy + 1, cx if wrap_x else cx + 1))
    ys = np.linspace(0, cy, h, endpoint=False)
    xs = np.linspace(0, cx, w, endpoint=False)
    y0 = np.floor(ys).astype(int)
    x0 = np.floor(xs).astype(int)
    ty = smooth(ys - y0)[:, None]
    tx = smooth(xs - x0)[None, :]
    x1 = (x0 + 1) % cx if wrap_x else x0 + 1
    y1 = y0 + 1
    a = grid[np.ix_(y0, x0)]
    b = grid[np.ix_(y0, x1)]
    c = grid[np.ix_(y1, x0)]
    d = grid[np.ix_(y1, x1)]
    top = a + (b - a) * tx
    bot = c + (d - c) * tx
    return top + (bot - top) * ty


def fbm(h, w, base_cy, base_cx, octaves, rng, wrap_x=True):
    total = np.zeros((h, w))
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        f = 2 ** o
        total += amp * value_noise(h, w, base_cy * f, base_cx * f, rng, wrap_x)
        norm += amp
        amp *= 0.55
    total /= norm
    return (total - total.min()) / (total.max() - total.min())


def wrap_blur(img, radius):
    """Flou gaussien qui conserve la périodicité horizontale."""
    w, h = img.size
    pad = int(radius * 3) + 2
    big = Image.new(img.mode, (w + 2 * pad, h))
    big.paste(img.crop((w - pad, 0, w, h)), (0, 0))
    big.paste(img, (pad, 0))
    big.paste(img.crop((0, 0, pad, h)), (pad + w, 0))
    big = big.filter(ImageFilter.GaussianBlur(radius))
    return big.crop((pad, 0, pad + w, h))


# ─── Brume et ciel ───────────────────────────────────────────────────────────
# Fumée sombre en volutes, comme sur les maquettes. Les nappes qui défilent
# sont en niveaux de gris (le dessus des bouffées, éclairé, est plus clair) :
# HalloweenDecor les teinte dans un canvas selon la page, en multipliant ce
# gris par la teinte. Une tuile de 1024 px suffit : la texture est floue, et
# le canvas qui la reçoit ne dépend ni de la taille de l'écran ni de sa
# densité de pixels.

def warp(field, dx, dy, wrap_x=True):
    """Échantillonne `field` aux positions décalées de (dx ; dy) pixels."""
    h, w = field.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    x = np.mod(xx + dx, w) if wrap_x else np.clip(xx + dx, 0, w - 1)
    y = np.clip(yy + dy, 0, h - 1)
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    x1 = (x0 + 1) % w if wrap_x else np.minimum(x0 + 1, w - 1)
    y1 = np.minimum(y0 + 1, h - 1)
    tx, ty = x - x0, y - y0
    top = field[y0, x0] * (1 - tx) + field[y0, x1] * tx
    bot = field[y1, x0] * (1 - tx) + field[y1, x1] * tx
    return top * (1 - ty) + bot * ty


def blur_array(arr, radius, wrap_x=True):
    """Flou gaussien d'un tableau de 0 à 1 (périodique en x si wrap_x)."""
    img = Image.fromarray(np.clip(arr * 255, 0, 255).astype(np.uint8))
    img = wrap_blur(img, radius) if wrap_x else img.filter(ImageFilter.GaussianBlur(radius))
    return np.array(img).astype(float) / 255


def billows(h, w, rng, count, y_range, r_range, wrap_x=True, x_weight=None):
    """Bouffées rondes réunies en douceur : elles se fondent sans pli sombre."""
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    field = np.zeros((h, w))
    for _ in range(count):
        cx = rng.uniform(0, w)
        while x_weight is not None and rng.random() >= x_weight(cx / w):
            cx = rng.uniform(0, w)
        cy = rng.uniform(*y_range) * h
        r = rng.uniform(*r_range) * h
        dx = xx - cx
        if wrap_x:
            dx = (dx + w / 2) % w - w / 2
        d2 = (dx / (r * rng.uniform(1.2, 1.9))) ** 2 + ((yy - cy) / r) ** 2
        field = 1 - (1 - field) * (1 - np.exp(-d2 * 1.4) * rng.uniform(0.55, 0.9))
    return field


def smoke(h, w, seed, count, y_range, r_range, density, wrap_x=True, x_weight=None, top_fade=(0.0, 0.35)):
    """Banc de fumée : bouffées déformées, volutes, bords effilochés, dessus
    éclairé. Renvoie (luminance, alpha), de 0 à 1."""
    rng = np.random.default_rng(seed)
    shape = billows(h, w, rng, count, y_range, r_range, wrap_x, x_weight)
    n1 = fbm(h, w, 3, 6, 6, rng, wrap_x)
    n2 = fbm(h, w, 3, 6, 5, rng, wrap_x)
    shape = warp(shape, (n1 - 0.5) * 70, (n2 - 0.5) * 36, wrap_x)
    detail = fbm(h, w, 4, 10, 6, rng, wrap_x)
    wisps = warp(detail, (n2 - 0.5) * 110, (n1 - 0.5) * 60, wrap_x)
    y = np.linspace(0, 1, h)[:, None]
    env = np.clip((y - top_fade[0]) / max(top_fade[1], 1e-3), 0, 1) ** 1.2
    d = blur_array(shape * (0.35 + 0.95 * wisps) * env, 1.6, wrap_x)
    edge = 0.1 + 0.18 * (1 - wisps)
    alpha = np.clip((d - edge) / 0.55, 0, 1) ** 1.2 * density
    # Lumière venue d'en haut : le dessus des bouffées est plus clair.
    soft = blur_array(d, 9, wrap_x)
    up = np.roll(soft, 7, axis=0)
    up[:7] = soft[:7]
    lit = np.clip(0.5 + (soft - up) * 4.0, 0, 1)
    lum = np.clip(0.48 + 0.42 * lit + 0.2 * (wisps - 0.5), 0.3, 1)
    return lum, alpha


def fog_layer(name, w, h, seed, count, y_range, r_range, density, top_fade):
    """Nappe qui défile, en niveaux de gris, périodique en x."""
    lum, alpha = smoke(h, w, seed, count, y_range, r_range, density, top_fade=top_fade)
    rgba = np.dstack([np.dstack([lum * 255] * 3), alpha * 255])
    # Fumée floue et bruitée : la compression à 70 n'y fait pas de bandes,
    # et divise le poids par deux et demi.
    save(Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), 'RGBA'), name, 70)


def smoke_corner(name, w, h, seed, color):
    """Banc de fumée dense du coin bas gauche (retourné pour le coin droit),
    déjà teinté : il ne défile pas, il respire."""
    lum, alpha = smoke(h, w, seed, 26, (0.35, 1.05), (0.12, 0.3), 0.95,
                       x_weight=lambda u: max(0.04, (1 - u) ** 2.2), top_fade=(0.15, 0.4))
    u = np.linspace(0, 1, w)[None, :]
    alpha = alpha * np.clip((1 - u) / 0.5, 0, 1) ** 1.3
    rgb = lum[..., None] * np.array(color, float)
    rgba = np.dstack([rgb, alpha * 255])
    save(Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), 'RGBA'), name, 70)


def sky_layer(name, w, h, seed):
    """Ciel de fumée opaque, derrière tout le site : gris-vert à gauche,
    violet à droite, bleu-gris en haut, presque noir derrière le contenu."""
    rng = np.random.default_rng(seed)
    n1 = fbm(h, w, 3, 5, 6, rng, wrap_x=False)
    n2 = fbm(h, w, 3, 5, 5, rng, wrap_x=False)
    detail = fbm(h, w, 4, 7, 6, rng, wrap_x=False)
    clouds = warp(detail, (n1 - 0.5) * 160, (n2 - 0.5) * 90, wrap_x=False)
    clouds = np.clip((clouds - 0.22) / 0.55, 0, 1) ** 1.2
    u = np.linspace(0, 1, w)[None, :]
    v = np.linspace(0, 1, h)[:, None]
    wl = np.clip(1 - u / 0.3, 0, 1) ** 1.2
    wr = np.clip((u - 0.68) / 0.32, 0, 1) ** 1.1
    wt = np.clip(1 - v / 0.35, 0, 1) * (1 - wl) * (1 - wr)
    rest = np.clip(1 - wl - wr - wt, 0, 1)
    tint = (np.array([58, 76, 80]) * wl[..., None] + np.array([82, 58, 108]) * wr[..., None]
            + np.array([50, 56, 72]) * wt[..., None] + np.array([40, 44, 52]) * rest[..., None])
    # Bords et haut plus présents (une brume de fond même entre les nuages),
    # centre sombre derrière le contenu.
    edge = np.clip(np.maximum(wl, wr) + 0.6 * np.clip(1 - v / 0.3, 0, 1), 0, 1)
    amount = np.clip(clouds * (0.3 + 0.7 * edge) + 0.3 * edge, 0, 1)[..., None]
    rgb = np.array([8, 9, 12]) * (1 - amount) + tint * amount
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), 'RGB').filter(ImageFilter.GaussianBlur(1.2))
    save(img, name, 72)


# ─── Arbres morts ────────────────────────────────────────────────────────────
# Les deux arbres de la maquette (1024 × 572 px, un écran de 1920 px).
# Celui de droite, noir et net, est relevé sur la maquette elle-même :
# scripts/halloween-tree-right.png en garde la silhouette à la taille de la
# maquette, cadre (820 ; 150) - (1024 ; 572), tronc prolongé jusqu'au sol
# dans la brume. Pour le redessiner net en plus grand sans agrandir les
# pixels, la silhouette est réduite à son squelette, découpée en branches, et
# chaque branche est retracée lissée, effilée jusqu'à sa pointe. Celui de
# gauche, flou dans la brume, est tracé à la main d'après la même maquette.
# Ces deux arbres demandent SciPy en plus.

TREE_RIGHT_MASK = Path(__file__).with_name('halloween-tree-right.png')
N8 = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]


def shifted(P, dy, dx):
    """Vue de P (bordé d'un pixel) décalée de (dy ; dx)."""
    h, w = P.shape[0] - 2, P.shape[1] - 2
    return P[1 + dy:1 + dy + h, 1 + dx:1 + dx + w]


def neighbours(sk):
    P = np.pad(sk.astype(np.uint8), 1)
    return sum(shifted(P, dy, dx) for dy, dx in N8)


def thin(mask):
    """Squelette d'un pixel d'épaisseur (Zhang-Suen), sans marches
    d'escalier."""
    img = mask.astype(np.uint8).copy()
    changed = True
    while changed:
        changed = False
        for step in (0, 1):
            p = [shifted(np.pad(img, 1), dy, dx) for dy, dx in N8]
            seq = p + [p[0]]
            transitions = sum(((seq[i] == 0) & (seq[i + 1] == 1)).astype(np.uint8) for i in range(8))
            p2, p3, p4, p5, p6, p7, p8, p9 = p
            if step == 0:
                side = (p2 * p4 * p6 == 0) & (p4 * p6 * p8 == 0)
            else:
                side = (p2 * p4 * p8 == 0) & (p2 * p6 * p8 == 0)
            count = sum(p)
            gone = (img == 1) & (count >= 2) & (count <= 6) & (transitions == 1) & side
            if gone.any():
                img[gone] = 0
                changed = True
    sk = img.astype(bool)
    # Un pixel dont deux voisins orthogonaux consécutifs sont pris (N et E…)
    # est de trop si le côté opposé est vide ; un sur deux, par parité.
    yy, xx = np.indices(sk.shape)
    for _ in range(2):
        P = np.pad(sk, 1)
        n, e, s, w = shifted(P, -1, 0), shifted(P, 0, 1), shifted(P, 1, 0), shifted(P, 0, -1)
        ne, se, sw, nw = shifted(P, -1, 1), shifted(P, 1, 1), shifted(P, 1, -1), shifted(P, -1, -1)
        extra = sk & ((n & e & ~sw & ~s & ~w) | (e & s & ~nw & ~n & ~w) | (s & w & ~ne & ~n & ~e) | (w & n & ~se & ~s & ~e))
        if not extra.any():
            break
        sk &= ~(extra & ((yy + xx) % 2 == 0))
    return sk


def prune(sk, n):
    """Retire les ergots de moins de n pixels, puis rallonge les vraies
    pointes d'autant le long du squelette d'origine."""
    from scipy import ndimage as ndi
    s = sk.copy()
    for _ in range(n):
        s &= ~(s & (neighbours(s) <= 1))
    for _ in range(n):
        ends = s & (neighbours(s) <= 1)
        s |= ndi.binary_dilation(ends, structure=np.ones((3, 3))) & sk
    return s


def skeleton_branches(sk):
    """Chaînes de pixels du squelette entre deux nœuds (pointes ou
    embranchements) : [(pixels, début, fin)], début et fin valant 'tip'
    (pointe) ou 'fork' (embranchement)."""
    H, W = sk.shape
    nb = neighbours(sk)
    node = sk & ((nb == 1) | (nb >= 3))
    tip = sk & (nb == 1)
    visited = np.zeros_like(sk)

    def around(y, x):
        for dy, dx in N8:
            yy, xx = y + dy, x + dx
            if 0 <= yy < H and 0 <= xx < W and sk[yy, xx]:
                yield yy, xx

    out = []
    for y, x in zip(*np.nonzero(node)):
        for start in around(y, x):
            if node[start] or visited[start]:
                continue
            chain = [(y, x), start]
            visited[start] = True
            prev, cur = (y, x), start
            while True:
                nxt = None
                for c in around(*cur):
                    if c == prev or c in chain[-3:]:
                        continue
                    if node[c]:
                        nxt = c
                        break
                    if not visited[c] and nxt is None:
                        nxt = c
                if nxt is None:
                    break
                chain.append(nxt)
                if node[nxt]:
                    break
                visited[nxt] = True
                prev, cur = cur, nxt
            kind = lambda p: 'tip' if tip[p] else 'fork'
            out.append((chain, kind(chain[0]), kind(chain[-1])))
    return out


def trace_silhouette(mask, out_scale, pad, spur, pos_sigma, rad_sigma, grow, tip_len=1.6, min_r=0.45):
    """Retrace net une silhouette d'arbre : alpha de 0 à 1, `out_scale` fois
    la taille du masque. Chaque branche du squelette est lissée ; son
    épaisseur (distance au bord, + `grow`) aussi, et s'amincit régulièrement
    jusqu'à une pointe prolongée le long de la branche. Le masque est
    prolongé de `pad` px (bords répliqués) : ce que le cadre coupe (le tronc)
    reste plein jusqu'au bord."""
    from scipy import ndimage as ndi
    h, w = mask.shape
    m = np.pad(mask, pad, mode='edge')
    sk = prune(thin(m), spur)
    edt = ndi.distance_transform_edt(m)
    ss = 4
    f = out_scale * ss
    img = Image.new('L', (int(round(w * f)), int(round(h * f))), 0)
    d = ImageDraw.Draw(img)

    def smooth1d(a, sigma):
        return ndi.gaussian_filter1d(a, sigma, axis=0, mode='nearest') if len(a) >= 3 else a

    for chain, a, b in skeleton_branches(sk):
        if a == 'tip' and b != 'tip':
            chain, a, b = chain[::-1], b, a
        P = np.array(chain, float)
        R = np.array([edt[p] for p in chain]) - 0.5 + grow
        n = len(P)
        # Près d'un embranchement, la distance au bord est celle de la grosse
        # branche : la brindille garde sa propre épaisseur.
        core = R[3:n - 3] if n > 8 else R
        cap = np.median(core) * 1.35 + 0.4
        if a == 'fork':
            R[:4] = np.minimum(R[:4], cap)
        if b == 'fork':
            R[-4:] = np.minimum(R[-4:], cap)
        Ps = smooth1d(P, pos_sigma)
        Ps[0], Ps[-1] = P[0], P[-1]
        Rs = smooth1d(R, rad_sigma)
        if b == 'tip':
            if n >= 6:
                # Effilement régulier : droite ajustée sur l'épaisseur mesurée.
                s = np.linspace(0, 1, n)
                slope, icpt = np.polyfit(s, R, 1)
                Rs = np.clip(0.35 * Rs + 0.65 * (icpt + min(slope, 0.0) * s), 0.1, None)
            Rs = np.minimum.accumulate(Rs)
            if n >= 3:
                t = Ps[-1] - Ps[max(0, n - 5)]
                t /= max(np.linalg.norm(t), 1e-6)
                L = max(Rs[-1], 0.8) * tip_len
                Ps = np.vstack([Ps] + [Ps[-1] + t * L * k for k in (0.35, 0.7, 1.0)])
                Rs = np.concatenate([Rs, [Rs[-1] * 0.7, Rs[-1] * 0.4, 0.15]])
        pts = [((x - pad + 0.5) * f, (y - pad + 0.5) * f) for y, x in Ps]
        rads = [(max(r, min_r) if i < len(Rs) - 1 else max(r, 0.1)) * f for i, r in enumerate(Rs)]
        for (x0, y0), (x1, y1), r0, r1 in zip(pts, pts[1:], rads, rads[1:]):
            ang = math.atan2(y1 - y0, x1 - x0)
            px, py = -math.sin(ang), math.cos(ang)
            d.polygon([(x0 + px * r0, y0 + py * r0), (x0 - px * r0, y0 - py * r0),
                       (x1 - px * r1, y1 - py * r1), (x1 + px * r1, y1 + py * r1)], fill=255)
            d.ellipse([x1 - r1, y1 - r1, x1 + r1, y1 + r1], fill=255)
        (x0, y0), r0 = pts[0], rads[0]
        d.ellipse([x0 - r0, y0 - r0, x0 + r0, y0 + r0], fill=255)
    out = img.resize((int(round(w * out_scale)), int(round(h * out_scale))), Image.LANCZOS)
    return np.array(out).astype(float) / 255


def catmull(points, steps):
    """Courbe lisse (Catmull-Rom) passant par les points (x, y, largeur)."""
    pts = [points[0]] + list(points) + [points[-1]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = (np.array(p, float) for p in pts[i - 1:i + 3])
        for t in np.linspace(0, 1, steps, endpoint=False):
            out.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3))
    out.append(np.array(points[-1], float))
    return out


def save_tree(alpha, name, color):
    rgba = np.zeros(alpha.shape + (4,), np.uint8)
    rgba[..., :3] = color
    rgba[..., 3] = np.round(np.clip(alpha, 0, 1) * 255).astype(np.uint8)
    save(Image.fromarray(rgba, 'RGBA'), name, 85)


def tree_right(name):
    """Arbre de droite, relevé sur la maquette : tronc collé au bord droit,
    couronne qui monte et grosse branche basse qui part loin vers la gauche,
    au-dessus du HeroSlider. Silhouette agrandie quatre fois (bicubique) pour
    le squelette, puis retracée à 3 px par pixel de maquette."""
    from scipy import ndimage as ndi
    alpha = np.array(Image.open(TREE_RIGHT_MASK).convert('L')).astype(float) / 255
    a4 = ndi.gaussian_filter(ndi.zoom(alpha, 4, order=3), 0.8)
    mask = ndi.binary_opening(a4 > 0.45, structure=np.ones((2, 2))) | (a4 > 0.75)
    save_tree(trace_silhouette(mask, 0.75, pad=48, spur=7, pos_sigma=3.0, rad_sigma=9.0, grow=0.6), name, (7, 6, 10))


def tree_left(name):
    """Arbre de gauche, dans la brume : tronc épais coupé par le bord de
    l'écran, branche maîtresse qui monte en penchant à gauche, fourche vers
    la droite qui file derrière le HeroSlider, branche gauche qui sort de
    l'écran, et deux branches basses vers la droite (celle du bas porte
    l'araignée noire de halloween-decor.css). Points (x ; y ; épaisseur) en
    pixels de maquette, cadre (0 ; 150) - (60 ; 572), tracés à 3 px par pixel
    de maquette ; bords adoucis comme dans la brume."""
    from scipy import ndimage as ndi
    k, ss, ox, oy = 3, 4, 0, 150
    w, h = 60 * k, 422 * k
    img = Image.new('L', (w * ss, h * ss), 0)
    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(3)

    def limb(points, wobble=0.25):
        path = catmull(points, 14)
        noise = ndi.gaussian_filter1d(rng.normal(0, 1, len(path)), 3) * wobble
        f = k * ss
        q = []
        for i, p in enumerate(path):
            a, b = path[max(i - 1, 0)], path[min(i + 1, len(path) - 1)]
            dx, dy = b[0] - a[0], b[1] - a[1]
            n = math.hypot(dx, dy) or 1
            off = noise[i] * p[2] * 0.25
            q.append(((p[0] - dy / n * off - ox) * f, (p[1] + dx / n * off - oy) * f, max(p[2], 0.3) * f / 2))
        for (x0, y0, r0), (x1, y1, r1) in zip(q, q[1:]):
            ang = math.atan2(y1 - y0, x1 - x0)
            px, py = -math.sin(ang), math.cos(ang)
            d.polygon([(x0 + px * r0, y0 + py * r0), (x0 - px * r0, y0 - py * r0),
                       (x1 - px * r1, y1 - py * r1), (x1 + px * r1, y1 + py * r1)], fill=255)
            d.ellipse([x1 - r1, y1 - r1, x1 + r1, y1 + r1], fill=255)

    limb([(6, 600, 38), (8, 520, 30), (10, 460, 26), (11, 400, 23), (12, 362, 22), (15, 330, 17),
          (18, 302, 13), (17, 282, 15), (15, 262, 17), (14, 245, 12.5), (11, 232, 10.5), (9, 220, 9.5),
          (9, 207, 8), (10, 195, 6), (12, 184, 3.6), (14, 176, 1.6)], wobble=0.15)
    limb([(19, 264, 9.5), (27, 259, 8.2), (35, 255, 7.2), (43, 251, 6), (50, 247, 4.8), (58, 242, 3.2), (63, 239, 1.6)])
    limb([(12, 300, 7), (8, 286, 6), (5, 272, 5.4), (3, 259, 4.6), (1, 250, 4), (-3, 240, 3)])
    limb([(16, 354, 10), (24, 352, 8), (31, 351, 6.4), (38, 350, 5), (45, 348, 3.6), (52, 345, 2.2), (57, 343, 1)])
    limb([(20, 344, 7.5), (27, 341, 6.4), (34, 338, 5.4), (41, 335, 4.4), (48, 331, 3.4), (55, 327, 2.2), (60, 324, 1)])
    # Brindilles.
    limb([(34, 255, 3.2), (37, 247, 2.4), (39, 240, 1.6), (40, 235, 0.8)])
    limb([(45, 250, 2.8), (50, 254, 2), (54, 256, 1.2), (57, 257, 0.6)])
    limb([(30, 338, 2.8), (32, 330, 2), (33, 324, 1.2), (33, 320, 0.6)])
    limb([(42, 349, 2.4), (46, 356, 1.6), (48, 361, 0.8)])
    limb([(10, 230, 3), (5, 222, 2.2), (2, 216, 1.4), (0, 212, 0.8)])
    limb([(13, 214, 2.6), (17, 206, 1.8), (20, 200, 1.0), (21, 196, 0.5)])
    a = np.array(img.resize((w, h), Image.LANCZOS)).astype(float) / 255
    save_tree(ndi.gaussian_filter(a, 1.1), name, (8, 12, 14))


# ─── Toiles d'araignée ───────────────────────────────────────────────────────

def frame_distance(hx, hy, ang, A, B):
    """Distance du moyeu au cadre de la toile (bord haut, bord gauche, fil
    tendu de (A ; 0) à (0 ; B)) dans la direction `ang` (y vers le bas)."""
    dx, dy = math.cos(ang), -math.sin(ang)
    best = 1e9
    if dy < -1e-6 and -1 <= hx - dx * hy / dy <= A + 1:
        best = min(best, -hy / dy)
    if dx < -1e-6 and -1 <= hy - dy * hx / dx <= B + 1:
        best = min(best, -hx / dx)
    den = dx / A + dy / B
    if den > 1e-9:
        best = min(best, (1 - hx / A - hy / B) / den)
    return best


def orb_web(name, w, h, A, B, hub, spokes, radii, seed, line, outer, glow, hub_tint, width,
            dangles=0, fade=0.55, junction=None):
    """Toile de coin des maquettes : un fil tendu en diagonale de (A ; 0) à
    (0 ; B), le moyeu dedans, des rayons jusqu'au cadre et des anneaux en
    feston, presque ronds près du moyeu, qui épousent le cadre en s'en
    approchant. Trait fin, clair et chaud au moyeu, plus terne et plus
    transparent vers l'extérieur. `junction` (x ; y) : affiche la jonction de
    fils la plus proche, pour y accrocher une araignée."""
    rng = np.random.default_rng(seed)
    s = 4
    hx, hy = hub
    lines = Image.new('L', (w * s, h * s), 0)
    d = ImageDraw.Draw(lines)
    P = lambda x, y: (x * s, y * s)
    lw = max(1, round(width * s))
    d.line([P(A * 1.03, -3), P(-3, B * 1.03)], fill=235, width=lw)

    # Bouts des rayons répartis le long du cadre, à mi-chemin entre un pas
    # d'angle et un pas de longueur réguliers : la toile descend loin le long
    # du bord, sans rayons serrés près du moyeu. Un rayon par sommet.
    diag = math.hypot(A, B)
    perimeter = A + diag + B

    def point(p):
        if p <= A:
            return p, 0.0
        if p <= A + diag:
            t = (p - A) / diag
            return A * (1 - t), B * t
        return 0.0, B - (p - A - diag)

    ps = np.linspace(0, perimeter, 2000)
    th = np.unwrap([math.atan2(hy - point(p)[1], point(p)[0] - hx) for p in ps])
    m = 0.5 * ps / perimeter + 0.5 * (th[0] - th) / (th[0] - th[-1])
    mv = [float(np.interp(v, ps, m)) for v in (0.0, A, A + diag)] + [1.0]
    picks = []
    for i in range(3):
        n = max(1, round((mv[i + 1] - mv[i]) * spokes))
        for k in range(n):
            mk = mv[i] + (mv[i + 1] - mv[i]) * (k + (rng.normal(0, 0.12) if k else 0)) / n
            picks.append(float(np.interp(mk, m, ps)))
    angles = np.sort([math.atan2(hy - point(p)[1], point(p)[0] - hx) % (2 * math.pi) for p in picks])
    count = len(angles)
    lengths = [frame_distance(hx, hy, a, A, B) for a in angles]
    for a, L in zip(angles, lengths):
        d.line([P(hx, hy), P(hx + math.cos(a) * L, hy - math.sin(a) * L)], fill=255, width=lw)

    rings = []
    for k, R in enumerate(radii):
        pts = []
        for a, L in zip(angles, lengths):
            r = R * rng.uniform(0.96, 1.04)
            r = r / (1 + (r / (L * 0.97)) ** 4) ** 0.25  # se tasse contre le cadre
            pts.append((hx + math.cos(a) * r, hy - math.sin(a) * r, r / L))
        rings.append(pts)
        for i in range(count):
            j = (i + 1) % count
            if rng.random() < 0.06 or (angles[j] - angles[i]) % (2 * math.pi) > math.pi * 0.9:
                continue  # fil cassé, ou pas de fil hors du cadre
            p1, p2 = pts[i], pts[j]
            if p1[2] > 0.9 and p2[2] > 0.9 and k < len(radii) - 1 and rng.random() < 0.6:
                continue  # deux anneaux tassés contre le cadre : un seul suffit
            mx, my = (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2
            cx = mx + (hx - mx) * 0.16 * rng.uniform(0.7, 1.3)
            cy = my + (hy - my) * 0.16 * rng.uniform(0.7, 1.3)
            d.line([P((1 - t) ** 2 * p1[0] + 2 * (1 - t) * t * cx + t ** 2 * p2[0],
                      (1 - t) ** 2 * p1[1] + 2 * (1 - t) * t * cy + t ** 2 * p2[1]) for t in np.linspace(0, 1, 20)],
                   fill=230, width=lw, joint='curve')
    d.ellipse([P(hx - 1.5 * width, hy - 1.5 * width), P(hx + 1.5 * width, hy + 1.5 * width)], fill=255)

    # Fils cassés qui pendent sous le moyeu.
    for _ in range(dangles):
        x0, y0, _f = rings[rng.integers(2, max(3, len(radii) - 1))][rng.integers(0, count)]
        if y0 < hy + 4:
            continue
        length = rng.uniform(14, 34) * width
        sway = rng.uniform(-6, 6) * width
        d.line([P(x0 + sway * t * t, y0 + length * t) for t in np.linspace(0, 1, 14)], fill=210, width=lw)
        for _ in range(3):
            d.line([P(x0 + sway, y0 + length), P(x0 + sway + rng.uniform(-5, 5) * width, y0 + length + rng.uniform(2, 8) * width)],
                   fill=190, width=lw)

    lines = lines.resize((w, h), Image.LANCZOS)
    la = np.array(lines).astype(float) / 255
    gl = np.array(lines.filter(ImageFilter.GaussianBlur(2.4 * width))).astype(float) / 255
    yy, xx = np.mgrid[0:h, 0:w]
    dist = np.sqrt((xx - hx) ** 2 + (yy - hy) ** 2) / max(A, B)
    near = np.exp(-(dist / 0.22) ** 2)
    far = np.clip(dist / 0.9, 0, 1)
    alpha = np.clip((la * 0.92 + gl * glow[3] * (0.4 + near)) * (1 - fade * far), 0, 1)
    mix = np.clip(la / np.maximum(la + gl * glow[3], 1e-3), 0, 1)[..., None]
    strand = np.array(line, float) * (1 - far[..., None]) + np.array(outer, float) * far[..., None]
    strand = strand * (1 - near[..., None]) + np.array(hub_tint, float) * near[..., None]
    rgb = np.array(glow[:3], float) * (1 - mix) + strand * mix
    save(Image.fromarray(np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8), 'RGBA'), name, 82)
    if junction:
        jx, jy = junction
        best = min((p for ring in rings for p in ring), key=lambda p: (p[0] - jx) ** 2 + (p[1] - jy) ** 2)
        print(f'{name} : jonction à ({best[0] / w:.3f} ; {best[1] / h:.3f}) de la texture')


def cobweb(name, size, seed, rings, rays):
    """Toile de coin : rayons irréguliers, spirale qui pend, quelques fils
    cassés, lueur orangée autour des fils."""
    rng = np.random.default_rng(seed)
    s = 3
    S = size * s
    lines = Image.new('L', (S, S), 0)
    draw = ImageDraw.Draw(lines)
    angles = np.sort(np.clip(np.linspace(0, math.pi / 2, rays) + rng.normal(0, 0.06, rays), 0, math.pi / 2))
    reach = S * rng.uniform(0.9, 1.05, rays)
    lw = int(1.4 * s)

    def at(a, r):
        return math.cos(a) * r, math.sin(a) * r

    for a, r in zip(angles, reach):
        draw.line([(0, 0), at(a, r)], fill=255, width=lw)
    r = S * 0.08
    while r < S * 0.92 and rings > 0:
        for i in range(rays - 1):
            if rng.random() < 0.07:
                continue  # fil cassé
            a1, a2 = angles[i], angles[i + 1]
            r1 = r * rng.uniform(0.96, 1.04)
            r2 = r * rng.uniform(0.96, 1.04)
            p1, p2 = at(a1, r1), at(a2, r2)
            c = at((a1 + a2) / 2, (r1 + r2) / 2 * 0.84)
            pts = []
            for t in np.linspace(0, 1, 14):
                pts.append(((1 - t) ** 2 * p1[0] + 2 * (1 - t) * t * c[0] + t ** 2 * p2[0],
                            (1 - t) ** 2 * p1[1] + 2 * (1 - t) * t * c[1] + t ** 2 * p2[1]))
            draw.line(pts, fill=230, width=max(1, int(1.1 * s)))
        r += S / (rings + 2) * rng.uniform(0.8, 1.2)
    lines = lines.resize((size, size), Image.LANCZOS)
    glow = lines.filter(ImageFilter.GaussianBlur(3))
    yy, xx = np.mgrid[0:size, 0:size]
    fade = np.clip(1.15 - np.sqrt(xx ** 2 + yy ** 2) / size, 0.25, 1)
    line_a = np.array(lines).astype(float) / 255 * fade
    glow_a = np.array(glow).astype(float) / 255 * fade * 0.8
    alpha = np.clip(line_a * 0.9 + glow_a * 0.6, 0, 1)
    mix = np.clip(line_a / np.maximum(alpha, 1e-3), 0, 1)[..., None]
    rgb = np.array([255, 160, 80]) * (1 - mix) + np.array([240, 232, 222]) * mix
    save(Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8), 'RGBA'), name, 85)


# ─── Cadres lumineux (border-image) ──────────────────────────────────────────

FRAME_COLORS = {
    'orange': (249, 115, 22), 'green': (74, 222, 128), 'purple': (192, 132, 252),
    'yellow': (250, 204, 21), 'pink': (244, 114, 182), 'red': (248, 80, 60),
    'blue': (96, 165, 250), 'indigo': (129, 140, 248), 'sky': (56, 189, 248),
    'gray': (200, 196, 210),
}


def frame(name, color, seed):
    """Cadre de 96 px à bords irréguliers : trait clair, halo coloré, fond
    sombre. Découpé en 9 morceaux par border-image (tranche de 32 px)."""
    rng = np.random.default_rng(seed)
    s, size, inset, radius = 4, 96, 10, 14
    S = size * s
    stroke = Image.new('L', (S, S), 0)
    fill = Image.new('L', (S, S), 0)
    ImageDraw.Draw(fill).rounded_rectangle([inset * s, inset * s, S - inset * s, S - inset * s], radius * s, fill=255)
    d = ImageDraw.Draw(stroke)
    for k in range(4):
        j = rng.normal(0, 0.9 * s, 4)
        d.rounded_rectangle([inset * s + j[0], inset * s + j[1], S - inset * s + j[2], S - inset * s + j[3]],
                            radius * s, outline=200 + k * 15, width=int(1.2 * s))
    # Éraflures : petits traits le long du bord.
    for _ in range(14):
        side = rng.integers(4)
        t = rng.uniform(0.2, 0.8) * S
        e = inset * s + rng.normal(0, 1.5 * s)
        L = rng.uniform(4, 10) * s
        if side == 0:
            seg = [(t, e), (t + L, e + rng.normal(0, s))]
        elif side == 1:
            seg = [(t, S - e), (t + L, S - e + rng.normal(0, s))]
        elif side == 2:
            seg = [(e, t), (e + rng.normal(0, s), t + L)]
        else:
            seg = [(S - e, t), (S - e + rng.normal(0, s), t + L)]
        d.line(seg, fill=255, width=int(1.4 * s))
    stroke = stroke.resize((size, size), Image.LANCZOS)
    fill = fill.resize((size, size), Image.LANCZOS)
    glow = stroke.filter(ImageFilter.GaussianBlur(4))
    st = np.array(stroke).astype(float) / 255
    gl = np.clip(np.array(glow).astype(float) / 255 * 2.2, 0, 1)
    fi = np.array(fill).astype(float) / 255 * 0.72
    c = np.array(color, dtype=float)
    light = c + (255 - c) * 0.55
    alpha = np.clip(np.maximum.reduce([st, gl * 0.8, fi]), 0, 1)
    rgb = (np.array([14, 9, 6]) * (fi[..., None] * (1 - gl[..., None]))
           + c * gl[..., None] + light * st[..., None])
    rgb = rgb / np.maximum(fi[..., None] * (1 - gl[..., None]) + gl[..., None] + st[..., None], 1e-3)
    save(Image.fromarray(np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8), 'RGBA'), name, 90)


# ─── Cartes de carrousel : cadre, toiles et flèche ───────────────────────────
# Cadre de branche prune tordue à la taille de la carte (2:3, dessiné en 2x),
# en trois variantes qui alternent : card-frame-<v> (cadre, toile du coin haut
# droit, brindilles, araignées) et card-webs-<v> (toiles des coins du bas,
# effacées au survol pour laisser lire le résumé). Puis la flèche du
# carrousel, dessinée vers la droite et retournée en CSS pour la gauche.

CARD_U = 2                        # pixels par px CSS
CARD_W, CARD_H = 192 * CARD_U, 288 * CARD_U
CARD_SS = 3                       # suréchantillonnage des tracés


def card_rr_param(X, Y, a, b, r):
    """Distance signée au rectangle arrondi (négative dedans) et abscisse
    curviligne du point le plus proche du bord, sens horaire depuis le haut."""
    qx = np.clip(X, -(a - r), a - r)
    qy = np.clip(Y, -(b - r), b - r)
    dx, dy = X - qx, Y - qy
    dist = np.hypot(dx, dy)
    inside = dist == 0
    sd = np.where(inside, -np.minimum(a - np.abs(X), b - np.abs(Y)), dist - r)
    Lx, Ly, q = 2 * (a - r), 2 * (b - r), math.pi * r / 2
    ang = np.arctan2(dy, dx)
    s = np.zeros_like(X)
    top = (qy == -(b - r)) & (np.abs(qx) < a - r)
    right = (qx == a - r) & (np.abs(qy) < b - r)
    bottom = (qy == b - r) & (np.abs(qx) < a - r)
    left = (qx == -(a - r)) & (np.abs(qy) < b - r)
    tr = (qx == a - r) & (qy == -(b - r))
    br = (qx == a - r) & (qy == b - r)
    bl = (qx == -(a - r)) & (qy == b - r)
    tl = (qx == -(a - r)) & (qy == -(b - r))
    s = np.where(top, X + (a - r), s)
    s = np.where(tr, Lx + r * (ang + math.pi / 2), s)
    s = np.where(right, Lx + q + Y + (b - r), s)
    s = np.where(br, Lx + q + Ly + r * ang, s)
    s = np.where(bottom, Lx + 2 * q + Ly + (a - r) - X, s)
    s = np.where(bl, 2 * Lx + 2 * q + Ly + r * (ang - math.pi / 2), s)
    s = np.where(left, 2 * Lx + 3 * q + Ly + (b - r) - Y, s)
    tl_ang = np.where(ang > 0, ang - 2 * math.pi, ang)
    s = np.where(tl, 2 * Lx + 3 * q + 2 * Ly + r * (tl_ang + math.pi), s)
    near = np.argmin(np.stack([Y + b, a - X, b - Y, X + a]), axis=0)
    s_in = np.choose(near, [X + (a - r), Lx + q + Y + (b - r), Lx + 2 * q + Ly + (a - r) - X,
                            2 * Lx + 3 * q + Ly + (b - r) - Y])
    s = np.where(inside, s_in, s)
    P = 2 * Lx + 2 * Ly + 4 * q
    return sd, np.mod(s, P), P


def card_loop_noise(s, P, rng, k_min, k_max, slope=1.0):
    """Bruit lisse et périodique le long du contour, normalisé à [-1, 1]."""
    out = np.zeros_like(s)
    for k in range(k_min, k_max + 1):
        out += rng.uniform(0.5, 1) / k ** slope * np.sin(2 * math.pi * k * s / P + rng.uniform(0, 2 * math.pi))
    return out / np.abs(out).max()


class CardTrace:
    """Calque de tracés suréchantillonné, en pixels de l'image ; rendu en
    alpha de 0 à 1."""

    def __init__(self):
        self.img = Image.new('L', (CARD_W * CARD_SS, CARD_H * CARD_SS), 0)
        self.d = ImageDraw.Draw(self.img)

    def line(self, pts, width, val=255):
        self.d.line([(x * CARD_SS, y * CARD_SS) for x, y in pts], fill=val,
                    width=max(1, int(round(width * CARD_SS))), joint='curve')

    def ellipse(self, cx, cy, rx, ry, val=255):
        k = CARD_SS
        self.d.ellipse([(cx - rx) * k, (cy - ry) * k, (cx + rx) * k, (cy + ry) * k], fill=val)

    def alpha(self, blur=0):
        img = self.img.resize((CARD_W, CARD_H), Image.LANCZOS)
        if blur:
            img = img.filter(ImageFilter.GaussianBlur(blur))
        return np.array(img).astype(float) / 255


def card_corner_web(lines, hub_l, rng, corner, ww, wh, hub_off, n_edge, n_sag, n_rings):
    """Toile de coin : rayons du moyeu vers des points d'accroche répartis sur
    les deux bords du cadre et sur le fil extérieur qui pend, spirale en
    cercles autour du moyeu. Tailles en px CSS."""
    u = CARD_U
    cx = CARD_W if 'r' in corner else 0
    cy = CARD_H if 'b' in corner else 0
    sx = -1 if 'r' in corner else 1
    sy = -1 if 'b' in corner else 1
    hub = (cx + sx * hub_off[0] * u, cy + sy * hub_off[1] * u)
    WW, WH = ww * u, wh * u
    gam = 0.8
    edge = 2.5 * u  # accroche sous la bande du cadre

    def sag(q):
        ang = q * math.pi / 2
        return (cx + sx * (edge + (WW - edge) * math.cos(ang) ** (2 / gam)),
                cy + sy * (edge + (WH - edge) * math.sin(ang) ** (2 / gam)))

    anchors = []
    for d in np.linspace(0, 1, n_edge + 1)[1:] ** 1.15:
        anchors.append((cx + sx * (edge + d * (WW - edge) * 0.97), cy + sy * edge))
        anchors.append((cx + sx * edge, cy + sy * (edge + d * (WH - edge) * 0.97)))
    for q in np.linspace(0.12, 0.88, n_sag):
        anchors.append(sag(q + rng.normal(0, 0.02)))
    anchors.append((cx + sx * edge, cy + sy * edge))
    rays = []
    for p in anchors:
        p = (p[0] + rng.normal(0, 0.6 * u), p[1] + rng.normal(0, 0.6 * u))
        rays.append((math.atan2(p[1] - hub[1], p[0] - hub[0]), p))
    rays.sort()
    for _, p in rays:
        lines.line([hub, p], 0.6 * u, 255)
    # Spirale en cercles réguliers autour du moyeu, arrêtés là où les rayons
    # s'arrêtent : comme une vraie toile, pas un éventail.
    lens = [math.hypot(p[0] - hub[0], p[1] - hub[1]) for _, p in rays]
    step = max(lens) / (n_rings + 1.2)
    for k in range(1, n_rings + 2):
        r = step * k ** 0.97
        for i in range(len(rays)):
            j = (i + 1) % len(rays)
            (a1, p1), (a2, p2) = rays[i], rays[j]
            if (a2 - a1) % (2 * math.pi) > 1.3 or lens[i] < r or lens[j] < r or rng.random() < 0.05:
                continue  # trou entre deux rayons, ou fil cassé
            r1, r2 = r * rng.uniform(0.96, 1.04), r * rng.uniform(0.96, 1.04)
            q1 = (hub[0] + (p1[0] - hub[0]) * r1 / lens[i], hub[1] + (p1[1] - hub[1]) * r1 / lens[i])
            q2 = (hub[0] + (p2[0] - hub[0]) * r2 / lens[j], hub[1] + (p2[1] - hub[1]) * r2 / lens[j])
            mid = ((q1[0] + q2[0]) / 2, (q1[1] + q2[1]) / 2)
            c = (hub[0] + (mid[0] - hub[0]) * 0.84, hub[1] + (mid[1] - hub[1]) * 0.84)
            pts = [((1 - t) ** 2 * q1[0] + 2 * (1 - t) * t * c[0] + t ** 2 * q2[0],
                    (1 - t) ** 2 * q1[1] + 2 * (1 - t) * t * c[1] + t ** 2 * q2[1]) for t in np.linspace(0, 1, 10)]
            lines.line(pts, 0.5 * u, 225)
    lines.line([sag(q) for q in np.linspace(0, 1, 50)], 0.6 * u, 240)
    hub_l.ellipse(hub[0], hub[1], 1.6 * u, 1.6 * u)


def card_spider(lines, hub_l, x0, y0, drop):
    """Araignée pendue à son fil, accroché en (x0, y0) ; px CSS."""
    u, k = CARD_U, CARD_SS
    x0, y0, drop = x0 * u, y0 * u, drop * u
    lines.line([(x0, y0), (x0, y0 + drop)], 0.5 * u, 220)
    by = y0 + drop + 2.6 * u
    hub_l.ellipse(x0, by, 2.1 * u, 2.5 * u)
    hub_l.ellipse(x0, by - 3.1 * u, 1.35 * u, 1.3 * u)
    for side in (-1, 1):
        for ax, ay in [(3.6, -3.4), (4.4, -1.0), (4.2, 1.6), (3.2, 4.0)]:
            knee = (x0 + side * ax * 0.6 * u, by + (ay * 0.45 - 1.3) * u)
            hub_l.d.line([(x0 * k, (by - 0.6 * u) * k), (knee[0] * k, knee[1] * k),
                          ((x0 + side * ax * u) * k, (by + ay * u) * k)], fill=255, width=int(0.6 * u * k), joint='curve')


def compose_layers(layers, w, h):
    """Superpose des calques (couleur, alpha) du fond vers l'avant."""
    rgb = np.zeros((h, w, 3))
    alpha = np.zeros((h, w))
    for c, a_ in layers:
        a_ = np.clip(a_, 0, 1)
        out_a = a_ + alpha * (1 - a_)
        rgb = (np.broadcast_to(np.asarray(c, float), rgb.shape) * a_[..., None]
               + rgb * (alpha * (1 - a_))[..., None]) / np.maximum(out_a, 1e-6)[..., None]
        alpha = out_a
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8), 'RGBA')


# Variantes : graine, toile du haut, toiles du bas (coin, largeur, hauteur,
# moyeu, accroches par bord, accroches sur le fil qui pend, cercles),
# brindilles (départ, angle, longueur, courbure, épaisseur) et araignées
# (accroche, longueur du fil). Tout en px CSS.
CARD_VARIANTS = {
    'a': dict(seed=41,
              top_web=('tr', 90, 60, (23, 21), 5, 5, 8),
              bottom_webs=[('bl', 78, 50, (24, 21), 5, 5, 8), ('br', 64, 48, (20, 19), 5, 4, 7)],
              twigs=[((7.0, 67), -32, 17, 22, 2.6), ((102, 7.2), 64, 7, 12, 1.4), ((185, 214), 207, 11, -16, 1.6)]),
    'b': dict(seed=57,
              top_web=('tr', 84, 56, (21, 19), 5, 4, 8),
              bottom_webs=[('bl', 70, 46, (21, 19), 5, 4, 7), ('br', 72, 50, (23, 20), 5, 5, 8)],
              twigs=[((7.2, 64), -28, 16, 26, 2.5), ((78, 7.2), 72, 6, -10, 1.3), ((185, 166), 200, 9, 14, 1.5)]),
    'c': dict(seed=73,
              top_web=('tr', 94, 64, (24, 21), 5, 5, 8),
              bottom_webs=[('bl', 66, 46, (20, 19), 5, 4, 7), ('br', 74, 50, (23, 21), 5, 5, 8)],
              twigs=[((7.0, 70), -36, 17, 20, 2.5), ((122, 7.2), 114, 7, 10, 1.4), ((185, 236), 214, 10, -12, 1.5)],
              # Une araignée pend sous le cercueil (bas du badge : x 26, y 47
              # dans halloween-ui.css), l'autre sous la toile du coin.
              spiders=[(26, 45, 32), (177, 30, 37)]),
}


def card_frame(variant):
    """Cadre de carte : bande de branche prune qui ondule (ombre presque
    noire côté extérieur, liseré clair côté affiche), nœuds, brindilles,
    ombre portée sur l'affiche, toiles orange."""
    spec = CARD_VARIANTS[variant]
    rng = np.random.default_rng(spec['seed'])
    u, W, H = CARD_U, CARD_W, CARD_H
    yy, xx = np.mgrid[0:H, 0:W].astype(float)
    X, Y = xx + 0.5 - W / 2, yy + 0.5 - H / 2
    sd_out, s, P = card_rr_param(X, Y, W / 2, H / 2, 11.5 * u)
    depth = -sd_out
    t0 = 8.0 * u
    sd_in, _, _ = card_rr_param(X, Y, W / 2 - t0, H / 2 - t0, 9.5 * u)

    # Le bord extérieur de la branche ondule ; entre lui et le bord de la
    # carte, une ombre presque noire qui se fond dans le fond de la page
    # (pas de liseré net autour de la carte).
    o = (0.5 + 1.9 * np.clip(card_loop_noise(s, P, rng, 5, 30, 0.8), 0, 1)) * u
    m = (2.3 * card_loop_noise(s, P, rng, 3, 22, 0.7) + 0.9 * card_loop_noise(s, P, rng, 24, 70, 0.5)) * u
    for _ in range(10):  # nœuds : la branche s'épaissit par endroits
        c = rng.uniform(0, P)
        dist = np.abs((s - c + P / 2) % P - P / 2)
        m -= rng.uniform(1.0, 2.8) * u * np.exp(-(dist / (rng.uniform(3, 8) * u)) ** 2)
    outer_d = depth - o
    inner_d = sd_in + m
    band_a = np.clip(depth * 2 + 0.5, 0, 1) * np.clip(inner_d / 0.8 + 0.5, 0, 1)
    body = np.clip(outer_d / (0.9 * u) + 0.5, 0, 1)
    v = np.clip(outer_d / np.maximum(outer_d + inner_d, 1e-3), 0, 1)

    # Écorce : plaques sombres et claires étirées le long de la branche,
    # légère torsion.
    n_tex = value_noise(64, 2000, 5, 260, rng, wrap_x=False)
    gi = np.clip((depth / (14 * u) * 63).astype(int), 0, 63)
    si = np.clip(((s + depth * 1.3) % P / P * 1999).astype(int), 0, 1999)
    fib = n_tex[gi, si]
    twist = 0.5 + 0.5 * np.sin((s + depth * 2.2) / (1.6 * u) + 3.0 * card_loop_noise(s, P, rng, 2, 12))
    tone = np.clip(0.88 * fib + 0.12 * twist, 0, 1) ** 1.3

    dark = np.array([15, 7, 13], float)
    fill_lo = np.array([28, 15, 26], float)
    fill_hi = np.array([78, 57, 74], float)
    rim = np.array([112, 92, 110], float)
    col = fill_lo + (fill_hi - fill_lo) * tone[..., None]
    # Plus clair en haut, plus sombre en bas, comme sous un éclairage d'en haut.
    col *= ((0.8 + 0.2 * np.sin(v * math.pi) ** 0.5) * (1.14 - 0.32 * yy / H))[..., None]
    rim_o = np.exp(-((outer_d - 1.0 * u) / (0.6 * u)) ** 2)
    rim_i = np.exp(-((inner_d - 1.05 * u) / (0.5 * u)) ** 2)
    rim_n = value_noise(1, 2000, 1, 120, rng, wrap_x=False)[0][np.clip((s / P * 1999).astype(int), 0, 1999)]
    rim_w = np.clip(0.12 * rim_o * rim_n + 0.8 * rim_i * (0.3 + 0.7 * rim_n), 0, 1)
    col = col + (rim - col) * rim_w[..., None]
    edge = np.clip(inner_d / (0.55 * u), 0, 1)
    col = dark + (col - dark) * (0.2 + 0.8 * edge * body)[..., None]

    shade_a = np.clip(0.7 * np.exp(-np.maximum(-inner_d, 0) / (1.3 * u)), 0, 1) * (inner_d < 0.5)

    web_top, hub_top = CardTrace(), CardTrace()
    web_bot, hub_bot = CardTrace(), CardTrace()
    twig_l, twig_h = CardTrace(), CardTrace()
    card_corner_web(web_top, hub_top, rng, *spec['top_web'])
    for wb in spec['bottom_webs']:
        card_corner_web(web_bot, hub_bot, rng, *wb)
    for x0, y0, drop in spec.get('spiders', ()):
        card_spider(web_top, hub_top, x0, y0, drop)
    # Brindilles : partent du bord intérieur et s'effilent en se courbant.
    for (x0, y0), ang, length, curl, width in spec['twigs']:
        x0, y0, length = x0 * u, y0 * u, length * u
        pts = [(x0, y0)]
        a_ = math.radians(ang)
        steps = 16
        for i in range(steps):
            a_ += math.radians(curl) / steps
            pts.append((pts[-1][0] + math.cos(a_) * length / steps, pts[-1][1] + math.sin(a_) * length / steps))
        for i in range(steps):
            w = width * u * (1 - i / steps) ** 0.9 + 0.3 * u
            twig_l.line([pts[i], pts[i + 1]], w)
            off = 0.28 * u
            twig_h.line([(pts[i][0] - off, pts[i][1] - off), (pts[i + 1][0] - off, pts[i + 1][1] - off)], w * 0.4, 170)

    def web_layers(lines, hubs, strength):
        la, ha = lines.alpha(), hubs.alpha()
        glow = np.clip(lines.alpha(1.6 * u) * 1.8, 0, 1)
        hglow = hubs.alpha(2.2 * u)
        return [((255, 112, 24), glow * 0.24 * strength + hglow * 0.5),
                ((234, 142, 70), la * 0.8 * strength),
                ((246, 150, 70), ha)]

    twig_a = twig_l.alpha()
    frame_img = compose_layers([((8, 3, 8), shade_a)] + web_layers(web_top, hub_top, 0.75)
                               + [((22, 9, 18), twig_a), ((84, 66, 80), twig_h.alpha() * twig_a * 0.7), (col, band_a)], W, H)
    webs_img = compose_layers(web_layers(web_bot, hub_bot, 1.15), W, H)
    save(frame_img, f'card-frame-{variant}', 85)
    save(webs_img, f'card-webs-{variant}', 85)


def carousel_arrow(name, seed):
    """Flèche de carrousel (136 × 164 px CSS, en 2x) : panneau à bord cuivré
    et fond prune moucheté avec le halo du chevron (l'icône SVG se pose au
    centre), volutes de fer forgé, nœud de branches en haut, racines en bas,
    chauves-souris noires à gauche et orange à droite."""
    U, SS = 2, 4
    CW, CH = 136, 164
    PW, PH = 54, 120                  # panneau, taille du bouton en CSS
    PX, PY = (CW - PW) / 2, (CH - PH) / 2
    W, H = CW * U, CH * U
    rng = np.random.default_rng(seed)

    class Trace:
        """Calque suréchantillonné, coordonnées et largeurs en px CSS."""

        def __init__(self):
            self.img = Image.new('L', (W * SS, H * SS), 0)
            self.d = ImageDraw.Draw(self.img)

        def stroke(self, pts, w0, w1=None, val=255):
            """Trait effilé de w0 à w1, bouts ronds."""
            w1 = w0 if w1 is None else w1
            n = len(pts) - 1
            k = U * SS
            for i in range(n):
                w = (w0 + (w1 - w0) * i / max(n, 1)) * k
                (x1, y1), (x2, y2) = pts[i], pts[i + 1]
                self.d.line([(x1 * k, y1 * k), (x2 * k, y2 * k)], fill=val, width=max(1, int(w)))
                r = w / 2
                self.d.ellipse([x2 * k - r, y2 * k - r, x2 * k + r, y2 * k + r], fill=val)
            r = w0 * k / 2
            self.d.ellipse([pts[0][0] * k - r, pts[0][1] * k - r, pts[0][0] * k + r, pts[0][1] * k + r], fill=val)

        def poly(self, pts, val=255):
            k = U * SS
            self.d.polygon([(x * k, y * k) for x, y in pts], fill=val)

        def ellipse(self, cx, cy, rx, ry, val=255):
            k = U * SS
            self.d.ellipse([(cx - rx) * k, (cy - ry) * k, (cx + rx) * k, (cy + ry) * k], fill=val)

        def alpha(self, blur=0):
            img = self.img.resize((W, H), Image.LANCZOS)
            if blur:
                img = img.filter(ImageFilter.GaussianBlur(blur * U))
            return np.array(img).astype(float) / 255

    def bez(*p, n=24):
        m = len(p) - 1
        return [(sum(math.comb(m, i) * (1 - t) ** (m - i) * t ** i * p[i][0] for i in range(m + 1)),
                 sum(math.comb(m, i) * (1 - t) ** (m - i) * t ** i * p[i][1] for i in range(m + 1)))
                for t in np.linspace(0, 1, n)]

    def spiral(cx, cy, r0, r1, a0, turns, sign=1, n=40):
        return [(cx + math.cos(a0 + sign * turns * 2 * math.pi * i / n) * (r0 + (r1 - r0) * i / n),
                 cy + math.sin(a0 + sign * turns * 2 * math.pi * i / n) * (r0 + (r1 - r0) * i / n))
                for i in range(n + 1)]

    # Chauve-souris : silhouette du thème (BAT_PATH de HalloweenIcons.tsx,
    # viewBox 100 × 38), aile gauche puis son miroir.
    def qbez(p0, p1, p2, n=10):
        return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0],
                 (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1]) for t in np.linspace(0, 1, n)[1:]]
    bat_l = [(47, 18)] + bez((47, 18), (36, 8), (16, 2), (3, 1), n=16)[1:]
    for c, e in [((11, 7), (12, 16)), ((18, 12), (23, 20)), ((30, 16), (35, 26)), ((41, 22), (45, 30))]:
        bat_l += qbez(bat_l[-1], c, e)
    bat_r = [(100 - x, y) for x, y in bat_l]

    def bat(layer, cx, cy, span, angle=0.0, flap=1.0):
        """Chauve-souris centrée en (cx, cy) ; `flap` relève (> 1) ou
        abaisse (< 1) le bout des ailes."""
        s = span / 100
        ca, sa = math.cos(math.radians(angle)), math.sin(math.radians(angle))

        def tr(x, y):
            x, y = (x - 50) * s, (y - 19) * s * flap if y < 19 else (y - 19) * s
            return (cx + x * ca - y * sa, cy + x * sa + y * ca)
        layer.poly([tr(x, y) for x, y in bat_l])
        layer.poly([tr(x, y) for x, y in bat_r])
        layer.ellipse(*tr(50, 25), 5.2 * s, 8.0 * s)
        layer.ellipse(*tr(50, 15.5), 4.4 * s, 4.4 * s)
        for ex in (-1, 1):
            layer.poly([tr(50 + ex * 3.6, 13.2), tr(50 + ex * 4.8, 6.6), tr(50 + ex * 1.0, 11.6)])

    def scroll_side(iron, hi, sign):
        """Volutes d'un côté du panneau (sign = -1 à gauche, +1 à droite)."""
        edge = PX if sign < 0 else PX + PW

        def X(dx):
            return edge + sign * dx

        def scroll(p0, c1, c2, centre, r, a0, turns, w):
            """Volute soudée au panneau : part du bord (p0, sous le cadre),
            s'écarte en courbe puis s'enroule en spirale."""
            a = math.radians(a0 if sign > 0 else 180 - a0)
            spi = spiral(centre[0], centre[1], r, 1.2, a, turns, -sign)
            pts = bez(p0, c1, c2, spi[0], n=18) + spi[1:]
            iron.stroke(pts, w, 1.0)
            hi.stroke([(x - 0.45, y - 0.45) for x, y in pts], w * 0.32, 0.35, 150)
            iron.ellipse(pts[-1][0], pts[-1][1], 1.3, 1.3)

        # Tige qui longe le panneau en ondulant et vient toucher le cadre à
        # chaque soudure : tout le fer forgé fait corps avec le panneau.
        stem = bez((X(-2), PY + 6), (X(9), PY + 8), (X(11), PY + 22), (X(2), PY + 32), n=24) \
            + bez((X(2), PY + 32), (X(11), PY + 40), (X(12), PY + 50), (X(1), PY + PH / 2 + 2), n=24)[1:] \
            + bez((X(1), PY + PH / 2 + 2), (X(12), PY + 70), (X(11), PY + 80), (X(2), PY + 88), n=24)[1:] \
            + bez((X(2), PY + 88), (X(11), PY + 98), (X(9), PY + PH - 8), (X(-2), PY + PH - 6), n=24)[1:]
        iron.stroke(stem, 3.0, 2.6)
        hi.stroke([(x - 0.55, y - 0.55) for x, y in stem], 0.8, 0.7, 150)
        # Volutes : chacune part du cadre et s'enroule vers l'extérieur.
        scroll((X(-1), PY + 12), (X(10), PY + 8), (X(19), PY + 12), (X(15), PY + 20), 5.6, -150, 1.35, 2.6)
        scroll((X(4), PY + 30), (X(14), PY + 30), (X(20), PY + 36), (X(16), PY + 42), 4.8, -120, 1.3, 2.4)
        scroll((X(4), PY + 90), (X(14), PY + 90), (X(20), PY + 84), (X(16), PY + 78), 4.8, 120, 1.3, 2.4)
        scroll((X(-1), PY + PH - 12), (X(10), PY + PH - 8), (X(19), PY + PH - 12), (X(15), PY + PH - 20), 5.6, 150, 1.35, 2.6)
        # Petites volutes entre la tige et le cadre.
        for dy, a0 in ((44, -90), (76, 90)):
            a = math.radians(a0 if sign > 0 else 180 - a0)
            pts = spiral(X(6), PY + dy, 3.6, 1.0, a, 1.2, -sign)
            iron.stroke(pts, 1.9, 0.8)
            hi.stroke([(x - 0.35, y - 0.35) for x, y in pts], 0.55, 0.3, 140)
        # Fleuron en pointe, tourné vers l'extérieur, au milieu, sur sa tige.
        my = PY + PH / 2 + 2
        tip = X(34)
        iron.stroke([(X(0), my), (X(18), my)], 3.0, 2.6)
        iron.poly([(X(16), my - 3.0), (X(25), my - 2.0), (tip, my), (X(25), my + 2.0), (X(16), my + 3.0)])
        for k in (-1, 1):
            iron.stroke(bez((X(16), my), (X(22), my + k * 2), (X(29), my + k * 8), (X(25), my + k * 12), n=16), 2.1, 0.7)
            iron.stroke(bez((X(9), my), (X(13), my + k * 5), (X(11), my + k * 9), (X(7), my + k * 9.5), n=12), 1.8, 0.7)
        hi.stroke([(X(1), my - 1.0), (tip - sign * 3, my - 0.4)], 0.7, 0.3, 160)
        # Petites épines le long de la tige, vers l'extérieur.
        for i in range(10, len(stem) - 6, 9):
            (x1, y1), (x2, y2) = stem[i], stem[i + 1]
            nx, ny = -(y2 - y1), x2 - x1
            ln = math.hypot(nx, ny) or 1
            nx, ny = nx / ln, ny / ln
            if nx * sign < 0:
                nx, ny = -nx, -ny
            L = rng.uniform(2.2, 3.6)
            iron.poly([(x1 - ny * 0.9, y1 + nx * 0.9), (x1 + nx * L + (x2 - x1) * 0.8, y1 + ny * L + (y2 - y1) * 0.8),
                       (x1 + ny * 0.9, y1 - nx * 0.9)])

    def branch(layer, hi, pts, w0, w1, thorns=4):
        """Branche effilée, reflet clair et quelques épines."""
        layer.stroke(pts, w0, w1)
        hi.stroke([(x - 0.3, y - 0.4) for x, y in pts], w0 * 0.3, w1 * 0.3, 130)
        for i in rng.choice(np.arange(4, len(pts) - 3), size=min(thorns, len(pts) - 7), replace=False):
            (x1, y1), (x2, y2) = pts[i], pts[i + 1]
            nx, ny = -(y2 - y1), x2 - x1
            ln = math.hypot(nx, ny) or 1
            side = 1 if rng.random() < 0.5 else -1
            nx, ny = side * nx / ln, side * ny / ln
            L = rng.uniform(1.8, 3.2)
            layer.poly([(x1 - (x2 - x1) * 0.6, y1 - (y2 - y1) * 0.6),
                        (x1 + nx * L + (x2 - x1) * 1.2, y1 + ny * L + (y2 - y1) * 1.2),
                        (x1 + (x2 - x1) * 0.6, y1 + (y2 - y1) * 0.6)])

    yy, xx = np.mgrid[0:H, 0:W].astype(float)
    X, Y = (xx + 0.5) / U, (yy + 0.5) / U          # en px CSS
    # Rectangle arrondi du panneau, coins du haut plus ronds que ceux du bas.
    r_corner = np.where(Y < PY + PH / 2, 22, 17)
    qx = np.abs(X - (PX + PW / 2)) - (PW / 2 - r_corner)
    qy = np.abs(Y - (PY + PH / 2)) - (PH / 2 - r_corner)
    sd = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r_corner
    # Normale approchée (lumière en haut à gauche).
    gy, gx = np.gradient(sd)
    gl = np.maximum(np.hypot(gx, gy), 1e-6)
    nx, ny = gx / gl, gy / gl
    rim_w = 4.2
    depth = -sd
    panel_a = np.clip(depth * U + 0.5, 0, 1)
    t = np.clip(depth / rim_w, 0, 1)

    # Bord cuivré : moulure arrondie, plus claire vers le haut et la gauche.
    wood = value_noise(H, W, 18, 10, rng, wrap_x=False)
    grain = value_noise(H, W, 60, 6, rng, wrap_x=False)
    copper_dark = np.array([56, 24, 10], float)
    copper = np.array([150, 88, 52], float)
    copper_hi = np.array([220, 152, 106], float)
    prof = np.exp(-((t - 0.4) / 0.26) ** 2)
    light = np.clip(0.62 - 0.55 * (nx * 0.55 + ny * 0.85), 0.15, 1.15)
    rim_rgb = copper_dark + (copper - copper_dark) * (0.3 + 0.7 * prof)[..., None] * light[..., None]
    rim_rgb = rim_rgb + (copper_hi - rim_rgb) * (np.clip(prof - 0.55, 0, 1) * 1.5 * np.clip(light - 0.6, 0, 1))[..., None]
    rim_rgb *= (0.8 + 0.3 * wood * 0.6 + 0.14 * grain)[..., None]
    outline = np.exp(-(depth / 0.45) ** 2) + np.exp(-((depth - rim_w) / 0.55) ** 2) * 1.2
    rim_rgb = rim_rgb * (1 - np.clip(outline, 0, 0.92))[..., None]

    # Fond prune-gris moucheté, plus sombre en bas, lueur chaude au centre.
    fy = np.clip((Y - PY) / PH, 0, 1)
    stops = [(0, (52, 49, 63)), (0.3, (58, 55, 69)), (0.55, (52, 48, 61)), (0.75, (36, 33, 42)), (1, (30, 29, 38))]
    base = np.zeros((H, W, 3))
    for (f0, c0), (f1, c1) in zip(stops, stops[1:]):
        seg = (fy >= f0) & (fy <= f1)
        q = ((fy - f0) / (f1 - f0))[..., None]
        base = np.where(seg[..., None], np.array(c0, float) + (np.array(c1, float) - np.array(c0, float)) * q, base)
    # Grain d'un px CSS et demi : il reste visible une fois l'image réduite
    # en 1x. Grain sombre plus fréquent que le clair, comme un feutre usé.
    speck = Image.fromarray((rng.random((H // 3, W // 3)) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)
    speck = np.array(speck).astype(float) / 255
    mott = value_noise(H, W, 20, 14, rng, wrap_x=False)
    fill = base * (0.44 + 0.85 * speck ** 0.6 + 0.2 * (mott - 0.5))[..., None]
    gcx, gcy = PX + PW / 2, PY + PH / 2 + 3
    glow = np.exp(-(((X - gcx) / 20) ** 2 + ((Y - gcy) / 26) ** 2))
    fill = fill + (np.array([104, 60, 48], float) - fill) * (glow * 0.5)[..., None]
    inner_sh = np.clip(1 - (depth - rim_w) / 3.5, 0, 1) * (depth > rim_w)
    fill = fill * (1 - 0.5 * inner_sh)[..., None]
    # Halo du chevron : même tracé que l'icône (43 px, trait de 4,5 px).
    chev = Trace()
    ch = 21.5 / 2
    chev.stroke([(gcx - 5.4, gcy - 3 - ch), (gcx + 5.4, gcy - 3), (gcx - 5.4, gcy - 3 + ch)], 4.5)
    halo = chev.alpha(3.2)
    fill = fill + (np.array([255, 128, 36], float) - fill) * np.clip(halo * 1.15, 0, 0.85)[..., None]
    rim_mask = np.clip((rim_w - depth) * U + 0.5, 0, 1)
    panel_rgb = rim_rgb * rim_mask[..., None] + fill * (1 - rim_mask)[..., None]
    # Ombre portée du panneau, et lueur orangée autour : elle détache le fer
    # forgé noir même sur une carte sombre. Elle s'éteint avant les bords de
    # l'image, sans coupure nette.
    shadow = np.clip(1 - np.maximum(sd, 0) / 5, 0, 1) * (sd > 0) * 0.55
    border = np.clip(np.minimum.reduce([X, CW - X, Y, CH - Y]) / 14, 0, 1) ** 2
    warm = np.clip(0.62 * np.exp(-np.maximum(sd, 0) / 15), 0, 1) * (sd > 0) * border

    iron, iron_hi = Trace(), Trace()
    scroll_side(iron, iron_hi, -1)
    scroll_side(iron, iron_hi, 1)
    br, br_hi = Trace(), Trace()
    # Nœud de branches tordues sur le coin haut gauche du panneau : deux
    # brins qui s'enroulent l'un autour de l'autre, et des rameaux.
    for ph in (0.0, math.pi):
        pts = []
        for tt in np.linspace(0, 1, 40):
            off = 2.2 * math.sin(tt * 9 + ph)
            pts.append((PX - 4 + 26 * tt + off * 0.6, PY - 12 + 22 * tt - 10 * tt * (1 - tt) - off))
        branch(br, br_hi, pts, 3.0, 1.4, 3)
    branch(br, br_hi, bez((PX + 22, PY - 13), (PX + 16, PY - 2), (PX + 6, PY + 2), (PX - 3, PY + 15), n=28), 2.6, 1.0)
    branch(br, br_hi, bez((PX + 2, PY + 5), (PX + 10, PY - 8), (PX + 24, PY - 5), (PX + 31, PY + 2), n=24), 2.0, 0.8, 3)
    branch(br, br_hi, bez((PX + 9, PY - 16), (PX + 6, PY - 7), (PX + 14, PY + 1), (PX + 10, PY + 9), n=18), 1.8, 0.7, 2)
    branch(br, br_hi, bez((PX - 8, PY + 2), (PX - 2, PY - 4), (PX + 4, PY - 2), (PX + 6, PY + 6), n=16), 1.6, 0.6, 2)
    # Racines emmêlées sur le bas du panneau, surtout à droite.
    bx, by = PX + PW, PY + PH
    branch(br, br_hi, bez((PX + 14, by + 8), (PX + 26, by - 4), (PX + 40, by + 4), (bx + 8, by - 10), n=30), 2.6, 0.9, 5)
    branch(br, br_hi, bez((PX + 24, by + 14), (PX + 34, by + 2), (PX + 48, by - 6), (bx + 12, by + 4), n=30), 2.2, 0.8, 4)
    branch(br, br_hi, bez((bx - 16, by - 14), (bx - 4, by - 6), (bx + 2, by + 6), (bx - 8, by + 16), n=24), 2.0, 0.7, 3)
    branch(br, br_hi, bez((bx - 30, by + 2), (bx - 20, by + 10), (bx - 6, by + 12), (bx + 4, by + 20), n=24), 1.7, 0.6, 3)
    branch(br, br_hi, bez((PX + 4, by - 2), (PX + 10, by + 8), (PX + 20, by + 12), (PX + 30, by + 10), n=20), 1.5, 0.6, 2)

    bats_dark, bats_or, bats_or_soft = Trace(), Trace(), Trace()
    bat(bats_dark, PX - 22, PY - 1, 28, 16, 1.3)
    bat(bats_dark, PX - 32, PY + 30, 11, -10)
    bat(bats_dark, PX - 26, by + 2, 18, 8, 0.9)
    bat(bats_dark, bx + 20, PY + 38, 9, 20)
    bat(bats_or, bx + 8, PY - 13, 32, -18, 0.9)
    bat(bats_or, bx + 27, PY + 17, 15, 12)
    bat(bats_or_soft, bx + 24, by + 3, 27, -6, 0.8)

    iron_a = iron.alpha()
    br_a = br.alpha()
    img = compose_layers([
        ((150, 70, 24), warm),
        ((6, 3, 6), shadow),
        ((255, 120, 30), np.clip(bats_or.alpha(2.2) * 0.5 + bats_or_soft.alpha(2.6) * 0.45, 0, 1)),
        ((14, 10, 12), iron_a),
        ((104, 88, 90), iron_hi.alpha() * iron_a * 0.6),
        (panel_rgb, panel_a),
        ((18, 11, 14), br_a),
        ((104, 86, 92), br_hi.alpha() * br_a * 0.75),
        ((10, 6, 10), bats_dark.alpha()),
        ((236, 128, 52), bats_or.alpha()),
        ((228, 124, 56), bats_or_soft.alpha(0.5) * 0.9),
    ], W, H)
    save(img, name, 85)


# ─── Parchemin brûlé ─────────────────────────────────────────────────────────

def parchment(name, w, h, seed):
    rng = np.random.default_rng(seed)
    n = fbm(h, w, 2, 12, 6, rng, wrap_x=False)
    edge_n = fbm(h, w, 6, 60, 4, rng, wrap_x=False)
    yy, xx = np.mgrid[0:h, 0:w]
    dist = np.minimum.reduce([xx, w - 1 - xx, yy * 1.0, h - 1 - yy]).astype(float)
    ragged = dist - edge_n * 16
    alpha = np.clip(ragged / 2, 0, 1)
    burn = np.clip(1 - (ragged - 2) / 16, 0, 1) ** 1.6
    paper = np.array([233, 212, 166]) * (0.86 + 0.18 * n[..., None])
    dark = np.array([70, 38, 14])
    rgb = paper * (1 - burn[..., None] * 0.92) + dark * burn[..., None] * 0.92
    rgba = np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8)
    save(Image.fromarray(rgba, 'RGBA'), name, 80)


# ─── Fantôme de la page 404 ──────────────────────────────────────────────────

def gaussian(arr, radius):
    """Flou gaussien d'un tableau de 0 à 1."""
    img = Image.fromarray(np.clip(arr * 255, 0, 255).astype(np.uint8))
    return np.array(img.filter(ImageFilter.GaussianBlur(radius))).astype(float) / 255


def ghost(name, w, h, seed):
    """Apparition de brume : drap lumineux et translucide dont la traîne
    s'effiloche vers la droite, manches qui retombent et se dissolvent,
    orbites creuses en amande et bouche ouverte, halo lavande."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    u = xx / w
    v = yy / h

    # Ligne médiane qui ondule : la traîne part vers la droite, comme
    # emportée par un courant d'air.
    head_v, head_r = 0.25, 0.165
    t = np.clip((v - head_v) / (1 - head_v), 0, 1)
    center = 0.5 + 0.10 * t ** 2 + 0.025 * np.sin(t * math.pi * 2.2)
    # Demi-largeur : le drap s'évase juste sous la tête, puis la traîne
    # s'amincit régulièrement. Bords irréguliers : le drap se défait.
    half = head_r + 0.03 * smooth(np.clip(t / 0.18, 0, 1)) - 0.185 * smooth(np.clip((t - 0.12) / 0.88, 0, 1))
    half = half + (fbm(h, w, 6, 4, 4, rng, wrap_x=False) - 0.5) * 0.06 * (0.3 + t)
    body = (np.abs(u - center) <= half) & (v >= head_v)
    head = ((u - 0.5) ** 2 + ((v - head_v) * h / w) ** 2) <= head_r ** 2
    shape = (body | head).astype(float)

    # Manches du drap : elles partent des épaules, retombent vers l'extérieur
    # et se dissolvent au bout.
    arms = np.zeros((h, w))
    for side in (-1, 1):
        img = Image.new('L', (w, h), 0)
        d = ImageDraw.Draw(img)
        for k in np.linspace(0, 1, 40):
            ax = 0.5 + side * (0.11 + 0.17 * k)
            ay = 0.33 + 0.03 * k + 0.22 * k ** 2
            r = (0.075 - 0.04 * k) * w
            d.ellipse([ax * w - r, ay * h - r * 1.1, ax * w + r, ay * h + r * 1.1], fill=int(255 * (1 - 0.8 * k ** 1.3)))
        arms = np.maximum(arms, np.array(img).astype(float) / 255)
    shape = np.maximum(shape, arms * (0.6 + 0.4 * fbm(h, w, 8, 8, 3, rng, wrap_x=False)))

    soft = gaussian(shape, 6)
    deep = gaussian(shape, 18)

    # Brume intérieure (volutes contrastées) et effilochage de la traîne.
    mist = fbm(h, w, 5, 4, 6, rng, wrap_x=False)
    swirl = fbm(h, w, 9, 6, 4, rng, wrap_x=False)
    streak = fbm(h, w, 2, 14, 4, rng, wrap_x=False)
    fade = 1 - smooth(np.clip((v - 0.5) / 0.47, 0, 1))
    tail = np.clip(fade + (streak - 0.5) * 0.9 * (1 - fade) * 2, 0, 1)
    texture = np.clip(0.42 + 0.5 * mist + 0.35 * (swirl - 0.5), 0, 1)
    density = np.clip(soft * texture * tail * (0.7 + 0.45 * deep), 0, 1)
    halo = gaussian(shape * tail, 22) * 0.55

    # Visage : orbites en amande aux coins extérieurs tombants (air
    # mélancolique), ombre autour, bouche ouverte étirée. Bords flous.
    s = 4
    face = Image.new('L', (w * s, h * s), 0)
    fd = ImageDraw.Draw(face)
    for side in (-1, 1):
        ex, ey = (0.5 + side * 0.066) * w * s, 0.232 * h * s
        rx, ry = 0.036 * w * s, 0.047 * h * s
        pts = []
        for a in np.linspace(0, 2 * math.pi, 60, endpoint=False):
            x, y = math.cos(a) * rx, math.sin(a) * ry
            pts.append((ex + x, ey + y + side * x / rx * 0.0108 * h * s))
        fd.polygon(pts, fill=255)
    mx, my = 0.5 * w * s, 0.325 * h * s
    fd.ellipse([mx - 0.024 * w * s, my - 0.048 * h * s, mx + 0.024 * w * s, my + 0.048 * h * s], fill=235)
    face = face.resize((w, h), Image.LANCZOS)
    hole = np.array(face.filter(ImageFilter.GaussianBlur(1.6))).astype(float) / 255
    socket = np.array(face.filter(ImageFilter.GaussianBlur(9))).astype(float) / 255 * 0.45

    core = np.array([244, 242, 255], dtype=float)
    rim = np.array([150, 138, 214], dtype=float)
    glow = np.array([170, 156, 240], dtype=float)
    dark = np.array([22, 14, 38], dtype=float)
    mix = np.clip(deep * 1.4, 0, 1)[..., None]
    body_rgb = rim * (1 - mix) + core * mix
    body_rgb = body_rgb * (1 - socket[..., None]) + rim * 0.55 * socket[..., None]
    a_body = np.clip(density * 0.88, 0, 1)
    a_halo = np.clip(halo * (1 - a_body), 0, 1)
    a_hole = hole * 0.9 * np.clip(soft * 2, 0, 1)
    alpha = np.clip(a_body + a_halo, 0, 1)
    rgb = (body_rgb * a_body[..., None] + glow * a_halo[..., None]) / np.maximum(alpha, 1e-3)[..., None]
    # Les orbites et la bouche se posent par-dessus, sombres.
    rgb = rgb * (1 - a_hole[..., None]) + dark * a_hole[..., None]
    alpha = np.clip(alpha + a_hole * (1 - alpha), 0, 1)
    save(Image.fromarray(np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8), 'RGBA'), name, 80, alpha_quality=100)


# Maquettes : 1024 px de large pour un écran de 1920 px (× 1,875). Toiles en
# texture deux fois plus fine que leur taille d'affichage ; arbres à 3 px par
# pixel de maquette (voir « Arbres morts »).
MOCK = 1920 / 1024
web_px = lambda v: v * MOCK * 2
WEB_RADII = [web_px(r) for r in (8, 15, 23, 32, 42, 54, 68, 84)]

ASSETS = {
    'fog-back': lambda: fog_layer('fog-back', 1024, 380, 11, 40, (0.1, 1.0), (0.12, 0.34), 0.9, (0.0, 0.3)),
    'fog-mid': lambda: fog_layer('fog-mid', 1024, 300, 37, 30, (0.35, 1.0), (0.14, 0.36), 0.85, (0.05, 0.4)),
    'fog-front': lambda: fog_layer('fog-front', 1024, 260, 23, 26, (0.45, 1.05), (0.16, 0.42), 0.9, (0.1, 0.4)),
    'smoke-corner': lambda: smoke_corner('smoke-corner', 900, 520, 7, (96, 108, 114)),
    'sky': lambda: sky_layer('sky', 1600, 900, 5),
    'tree-left': lambda: tree_left('tree-left'),
    'tree-right': lambda: tree_right('tree-right'),
    'web-left': lambda: orb_web('web-left', round(web_px(80)), round(web_px(120)), web_px(77), web_px(115),
                                (web_px(36), web_px(35)), 14, WEB_RADII, 41, line=(236, 186, 118), outer=(186, 150, 112),
                                glow=(255, 150, 60, 0.4), hub_tint=(255, 226, 150), width=1.9,
                                junction=(web_px(25), web_px(75))),
    'web-right': lambda: orb_web('web-right', round(web_px(80)), round(web_px(120)), web_px(74), web_px(113),
                                 (web_px(36.5), web_px(33)), 14, WEB_RADII, 7, line=(240, 184, 152), outer=(196, 150, 132),
                                 glow=(255, 140, 100, 0.36), hub_tint=(255, 222, 190), width=1.9,
                                 junction=(web_px(27), web_px(70))),
    'web-hero': lambda: orb_web('web-hero', round(web_px(114)), round(web_px(108)), web_px(110), web_px(105),
                                (web_px(33), web_px(30)), 14, [web_px(r) for r in (7, 13, 20, 28, 37, 47, 58)], 19,
                                line=(236, 236, 248), outer=(200, 200, 222), glow=(176, 164, 236, 0.3),
                                hub_tint=(214, 200, 255), width=2.1, dangles=7, fade=0.25),
    'web-small': lambda: cobweb('web-small', 140, 9, 5, 6),
    **{f'frame-{key}': (lambda key=key, rgb=rgb, i=i: frame(f'frame-{key}', rgb, 100 + i))
       for i, (key, rgb) in enumerate(FRAME_COLORS.items())},
    'parchment': lambda: parchment('parchment', 1400, 200, 12),
    # Chaque variante écrit card-frame-<v> et card-webs-<v>.
    **{f'card-frame-{v}': (lambda v=v: card_frame(v)) for v in CARD_VARIANTS},
    'carousel-arrow': lambda: carousel_arrow('carousel-arrow', 5),
    'ghost': lambda: ghost('ghost', 360, 480, 7),
}

unknown = [n for n in sys.argv[2:] if n not in ASSETS]
if unknown:
    sys.exit(f'Textures inconnues : {", ".join(unknown)}')
for asset in sys.argv[2:] or ASSETS:
    ASSETS[asset]()
print('ok')
