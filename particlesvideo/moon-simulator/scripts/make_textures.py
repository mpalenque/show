"""Turn the NASA CGI Moon Kit maps into web textures: 4K colour + 4K normal map.

Colour: lroc_color_poles_4k.tif (LROC WAC 2019 mosaic, poles filled).
Relief: ldem_16_uint.tif (LOLA, 16 px/deg, unsigned 16-bit half-metres, +20000 DN
offset relative to a 1737.4 km sphere) -> tangent-space normal map.
"""
import sys

import numpy as np
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "."  # dir holding the NASA TIFFs
OUT = sys.argv[2] if len(sys.argv) > 2 else "public/textures"
W, H = 4096, 2048
MOON_RADIUS_M = 1737400.0

Image.MAX_IMAGE_PIXELS = None

# --- colour -----------------------------------------------------------------
color = Image.open(f"{SRC}/lroc_color_poles_4k.tif").convert("RGB")
print("colour source", color.size)
if color.size != (W, H):
    color = color.resize((W, H), Image.LANCZOS)
color.save(f"{OUT}/moon_color_4k.jpg", quality=92, optimize=True, progressive=True)

# --- elevation --------------------------------------------------------------
dem = Image.open(f"{SRC}/ldem_16_uint.tif")
print("dem source", dem.size, dem.mode)
height_m = (np.asarray(dem, dtype=np.float32) - 20000.0) * 0.5  # DN -> metres
print("elevation range m: %.0f .. %.0f" % (height_m.min(), height_m.max()))

# Resample the height field first, then differentiate: differentiating at source
# resolution and averaging afterwards aliases the slopes.
height_m = np.asarray(
    Image.fromarray(height_m, mode="F").resize((W, H), Image.BICUBIC), dtype=np.float32
)

lat = (0.5 - (np.arange(H, dtype=np.float32) + 0.5) / H) * np.pi  # +pi/2 .. -pi/2
# Metres per pixel: east-west shrinks with latitude, north-south is constant.
dx = (MOON_RADIUS_M * 2 * np.pi / W) * np.maximum(np.cos(lat), np.cos(np.radians(85.0)))
dy = MOON_RADIUS_M * np.pi / H

# East-west slope, wrapping at the seam.
slope_u = (np.roll(height_m, -1, axis=1) - np.roll(height_m, 1, axis=1)) / (2 * dx[:, None])
# North-south slope. Row index grows southward; V grows northward, hence the sign.
north = np.empty_like(height_m)
north[1:-1] = (height_m[:-2] - height_m[2:]) / (2 * dy)
north[0] = north[1]
north[-1] = north[-2]
slope_v = north

normal = np.stack([-slope_u, -slope_v, np.ones_like(slope_u)], axis=-1)
normal /= np.linalg.norm(normal, axis=-1, keepdims=True)

# Fade to flat over the last degrees of latitude, where the east-west spacing
# collapses and slopes would otherwise blow up.
polar = np.clip((np.abs(np.degrees(lat)) - 84.0) / 6.0, 0.0, 1.0)[:, None, None]
normal = normal * (1.0 - polar) + np.array([0.0, 0.0, 1.0], dtype=np.float32) * polar
normal /= np.linalg.norm(normal, axis=-1, keepdims=True)

encoded = np.clip(normal * 0.5 + 0.5, 0.0, 1.0)
Image.fromarray((encoded * 255.0 + 0.5).astype(np.uint8), mode="RGB").save(
    f"{OUT}/moon_normal_4k.png", optimize=True
)
print("done")
