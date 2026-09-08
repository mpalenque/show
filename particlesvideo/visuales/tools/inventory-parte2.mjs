// Read-only audit of the external Parte 2 package. Writes only the requested JSON report.
// Usage: node tools/inventory-parte2.mjs <package-directory> <report.json>
import { readdir, stat, statfs, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !outputArg) throw new Error('Usage: node tools/inventory-parte2.mjs <package-directory> <report.json>');
const source = path.resolve(sourceArg), output = path.resolve(outputArg);
const load = relative => import(pathToFileURL(path.join(source, relative)).href);
const { resolveMediaPaths } = await load('system/media-paths.mjs');
const { createMediaServer, matchClipFiles, groupByStem } = await load('system/media-server.mjs');
const paths = await resolveMediaPaths({ packageRoot: source });
const manifest = await createMediaServer({ paths }).ready;
if (!manifest?.clips) throw new Error('The source media service did not return its catalog.');
const files = [];
async function walk(directory, relative = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules'].includes(entry.name)) continue;
    const name = path.join(relative, entry.name), absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute, name);
    else if (entry.isFile()) files.push({ path: name.replaceAll('\\', '/'), absolute });
  }
}
await walk(source);
let cursor = 0;
await Promise.all(Array.from({ length: 12 }, async () => {
  for (;;) {
    const file = files[cursor++]; if (!file) return;
    const info = await stat(file.absolute);
    file.bytes = info.size;
    file.modifiedAt = info.mtime.toISOString();
    if (!file.path.startsWith('media/') && !file.path.startsWith('captures/') && !file.path.endsWith('.log')) {
      file.sha256 = createHash('sha256').update(await readFile(file.absolute)).digest('hex');
    }
    delete file.absolute;
  }
}));
files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
const summarize = list => ({ files: list.length, bytes: list.reduce((n, f) => n + f.bytes, 0) });
const sourceCode = files.filter(f => f.sha256);
const selectedClips = [];
for (const root of manifest.roots.filter(root => root.clips > 0)) {
  const names = (await readdir(root.path, { withFileTypes: true })).filter(e => e.isFile() && /\.dds$/i.test(e.name))
    .map(e => e.name).sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0);
  const groups = groupByStem(names);
  for (const clip of manifest.clips.filter(clip => clip.rootId === root.id)) {
    const match = matchClipFiles(clip, names, { groups });
    let bytes = 0;
    // Metadata only: media payloads and their hashes are checked during the future copy.
    const selected = [...match.frames.values()];
    for (let i = 0; i < selected.length; i += 32) {
      const batch = await Promise.all(selected.slice(i, i + 32).map(name => stat(path.join(root.path, name))));
      bytes += batch.reduce((n, info) => n + info.size, 0);
    }
    selectedClips.push({ id: clip.id, index: clip.index, name: clip.name, rootId: root.id, root: root.path,
      mapping: match.mapping, files: selected.length, bytes, width: clip.width, height: clip.height,
      format: clip.format, first: selected[0], last: selected.at(-1) });
  }
}
selectedClips.sort((a, b) => a.index - b.index);
let disk;
try { const s = await statfs(path.dirname(output)); disk = { bytesAvailable: s.bavail * s.bsize, bytesTotal: s.blocks * s.bsize }; }
catch (error) { disk = { error: error.message }; }
const report = {
  auditedAt: new Date().toISOString(), source, method: 'Read-only directory counts, file sizes, catalog resolution and first DDS headers. SHA-256 for code/docs; media payloads were not hashed or copied.',
  package: { ...summarize(files), codeAndDocs: summarize(sourceCode), captures: summarize(files.filter(f => f.path.startsWith('captures/'))),
    dds: summarize(files.filter(f => f.path.startsWith('media/dds/'))), ink: summarize(files.filter(f => f.path.startsWith('media/ink/'))),
    codeTreeSha256: createHash('sha256').update(sourceCode.map(f => `${f.path}\0${f.sha256}\n`).join('')).digest('hex') },
  selectedMedia: { bytes: selectedClips.reduce((n, c) => n + c.bytes, 0), clips: selectedClips.length,
    frames: selectedClips.reduce((n, c) => n + c.files, 0), byRoot: manifest.roots.filter(r => r.clips > 0).map(root => ({ id: root.id, path: root.path,
      clips: root.clips, frames: selectedClips.filter(c => c.rootId === root.id).reduce((n, c) => n + c.files, 0),
      bytes: selectedClips.filter(c => c.rootId === root.id).reduce((n, c) => n + c.bytes, 0) })), selectedClips },
  destinationDisk: disk, catalog: manifest, files,
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, package: report.package, media: { ...report.selectedMedia, selectedClips: undefined },
  totals: manifest.totals, missing: manifest.clips.filter(c => !c.complete).map(c => ({ id: c.id, name: c.name, frames: c.frameCount - c.availableFrames })), disk }, null, 2));
