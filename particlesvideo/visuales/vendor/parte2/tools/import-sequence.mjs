/**
 * Turn new footage into DDS frames for a catalog clip that has no media.
 *
 *   node tools/import-sequence.mjs --list
 *   node tools/import-sequence.mjs --clip 64 --input "D:\bosque.mp4"
 *   node tools/import-sequence.mjs --clip 63 --input "D:\incendio" --frames all --update-catalog
 *
 * Input may be a video file (any format ffmpeg reads) or a folder holding a
 * numbered image sequence. ffmpeg decodes to raw RGBA at the clip's frame rate
 * and target size; system/bc1-encoder.mjs writes DXT1 DDS frames byte-compatible
 * with the show's originals. Files land in the package's media/dds folder with
 * names the media server matches by the patch's own rule (drop four characters
 * from each end of the file name), so no remap or config change is needed.
 *
 * Nothing is deleted: existing frames are only overwritten when --force is given.
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeDDS } from '../system/bc1-encoder.mjs';
import { parseDDSHeader, decodeDDS } from '../system/dds-format.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(packageRoot, 'system', 'catalog.json');
const IMAGE = /\.(png|jpe?g|tiff?|tga|bmp|exr|dpx)$/i;

function parseArguments(argv) {
  const options = { size: '1920x1080', frames: 'catalog', fit: 'cover', out: null, fps: null };
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (!name.startsWith('--')) throw new Error(`Argumento inesperado: ${name}`);
    const key = name.slice(2);
    if (['list', 'dry-run', 'update-catalog', 'force'].includes(key)) { options[key] = true; continue; }
    const value = argv[++i];
    if (value == null) throw new Error(`Falta el valor de --${key}`);
    options[key] = value;
  }
  return options;
}

/** Accept a clip index, a clip id (clip-64) or part of its catalog name. */
function resolveClip(catalog, wanted) {
  if (wanted == null) throw new Error('Indica el clip con --clip (indice, clip-NN o parte del nombre).');
  const text = String(wanted).trim();
  const byIndex = /^\d+$/.test(text) ? catalog.clips.find(clip => clip.index === Number(text)) : null;
  const byId = catalog.clips.find(clip => clip.id === text);
  const matches = catalog.clips.filter(clip => clip.name.toLowerCase().includes(text.toLowerCase()));
  const clip = byIndex || byId || (matches.length === 1 ? matches[0] : null);
  if (!clip) throw new Error(matches.length > 1
    ? `"${text}" coincide con ${matches.length} clips: ${matches.map(item => `${item.index} ${item.name}`).join(', ')}`
    : `No encontre el clip "${text}".`);
  return clip;
}

/** filename = 4-char prefix + catalog name + 4-digit frame, so that dropping
 * four characters from each end yields exactly the catalog name. */
export const frameName = (clip, frame) =>
  `${String(clip.index + 1).padStart(3, '0')} ${clip.name}${String(frame).padStart(4, '0')}.dds`;

async function ffmpegArguments(input, { width, height, fps, fit }) {
  const information = await stat(input).catch(() => null);
  if (!information) throw new Error(`No existe la entrada: ${input}`);
  const scale = fit === 'stretch' ? `scale=${width}:${height}:flags=lanczos`
    : fit === 'contain' ? `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:-1:-1:color=black`
      : `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}`;
  const filters = `fps=${fps},${scale},format=rgba`;
  const tail = ['-vf', filters, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'];
  if (!information.isDirectory()) return ['-nostdin', '-v', 'error', '-i', input, ...tail];
  const files = (await readdir(input)).filter(name => IMAGE.test(name)).sort((a, b) => a.localeCompare(b, 'en'));
  if (!files.length) throw new Error(`La carpeta no tiene imagenes: ${input}`);
  const digits = /(\d+)(\.[^.]+)$/.exec(files[0]);
  if (!digits) throw new Error('Las imagenes de la carpeta no tienen numeracion al final del nombre.');
  const pattern = files[0].replace(/\d+(\.[^.]+)$/, `%0${digits[1].length}d$1`);
  return ['-nostdin', '-v', 'error', '-framerate', String(fps), '-start_number', String(Number(digits[1])),
    '-i', path.join(input, pattern), ...tail];
}

function psnr(a, b) {
  let sum = 0, count = 0;
  for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) { const d = a[i + c] - b[i + c]; sum += d * d; count++; }
  const mse = sum / count;
  return mse === 0 ? Infinity : 10 * Math.log10(255 * 255 / mse);
}

async function listPending() {
  const { createMediaServer } = await import('../system/media-server.mjs');
  const manifest = await createMediaServer().getCatalog();
  const pending = manifest.clips.filter(clip => clip.availableFrames < clip.frameCount);
  console.log(`Catalogo: ${manifest.totals.completeClips}/${manifest.totals.clips} clips completos, ${manifest.totals.availableFrames}/${manifest.totals.expectedFrames} frames.`);
  if (!pending.length) { console.log('No falta ninguna secuencia.'); return; }
  for (const clip of pending) {
    const first = Math.ceil(clip.index * 127 / 68), last = Math.ceil((clip.index + 1) * 127 / 68) - 1;
    console.log(`  clip ${String(clip.index).padStart(2)} | ${clip.name.padEnd(16)} | ${String(clip.availableFrames).padStart(5)}/${String(clip.frameCount).padEnd(5)} frames` +
      ` | ${((clip.frameCount - 1) / (clip.fps || 30)).toFixed(2)}s | velocity ${first}-${last} | archivos "${frameName(clip, 0)}"`);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  if (options.list) return listPending();

  const clip = resolveClip(catalog, options.clip);
  const [width, height] = String(options.size).split('x').map(Number);
  if (!(width > 0 && height > 0) || width % 4 || height % 4) throw new Error('--size debe ser ANCHOxALTO con multiplos de 4, por ejemplo 1920x1080.');
  const fps = Number(options.fps || clip.fps || 30);
  const limit = options.frames === 'all' ? Infinity : options.frames === 'catalog' ? clip.frameCount : Number(options.frames);
  if (!(limit > 0)) throw new Error('--frames acepta catalog, all o un numero.');
  const out = path.resolve(options.out || path.join(packageRoot, 'media', 'dds'));
  const args = await ffmpegArguments(path.resolve(options.input ?? ''), { width, height, fps, fit: options.fit });

  console.log(`Clip ${clip.index} - ${clip.name} - el catalogo espera ${clip.frameCount} frames a ${fps} fps`);
  console.log(`Entrada: ${options.input}`);
  console.log(`Salida:  ${path.join(out, frameName(clip, 0))} ...`);
  if (options['dry-run']) { console.log('ffmpeg ' + args.join(' ')); return; }
  if (!options.force && existsSync(path.join(out, frameName(clip, 0)))) {
    throw new Error(`Ya hay frames de este clip en ${out}. Usa --force para reemplazarlos.`);
  }
  await mkdir(out, { recursive: true });

  const ffmpeg = spawn(process.env.MILKY_FFMPEG || 'ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const frameBytes = width * height * 4;
  let pending = Buffer.alloc(0), frame = 0, errors = '', checked = false;
  let writes = [];
  ffmpeg.stderr.on('data', chunk => { errors += chunk; });
  for await (const chunk of ffmpeg.stdout) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= frameBytes && frame < limit) {
      const rgba = pending.subarray(0, frameBytes);
      const dds = encodeDDS(rgba, width, height);
      if (!checked) { // verify the very first frame with the app's own parser
        checked = true;
        const header = parseDDSHeader(dds);
        if (header.format !== 'bc1-rgba-unorm' || header.width !== width || header.height !== height) {
          throw new Error(`El DDS generado no es BC1 ${width}x${height}: ${header.format}`);
        }
        if (dds.length !== header.totalBytes) throw new Error('El tamano del DDS no coincide con su cabecera.');
        console.log(`Verificacion del primer frame: ${header.format}, ${header.width}x${header.height}, ${dds.length} bytes, PSNR ${psnr(rgba, decodeDDS(dds, header)).toFixed(2)} dB`);
      }
      writes.push(writeFile(path.join(out, frameName(clip, frame)), dds));
      if (writes.length >= 32) { await Promise.all(writes); writes = []; }
      pending = pending.subarray(frameBytes);
      frame++;
      if (frame % 60 === 0) process.stdout.write(`\r  ${frame} frames...`);
    }
    if (frame >= limit) break;
  }
  ffmpeg.stdout.destroy();
  await Promise.all(writes);
  const code = await new Promise(resolve => ffmpeg.on('close', resolve));
  process.stdout.write('\r');
  if (!frame) throw new Error(`ffmpeg no entrego frames. ${errors.trim() || `Codigo ${code}.`}`);
  console.log(`Escritos ${frame} frames en ${out}`);
  if (errors.trim()) console.log(`Aviso de ffmpeg: ${errors.trim().split('\n').slice(0, 3).join(' | ')}`);

  if (frame !== clip.frameCount) {
    const message = `El clip esperaba ${clip.frameCount} frames y se escribieron ${frame}.`;
    if (options['update-catalog']) {
      const document = JSON.parse(await readFile(catalogPath, 'utf8'));
      document.clips[clip.index].frameCount = frame;
      document.clips[clip.index].importedFrames = { at: new Date().toISOString().slice(0, 10), originalFrameCount: clip.frameCount, source: path.basename(String(options.input)) };
      await writeFile(catalogPath, JSON.stringify(document, null, 2) + '\n');
      console.log(`${message} catalog.json actualizado: frameCount ${clip.frameCount} -> ${frame}; el ciclo del clip pasa a ${((frame - 1) / fps).toFixed(2)} s.`);
    } else {
      console.log(`${message} Reintenta con --frames all --update-catalog para conservar esa duracion, o genera exactamente ${clip.frameCount} frames.`);
    }
  } else {
    console.log(`Coincide con el catalogo: ${frame} frames, ciclo de ${((frame - 1) / fps).toFixed(2)} s.`);
  }
  console.log('Reinicia el servidor (node server.mjs) para que vuelva a escanear las carpetas.');
}

// Only run as a CLI. Importing this module (the tests read frameName) must not
// execute anything or touch process.exitCode.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`\n${error.message}`); process.exitCode = 1; });
}
