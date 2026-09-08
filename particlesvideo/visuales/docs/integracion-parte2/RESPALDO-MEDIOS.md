# Respaldo de los medios de Parte 2 fuera de GitHub

Los DDS y la tinta de Parte 2 **no pueden ir al repositorio**: son 50,19 GB en 48.104 archivos, y
GitHub corta en 100 MB por archivo y da 1 GB de LFS gratis. Lo que sí está versionado es
`placeholder/parte2/`: un frame real por secuencia (63 de 68 clips, más INK en DDS y JPG), 69 MB,
que alcanzan para abrir el proyecto en una máquina sin el disco de medios.

Hoy los medios existen **en un solo lugar**, `E:\PARTE2-MEDIA`. Si ese disco se cae, el show
queda sin material. Este documento es el plan para que dejen de estar en un solo lugar, con la
herramienta que lo hace y lo comprueba: [`tools/backup-parte2-media.mjs`](../../tools/backup-parte2-media.mjs).

## Qué hay que respaldar

Medido el 2026-09-08 con `node tools/backup-parte2-media.mjs <destino> --dry-run`:

| Raíz | Secuencias | Archivos | Tamaño |
|---|---|---|---|
| `E:\PARTE2-MEDIA\dds` | 49 | 33.288 | 36,72 GB |
| `E:\PARTE2-MEDIA\dds2` | 14 | 8.905 | 8,61 GB |
| `E:\PARTE2-MEDIA\resize` | 6 | 3.777 | 3,89 GB |
| `E:\PARTE2-MEDIA\ink` | 2 | 2.134 | 0,97 GB |
| **Total** | **71** | **48.104** | **50,19 GB** |

Las raíces no están escritas en la herramienta: salen de `config/parte2-media.local.json` o, si no
existe, de `config/parte2-media.example.json`, que es la misma configuración que usa el show. Si
los medios se mudan, el respaldo sigue apuntando bien sin tocar código.

**La tinta son dos carpetas, no una.** Los 1.067 JPG de `ink/` son el material original, pero el
show lee `ink/DDS/` (943 MB). Un respaldo que copie sólo la raíz se lleva 50 MB y deja afuera lo
que se proyecta.

## Los dos destinos, y por qué son distintos

**Disco externo — `F:` (EXTRA, 774 GB libres): sin `--zip`.**

```
node tools/backup-parte2-media.mjs F:/PARTE2-MEDIA-BACKUP
```

El destino queda **espejado** al origen: mismas carpetas, mismos nombres. Eso permite que el show
corra directo desde el respaldo si `E:` falla, copiando `config/parte2-media.example.json` a
`config/parte2-media.local.json` y cambiando las rutas a `F:/PARTE2-MEDIA-BACKUP/dds`, `dds2`,
`resize` e `ink`. No hay paso de restauración: se apunta y anda. Medido a ~160 MB/s, los 50 GB
tardan unos 6 minutos entre discos locales.

**Nube — Google Drive (`G:`, 735 GB libres) o Dropbox: con `--zip`.**

```
node tools/backup-parte2-media.mjs "G:/Mi unidad/PARTE2-MEDIA" --zip
```

Queda un `.zip` por secuencia: 71 archivos en vez de 48.104. Eso es lo que importa, porque los
clientes de nube se arrastran con decenas de miles de archivos chicos. La compresión es un
agregado, no el motivo: en el clip de prueba (`011 reactor nuclear`, 134,1 MB en 305 frames) el zip
quedó en 87,9 MB, un 35 % menos; la tinta en DDS comprime muchísimo más (943 MB → 38,9 MB) porque
son cuadros casi planos.

Lo ideal es tener los dos: el disco externo es el que sirve para tocar el show mañana, la nube es
el que sobrevive a que se rompa la casa.

## Cómo comprobar que la copia sirve

Sin hashes, una copia de 50 GB no se distingue de una copia truncada. La herramienta escribe
`manifiesto-parte2.json` en el destino con el SHA-256, el tamaño y la fecha de **cada archivo**,
agrupados por secuencia; en modo zip guarda además el hash del zip.

```
node tools/backup-parte2-media.mjs F:/PARTE2-MEDIA-BACKUP --verify
```

Vuelve a leer el destino, lo rehashea y lo compara contra el manifiesto. Sale `0` si está todo, y
`1` con la lista de problemas si no: `FALTA` (no está), `TAMANO` (pesa otra cosa) o `HASH` (pesa
igual pero el contenido cambió). Probado a propósito sobre la copia de la tinta: cambiando un byte
de un JPG y borrando un DDS, la verificación marcó exactamente esos dos archivos.

**Para reparar:** borrar los archivos que la verificación señaló y volver a correr el respaldo.
Sólo repone esos. La reanudación compara tamaños, no contenidos —así no relee 50 GB en cada
corrida—, por eso un archivo dañado que conserva el tamaño no se repone solo: hay que borrarlo, o
usar `--rehash` para rehacer todo.

## Detalles que importan

- **El origen es de sólo lectura.** La herramienta nunca escribe en `E:`, ni siquiera archivos
  temporales; la lista que consume `tar` se escribe en el destino y se borra al terminar.
- **Es reanudable.** 50 GB no siempre entran en una sesión: al volver a correrla saltea lo que ya
  está registrado en el manifiesto con el mismo tamaño. Un corte de luz deja un `.parcial`
  visible, no un frame a medias que el manifiesto daría por bueno.
- **Copia y hashea en una sola lectura**, para no leer los 50 GB dos veces.
- `--only=ink,resize` limita las raíces por nombre de carpeta; `--dry-run` muestra el inventario y
  no toca nada.
- El zip lo arma el `bsdtar` que trae Windows, llamado por ruta absoluta a propósito: el `tar` del
  PATH en Git Bash es GNU tar y toma `-f C:/...` como un host remoto.
- Las cinco secuencias que nunca tuvieron material de origen (63–67: `INCENDIO00`, `bosqu`,
  `LOMBRIZ0`, `capulloalien0`, `mariposa`) no aparecen en el respaldo porque no existen en ninguna
  raíz. No es una falla de la copia.

## Estado

- 2026-09-08: herramienta escrita y probada de punta a punta contra la raíz `ink` real (0,97 GB,
  2.134 archivos) en los dos modos —espejo y zip—, con verificación, reanudación y detección de
  daño. **El respaldo completo de los 50,19 GB todavía no se corrió**: hay que elegir el destino y
  dejarlo trabajar.
