import { stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the server looks for the show media, in priority order.
 *
 * Everything the browser needs is served by server.mjs from these locations:
 *   DDS clips  → GET /media/<clip>/<frame>.dds     (68-clip catalog, 48,030 frames)
 *   INK frames → GET /ink/<nnnnnn>.dds|.jpg         (1,067 frames, BC7 + JPG)
 *   overlay    → GET /assets/part2-overlay.png      (3840×2160 calibration guide)
 *
 * Priority: explicit environment variable → copy inside this package (media/)
 * → historical machine-specific locations. Copy the package folder together
 * with media/ and nothing else has to be configured; on another machine set
 * PARTE2_DDS_ROOT / PARTE2_INK_ROOT / PARTE2_OVERLAY to point elsewhere.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = path.resolve(here, '..');
export const WORKSPACE_ROOT = path.resolve(PACKAGE_ROOT, '..');

export const MEDIA_ENV = { dds: 'PARTE2_DDS_ROOT', ink: 'PARTE2_INK_ROOT', overlay: 'PARTE2_OVERLAY' };

const isDirectory = async target => { try { return (await stat(target)).isDirectory(); } catch { return false; } };
const isFile = async target => { try { return (await stat(target)).isFile(); } catch { return false; } };
const hasFiles = async (directory, pattern) => {
  try { return (await readdir(directory)).some(name => pattern.test(name)); } catch { return false; }
};

/** All folders are scanned together: each catalog clip is taken from the first
 * folder (in this order) that holds it complete, otherwise from the one with
 * most frames. `catalog:true` roots are matched by the patch's file-naming
 * rules (see media-server.mjs matchClipFiles); the others only serve manual
 * remaps. PARTE2_DDS_ROOT accepts several folders separated by ";". */
export function ddsRootCandidates({ env = process.env, packageRoot = PACKAGE_ROOT, workspaceRoot = WORKSPACE_ROOT } = {}) {
  const roots = [];
  const configured = String(env[MEDIA_ENV.dds] ?? '').split(/[;\n]/).map(value => value.trim()).filter(Boolean);
  configured.forEach((value, index) => roots.push({ id: configured.length > 1 ? `env-${index + 1}` : 'env',
    label: `${MEDIA_ENV.dds}${configured.length > 1 ? ` #${index + 1}` : ''} · variable de entorno`, path: path.resolve(value), catalog: true }));
  roots.push(
    // Show location, 7/9/2026: the sequences were copied to the NVMe on E:.
    // Seven decks reading BC1 at 30 fps starve on the USB spinning disks below
    // (I: and H: are WD USB HDDs), which showed up as decks stalling mid-cue.
    // These come first so the launchers need no environment variable.
    { id: 'fast-dds', label: 'E:\\PARTE2-MEDIA\\dds · M.2, carpeta principal del show', path: 'E:\\PARTE2-MEDIA\\dds', catalog: true },
    { id: 'fast-dds2', label: 'E:\\PARTE2-MEDIA\\dds2 · M.2, clips 32–44', path: 'E:\\PARTE2-MEDIA\\dds2', catalog: true },
    { id: 'fast-resize', label: 'E:\\PARTE2-MEDIA\\resize · M.2, clips 27–31 y 49', path: 'E:\\PARTE2-MEDIA\\resize', catalog: true },
    { id: 'package', label: 'media/dds · copia dentro del paquete', path: path.join(packageRoot, 'media', 'dds'), catalog: true },
    { id: 'original', label: 'DDS2 · ruta original (OneDrive)', path: 'C:\\Users\\mpale\\OneDrive\\Desktop\\DDS2', catalog: true },
    // Origin of the E: copy, on the backup drive I:. Kept as a fallback.
    { id: 'show-dds', label: 'I:\\dds · disco de backup, lento (33.288 frames)', path: 'I:\\dds', catalog: true },
    { id: 'show-dds2', label: 'I:\\dds2 · disco de backup, lento (8.905 frames)', path: 'I:\\dds2', catalog: true },
    { id: 'show-resize', label: 'I:\\laptop shit\\…\\resize · disco de backup, lento', path: 'I:\\laptop shit\\0001 SHOW NUEVO MATERIAL VIDEO\\resize', catalog: true },
    { id: 'show-dds-copy', label: 'I:\\laptop shit\\…\\dds · copia de I:\\dds', path: 'I:\\laptop shit\\0001 SHOW NUEVO MATERIAL VIDEO\\dds', catalog: true },
    { id: 'legacy-show', label: 'Material del show · ruta relativa anterior', path: path.resolve(workspaceRoot, '..', '0001 SHOW NUEVO MATERIAL VIDEO', 'dds'), catalog: true },
    { id: 'legacy-liquid', label: 'Líquido · ruta anterior', path: 'C:\\Users\\SG13\\Desktop\\liquido' },
  );
  return roots;
}

/** The ink is read every frame by FINAL and INK dripping, so the M.2 copy also
 * takes priority over the package copy sitting on the H: spinning disk. */
export function inkRootCandidates({ env = process.env, packageRoot = PACKAGE_ROOT, workspaceRoot = WORKSPACE_ROOT } = {}) {
  const roots = [];
  if (env[MEDIA_ENV.ink]) roots.push({ id: 'env', path: path.resolve(env[MEDIA_ENV.ink]) });
  roots.push({ id: 'fast', path: 'E:\\PARTE2-MEDIA\\ink' },
    { id: 'package', path: path.join(packageRoot, 'media', 'ink') },
    { id: 'workspace', path: path.join(workspaceRoot, '2D', 'ink') });
  return roots;
}

export function overlayCandidates({ env = process.env, packageRoot = PACKAGE_ROOT } = {}) {
  const files = [];
  if (env[MEDIA_ENV.overlay]) files.push({ id: 'env', path: path.resolve(env[MEDIA_ENV.overlay]) });
  files.push({ id: 'package', path: path.join(packageRoot, 'media', 'overlay', 'part2-overlay.png') },
    { id: 'original', path: 'C:/Users/mpale/Downloads/Group 1 (1).png' });
  return files;
}

/** Resolve the effective media locations once at server start. Never throws:
 * a missing location is reported as null so the UI can show it as absent. */
export async function resolveMediaPaths(options = {}) {
  const dds = ddsRootCandidates(options);
  for (const root of dds) {
    root.exists = await isDirectory(root.path);
    root.hasDDS = root.exists && await hasFiles(root.path, /\.dds$/i);
  }
  const activeDDS = dds.find(root => root.hasDDS) || null;
  let ink = null;
  for (const candidate of inkRootCandidates(options)) {
    if (await isFile(path.join(candidate.path, 'DDS', 'INK000000.DDS')) || await isFile(path.join(candidate.path, 'INK000000.jpg'))) { ink = candidate; break; }
  }
  let overlay = null;
  for (const candidate of overlayCandidates(options)) if (await isFile(candidate.path)) { overlay = candidate; break; }
  return {
    packageRoot: options.packageRoot ?? PACKAGE_ROOT,
    ddsRoots: dds, activeDDSRootId: activeDDS?.id ?? null, ddsRoot: activeDDS?.path ?? null,
    inkRoot: ink?.path ?? null, inkSource: ink?.id ?? null,
    overlayPath: overlay?.path ?? null, overlaySource: overlay?.id ?? null,
    env: MEDIA_ENV,
  };
}

export function describeMediaPaths(paths) {
  const line = (label, value, source) => `  ${label}: ${value ?? 'NO ENCONTRADO'}${source ? ` (${source})` : ''}`;
  return [
    line('DDS del catálogo', paths.ddsRoot, paths.activeDDSRootId),
    line('Tinta INK', paths.inkRoot, paths.inkSource),
    line('Overlay', paths.overlayPath, paths.overlaySource),
    `  Variables: ${Object.values(paths.env).join(', ')}`,
  ].join('\n');
}
