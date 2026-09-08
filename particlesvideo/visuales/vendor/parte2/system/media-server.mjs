import { readFile, readdir, stat, realpath, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDDSHeader } from './dds-format.js';
import { resolveMediaPaths, PACKAGE_ROOT, WORKSPACE_ROOT } from './media-paths.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const compareNames = (a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
const normalizedName = value => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
const within = (parent, child) => child === parent || child.startsWith(parent + path.sep);
const stemOf = name => name.replace(/\.dds$/i, '').replace(/[\s_-]*\d+$/, '');
const ranges = values => {
  const output = [];
  for (const value of [...values].sort((a, b) => a - b)) {
    const last = output.at(-1);
    if (last && value === last[1] + 1) last[1] = value;
    else output.push([value, value]);
  }
  return output;
};

export function groupByStem(files) {
  const groups = new Map();
  for (const name of files) { const stem = stemOf(name); if (!groups.has(stem)) groups.set(stem, []); groups.get(stem).push(name); }
  return groups;
}

/** Which DDS files of one folder belong to a catalog clip. Rules, in order:
 * 1. `original-name-extraction` — the patch (`Process ordenar secuencia dds`)
 *    drops exactly four leading and four trailing characters of the file name
 *    without extension: `004 drone arriba incendio000` → `drone arriba incendi`,
 *    `002 bacteria naranja0000` → `bacteria naranja`. Prefixes are NOT
 *    consecutive (0103 is absent, "011 reactor" sorts between 0109 and 0110),
 *    so the saved name is reproduced instead of guessing by position. Exact for
 *    DDS2, I:\dds and …\resize.
 * 2. `name-suffix-and-count` — folders renamed later (I:\dds2: `NY 1 001.DDS`,
 *    `autopista circular dia 0001.DDS`) still END with the catalog name (`1`,
 *    `opista circular dia`); `NY 1` vs `mede 1` is disambiguated by the frame
 *    count, which must match exactly.
 * 3. `selected-directory` — a non-catalog folder chosen for one clip is that clip.
 * 4. `original-global-order` — a single 48,030-file folder in the patch's order.
 * Frame numbers come from the file suffix when they are unique and in range;
 * otherwise from the sorted position (1-based suffixes, 3-digit overflow).
 */
export function matchClipFiles(clip, files, { singleClip = false, catalogRoot = true, groups = null, placeholder = false } = {}) {
  const target = normalizedName(clip.name);
  let selected = files.filter(name => normalizedName(name.replace(/\.dds$/i, '').slice(4, -4)) === target);
  let mapping = 'original-name-extraction';
  // Rule 1 can hit the wrong renamed group ("mede 1 001" also yields "1"); an exact
  // frame-count match by name suffix wins over an inexact character extraction.
  if (selected.length !== clip.frameCount) {
    const candidates = [...(groups ?? groupByStem(files)).entries()]
      .filter(([stem, names]) => normalizedName(stem).endsWith(target) && names.length === clip.frameCount);
    if (candidates.length === 1) { selected = candidates[0][1]; mapping = 'name-suffix-and-count'; }
  }
  // Placeholder roots intentionally have one frame per sequence, so their
  // unique suffix is enough to associate the still with the original clip.
  if (placeholder && !selected.length) {
    const candidates = [...(groups ?? groupByStem(files)).entries()]
      .filter(([stem]) => normalizedName(stem).endsWith(target));
    if (candidates.length === 1) { selected = candidates[0][1]; mapping = 'placeholder-name-suffix'; }
  }
  if (!selected.length && singleClip && !catalogRoot) { selected = files; mapping = 'selected-directory'; }
  if (!selected.length && files.length === 48030) { selected = files.slice(clip.startGlobal, clip.endGlobal + 1); mapping = 'original-global-order'; }
  if (!selected.length) mapping = null;
  const frames = new Map();
  const suffixes = selected.map(name => Number(/(\d+)\.dds$/i.exec(name)?.[1]));
  const useSuffix = suffixes.every(Number.isInteger) && new Set(suffixes).size === suffixes.length && suffixes.every(n => n < clip.frameCount);
  selected.forEach((name, index) => { const frame = useSuffix ? suffixes[index] : index; if (frame < clip.frameCount) frames.set(frame, name); });
  return { frames, mapping };
}

/** DDS roots come from media-paths.mjs: env override → media/dds inside the
 * package → the original and backup-drive folders. Every existing catalog root
 * is scanned; each clip is served from the first root holding it complete,
 * otherwise from the root with most frames. `paths` may be injected by
 * server.mjs so both share one resolution. */
export function createMediaServer({ workspaceRoot = WORKSPACE_ROOT, packageRoot = PACKAGE_ROOT, env = process.env, paths = null, restrictedRemap = false } = {}) {
  let roots = [], catalogRoots = [], mediaPaths = paths, activeRootId = null;
  let base, manifest, revision = Date.now(), sourceMaps = new Map();
  const json = (res, code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };

  async function listDirectory(directory) {
    return (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile() && /\.dds$/i.test(entry.name)).map(entry => entry.name).sort(compareNames);
  }

  async function describeClip(clip, root, { frames: names, mapping }) {
    const frames = new Map([...names].map(([frame, name]) => [frame, path.join(root.path, name)]));
    sourceMaps.set(clip.id, { root, frames });
    let metadata = {}, headerError = null;
    if (frames.size) {
      let file;
      try {
        file = await open(frames.values().next().value, 'r');
        const bytes = Buffer.alloc(148);
        const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
        const header = parseDDSHeader(bytes.subarray(0, bytesRead));
        metadata = { width: header.width, height: header.height, format: header.format, bytesPerFrame: header.byteLength };
      } catch (error) { headerError = error.message; }
      finally { if (file) await file.close(); }
    }
    const firstAvailableFrame = frames.size ? Math.min(...frames.keys()) : null;
    return { ...clip, ...metadata, availableFrames: frames.size, complete: frames.size === clip.frameCount,
      // A versioned placeholder is a still frame, never a full source sequence.
      placeholder: Boolean(root.placeholder && frames.size), placeholderFrame: root.placeholder ? firstAvailableFrame : null,
      availableRanges: ranges(frames.keys()), firstAvailableFrame,
      rootId: frames.size ? root.id : null, mapping: frames.size ? mapping : null, headerError };
  }

  async function listings(candidates) {
    const result = [];
    for (const root of candidates) {
      if (!root.exists) continue;
      try {
        const files = await listDirectory(root.path);
        root.fileCount = files.length;
        if (files.length) result.push({ root, files, groups: groupByStem(files) });
      } catch { root.exists = false; }
    }
    return result;
  }

  async function resolveCatalog(candidates) {
    const scanned = await listings(candidates);
    const clips = [];
    for (const clip of base.clips) {
      let best = null;
      for (const listing of scanned) {
        const placeholder = listing.root.placeholderFrames?.get(clip.id);
        const match = placeholder && listing.files.includes(placeholder.filename)
          ? { frames: new Map([[placeholder.frame, placeholder.filename]]), mapping: 'placeholder-manifest' }
          : matchClipFiles(clip, listing.files, { groups: listing.groups, placeholder: listing.root.placeholder });
        if (match.frames.size && (!best || match.frames.size > best.match.frames.size)) best = { listing, match };
        if (match.frames.size === clip.frameCount) break;
      }
      clips.push(best ? await describeClip(clip, best.listing.root, best.match)
        : await describeClip(clip, scanned[0]?.root ?? candidates[0] ?? { id: null, path: '' }, { frames: new Map(), mapping: null }));
    }
    return clips;
  }

  function summarize(clips) {
    const expectedFrames = clips.reduce((sum, clip) => sum + clip.frameCount, 0);
    const availableFrames = clips.reduce((sum, clip) => sum + clip.availableFrames, 0);
    for (const root of roots) root.clips = clips.filter(clip => clip.rootId === root.id && clip.availableFrames).length;
    manifest = { ...base, revision, roots, activeRootId, clips,
      paths: mediaPaths ? { dds: mediaPaths.ddsRoot, ink: mediaPaths.inkRoot, overlay: mediaPaths.overlayPath,
        placeholderDDS: mediaPaths.placeholderDDSRoot ?? null, placeholderInk: mediaPaths.placeholderInkRoot ?? null, env: mediaPaths.env } : null,
      totals: { clips: clips.length, expectedFrames, availableFrames, missingFrames: expectedFrames - availableFrames,
        completeClips: clips.filter(clip => clip.complete).length, partialClips: clips.filter(clip => clip.availableFrames && !clip.complete).length },
      warnings: availableFrames < expectedFrames ? [`Faltan ${expectedFrames - availableFrames} de ${expectedFrames} frames referenciados por el patch. Las secuencias faltantes no se reemplazan por imágenes generadas; con media.fallback activo reproducen otra secuencia disponible.`] : [],
    };
    return manifest;
  }

  const ready = (async () => {
    base = JSON.parse(await readFile(path.join(here, 'catalog.json'), 'utf8'));
    mediaPaths ??= await resolveMediaPaths({ env, packageRoot, workspaceRoot });
    roots = [
      ...mediaPaths.ddsRoots.map(({ id, label, path: location, catalog, exists, hasDDS, placeholder }) => ({ id, label, path: location, catalog: !!catalog, exists, hasDDS, placeholder: !!placeholder })),
      { id: 'ink', label: 'Tinta original · 1.067 frames', path: path.join(mediaPaths.inkRoot ?? path.join(workspaceRoot, '2D', 'ink'), 'DDS') },
      { id: 'package-root', label: 'Carpeta del paquete', path: packageRoot },
      { id: 'workspace', label: 'Carpeta del proyecto', path: workspaceRoot },
    ];
    for (const root of roots) if (root.exists == null) { try { root.exists = (await stat(root.path)).isDirectory(); } catch { root.exists = false; } }
    for (const root of roots.filter(root => root.placeholder && root.exists)) {
      try {
        const placeholder = JSON.parse(await readFile(path.join(root.path, '..', 'placeholder-manifest.json'), 'utf8'));
        root.placeholderFrames = new Map((placeholder.dds || []).filter(frame => Number.isInteger(frame.frame) && typeof frame.filename === 'string')
          .map(frame => [frame.id, frame]));
      } catch {
        // A hand-made placeholder folder can still use the filename matcher.
      }
    }
    catalogRoots = roots.filter(root => root.catalog && root.exists && root.hasDDS !== false);
    activeRootId = catalogRoots[0]?.id ?? null;
    return summarize(await resolveCatalog(catalogRoots));
  })();

  async function readBody(req) {
    let text = '';
    for await (const chunk of req) { text += chunk; if (text.length > 4096) throw new Error('La solicitud de carpeta es demasiado larga.'); }
    return JSON.parse(text);
  }

  async function remap(req, res) {
    if (req.method !== 'POST') { json(res, 405, { error: 'Usá POST para seleccionar la carpeta.' }); return; }
    if (!String(req.headers['content-type']).startsWith('application/json')) { json(res, 415, { error: 'Se requiere application/json.' }); return; }
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) { json(res, 403, { error: 'La selección debe hacerse desde esta aplicación local.' }); return; }
    try {
      const body = await readBody(req);
      let selected = roots.find(root => root.id === body.rootId);
      if (restrictedRemap && selected && !selected.catalog) throw new Error('Elegí una raíz de medios configurada para el show.');
      if (body.directory) {
        const resolved = await realpath(path.resolve(body.directory));
        const allowed = await Promise.all(roots.filter(root => !restrictedRemap || root.catalog).map(async root => { try { return await realpath(root.path); } catch { return null; } }));
        if (!allowed.some(parent => parent && within(parent.toLowerCase(), resolved.toLowerCase()))) {
          json(res, 403, { error: 'La carpeta debe estar dentro del paquete, del proyecto o de una de las rutas originales registradas.' }); return;
        }
        selected = roots.find(root => root.path.toLowerCase() === resolved.toLowerCase())
          ?? { id: `mapped-${revision + 1}`, label: path.basename(resolved), path: resolved, exists: true, catalog: false };
      }
      if (!selected) throw new Error('Elegí una carpeta registrada mediante rootId o directory.');
      const files = await listDirectory(selected.path);
      if (!files.length) throw new Error('La carpeta elegida no contiene archivos DDS.');
      selected.exists = true; selected.fileCount = files.length;
      const selectedClip = body.clipId == null ? null : base.clips.find(clip => clip.id === body.clipId);
      if (body.clipId != null && !selectedClip) throw new Error('El clip seleccionado no existe.');
      if (!roots.some(root => root.id === selected.id)) roots.push(selected);
      let clips;
      if (selectedClip) {
        const match = matchClipFiles(selectedClip, files, { singleClip: true, catalogRoot: !!selected.catalog });
        if (!match.frames.size) throw new Error(`En esa carpeta no hay archivos de «${selectedClip.name}».`);
        const described = await describeClip(selectedClip, selected, match);
        clips = manifest.clips.map(clip => clip.id === selectedClip.id ? described : clip);
      } else {
        // Whole catalog: the chosen folder gets priority, the other known folders still fill the gaps.
        catalogRoots = [selected, ...catalogRoots.filter(root => root.id !== selected.id)];
        activeRootId = selected.id;
        clips = await resolveCatalog(catalogRoots);
      }
      revision++;
      json(res, 200, summarize(clips));
    } catch (error) { json(res, 400, { error: error.message }); }
  }

  async function handle(req, res, pathname) {
    if (pathname !== '/api/catalog' && pathname !== '/api/media/remap' && !pathname.startsWith('/media/')) return false;
    try {
      await ready;
      if (pathname === '/api/catalog') { json(res, 200, manifest); return true; }
      if (pathname === '/api/media/remap') { await remap(req, res); return true; }
      const match = /^\/media\/(clip-\d{2})\/(\d+)\.(dds|jpg|png)$/.exec(pathname);
      if (!match || !['GET', 'HEAD'].includes(req.method)) { json(res, 404, { error: 'Ruta de frame inválida.' }); return true; }
      const clip = manifest.clips.find(item => item.id === match[1]);
      const frame = Number(match[2]);
      const source = sourceMaps.get(match[1]);
      const sourceFrame = source?.frames.has(frame) ? frame : clip?.placeholder ? clip.placeholderFrame : null;
      if (!clip || frame >= clip.frameCount || sourceFrame == null || !source?.frames.has(sourceFrame)) {
        json(res, 404, { code: 'MISSING_FRAME', error: `No está disponible ${match[1]} / frame ${frame}.` }); return true;
      }
      let filename = source.frames.get(sourceFrame);
      if (match[3] !== 'dds') {
        const sibling = filename.replace(/\.dds$/i, '.' + match[3]);
        try { await stat(sibling); filename = sibling; }
        catch {
          const parentSibling = path.join(path.dirname(path.dirname(filename)), path.basename(sibling));
          if (!within(source.root.path, parentSibling) && source.root.id !== 'ink') throw new Error('No hay una imagen alternativa para este DDS.');
          filename = parentSibling;
        }
      }
      const info = await stat(filename);
      const data = req.method === 'HEAD' ? null : await readFile(filename);
      res.writeHead(200, { 'Content-Type': match[3] === 'dds' ? 'application/octet-stream' : `image/${match[3] === 'jpg' ? 'jpeg' : 'png'}`,
        'Content-Length': info.size, 'Cache-Control': restrictedRemap ? 'no-store' : 'private, max-age=3600', 'X-Media-Revision': revision,
        ...(clip.placeholder ? { 'X-Media-Placeholder': `frame-${sourceFrame}` } : {}) });
      res.end(data);
    } catch (error) { json(res, 404, { error: error.message }); }
    return true;
  }
  return { handle, ready, getCatalog: async () => { await ready; return manifest; } };
}
