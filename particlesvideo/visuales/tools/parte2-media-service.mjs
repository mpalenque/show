import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMediaServer } from '../vendor/parte2/system/media-server.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function createParte2MediaService({ env = process.env, configFile, prefix = '/parte2' } = {}) {
  let config;
  try { config = JSON.parse(await readFile(configFile || path.join(project, 'config/parte2-media.local.json'), 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT' || configFile) throw error;
    config = JSON.parse(await readFile(path.join(project, 'config/parte2-media.example.json'), 'utf8'));
  }
  const configuredRoots = env.PARTE2_DDS_ROOT ? env.PARTE2_DDS_ROOT.split(';').filter(Boolean) : config.ddsRoots;
  if (!Array.isArray(configuredRoots) || !configuredRoots.length) throw new Error('Parte 2 necesita ddsRoots.');
  const packageRoot = path.join(project, 'vendor/parte2');
  const placeholderDDSRoot = config.placeholderDDSRoot && path.resolve(project, config.placeholderDDSRoot);
  const placeholderInkRoot = config.placeholderInkRoot && path.resolve(project, config.placeholderInkRoot);
  const paths = {
    packageRoot,
    ddsRoots: [
      ...configuredRoots.map((dir, i) => ({ id: `show-${i + 1}`, label: dir, path: path.resolve(project, dir), catalog: true })),
      ...(placeholderDDSRoot ? [{ id: 'placeholder', label: 'Placeholders versionados (un frame por secuencia)',
        path: placeholderDDSRoot, catalog: true, placeholder: true }] : []),
    ],
    ddsRoot: path.resolve(project, configuredRoots[0]),
    inkRoot: path.resolve(project, env.PARTE2_INK_ROOT || config.inkRoot),
    placeholderDDSRoot,
    placeholderInkRoot,
    overlayPath: path.resolve(project, env.PARTE2_OVERLAY || 'vendor/parte2/media/overlay/part2-overlay.png'),
  };
  // Explicit paths prevent any scan/fallback to the old H:/I: locations.
  const media = createMediaServer({ packageRoot, workspaceRoot: packageRoot, paths, restrictedRemap: true });
  await media.ready;
  async function handle(req, res, next = () => {}) {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (!pathname.startsWith(prefix + '/')) return next();
    const local = pathname.slice(prefix.length);
    try {
      if (await media.handle(req, res, local)) return;
      let filename;
      const ink = /^\/ink\/(\d{6})\.(dds|jpg)$/i.exec(local);
      if (ink && Number(ink[1]) <= 1066) filename = path.join(paths.inkRoot,
        ink[2].toLowerCase() === 'dds' ? `DDS/INK${ink[1]}.DDS` : `INK${ink[1]}.jpg`);
      if (local === '/assets/part2-overlay.png') filename = paths.overlayPath;
      if (!filename || !['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(404); res.end('Recurso de Parte 2 inexistente'); return;
      }
      let info, placeholder = false;
      try { info = await stat(filename); }
      catch (error) {
        // A clone contains just INK000000 in the placeholder folder. It is
        // repeated for every request only to test FINAL and INK without media.
        if (!ink || !paths.placeholderInkRoot) throw error;
        filename = path.join(paths.placeholderInkRoot, ink[2].toLowerCase() === 'dds' ? 'DDS/INK000000.DDS' : 'INK000000.jpg');
        info = await stat(filename); placeholder = true;
      }
      res.writeHead(200, { 'Content-Type': filename.toLowerCase().endsWith('.jpg') ? 'image/jpeg'
        : filename.endsWith('.png') ? 'image/png' : 'application/octet-stream',
        'Content-Length': info.size, 'Cache-Control': ink ? 'no-store' : 'private, max-age=3600',
        ...(placeholder ? { 'X-Media-Placeholder': 'ink-frame-000000' } : {}) });
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(filename);
      stream.on('error', error => res.destroy(error));
      res.on('close', () => stream.destroy()); stream.pipe(res);
    } catch (error) {
      if (res.headersSent) { res.destroy(error); return; }
      res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message }));
    }
  }
  return { handle, paths, catalog: () => media.getCatalog() };
}

export function parte2MediaPlugin() {
  let service, prefix = '/parte2';
  const mount = async server => {
    service ??= await createParte2MediaService({ prefix });
    server.middlewares.use((req, res, next) => { void service.handle(req, res, next); });
  };
  return { name: 'parte2-media', configResolved(config) {
    prefix = `${config.base.startsWith('/') ? config.base.replace(/\/$/, '') : ''}/parte2`;
  }, configureServer: mount, configurePreviewServer: mount };
}
