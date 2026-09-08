// Respalda los medios de Parte 2 (los DDS y la tinta que viven en E:\PARTE2-MEDIA) fuera de
// GitHub, con un manifiesto de SHA-256 por secuencia para poder comprobar después que la copia
// sirve. Nunca escribe en el origen: solo lee.
//
// Los medios no pueden ir al repo: son 49,3 GB en ~48.100 archivos y GitHub no sostiene eso
// (100 MB por archivo, y 1 GB de LFS gratis). Por eso el respaldo va aparte, y el manifiesto es
// la parte que importa: sin hashes, una copia de 50 GB no se distingue de una copia truncada.
//
//   node tools/backup-parte2-media.mjs F:/PARTE2-MEDIA-BACKUP
//   node tools/backup-parte2-media.mjs "G:/Mi unidad/PARTE2-MEDIA" --zip
//   node tools/backup-parte2-media.mjs F:/PARTE2-MEDIA-BACKUP --verify
//
// Sin --zip el destino queda ESPEJADO al origen (mismas carpetas, mismos nombres), así que un
// disco externo se puede apuntar directo desde config/parte2-media.local.json sin restaurar
// nada. Con --zip queda un .zip por secuencia, que es lo que hace falta para Drive o Dropbox:
// 48.000 archivos chicos los ahogan.
//
// --verify  no copia: vuelve a hashear el destino y lo compara contra el manifiesto.
// --only    limita las raíces por nombre de carpeta: --only=ink,resize
// --dry-run dice qué haría y cuánto pesa, sin tocar nada.
// --rehash  ignora lo ya registrado y vuelve a hashear todo lo que copia.
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupByStem } from '../vendor/parte2/system/media-server.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')).map((a) => a.split('=')[0]));
const onlyArg = args.find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean)) : null;
const destinoArg = args.find((a) => !a.startsWith('--'));
if (!destinoArg) {
  console.error('Falta el destino. Ejemplo: node tools/backup-parte2-media.mjs F:/PARTE2-MEDIA-BACKUP');
  process.exit(1);
}
const destino = path.resolve(destinoArg);
const zip = flags.has('--zip');
const verificar = flags.has('--verify');
const ensayo = flags.has('--dry-run');
const rehash = flags.has('--rehash');
const MANIFIESTO = path.join(destino, 'manifiesto-parte2.json');

// La tinta mezcla los JPG originales con los DDS que consume el show; los clips son solo DDS.
const EXTENSIONES = { dds: /\.dds$/i, ink: /\.(dds|jpe?g|png)$/i };
// Subcarpetas que además hay que recorrer. El servicio de medios lee la tinta de <inkRoot>/DDS
// (media-server.mjs:161), así que sin esto el respaldo se dejaba afuera los 943 MB que usa el show.
const SUBCARPETAS = { dds: [], ink: ['DDS'] };

// Los clips se agrupan con el mismo `groupByStem` que usa el servicio de medios, para que el
// respaldo hable de las mismas secuencias que el show. Con la tinta no alcanza: ese stem solo
// saca la extensión .dds, así que los 1.067 JPG caían de a uno por "secuencia".
const stemTinta = (nombre) => nombre.replace(/\.(dds|jpe?g|png)$/i, '').replace(/[\s_-]*\d+$/, '') || 'INK';
function agrupar(nombres, tipo) {
  if (tipo !== 'ink') return groupByStem(nombres);
  const grupos = new Map();
  for (const nombre of nombres) {
    const stem = stemTinta(nombre);
    if (!grupos.has(stem)) grupos.set(stem, []);
    grupos.get(stem).push(nombre);
  }
  return grupos;
}

function gb(bytes) { return `${(bytes / 1073741824).toFixed(2)} GB`; }

async function existe(ruta) {
  try {
    await stat(ruta);
    return true;
  } catch {
    return false;
  }
}

async function tamano(ruta) {
  try {
    return (await stat(ruta)).size;
  } catch {
    return -1;
  }
}

async function hashDe(archivo) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(archivo), hash);
  return hash.digest('hex');
}

// Copia y hashea en una sola lectura: son 50 GB, leerlos dos veces duplica la corrida.
async function copiarConHash(origen, rutaDestino) {
  const hash = createHash('sha256');
  const parcial = `${rutaDestino}.parcial`;
  const entrada = createReadStream(origen);
  entrada.on('data', (trozo) => hash.update(trozo));
  await pipeline(entrada, createWriteStream(parcial));
  // El rename recién al final: un corte deja un .parcial evidente, no un frame a medias que el
  // manifiesto daría por bueno.
  await rename(parcial, rutaDestino);
  return hash.digest('hex');
}

// El zip lo arma el bsdtar que trae Windows, apuntado por ruta absoluta a propósito: el `tar`
// del PATH en Git Bash es GNU tar y toma `-f C:/...` como un host remoto ("Cannot connect to C:").
const TAR = path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe');

function correr(comando, argumentos, cwd) {
  return new Promise((resolver, rechazar) => {
    const proceso = spawn(comando, argumentos, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let error = '';
    proceso.stderr.on('data', (trozo) => { error += trozo; });
    proceso.on('error', rechazar);
    proceso.on('close', (codigo) => (codigo === 0
      ? resolver()
      : rechazar(new Error(`${comando} salió ${codigo}: ${error.trim()}`))));
  });
}

async function archivosDe(directorio, patron) {
  try {
    const entradas = await readdir(directorio, { withFileTypes: true });
    return entradas
      .filter((e) => e.isFile() && patron.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// Las raíces salen de la misma configuración que usa el show: si algún día se mudan los medios,
// el respaldo sigue apuntando bien sin tocar este archivo.
async function leerConfig() {
  const candidatos = [
    path.join(project, 'config/parte2-media.local.json'),
    path.join(project, 'config/parte2-media.example.json'),
  ];
  for (const archivo of candidatos) {
    try {
      return { archivo, config: JSON.parse(await readFile(archivo, 'utf8')) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error('No hay config/parte2-media.local.json ni config/parte2-media.example.json');
}

const { archivo: configPath, config } = await leerConfig();
// La carpeta de destino se llama igual que la raíz de origen, para que el respaldo se lea igual que E:.
const declaradas = [
  ...(config.ddsRoots ?? []).map((r) => ({ origen: r, nombre: path.basename(r), tipo: 'dds' })),
  ...(config.inkRoot ? [{ origen: config.inkRoot, nombre: path.basename(config.inkRoot), tipo: 'ink' }] : []),
];
const raices = declaradas.filter((r) => !only || only.has(r.nombre));
if (!raices.length) throw new Error(`Ninguna raíz coincide con --only. Disponibles: ${declaradas.map((r) => r.nombre).join(', ')}`);

// ------------------------------------------------------------------ inventario del origen
// Cada secuencia queda con su `subruta` (vacía en la raíz, 'DDS' en la tinta) para que el
// destino espeje el origen y el manifiesto igual pueda agrupar por secuencia.
const inventario = [];
let bytesTotal = 0;
let archivosTotal = 0;
for (const raiz of raices) {
  const secuencias = [];
  for (const subruta of ['', ...SUBCARPETAS[raiz.tipo]]) {
    const directorio = subruta ? path.join(raiz.origen, subruta) : raiz.origen;
    const nombres = await archivosDe(directorio, EXTENSIONES[raiz.tipo]);
    if (nombres === null) {
      console.warn(`  aviso: no existe ${directorio}, la salteo`);
      continue;
    }
    for (const [nombre, archivos] of agrupar(nombres, raiz.tipo)) {
      const frames = [];
      for (const archivo of archivos) {
        const info = await stat(path.join(directorio, archivo));
        frames.push({ nombre: archivo, bytes: info.size, modificado: info.mtime.toISOString() });
        bytesTotal += info.size;
        archivosTotal += 1;
      }
      secuencias.push({ nombre, subruta, frames, bytes: frames.reduce((a, f) => a + f.bytes, 0) });
    }
  }
  if (!secuencias.length) continue;
  secuencias.sort((a, b) => `${a.subruta}/${a.nombre}`.localeCompare(`${b.subruta}/${b.nombre}`, 'en', { sensitivity: 'base' }));
  inventario.push({ ...raiz, secuencias });
}
if (!inventario.length) throw new Error('No se encontró ninguna raíz de medios. ¿Está conectado el disco?');

console.log(`Origen declarado en ${path.relative(project, configPath)}`);
for (const raiz of inventario) {
  const archivos = raiz.secuencias.reduce((a, s) => a + s.frames.length, 0);
  const bytes = raiz.secuencias.reduce((a, s) => a + s.bytes, 0);
  console.log(`  ${raiz.nombre.padEnd(8)} ${String(raiz.secuencias.length).padStart(3)} secuencias · ${String(archivos).padStart(6)} archivos · ${gb(bytes).padStart(9)}  ${raiz.origen}`);
}
console.log(`  TOTAL    ${archivosTotal} archivos · ${gb(bytesTotal)}`);
console.log(`Destino  ${destino}${zip ? ' · un zip por secuencia' : ' · espejo del origen'}`);

if (ensayo) {
  console.log('\n--dry-run: no se copió nada.');
  process.exit(0);
}

// El manifiesto previo hace el respaldo reanudable: 50 GB no siempre entran en una sesión.
let previo = null;
try {
  previo = JSON.parse(await readFile(MANIFIESTO, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const registrado = new Map();
if (previo && !rehash) {
  for (const raiz of previo.raices ?? []) {
    for (const sec of raiz.secuencias ?? []) {
      for (const f of sec.frames ?? []) registrado.set(`${raiz.nombre}/${sec.subruta ?? ''}/${f.nombre}`, f);
      if (sec.zip) registrado.set(`zip:${raiz.nombre}/${sec.zip.nombre}`, sec.zip);
    }
  }
}

// ------------------------------------------------------------------ verificar
if (verificar) {
  if (!previo) throw new Error(`No hay manifiesto en ${MANIFIESTO}. Primero hay que correr el respaldo.`);
  let ok = 0;
  const problemas = [];
  for (const raiz of previo.raices ?? []) {
    for (const sec of raiz.secuencias ?? []) {
      const entradas = sec.zip
        ? [{ ruta: path.join(destino, raiz.nombre, sec.zip.nombre), esperado: sec.zip.sha256, bytes: sec.zip.bytes }]
        : (sec.frames ?? []).map((f) => ({
          ruta: path.join(destino, raiz.nombre, sec.subruta ?? '', f.nombre),
          esperado: f.sha256,
          bytes: f.bytes,
        }));
      for (const entrada of entradas) {
        const bytes = await tamano(entrada.ruta);
        if (bytes < 0) {
          problemas.push(`FALTA    ${path.relative(destino, entrada.ruta)}`);
          continue;
        }
        if (bytes !== entrada.bytes) {
          problemas.push(`TAMANO   ${path.relative(destino, entrada.ruta)} (${bytes} en vez de ${entrada.bytes})`);
          continue;
        }
        if (await hashDe(entrada.ruta) !== entrada.esperado) problemas.push(`HASH     ${path.relative(destino, entrada.ruta)}`);
        else ok += 1;
      }
      process.stdout.write(`\r  verificados ${ok}, con problema ${problemas.length}   `);
    }
  }
  console.log('');
  if (problemas.length) {
    console.log(`\n${problemas.length} problemas:`);
    for (const p of problemas.slice(0, 40)) console.log(`  ${p}`);
    if (problemas.length > 40) console.log(`  ... y ${problemas.length - 40} más`);
    process.exit(1);
  }
  console.log(`\nRespaldo íntegro: ${ok} archivos coinciden con el manifiesto.`);
  process.exit(0);
}

// ------------------------------------------------------------------ copiar
await mkdir(destino, { recursive: true });
const manifiesto = {
  generado: new Date().toISOString(),
  proposito: 'Respaldo de los medios de Parte 2 fuera de GitHub. Los hashes permiten comprobar la copia con --verify.',
  origen: Object.fromEntries(inventario.map((r) => [r.nombre, r.origen])),
  formato: zip ? 'un zip por secuencia' : 'espejo del origen',
  bytesOrigen: bytesTotal,
  archivosOrigen: archivosTotal,
  raices: [],
};
let copiados = 0;
let salteados = 0;
let bytesCopiados = 0;
const t0 = Date.now();

for (const raiz of inventario) {
  const destinoRaiz = path.join(destino, raiz.nombre);
  await mkdir(destinoRaiz, { recursive: true });
  const secuencias = [];
  for (const sec of raiz.secuencias) {
    const directorioOrigen = sec.subruta ? path.join(raiz.origen, sec.subruta) : raiz.origen;
    const destinoSec = sec.subruta ? path.join(destinoRaiz, sec.subruta) : destinoRaiz;
    // El nombre del zip lleva la subruta adelante para que la tinta original y la tinta en DDS
    // no se pisen: comparten el stem INK.
    const nombreZip = `${sec.subruta ? `${sec.subruta}-` : ''}${sec.nombre}.zip`;
    const rutaZip = path.join(destinoRaiz, nombreZip);
    const zipListo = zip && Boolean(registrado.get(`zip:${raiz.nombre}/${nombreZip}`)) && await existe(rutaZip);
    const frames = [];
    for (const frame of sec.frames) {
      const anterior = registrado.get(`${raiz.nombre}/${sec.subruta}/${frame.nombre}`);
      const rutaDestino = path.join(destinoSec, frame.nombre);
      let sha256 = null;
      if (anterior?.sha256 && anterior.bytes === frame.bytes) {
        // Ya estaba en el manifiesto con el mismo tamaño: alcanza con confirmar que sigue ahí.
        const sigue = zip ? zipListo : await tamano(rutaDestino) === frame.bytes;
        if (sigue) {
          sha256 = anterior.sha256;
          salteados += 1;
        }
      }
      if (!sha256) {
        if (zip) {
          // Con zip el frame no se copia suelto, pero su hash igual va al manifiesto: es lo que
          // permite comprobar el contenido después de descomprimir.
          sha256 = await hashDe(path.join(directorioOrigen, frame.nombre));
        } else {
          await mkdir(destinoSec, { recursive: true });
          sha256 = await copiarConHash(path.join(directorioOrigen, frame.nombre), rutaDestino);
        }
        copiados += 1;
        bytesCopiados += frame.bytes;
      }
      frames.push({ ...frame, sha256 });
    }
    const registro = { nombre: sec.nombre, subruta: sec.subruta, bytes: sec.bytes, frames };
    if (zip) {
      // El tar de Windows (bsdtar, en System32) escribe zip con -a. Se arma desde el directorio
      // de origen y con los nombres tal cual, para poder descomprimir directo sobre E:.
      if (!zipListo) {
        const lista = path.join(destino, '.lista-zip.txt');
        await writeFile(lista, `${sec.frames.map((f) => f.nombre).join('\n')}\n`, 'utf8');
        await correr(TAR, ['-a', '-c', '-f', rutaZip, '-T', lista], directorioOrigen);
      }
      registro.zip = { nombre: nombreZip, bytes: await tamano(rutaZip), sha256: await hashDe(rutaZip) };
    }
    secuencias.push(registro);
    const avance = ((bytesCopiados / bytesTotal) * 100).toFixed(1);
    process.stdout.write(`\r  ${raiz.nombre}/${sec.nombre.slice(0, 34).padEnd(34)} ${String(frames.length).padStart(5)} frames · ${gb(bytesCopiados)} (${avance}%)      `);
  }
  manifiesto.raices.push({ nombre: raiz.nombre, origen: raiz.origen, tipo: raiz.tipo, secuencias });
}
console.log('');

if (zip) await rm(path.join(destino, '.lista-zip.txt'), { force: true });
await writeFile(MANIFIESTO, `${JSON.stringify(manifiesto, null, 2)}\n`, 'utf8');
const minutos = ((Date.now() - t0) / 60000).toFixed(1);
console.log(`\nListo en ${minutos} min: ${copiados} archivos nuevos (${gb(bytesCopiados)}), ${salteados} ya estaban.`);
console.log(`Manifiesto: ${MANIFIESTO}`);
console.log(`Comprobar:  node tools/backup-parte2-media.mjs ${destinoArg} --verify`);
