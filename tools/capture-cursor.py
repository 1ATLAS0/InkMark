"""Screen grab with the mouse cursor composited at its real position (Windows).

Usage: python tools/capture-cursor.py <x> <y> <out.png>
"""
import ctypes
import sys
import time
from ctypes import wintypes

from PIL import Image, ImageGrab

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
user32.GetCursorInfo.argtypes = [ctypes.c_void_p]
user32.GetIconInfo.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
gdi32.GetObjectW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p]
gdi32.GetDIBits.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint, ctypes.c_uint,
                            ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint]
user32.GetDC.argtypes = [ctypes.c_void_p]
user32.GetDC.restype = ctypes.c_void_p
user32.ReleaseDC.argtypes = [ctypes.c_void_p, ctypes.c_void_p]


class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


class CURSORINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("flags", wintypes.DWORD),
                ("hCursor", ctypes.c_void_p), ("ptScreenPos", POINT)]


class ICONINFO(ctypes.Structure):
    _fields_ = [("fIcon", wintypes.BOOL), ("xHotspot", wintypes.DWORD),
                ("yHotspot", wintypes.DWORD), ("hbmMask", ctypes.c_void_p),
                ("hbmColor", ctypes.c_void_p)]


class BITMAP(ctypes.Structure):
    _fields_ = [("bmType", ctypes.c_long), ("bmWidth", ctypes.c_long),
                ("bmHeight", ctypes.c_long), ("bmWidthBytes", ctypes.c_long),
                ("bmPlanes", wintypes.WORD), ("bmBitsPixel", wintypes.WORD),
                ("bmBits", ctypes.c_void_p)]


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [("biSize", wintypes.DWORD), ("biWidth", ctypes.c_long),
                ("biHeight", ctypes.c_long), ("biPlanes", wintypes.WORD),
                ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
                ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", ctypes.c_long),
                ("biYPelsPerMeter", ctypes.c_long), ("biClrUsed", wintypes.DWORD),
                ("biClrImportant", wintypes.DWORD)]


def move_cursor(x, y):
    for _ in range(3):
        user32.SetCursorPos(int(x), int(y))
        time.sleep(0.25)
        pt = POINT()
        user32.GetCursorPos(ctypes.byref(pt))
        if abs(pt.x - x) <= 2 and abs(pt.y - y) <= 2:
            return True
    return False


def cursor_image():
    ci = CURSORINFO()
    ci.cbSize = ctypes.sizeof(ci)
    assert user32.GetCursorInfo(ctypes.byref(ci)), "GetCursorInfo failed"
    ii = ICONINFO()
    assert user32.GetIconInfo(ci.hCursor, ctypes.byref(ii)), "GetIconInfo failed"
    bm = BITMAP()
    gdi32.GetObjectW(ii.hbmColor, ctypes.sizeof(bm), ctypes.byref(bm))
    w, h = bm.bmWidth, bm.bmHeight
    header = BITMAPINFOHEADER()
    header.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    header.biWidth = w
    header.biHeight = -h
    header.biPlanes = 1
    header.biBitCount = 32
    buf = ctypes.create_string_buffer(w * h * 4)
    hdc = user32.GetDC(0)
    gdi32.GetDIBits(hdc, ii.hbmColor, 0, h, buf, ctypes.byref(header), 0)
    user32.ReleaseDC(0, hdc)
    data = buf.raw
    img = Image.frombuffer("RGBA", (w, h), data, "raw", "BGRA", 0, 1)
    if img.getchannel("A").getextrema() == (0, 0):
        # Some cursors ship without an alpha channel; use the AND mask instead.
        mh = BITMAPINFOHEADER()
        mh.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        mh.biWidth = w
        mh.biHeight = -h
        mh.biPlanes = 1
        mh.biBitCount = 32
        mbuf = ctypes.create_string_buffer(w * h * 4)
        hdc2 = user32.GetDC(0)
        gdi32.GetDIBits(hdc2, ii.hbmMask, 0, h, mbuf, ctypes.byref(mh), 0)
        user32.ReleaseDC(0, hdc2)
        mdata = mbuf.raw
        alpha = Image.frombytes("L", (w, h), bytes(
            255 if mdata[i] == 0 else 0 for i in range(3, w * h * 4, 4)))
        img.putalpha(alpha)
    return img, (ci.ptScreenPos.x, ci.ptScreenPos.y), (ii.xHotspot, ii.yHotspot)


def main():
    x, y, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
    moved = move_cursor(x, y)
    icon, pos, hotspot = cursor_image()
    shot = ImageGrab.grab()
    sw = user32.GetSystemMetrics(0)
    scale = shot.width / sw if sw else 1
    px = int((pos[0] - hotspot[0]) * scale)
    py = int((pos[1] - hotspot[1]) * scale)
    if scale != 1:
        icon = icon.resize((int(icon.width * scale), int(icon.height * scale)), Image.NEAREST)
    shot.paste(icon, (px, py), icon)
    shot.save(out)
    icon.resize((icon.width * 6, icon.height * 6), Image.NEAREST).save(out.replace(".png", ".icon.png"))
    colors = {}
    for p in icon.getdata():
        if p[3] > 128:
            colors[p[:3]] = colors.get(p[:3], 0) + 1
    top = sorted(colors.items(), key=lambda kv: -kv[1])[:6]
    print(f"moved={moved} cursor={pos} hotspot={hotspot} icon={icon.size} saved={out}")
    print("top pixel colors:", ", ".join(f"rgb{c}x{n}" for c, n in top))


if __name__ == "__main__":
    main()
