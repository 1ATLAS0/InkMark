#!/usr/bin/env python3
"""InkMark 品牌资产生成器。

一份设计规格 -> 桌面端(ico/png) + Android(mipmap) + Web(favicon.svg) 全量图标。
可重复执行，幂等；不依赖任何上游 logo 素材。

用法:
    python tools/make_brand_assets.py            # 生成 + 预览
    python tools/make_brand_assets.py --preview  # 只生成预览图
"""
from __future__ import annotations

import argparse
import os
from PIL import Image, ImageDraw

# ---------------------------------------------------------------- 设计规格
BRAND = dict(
    teal=(0x1E, 0x6F, 0x7A),      # 渐变起点（左上）
    indigo=(0x3B, 0x3F, 0x9C),    # 渐变终点（右下）
    white=(0xFF, 0xFF, 0xFF),
    tile_radius_ratio=0.225,      # 圆角半径 / 边长
    glyph_stroke_ratio=0.084,     # 笔画粗细 / 边长
    # 折线 ">" 三点（相对坐标，基于 1024 基准）
    chevron=[(290, 330), (520, 512), (290, 694)],
    underscore=(574, 664, 760, 750),   # x0 y0 x1 y1（相对坐标）
    glyph_scale=0.56,             # 自适应图标里 glyph 占画布的比例
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESKTOP = os.path.join(ROOT, "desktop")
ANDROID = os.path.join(ROOT, "android")
PREVIEW = os.path.join(ROOT, "tools", "preview")

# Android mipmap 密度 -> (legacy 边长, adaptive 边长)
DENSITIES = {
    "mdpi": (48, 108),
    "hdpi": (72, 162),
    "xhdpi": (96, 216),
    "xxhdpi": (144, 324),
    "xxxhdpi": (192, 432),
}


# ---------------------------------------------------------------- 绘制原语
def _mix(c0, c1, t):
    return tuple(round(a + (b - a) * t) for a, b in zip(c0, c1))


def gradient_tile(size: int) -> Image.Image:
    """对角线渐变（左上 teal -> 右下 indigo），用低分辨率放大保证平滑。"""
    base = 64
    small = Image.new("RGB", (base, base))
    px = small.load()
    for y in range(base):
        for x in range(base):
            px[x, y] = _mix(BRAND["teal"], BRAND["indigo"], (x + y) / (2 * (base - 1)))
    return small.resize((size, size), Image.LANCZOS)


def rounded_mask(size: int, radius: int) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def stroke(draw: ImageDraw.ImageDraw, p0, p1, width: float, fill) -> None:
    """带圆头圆角的粗线段（PIL 的 line 无圆头，手工补两端圆）。"""
    (x0, y0), (x1, y1) = p0, p1
    dx, dy = x1 - x0, y1 - y0
    length = (dx * dx + dy * dy) ** 0.5 or 1.0
    nx, ny = -dy / length * width / 2, dx / length * width / 2
    draw.polygon([(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)], fill=fill)
    r = width / 2
    for (cx, cy) in ((x0, y0), (x1, y1)):
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fill)


def draw_glyph(img: Image.Image, scale: float, color) -> None:
    """在 img 中央绘制品牌字形（折线 + 下划线），scale = 字形宽度占画布比例。

    设计坐标基于 1024 基准（BRAND 里的数值），这里整体缩放到目标画布并居中。
    """
    size = img.width
    d = ImageDraw.Draw(img)
    # 字形包围盒（含下划线），设计坐标基于 1024 基准
    bx0 = BRAND["chevron"][0][0]
    by0 = BRAND["chevron"][0][1]
    bx1 = BRAND["underscore"][2]
    by1 = BRAND["underscore"][3]
    k = (size * scale) / (bx1 - bx0)        # 设计单位 -> 像素
    ox = (size - (bx1 - bx0) * k) / 2
    oy = (size - (by1 - by0) * k) / 2

    def to_px(pt):
        return (ox + (pt[0] - bx0) * k, oy + (pt[1] - by0) * k)

    pts = [to_px(p) for p in BRAND["chevron"]]
    w = 1024 * BRAND["glyph_stroke_ratio"] * k
    stroke(d, pts[0], pts[1], w, color)
    stroke(d, pts[1], pts[2], w, color)
    x0, y0, x1, y1 = BRAND["underscore"]
    ux0, uy0 = to_px((x0, y0))
    ux1, uy1 = to_px((x1, y1))
    d.rounded_rectangle([ux0, uy0, ux1, uy1], radius=(uy1 - uy0) / 2, fill=color)


def app_icon(size: int, transparent_bg: bool = False) -> Image.Image:
    """应用图标：渐变圆角方块 + 白色字形。transparent_bg 用于自适应前景层。"""
    if transparent_bg:
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw_glyph(img, BRAND["glyph_scale"], BRAND["white"] + (255,))
        return img
    tile = gradient_tile(size).convert("RGBA")
    tile.putalpha(rounded_mask(size, round(size * BRAND["tile_radius_ratio"])))
    draw_glyph(tile, BRAND["glyph_scale"], BRAND["white"] + (255,))
    return tile


def glyph_silhouette(size: int) -> Image.Image:
    """单色层（Android monochrome）：白色剪影 + 透明底。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_glyph(img, BRAND["glyph_scale"], (255, 255, 255, 255))
    return img


def document_icon(size: int) -> Image.Image:
    """文件关联图标：纸面 + 折角 + 品牌色字形。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    m = size * 0.08
    fold = size * 0.28
    body = [m, m, size - m, size - m]
    d.rounded_rectangle(body, radius=size * 0.10, fill=(252, 252, 253, 255),
                        outline=(0xD5, 0xDB, 0xE4, 255), width=max(1, round(size * 0.018)))
    # 右上折角
    d.polygon([(size - m - fold, m), (size - m, m + fold), (size - m - fold, m + fold)],
              fill=(0xE4, 0xE9, 0xF0, 255))
    draw_glyph(img, BRAND["glyph_scale"] * 0.78, BRAND["teal"] + (255,))
    return img


def save_ico(path: str, base: int = 256) -> None:
    img = app_icon(base)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, format="ICO",
             sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])


ICNS_SIZES = [16, 32, 64, 128, 256, 512]
# icns 元素类型 -> 需要写入的像素边长
ICNS_TYPES = {"icp4": 16, "icp5": 32, "icp6": 64, "ic07": 128, "ic08": 256, "ic09": 512}


def save_icns(path: str) -> None:
    """手写 ICNS 容器（Pillow 无法在非 macOS 上写 icns）。

    结构: 'icns' + 总长度(大端 u32) + 若干 [类型(4B) + 长度(u32) + PNG 数据]。
    """
    import struct
    chunks = b""
    for tag, px in ICNS_TYPES.items():
        import io
        buf = io.BytesIO()
        app_icon(px).save(buf, format="PNG")
        data = buf.getvalue()
        chunks += tag.encode("ascii") + struct.pack(">I", len(data) + 8) + data
    blob = b"icns" + struct.pack(">I", len(chunks) + 8) + chunks
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(blob)


FAVICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1E6F7A"/>
      <stop offset="1" stop-color="#3B3F9C"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="1024" height="1024" rx="230" ry="230" fill="url(#g)"/>
  <g fill="none" stroke="#FFFFFF" stroke-width="86" stroke-linecap="round" stroke-linejoin="round">
    <path d="M290 330 L520 512 L290 694"/>
  </g>
  <rect x="574" y="664" width="186" height="86" rx="43" ry="43" fill="#FFFFFF"/>
</svg>
"""


def write(path: str, img: Image.Image) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true", help="只出预览图，不写入项目")
    args = ap.parse_args()

    if args.preview:
        os.makedirs(PREVIEW, exist_ok=True)
        sheet = Image.new("RGBA", (620, 200), (245, 246, 248, 255))
        x = 20
        for s in (128, 64, 32, 16):
            sheet.paste(app_icon(s), (x, 20 + (128 - s) // 2), app_icon(s))
            x += s + 20
        sheet.paste(document_icon(128), (x, 20), document_icon(128))
        sheet.save(os.path.join(PREVIEW, "preview.png"))
        print("preview ->", os.path.join(PREVIEW, "preview.png"))
        return

    # --- 桌面对（Windows/Linux/macOS） ---
    save_ico(os.path.join(DESKTOP, "packages/desktop/static/icon.ico"))
    save_icns(os.path.join(DESKTOP, "packages/desktop/static/icon.icns"))
    write(os.path.join(DESKTOP, "packages/desktop/static/icon.png"), app_icon(512))
    save_ico(os.path.join(DESKTOP, "packages/desktop/build/icons/icon.ico"))
    save_ico(os.path.join(DESKTOP, "packages/desktop/build/icons/md.ico"))
    write(os.path.join(DESKTOP, "packages/desktop/build/icons/icon.png"), app_icon(512))
    write(os.path.join(DESKTOP, "packages/desktop/build/icons/md.png"), document_icon(512))
    for s in (16, 24, 32, 48, 64, 128, 256, 512):
        write(os.path.join(DESKTOP, f"packages/desktop/build/icons/{s}x{s}/inkmark.png"), app_icon(s))
        write(os.path.join(DESKTOP, f"packages/desktop/build/icons/{s}x{s}/md.png"), document_icon(s))
    write(os.path.join(DESKTOP, "packages/desktop/static/logo-96px.png"), app_icon(96))
    write(os.path.join(DESKTOP, "packages/desktop/static/logo-small.png"), app_icon(64))
    write(os.path.join(DESKTOP, "packages/desktop/src/renderer/src/assets/images/logo.png"), app_icon(256))

    # --- Android ---
    for density, (legacy, adaptive) in DENSITIES.items():
        base = os.path.join(ANDROID, f"android/app/src/main/res/mipmap-{density}")
        write(os.path.join(base, "ic_launcher.png"), app_icon(legacy))
        write(os.path.join(base, "ic_launcher_foreground.png"), app_icon(adaptive, transparent_bg=True))
        write(os.path.join(base, "ic_launcher_monochrome.png"), glyph_silhouette(adaptive))
    with open(os.path.join(ANDROID, "public/favicon.svg"), "w", encoding="utf-8") as fh:
        fh.write(FAVICON_SVG)
    with open(os.path.join(DESKTOP, "packages/desktop/build/icons/md.svg"), "w", encoding="utf-8") as fh:
        fh.write(FAVICON_SVG)

    print("brand assets written.")
    print("  desktop:", os.path.join(DESKTOP, "packages/desktop/static/icon.ico"), "等")
    print("  android:", os.path.join(ANDROID, "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png"), "等")


if __name__ == "__main__":
    main()
