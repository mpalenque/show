/**
 * BC1 (DXT1) encoder, Node-side only. Used by tools/import-sequence.mjs to turn
 * new footage into DDS frames identical in format to the show's originals:
 * FourCC DXT1, mipMapCount 0, one image, no alpha. The browser then uploads
 * them compressed, exactly like the original media (see system/dds-format.js).
 *
 * Per 4x4 block: bounding box endpoints, 1/16 inset, then one least-squares
 * refit against the assigned indices; the lower-error candidate wins. Opaque
 * 4-colour mode only (color0 > color1), so no block ever decodes transparent.
 */
const WEIGHTS = [1, 0, 2 / 3, 1 / 3]; // index -> share of endpoint 0

const quant = (r, g, b) => ((Math.round(r * 31 / 255) << 11) | (Math.round(g * 63 / 255) << 5) | Math.round(b * 31 / 255)) & 0xffff;
const dequant = value => {
  const r = (value >>> 11) & 31, g = (value >>> 5) & 63, b = value & 31;
  return [(r << 3) | (r >>> 2), (g << 2) | (g >>> 4), (b << 3) | (b >>> 2)];
};

/** Palette and nearest-index assignment for one candidate endpoint pair. */
function evaluate(block, e0, e1) {
  let c0 = quant(e0[0], e0[1], e0[2]), c1 = quant(e1[0], e1[1], e1[2]);
  if (c0 < c1) { const swap = c0; c0 = c1; c1 = swap; }
  const a = dequant(c0), b = dequant(c1);
  const palette = [a, b,
    [Math.floor((2 * a[0] + b[0]) / 3), Math.floor((2 * a[1] + b[1]) / 3), Math.floor((2 * a[2] + b[2]) / 3)],
    [Math.floor((a[0] + 2 * b[0]) / 3), Math.floor((a[1] + 2 * b[1]) / 3), Math.floor((a[2] + 2 * b[2]) / 3)]];
  let indices = 0, error = 0;
  for (let p = 0; p < 16; p++) {
    const r = block[p * 3], g = block[p * 3 + 1], bl = block[p * 3 + 2];
    let best = 0, bestError = Infinity;
    for (let i = 0; i < 4; i++) {
      const dr = r - palette[i][0], dg = g - palette[i][1], db = bl - palette[i][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestError) { bestError = d; best = i; }
    }
    indices |= best << (2 * p);
    error += bestError;
  }
  return { c0, c1, indices, error };
}

/** One least-squares refit of both endpoints against the current indices. */
function refit(block, indices) {
  let aa = 0, ab = 0, bb = 0;
  const ap = [0, 0, 0], bp = [0, 0, 0];
  for (let p = 0; p < 16; p++) {
    const w = WEIGHTS[(indices >>> (2 * p)) & 3], v = 1 - w;
    aa += w * w; ab += w * v; bb += v * v;
    for (let c = 0; c < 3; c++) { ap[c] += w * block[p * 3 + c]; bp[c] += v * block[p * 3 + c]; }
  }
  const determinant = aa * bb - ab * ab;
  if (Math.abs(determinant) < 1e-6) return null;
  const clamp = value => Math.min(255, Math.max(0, value));
  const e0 = [], e1 = [];
  for (let c = 0; c < 3; c++) {
    e0.push(clamp((ap[c] * bb - bp[c] * ab) / determinant));
    e1.push(clamp((bp[c] * aa - ap[c] * ab) / determinant));
  }
  return [e0, e1];
}

/** Encode one 4x4 block given 16 RGB triples. Returns 8 bytes. */
export function encodeBlock(block, out, at) {
  let min = [255, 255, 255], max = [0, 0, 0];
  for (let p = 0; p < 16; p++) for (let c = 0; c < 3; c++) {
    const value = block[p * 3 + c];
    if (value < min[c]) min[c] = value;
    if (value > max[c]) max[c] = value;
  }
  const inset = [0, 1, 2].map(c => (max[c] - min[c]) >> 4);
  const high = [0, 1, 2].map(c => Math.max(min[c], max[c] - inset[c]));
  const low = [0, 1, 2].map(c => Math.min(max[c], min[c] + inset[c]));
  let best = evaluate(block, high, low);
  if (best.error > 0) {
    const refined = refit(block, best.indices);
    if (refined) {
      const candidate = evaluate(block, refined[0], refined[1]);
      if (candidate.error < best.error) best = candidate;
    }
  }
  out[at] = best.c0 & 0xff; out[at + 1] = best.c0 >>> 8;
  out[at + 2] = best.c1 & 0xff; out[at + 3] = best.c1 >>> 8;
  out[at + 4] = best.indices & 0xff; out[at + 5] = (best.indices >>> 8) & 0xff;
  out[at + 6] = (best.indices >>> 16) & 0xff; out[at + 7] = (best.indices >>> 24) & 0xff;
  return best.error;
}

/** RGBA pixels -> BC1 block payload. Edge blocks clamp to the last real pixel. */
export function encodeBC1(rgba, width, height) {
  const cols = Math.ceil(width / 4), rows = Math.ceil(height / 4);
  const out = new Uint8Array(cols * rows * 8);
  const block = new Uint8Array(48);
  for (let by = 0; by < rows; by++) for (let bx = 0; bx < cols; bx++) {
    for (let p = 0; p < 16; p++) {
      const x = Math.min(width - 1, bx * 4 + (p % 4)), y = Math.min(height - 1, by * 4 + ((p / 4) | 0));
      const source = (y * width + x) * 4;
      block[p * 3] = rgba[source]; block[p * 3 + 1] = rgba[source + 1]; block[p * 3 + 2] = rgba[source + 2];
    }
    encodeBlock(block, out, (by * cols + bx) * 8);
  }
  return out;
}

/** 128-byte DDS header matching the show's original frames. */
export function ddsHeader(width, height) {
  const header = new Uint8Array(128);
  const view = new DataView(header.buffer);
  const blocks = Math.ceil(width / 4) * Math.ceil(height / 4);
  view.setUint32(0, 0x20534444, true);                       // "DDS "
  view.setUint32(4, 124, true);                              // header size
  view.setUint32(8, 0x1 | 0x2 | 0x4 | 0x1000 | 0x80000, true); // CAPS|HEIGHT|WIDTH|PIXELFORMAT|LINEARSIZE
  view.setUint32(12, height, true);
  view.setUint32(16, width, true);
  view.setUint32(20, blocks * 8, true);                      // linear size
  view.setUint32(28, 0, true);                               // mipMapCount, 0 like the originals
  view.setUint32(76, 32, true);                              // pixel format size
  view.setUint32(80, 4, true);                               // DDPF_FOURCC
  header.set([0x44, 0x58, 0x54, 0x31], 84);                  // "DXT1"
  view.setUint32(108, 0x1000, true);                         // DDSCAPS_TEXTURE
  return header;
}

/** Complete .dds file bytes for one RGBA frame. */
export function encodeDDS(rgba, width, height) {
  if (rgba.length < width * height * 4) throw new Error(`Frame incompleto: ${rgba.length} bytes para ${width}x${height}.`);
  const header = ddsHeader(width, height), payload = encodeBC1(rgba, width, height);
  const file = new Uint8Array(header.length + payload.length);
  file.set(header); file.set(payload, header.length);
  return file;
}
