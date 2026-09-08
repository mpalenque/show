# Medios de PARTE 2

Esta carpeta contiene las copias de los medios que el servidor local (`server.mjs`) sirve al navegador. Con ella dentro del paquete no hace falta configurar rutas: `node server.mjs` las encuentra solo e imprime al arrancar qué ruta quedó activa para cada medio.

| Carpeta / archivo | Qué es | Tamaño | Origen de la copia |
|---|---|---|---|
| `dds/` | Secuencias DDS del catálogo (BC1). Contiene **los clips 0–11 completos y 5 frames del clip 12** (4.895 de 48.030 frames). | ≈ 5,7 GB | `C:\Users\mpale\OneDrive\Desktop\DDS2` |
| `ink/DDS/INK000000.DDS … INK001066.DDS` | Tinta de Milky FINAL e INK dripping, 1.067 frames BC7 1280 × 720. | ≈ 943 MB | `001Set tecnopolis\2D\ink\DDS` |
| `ink/INK000000.jpg … INK001066.jpg` | Alternativa JPG de la tinta para GPUs sin `texture-compression-bc`. | ≈ 56 MB | `001Set tecnopolis\2D\ink` |
| `overlay/part2-overlay.png` | Guía de calibración gris/roja 3840 × 2160 del patch original (capa opcional, apagada por defecto). | 37 KB | `C:\Users\mpale\Downloads\Group 1 (1).png` |

## Ubicación del show: el M.2 en E:

**Para tocar, los medios se leen de `E:\PARTE2-MEDIA`.** El 7/9/2026 se copiaron ahí las tres carpetas del catálogo y la tinta (50,19 GB en 9 min 53 s) porque `I:` y `H:` son discos USB mecánicos y no dan el caudal que piden siete decks a 30 fps. El código ya busca esa ubicación primero, así que `ABRIR PARTE 2.cmd` la toma sola, sin variables de entorno.

| Carpeta en E: | Origen | Clips que aporta |
|---|---|---|
| `E:\PARTE2-MEDIA\dds` | `I:\dds` | 44 |
| `E:\PARTE2-MEDIA\dds2` | `I:\dds2` | 13 |
| `E:\PARTE2-MEDIA\resize` | `I:\laptop shit\…\resize` | 6 |
| `E:\PARTE2-MEDIA\ink` | `media/ink` (tinta y JPG) | tinta de FINAL e INK |

Medido con `node tools/media-benchmark.mjs`, leyendo 200 frames consecutivos por carpeta. La columna que importa es cuántos decks a 30 fps aguanta cada disco; el show necesita 7:

| Carpeta | MB/s | frames/s | Decks a 30 fps |
|---|---:|---:|---:|
| `E:\PARTE2-MEDIA\dds` (NVMe) | 428 | 928 | **30,9** |
| `E:\PARTE2-MEDIA\dds2` (NVMe) | 713 | 688 | **22,9** |
| `E:\PARTE2-MEDIA\resize` (NVMe) | 683 | 618 | **20,6** |
| `E:\PARTE2-MEDIA\ink\DDS` (NVMe) | 695 | 754 | **25,1** |
| `media/dds` en H: (USB mecánico) | 37 | 36 | **1,2** |
| `I:\dds` (USB mecánico) | 69 | 149 | 5,0 |
| `I:\…\resize` (USB mecánico) | 74 | 67 | 2,2 |

El caso peor era la copia del paquete en `H:`, que aguantaba **un solo deck**: ahí vivían los clips 0–11, justamente los que selecciona la velocity 127. Las cifras de `I:\dds2` y de la carpeta de OneDrive salieron altas en esa corrida porque acababan de leerse y estaban en la caché de Windows; no son la velocidad real de esos discos.

Si el M.2 no está disponible, `PARTE2_DDS_ROOT` y `PARTE2_INK_ROOT` permiten apuntar a otra ubicación, y el paquete sigue funcionando con su copia interna, más lento.

## El resto del catálogo está en el disco I:

El 7/9/2026 se encontró el material que faltaba en el disco de backup `I:`. El servidor ya lo escanea automáticamente cuando el disco está conectado (ver `system/media-paths.mjs`):

| Carpeta | Frames | Aporta al catálogo |
|---|---|---|
| `I:\dds` (idéntica a `I:\laptop shit\0001 SHOW NUEVO MATERIAL VIDEO\dds` y a `I:\content\dds`) | 33.288 (36,7 GB) | Clips 0–26, 45–48 y 50–62. Es la carpeta que usaba el patch original. |
| `I:\dds2` (idéntica a `I:\content\dds2`) | 8.905 (8,6 GB) | Clips 32–44, con nombres cambiados. |
| `I:\laptop shit\0001 SHOW NUEVO MATERIAL VIDEO\resize` | 3.777 | Clips 27–31 y 49, en 2046 × 1080. |

Con el disco conectado: **63 de 68 clips completos (42.395 frames)**. Siguen faltando los clips **63–67: INCENDIO00, bosqu, LOMBRIZ0, capulloalien0, mariposa** (5.635 frames), que no aparecen en ningún disco de esta máquina. Mientras falten, el sistema reproduce un **sustituto temporal** (`media.fallback`, ver `ENTREGA_PARTE2_WEBGPU.md`).

Para que el paquete sea autosuficiente sin el disco `I:` (≈ 45 GB más), copiar esas tres carpetas dentro de `media/dds/` respetando los nombres de archivo (el servidor las reconoce por nombre, no por carpeta):

```powershell
robocopy I:\dds  "…\milky-webgpu\media\dds" /E /R:1 /W:1 /NP
robocopy I:\dds2 "…\milky-webgpu\media\dds" /E /R:1 /W:1 /NP
robocopy "I:\laptop shit\0001 SHOW NUEVO MATERIAL VIDEO\resize" "…\milky-webgpu\media\dds" /E /R:1 /W:1 /NP
```

Para el show conviene que estas carpetas estén en un SSD: siete decks a 30 fps de BC1 1080p leen unos 200 MB/s. Si quedan en otro disco, apuntar `PARTE2_DDS_ROOT` allí (varias rutas separadas por `;`).

## Orden de búsqueda del servidor

Para cada tipo de medio el servidor toma la primera ubicación que exista; para los DDS escanea **todas** las carpetas existentes y toma cada clip de la primera que lo tenga completo:

1. Variables de entorno: `PARTE2_DDS_ROOT` (una o varias rutas separadas por `;`), `PARTE2_INK_ROOT`, `PARTE2_OVERLAY`.
2. Esta carpeta: `media/dds`, `media/ink`, `media/overlay/part2-overlay.png`.
3. Rutas históricas de la máquina original: OneDrive Desktop, las carpetas de `I:` listadas arriba, `../2D/ink`, Descargas.

`GET /api/catalog` informa `paths`, `activeRootId`, y por cada carpeta (`roots`) si existe, cuántos archivos tiene y cuántos clips aporta; por cada clip, `rootId` y `mapping`.

## Agregar material nuevo

Para las secuencias que no existen, `tools/import-sequence.mjs` hace la conversión completa:

```text
node tools/import-sequence.mjs --list                                  # qué falta, con su velocity MIDI
node tools/import-sequence.mjs --clip 64 --input "D:\bosque.mp4"       # video -> frames DDS en media/dds
```

Toma un video (cualquier formato que lea ffmpeg) o una carpeta con imágenes numeradas, escala a 1920 × 1080, muestrea a 30 fps y escribe DDS DXT1 sin mipmaps, idénticos en formato a los originales. Los nombres que genera ya cumplen la regla del patch, así que el servidor los reconoce al reiniciarlo, sin remapear. Cantidades esperadas: clip 63 INCENDIO00 222 frames, 64 bosqu 361, 65 LOMBRIZ0 1.319, 66 capulloalien0 1.664, 67 mariposa 2.069. Con otra cantidad, `--frames all --update-catalog` ajusta el catálogo.

## Nombres de archivo

El patch (`Ordenar secuencias dds.v4p`) obtuvo los 68 nombres del catálogo quitando exactamente cuatro caracteres al principio y cuatro al final del nombre sin extensión (`004 drone arriba incendio000.dds` → `drone arriba incendi`). El servidor aplica la misma regla; para carpetas renombradas (`I:\dds2`: `NY 1 001.DDS`) acepta además que el nombre del catálogo sea el final del nombre del archivo, siempre que la cantidad de frames coincida exactamente. Al agregar material nuevo, conservar los nombres originales de los archivos.

## Git

`media/dds/` y `media/ink/` están en `.gitignore` por su tamaño. Si el repositorio destino va a versionarlos, usar Git LFS y quitar esas líneas del `.gitignore`.
