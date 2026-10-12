#!/usr/bin/env python3
"""InkMark 文本指针（I 形光标）位图生成器。

Windows 自带的文本指针是「白色主体 + 极细深色描边」，在白底页面上几乎看不见。
这里生成一支「深色主体 + 白色描边」的 I 形指针，浅色与深色页面上都清晰。

输出（桌面端资源目录，随打包进入应用）:
  text-cursor.png       12x24 CSS px  热点 (6, 12)
  text-cursor@2x.png    24x48 px      热点 (6, 12)
以及自检用预览（不参与打包）:
  tools/preview/text-cursor-preview.png（白底/深底各一份放大图）

用法: python tools/make-text-cursor.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "desktop/packages/desktop/src/renderer/src/assets/images"
PREVIEW_DIR = ROOT / "tools/preview"

# 画布按 2x 网格设计（24x48），1x 由整数缩放得到，保证边缘像素对齐。
W2, H2 = 24, 48
CORE = (26, 26, 26, 255)      # 深色主体
HALO = (255, 255, 255, 255)   # 白色描边

BAR = (10, 6, 13, 41)         # 竖笔 (x0, y0, x1, y1)，2x 网格
SERIF_TOP = (4, 6, 19, 9)
SERIF_BOTTOM = (4, 38, 19, 41)


def expanded(box, pad):
    return (box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad)


def draw_ibeam(scale2x=True):
    img = Image.new("RGBA", (W2, H2), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for box in (BAR, SERIF_TOP, SERIF_BOTTOM):
        draw.rectangle(expanded(box, 2), fill=HALO)
    for box in (BAR, SERIF_TOP, SERIF_BOTTOM):
        draw.rectangle(box, fill=CORE)
    if scale2x:
        return img
    return img.resize((W2 // 2, H2 // 2), Image.NEAREST)


def preview(icon, bg, path):
    pad = 6
    scale = 8
    w = (icon.width + pad * 2) * scale
    h = (icon.height + pad * 2) * scale
    canvas = Image.new("RGBA", (w, h), bg)
    big = icon.resize((icon.width * scale, icon.height * scale), Image.NEAREST)
    canvas.alpha_composite(big, (pad * scale, pad * scale))
    canvas.save(path)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    one = draw_ibeam(scale2x=False)
    two = draw_ibeam(scale2x=True)
    one.save(OUT_DIR / "text-cursor.png")
    two.save(OUT_DIR / "text-cursor@2x.png")

    preview(one, (255, 255, 255, 255), PREVIEW_DIR / "text-cursor-on-light.png")
    preview(one, (43, 43, 43, 255), PREVIEW_DIR / "text-cursor-on-dark.png")
    print(f"saved: {OUT_DIR/'text-cursor.png'} {one.size}")
    print(f"saved: {OUT_DIR/'text-cursor@2x.png'} {two.size}")
    print(f"preview: {PREVIEW_DIR/'text-cursor-on-light.png'}, {PREVIEW_DIR/'text-cursor-on-dark.png'}")


if __name__ == "__main__":
    main()
