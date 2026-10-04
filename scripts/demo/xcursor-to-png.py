"""Writes the image closest to 24 px from an Xcursor file as a PNG.

Usage: python3 xcursor-to-png.py CURSOR_FILE OUT_PNG
Prints "HOTSPOT_X HOTSPOT_Y" so the caller can align the pointer tip.
"""

import struct
import sys
import zlib

IMAGE_CHUNK = 0xFFFD0002
TARGET_SIZE = 24

data = open(sys.argv[1], "rb").read()
(toc_count,) = struct.unpack_from("<I", data, 12)
best = None
for i in range(toc_count):
    chunk_type, nominal, pos = struct.unpack_from("<III", data, 16 + i * 12)
    if chunk_type == IMAGE_CHUNK and (
        best is None or abs(nominal - TARGET_SIZE) < abs(best[0] - TARGET_SIZE)
    ):
        best = (nominal, pos)
pos = best[1]
width, height, hot_x, hot_y = struct.unpack_from("<IIII", data, pos + 16)
pixels = data[pos + 36 : pos + 36 + width * height * 4]

rows = bytearray()
for y in range(height):
    rows.append(0)
    for x in range(width):
        b, g, r, a = pixels[(y * width + x) * 4 : (y * width + x) * 4 + 4]
        if a:  # Xcursor stores premultiplied ARGB; PNG wants straight alpha.
            r, g, b = (min(255, c * 255 // a) for c in (r, g, b))
        rows += bytes((r, g, b, a))


def png_chunk(tag, body):
    return (
        struct.pack(">I", len(body))
        + tag
        + body
        + struct.pack(">I", zlib.crc32(tag + body))
    )


with open(sys.argv[2], "wb") as out:
    out.write(b"\x89PNG\r\n\x1a\n")
    out.write(png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)))
    out.write(png_chunk(b"IDAT", zlib.compress(bytes(rows))))
    out.write(png_chunk(b"IEND", b""))
print(hot_x, hot_y)
