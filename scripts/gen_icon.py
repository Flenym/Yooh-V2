"""Builds AppIcon.appiconset from repo-root new_logo.png (stdlib only).

iOS icons must have no alpha: RGBA sources are flattened onto white.
"""
import json
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "new_logo.png")
OUT = os.path.join(ROOT, "ios", "Yooh", "Yooh", "Assets.xcassets", "AppIcon.appiconset")
os.makedirs(OUT, exist_ok=True)


def read_png(path):
    data = open(path, "rb").read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    pos, w, h, bd, ct, idat = 8, 0, 0, 0, 0, b""
    while pos < len(data):
        (ln,) = struct.unpack(">I", data[pos:pos + 4])
        typ = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            w, h, bd, ct, comp, filt, il = struct.unpack(">IIBBBBB", chunk)
            assert bd == 8 and ct in (2, 6) and il == 0, f"need 8-bit RGB(A), got {bd}/{ct}/{il}"
        elif typ == b"IDAT":
            idat += chunk
        elif typ == b"IEND":
            break
        pos += 12 + ln
    raw = zlib.decompress(idat)
    ch = 4 if ct == 6 else 3
    stride = w * ch
    px = bytearray(w * h * 3)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        if f == 1:
            for i in range(ch, stride):
                line[i] = (line[i] + line[i - ch]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i - ch] if i >= ch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - ch] if i >= ch else 0
                b = prev[i]
                c = prev[i - ch] if i >= ch else 0
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        elif f != 0:
            raise ValueError(f"unknown filter {f}")
        for x in range(w):
            o, d = x * ch, (y * w + x) * 3
            if ch == 4:
                alpha = line[o + 3] / 255
                px[d] = int(line[o] * alpha + 255 * (1 - alpha))
                px[d + 1] = int(line[o + 1] * alpha + 255 * (1 - alpha))
                px[d + 2] = int(line[o + 2] * alpha + 255 * (1 - alpha))
            else:
                px[d:d + 3] = line[o:o + 3]
        prev = line
    return w, h, bytes(px)


def downscale(px, src, dst):
    out = bytearray(dst * dst * 3)
    s = src / dst
    for j in range(dst):
        y0 = int(j * s)
        y1 = max(y0 + 1, min(src, int((j + 1) * s + 0.5)))
        for i in range(dst):
            x0 = int(i * s)
            x1 = max(x0 + 1, min(src, int((i + 1) * s + 0.5)))
            rs = gs = bs = cnt = 0
            for yy in range(y0, y1):
                base = yy * src * 3
                for xx in range(x0, x1):
                    o = base + xx * 3
                    rs += px[o]
                    gs += px[o + 1]
                    bs += px[o + 2]
                    cnt += 1
            o = (j * dst + i) * 3
            out[o] = rs // cnt
            out[o + 1] = gs // cnt
            out[o + 2] = bs // cnt
    return bytes(out)


def write_png(path, n, px):
    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        return c + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + px[y * n * 3:(y + 1) * n * 3] for y in range(n))
    ihdr = struct.pack(">IIBBBBB", n, n, 8, 2, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


w, h, px = read_png(SRC)
print(f"source: {w}x{h}")
side = min(w, h)
if (w, h) != (side, side):
    # center-crop to square
    ox, oy = (w - side) // 2, (h - side) // 2
    cropped = bytearray(side * side * 3)
    for y in range(side):
        cropped[y * side * 3:(y + 1) * side * 3] = px[((oy + y) * w + ox) * 3:((oy + y) * w + ox + side) * 3]
    px = bytes(cropped)
base = px if side == 1024 else downscale(px, side, 1024)

slots = [
    ("iphone-60@3x", 180), ("iphone-60@2x", 120),
    ("iphone-40@3x", 120), ("iphone-40@2x", 80),
    ("iphone-29@3x", 87), ("iphone-29@2x", 58),
    ("ipad-76@2x", 152), ("ipad-76@1x", 76),
    ("ipad-40@2x", 80), ("ipad-40@1x", 40),
    ("ipad-29@2x", 58), ("ipad-29@1x", 29),
    ("ipad-83.5@2x", 167), ("ios-marketing", 1024),
]
cache = {}
images = []
for name, n in slots:
    if n not in cache:
        cache[n] = base if n == 1024 else downscale(base, 1024, n)
        write_png(os.path.join(OUT, f"icon-{n}.png"), n, cache[n])
        print("wrote", f"icon-{n}.png")
    if name == "ios-marketing":
        images.append({"filename": f"icon-{n}.png", "idiom": "ios-marketing",
                       "scale": "1x", "size": "1024x1024"})
    else:
        left, scale = name.split("@")
        dev, sz = left.rsplit("-", 1)
        images.append({"filename": f"icon-{n}.png", "idiom": dev,
                       "scale": scale, "size": f"{sz}x{sz}"})

with open(os.path.join(OUT, "Contents.json"), "w") as f:
    json.dump({"images": images, "info": {"author": "xcode", "version": 1}}, f, indent=2)
print("Contents.json OK")
