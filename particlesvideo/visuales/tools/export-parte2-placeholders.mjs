// Copies exactly one original frame per available Parte 2 sequence into the
// small, versionable placeholder set. It never writes to the media source.
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupByStem, matchClipFiles } from '../vendor/parte2/system/media-server.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(path.join(project, 'config/parte2-media.example.json'), 'utf8'));
const catalog = JSON.parse(await readFile(path.join(project, 'vendor/parte2/system/catalog.json'), 'utf8'));
const output = path.join(project, 'placeholder/parte2');
const ddsOutput = path.join(output, 'dds');
const inkOutput = path.join(output, 'ink');

async function filesIn(directory) {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && /\.dds$/i.test(entry.name)).map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

const roots = await Promise.all(config.ddsRoots.map(async (root, index) => {
  const directory = path.resolve(project, root);
  const files = await filesIn(directory);
  return { id: `show-${index + 1}`, directory, files, groups: groupByStem(files) };
}));
if (!roots.some(root => root.files.length)) throw new Error('No se encontraron DDS en las raíces configuradas.');

await Promise.all([mkdir(ddsOutput, { recursive: true }), mkdir(path.join(inkOutput, 'DDS'), { recursive: true })]);
const seenNames = new Set(), copied = [], unavailable = [];
for (const clip of catalog.clips) {
  let selected = null;
  for (const root of roots) {
    const match = matchClipFiles(clip, root.files, { groups: root.groups });
    if (match.frames.size && (!selected || match.frames.size > selected.match.frames.size)) selected = { root, match };
    if (match.frames.size === clip.frameCount) break;
  }
  if (!selected?.match.frames.size) { unavailable.push({ id: clip.id, index: clip.index, name: clip.name, reason: 'No hay frames en las raíces configuradas.' }); continue; }
  const [frame, filename] = [...selected.match.frames.entries()].sort(([a], [b]) => a - b)[0];
  if (seenNames.has(filename.toLowerCase())) throw new Error(`Dos placeholders usarían el mismo nombre: ${filename}`);
  seenNames.add(filename.toLowerCase());
  const source = path.join(selected.root.directory, filename), destination = path.join(ddsOutput, filename);
  try { await stat(destination); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await copyFile(source, destination);
  }
  copied.push({ id: clip.id, index: clip.index, name: clip.name, frame, filename, sourceRoot: selected.root.directory });
}

const inkSource = path.resolve(project, config.inkRoot);
const ink = [];
for (const item of [
  { relative: 'DDS/INK000000.DDS', destination: path.join(inkOutput, 'DDS/INK000000.DDS') },
  { relative: 'INK000000.jpg', destination: path.join(inkOutput, 'INK000000.jpg') },
]) {
  const source = path.join(inkSource, item.relative);
  try {
    await stat(item.destination);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await copyFile(source, item.destination);
  }
  ink.push({ source: item.relative, destination: path.relative(output, item.destination).replaceAll('\\', '/') });
}

const manifest = {
  generatedAt: new Date().toISOString(),
  purpose: 'Versioned test placeholders. Each DDS source clip is represented by one original frame and must not be used as show media.',
  catalog: { clips: catalog.clips.length, copied: copied.length, unavailable: unavailable.length },
  dds: copied,
  unavailable,
  ink,
};
await writeFile(path.join(output, 'placeholder-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(path.join(output, 'README.md'), `# Placeholders de Parte 2\n\nEste directorio contiene un frame original por secuencia disponible para probar el proyecto fuera de la PC del show. El servicio integrado los detecta automáticamente si no encuentra E:\\\\PARTE2-MEDIA. Cada DDS se repite como imagen fija; no sirve para validar movimiento, duración ni rendimiento.\n\nGenerado: ${manifest.generatedAt}\n\n- ${copied.length} de ${catalog.clips.length} secuencias DDS disponibles.\n- ${unavailable.length} secuencias siguen sin medio de origen.\n- INK incluye DDS y JPG del frame 000000.\n\nPara regenerarlo en la PC que tiene E:, ejecutar node tools/export-parte2-placeholders.mjs desde visuales.\n`);
console.log(JSON.stringify({ output, copied: copied.length, unavailable: unavailable.map(clip => clip.index), ink }, null, 2));
