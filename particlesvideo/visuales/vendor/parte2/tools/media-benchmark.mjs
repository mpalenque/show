/**
 * Measure whether the disk holding the DDS sequences can feed the show.
 *
 *   node tools/media-benchmark.mjs                     # the folders the server would use
 *   node tools/media-benchmark.mjs --frames 400        # longer run
 *   node tools/media-benchmark.mjs --dir "I:\dds"      # one specific folder
 *
 * Reads consecutive frames the way the seven decks do and reports MB/s and how
 * many 1080p BC1 frames per second that is. The show needs seven decks at 30 fps
 * plus the ink: about 210 frames/s, roughly 210 MB/s of BC1 1920x1080.
 * A single deck needs 30 frames/s, about 30 MB/s.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMediaPaths } from '../system/media-paths.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DECKS = 7, FPS = 30;

function parseArguments(argv) {
  const options = { frames: '200' };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`Argumento inesperado: ${argv[i]}`);
    options[argv[i].slice(2)] = argv[++i] ?? true;
  }
  return options;
}

async function measure(directory, wanted) {
  const names = (await readdir(directory)).filter(name => /\.dds$/i.test(name)).sort();
  if (!names.length) return { directory, error: 'sin archivos DDS' };
  const sample = names.slice(0, Math.min(wanted, names.length));
  // Warm-up read so the first-file open cost does not dominate the average.
  await readFile(path.join(directory, sample[0]));
  const started = performance.now();
  let bytes = 0;
  for (const name of sample) bytes += (await readFile(path.join(directory, name))).byteLength;
  const seconds = (performance.now() - started) / 1000;
  const perFrame = bytes / sample.length;
  return { directory, files: names.length, read: sample.length, seconds,
    mbPerSecond: bytes / seconds / 1e6, framesPerSecond: sample.length / seconds,
    frameKiB: perFrame / 1024, decksAt30: sample.length / seconds / FPS };
}

const options = parseArguments(process.argv.slice(2));
const wanted = Number(options.frames);
if (!(wanted > 0)) throw new Error('--frames debe ser un numero.');

const directories = [];
if (options.dir) directories.push({ id: 'manual', path: path.resolve(options.dir) });
else {
  const paths = await resolveMediaPaths({ packageRoot });
  for (const root of paths.ddsRoots) if (root.hasDDS) directories.push({ id: root.id, path: root.path, label: root.label });
  if (paths.inkRoot) directories.push({ id: 'ink', path: path.join(paths.inkRoot, 'DDS') });
}
if (!directories.length) throw new Error('No encontre carpetas con DDS.');

console.log(`Leyendo ${wanted} frames consecutivos por carpeta. El show necesita ~${DECKS * FPS} frames/s en total (${DECKS} decks a ${FPS} fps).\n`);
console.log('carpeta                                              MB/s   frames/s   decks a 30fps   KiB/frame');
for (const entry of directories) {
  try {
    if (!(await stat(entry.path)).isDirectory()) continue;
    const result = await measure(entry.path, wanted);
    if (result.error) { console.log(`${entry.path.padEnd(50)} ${result.error}`); continue; }
    const verdict = result.decksAt30 >= DECKS ? 'alcanza para los 7 decks'
      : result.decksAt30 >= 1 ? `alcanza para ${Math.floor(result.decksAt30)} deck(s)` : 'no alcanza ni para un deck';
    console.log(`${entry.path.padEnd(50)} ${result.mbPerSecond.toFixed(0).padStart(5)}   ${result.framesPerSecond.toFixed(0).padStart(8)}   ${result.decksAt30.toFixed(1).padStart(13)}   ${result.frameKiB.toFixed(0).padStart(9)}   ${verdict}`);
  } catch (error) { console.log(`${entry.path.padEnd(50)} ${error.message}`); }
}
