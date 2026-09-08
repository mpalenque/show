import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createMediaServer } from './system/media-server.mjs';
import { createOscBridge } from './system/osc-server.mjs';
import { resolveMediaPaths, describeMediaPaths } from './system/media-paths.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
// env → media/ inside this package → historical machine paths (see media/README.md).
const paths = await resolveMediaPaths({ packageRoot: root });
const inkRoot = paths.inkRoot;
const overlayPath = paths.overlayPath;
const port = Number(process.env.MILKY_PORT || 8787);
const media = createMediaServer({ paths });
const osc = createOscBridge();
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.md': 'text/plain; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (await osc.handle(req, res, pathname)) return;
    if (await media.handle(req, res, pathname)) return;
    if (pathname === '/assets/part2-overlay.png') {
      if (!overlayPath) { res.writeHead(404).end('Overlay de calibración no encontrado (PARTE2_OVERLAY o media/overlay/part2-overlay.png)'); return; }
      const data = await readFile(overlayPath);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' }); res.end(data); return;
    }
    if (pathname.startsWith('/ink/')) {
      const asset = /^\/ink\/(\d{6})\.(dds|jpg)$/.exec(pathname);
      if (!asset || Number(asset[1]) > 1066) { res.writeHead(404).end('Frame de tinta fuera de rango'); return; }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
      if (!inkRoot) { res.writeHead(404).end('Tinta INK no encontrada (PARTE2_INK_ROOT o media/ink)'); return; }
      const compressed = asset[2] === 'dds';
      const assetPath = path.join(inkRoot, ...(compressed ? ['DDS'] : []), `INK${asset[1]}.${compressed ? 'DDS' : 'jpg'}`);
      const assetStat = await stat(assetPath);
      if (!assetStat.isFile()) { res.writeHead(404).end('Frame de tinta no encontrado'); return; }
      const assetData = req.method === 'HEAD' ? null : await readFile(assetPath);
      res.writeHead(200, {
        'Content-Type': compressed ? 'application/octet-stream' : 'image/jpeg',
        'Content-Length': assetStat.size,
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
      res.end(assetData);
      return;
    }
    const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!filename.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    if (pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (!(await stat(filename)).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(filename));
  } catch { res.writeHead(404).end('No encontrado'); }
});
server.listen(port, '127.0.0.1', () => console.log(`PARTE 2 WebGPU: http://127.0.0.1:${port}
${describeMediaPaths(paths)}`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.on('close', () => osc.close());
