// DDS header parsing and a CPU fallback for BC1/2/3. BC7 stays compressed on
// the GPU; if BC compression is unavailable, use an original image sibling.
const FOURCC = { DXT1: 'bc1', DXT3: 'bc2', DXT5: 'bc3' };
const DXGI = new Map([
  [71, ['bc1', false]], [72, ['bc1', true]], [74, ['bc2', false]], [75, ['bc2', true]],
  [77, ['bc3', false]], [78, ['bc3', true]], [98, ['bc7', false]], [99, ['bc7', true]],
  [28, ['rgba', false]], [29, ['rgba', true]], [87, ['bgra', false]], [91, ['bgra', true]],
  [88, ['bgrx', false]], [93, ['bgrx', true]],
]);

export function parseDDSHeader(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 128) throw new Error('Cabecera DDS incompleta.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = offset => view.getUint32(offset, true);
  if (u32(0) !== 0x20534444 || u32(4) !== 124 || u32(76) !== 32) throw new Error('Cabecera DDS inválida.');
  const width = u32(16), height = u32(12);
  if (!width || !height || width > 32768 || height > 32768) throw new Error('Dimensiones DDS inválidas.');
  const flags = u32(80), fourCC = String.fromCharCode(...bytes.subarray(84, 88));
  let kind, srgb = false, offset = 128, bits = u32(88);
  let masks = [u32(92), u32(96), u32(100), u32(104)];
  if (flags & 4) {
    if (fourCC === 'DX10') {
      if (bytes.byteLength < 148) throw new Error('Cabecera DDS DX10 incompleta.');
      if (u32(132) !== 3 || u32(140) !== 1 || (u32(136) & 4)) throw new Error('Se requiere un DDS 2D de una sola imagen.');
      const format = DXGI.get(u32(128));
      if (!format) throw new Error(`Formato DDS DXGI ${u32(128)} no soportado.`);
      [kind, srgb] = format;
      offset = 148;
      if (!kind.startsWith('bc')) {
        bits = 32;
        masks = kind === 'rgba' ? [0xff, 0xff00, 0xff0000, 0xff000000] :
          [0xff0000, 0xff00, 0xff, kind === 'bgrx' ? 0 : 0xff000000];
      }
    } else {
      kind = FOURCC[fourCC];
      if (!kind) throw new Error(`Formato DDS ${fourCC} no soportado.`);
    }
  } else if (flags & 0x40) {
    kind = 'rgba';
    if (![16, 24, 32].includes(bits)) throw new Error(`DDS RGB de ${bits} bits no soportado.`);
  } else throw new Error('El DDS no contiene RGB ni compresión BC compatible.');
  const compressed = kind.startsWith('bc');
  const blockBytes = kind === 'bc1' ? 8 : 16;
  const bytesPerRow = compressed ? Math.ceil(width / 4) * blockBytes :
    ((u32(8) & 8) && u32(20) >= width * bits / 8 ? u32(20) : width * bits / 8);
  const rows = compressed ? Math.ceil(height / 4) : height;
  const byteLength = bytesPerRow * rows;
  return { width, height, kind, srgb, compressed, offset, bits, masks, bytesPerRow, rows, byteLength,
    format: compressed ? `${kind}-rgba-unorm${srgb ? '-srgb' : ''}` : `rgba8unorm${srgb ? '-srgb' : ''}`,
    mipCount: Math.max(1, u32(28)), totalBytes: offset + byteLength };
}

function rgb565(value) {
  const r = (value >>> 11) & 31, g = (value >>> 5) & 63, b = value & 31;
  return [(r << 3) | (r >>> 2), (g << 2) | (g >>> 4), (b << 3) | (b >>> 2), 255];
}

function colorPalette(view, offset, forceOpaque) {
  const c0 = view.getUint16(offset, true), c1 = view.getUint16(offset + 2, true);
  const a = rgb565(c0), b = rgb565(c1);
  if (c0 > c1 || forceOpaque) return [a, b,
    a.map((x, i) => i === 3 ? 255 : Math.floor((2 * x + b[i]) / 3)),
    a.map((x, i) => i === 3 ? 255 : Math.floor((x + 2 * b[i]) / 3))];
  return [a, b, a.map((x, i) => i === 3 ? 255 : Math.floor((x + b[i]) / 2)), [0, 0, 0, 0]];
}

export function decodeDDS(input, header = parseDDSHeader(input)) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < header.totalBytes) throw new Error('El DDS tiene un frame incompleto.');
  if (header.kind === 'bc7') throw new Error('BC7 requiere texture-compression-bc o una imagen original alternativa.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = new Uint8Array(header.width * header.height * 4);
  if (!header.compressed) {
    const channel = (value, mask, fallback) => {
      if (!mask) return fallback;
      const low = (mask & -mask) >>> 0;
      return Math.round(((value & mask) >>> 0) / low / (mask / low) * 255);
    };
    for (let y = 0; y < header.height; y++) for (let x = 0; x < header.width; x++) {
      const at = header.offset + y * header.bytesPerRow + x * header.bits / 8;
      const value = header.bits === 32 ? view.getUint32(at, true) : header.bits === 16 ? view.getUint16(at, true) :
        bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
      const out = (y * header.width + x) * 4;
      for (let c = 0; c < 4; c++) result[out + c] = channel(value, header.masks[c], c === 3 ? 255 : 0);
    }
    return result;
  }
  const blockBytes = header.kind === 'bc1' ? 8 : 16;
  for (let by = 0; by < header.rows; by++) for (let bx = 0; bx < Math.ceil(header.width / 4); bx++) {
    const at = header.offset + by * header.bytesPerRow + bx * blockBytes;
    const colorOffset = at + (header.kind === 'bc1' ? 0 : 8);
    const palette = colorPalette(view, colorOffset, header.kind !== 'bc1');
    const indices = view.getUint32(colorOffset + 4, true);
    let alphaPalette, alphaBits;
    if (header.kind === 'bc3') {
      const a = bytes[at], b = bytes[at + 1];
      alphaPalette = [a, b];
      const count = a > b ? 7 : 5;
      for (let i = 1; i < count; i++) alphaPalette.push(Math.floor(((count - i) * a + i * b) / count));
      if (a <= b) alphaPalette.push(0, 255);
      alphaBits = 0n;
      for (let i = 0; i < 6; i++) alphaBits |= BigInt(bytes[at + 2 + i]) << BigInt(8 * i);
    }
    for (let p = 0; p < 16; p++) {
      const x = bx * 4 + p % 4, y = by * 4 + Math.floor(p / 4);
      if (x >= header.width || y >= header.height) continue;
      const out = (y * header.width + x) * 4;
      result.set(palette[(indices >>> (2 * p)) & 3], out);
      if (header.kind === 'bc2') result[out + 3] = ((bytes[at + Math.floor(p / 2)] >>> ((p % 2) * 4)) & 15) * 17;
      if (header.kind === 'bc3') result[out + 3] = alphaPalette[Number((alphaBits >> BigInt(3 * p)) & 7n)];
    }
  }
  return result;
}
