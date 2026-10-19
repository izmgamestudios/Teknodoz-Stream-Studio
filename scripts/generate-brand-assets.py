#!/usr/bin/env python3
"""Generate the default app icons and the share image (needs Pillow: pip install pillow).

    python3 scripts/generate-brand-assets.py            # writes public/icons/*.png + public/og-image.png
    python3 scripts/generate-brand-assets.py --out dir  # somewhere else

The mark is the ring + pointer + dot of the Teknodoz wordmark ("O" glyph), drawn 4x and downsampled.
Replace the PNGs in public/ with your own artwork whenever you like (see docs/BRANDING.md); the
file names are what src/studio/branding/brand.ts points at.
"""
import argparse
import math
import os

from PIL import Image, ImageDraw, ImageFont

SS = 4  # supersampling factor


def oklch(l, c, h):
    a = c * math.cos(math.radians(h))
    b = c * math.sin(math.radians(h))
    l_ = l + 0.3963377774 * a + 0.2158037573 * b
    m_ = l - 0.1055613458 * a - 0.0638541728 * b
    s_ = l - 0.0894841775 * a - 1.2914855480 * b
    l3, m3, s3 = l_**3, m_**3, s_**3
    rgb = (
        4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
        -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
        -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3,
    )

    def enc(x):
        x = min(1.0, max(0.0, x))
        return round(255 * (12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055))

    return tuple(enc(x) for x in rgb)


BG = (0x12, 0x14, 0x1A)
CYAN = oklch(0.82, 0.13, 200)
MAGENTA = oklch(0.65, 0.25, 320)
MUTED = (0x9A, 0xA3, 0xB2)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def glyph(height_px):
    """The O-glyph (viewBox 32x40) as an RGBA image `height_px` tall, gradient cyan -> magenta."""
    s = height_px * SS / 40
    w, h = round(32 * s), round(40 * s)
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    cx, cy, r, sw = 16 * s, 17 * s, 12.5 * s, 2.2 * s
    d.ellipse([cx - r - sw / 2, cy - r - sw / 2, cx + r + sw / 2, cy + r + sw / 2], fill=255)
    d.ellipse([cx - r + sw / 2, cy - r + sw / 2, cx + r - sw / 2, cy + r - sw / 2], fill=0)
    d.polygon([(16 * s, 36 * s), (9 * s, 27 * s), (23 * s, 27 * s)], fill=255)
    grad = Image.new("RGB", (w, h))
    gp = grad.load()
    for y in range(h):
        for x in range(w):
            gp[x, y] = lerp(CYAN, MAGENTA, (x / w + y / h) / 2)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(grad, (0, 0), mask)
    dot = ImageDraw.Draw(out)
    dr = 3 * s
    dot.ellipse([cx - dr, 14 * s - dr, cx + dr, 14 * s + dr], fill=MAGENTA + (255,))
    return out.resize((round(32 * height_px / 40), height_px), Image.LANCZOS)


def icon(size, mark_ratio, rounded):
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=round(big * 0.22), fill=BG + (255,))
    else:
        d.rectangle([0, 0, big, big], fill=BG + (255,))
    g = glyph(round(size * mark_ratio)).resize(
        (round(32 * size * mark_ratio / 40 * SS), round(size * mark_ratio * SS)), Image.LANCZOS
    )
    img.alpha_composite(g, ((big - g.width) // 2, (big - g.height) // 2))
    return img.resize((size, size), Image.LANCZOS)


def font(size, bold=False):
    names = (
        ["DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf"] if bold else ["DejaVuSans.ttf", "LiberationSans-Regular.ttf"]
    )
    for n in names:
        for base in ("/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/truetype/liberation", ""):
            try:
                return ImageFont.truetype(os.path.join(base, n), size)
            except OSError:
                pass
    return ImageFont.load_default()


def og_image(w=1200, h=630):
    img = Image.new("RGB", (w, h), BG)
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = max(0.0, 1 - math.hypot(x - w * 0.88, y - h * 0.1) / (w * 0.55))
            u = max(0.0, 1 - math.hypot(x - w * 0.05, y - h * 1.0) / (w * 0.45))
            c = lerp(BG, CYAN, t * 0.30)
            px[x, y] = lerp(c, MAGENTA, u * 0.28)
    d = ImageDraw.Draw(img)
    for gy in range(24, h, 28):  # dotted backdrop, same idea as the broadcast templates
        for gx in range(24, w, 28):
            d.point((gx, gy), fill=(70, 78, 98))
    g = glyph(230)
    img.paste(g, (90, 110), g)
    d.text((370, 120), "Teknodoz Studio", font=font(76, True), fill=(255, 255, 255))
    d.text((372, 222), "Prompter · Canlı yayın · Konuk stüdyosu", font=font(34), fill=MUTED)
    d.text((372, 282), "Ücretsiz, açık kaynak, tarayıcıda çalışır", font=font(34), fill=MUTED)
    d.rounded_rectangle([372, 360, 640, 408], radius=24, outline=CYAN, width=2)
    d.text((398, 369), "ERKEN ERİŞİM", font=font(24, True), fill=CYAN)
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "public"))
    out = os.path.abspath(ap.parse_args().out)
    os.makedirs(os.path.join(out, "icons"), exist_ok=True)
    icon(192, 0.62, True).save(os.path.join(out, "icons", "icon-192.png"), optimize=True)
    icon(512, 0.62, True).save(os.path.join(out, "icons", "icon-512.png"), optimize=True)
    # maskable: full-bleed, mark inside the central 80 % safe zone
    icon(512, 0.5, False).save(os.path.join(out, "icons", "icon-maskable-512.png"), optimize=True)
    # iOS rounds the corners itself and dislikes transparency
    icon(180, 0.6, False).convert("RGB").save(os.path.join(out, "icons", "apple-touch-icon.png"), optimize=True)
    og_image().save(os.path.join(out, "og-image.png"), optimize=True)
    print("wrote icons and og-image.png to", out)


if __name__ == "__main__":
    main()
