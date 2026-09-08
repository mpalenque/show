# Validación de Parte 2 integrada — 2026-09-08

La integración está ejecutada en `particlesvideo/visuales`. [Plan vigente](PLAN-INTEGRACION-PARTE2.md) · [Arranque y configuración](../CONFIGURACION.md#parte-2-integrada-y-medios-del-disco-rápido).

## Copia y lectura de medios

Se verificó la presencia de los **111 archivos** del paquete copiado (27.468.652 bytes en la copia inicial). El [manifiesto](../origen-parte2/copia-sin-secuencias.json) conserva sus hashes originales; los archivos adaptados cambian después de esa copia. No falta ningún archivo del manifiesto.

La búsqueda en `vendor/parte2` y `dist` no encontró archivos DDS ni directorios de secuencias DDS/INK. Los 63 clips completos del catálogo y la tinta se resuelven exclusivamente desde E:. El overlay se sirve desde el proyecto. Desarrollo y preview sirven DDS/INK con `Cache-Control: no-store`; el cliente también evita guardarlos en caché de disco. No se convirtieron ni trasladaron secuencias.

## Pruebas funcionales

- **101 tests Node aprobados:** suites originales de Parte 2, adaptador contra Params real, router y las regresiones de línea, grillas, piso, rays y mapeos.
- **30 comprobaciones Chrome/WebGPU aprobadas** en la prueba sostenida de desarrollo; **31 en producción**, que además verifican las cabeceras de caché. La comparación GPU contra el decodificador fuente se realiza en desarrollo.
- Editor remoto y pestaña integrada, registro de 444 controles, enums numéricos, cambios en ambos sentidos, importación inválida sin mutación y persistencia después de recargar Output.
- Cue 72/ch10, nota de video anterior al cue, Note Off, Learn que consume antes de cambiar escena, cambio rápido cancelado, seek repetido y repetición de cue sin reiniciar tiempo.
- Vuelta a escena 2 con movimiento autónomo, primera entrada y redisparo de piso en 7, entrada en Fluids y suspensión de su sesión al volver a Parte 2.
- Blackout global medido sobre píxeles, salida con contenido visible y ausencia de excepciones del navegador o errores GPU.
- Dos puertos UDP aislados entregan una vez cada mensaje al mismo WebSocket, conservando el puerto principal. Se probaron `/fx1` y `/fx2`; no se cambió el puerto del bridge real.
- Build Vite aprobado y probado mediante preview. La prueba de producción detectó y permitió corregir una referencia generada incorrectamente al inicializar el listado MIDI del editor.

## Rendimiento medido

Chrome headless con WebGPU NVIDIA, salida **2688×1008**, en esta máquina. Dos pasadas de **600 s**, ejecutadas de a una. Siete decks DDS, Milky A, FINAL e INK activos; las variantes FULL se preparan, pero esta medición no implica todas las combinaciones posibles de efectos y warps.

| Medición | DDS alineados, carga comprimida | Seis DDS de 2046×1080 + deck completo |
|---|---:|---:|
| Frames de presentación registrados | 36.002 | 36.001 |
| Intervalo medio | 16,666 ms (~60 FPS) | 16,666 ms (~60 FPS) |
| Intervalo p95 / p99 | 17,0 / 19,9 ms | 21,8 / 24,4 ms |
| Intervalo máximo | 25,1 ms | 38,3 ms |
| Trabajo CPU medio / p95 | 1,87 / 2,60 ms | 2,05 / 3,20 ms |
| Fallos de lectura / errores GPU | 0 / 0 | 0 / 0 |

La pasada de DDS alineados precedió a la optimización del decoder; esa ruta conserva la carga comprimida. La segunda pasó con el decoder GPU y las lecturas sin caché de disco. La presentación promedia 60 FPS, con variación entre frames: no se afirma que cada cuadro tarde menos de 16,7 ms. Los DDS son de 30 FPS; en la segunda pasada sus índices avanzaron entre **29,53 y 29,96 frames/s**, calculados entre muestras y respetando sus loops originales. Es una medición distinta de la frecuencia de presentación.

La cola de presentación llegó a **dos envíos GPU**, su límite. La caché DDS observada llegó a **263.580.480 bytes**, dentro del presupuesto de 256 MiB, además de las texturas de composición/efectos y cargas acotadas en curso. No representa la memoria total de la aplicación.

Los clips 27, 28, 29, 30, 31 y 49 tienen ancho 2046, incompatible con la carga BC1 directa del port. Se trasladó su decodificación a un shader con la misma aritmética entera. Un frame completo real de 2046×1080 se comparó píxel por píxel contra `decodeDDS`: **diferencia media 0, máxima 0, alfa idéntico**. Esta corrección evita el cuello de CPU sin cambiar tamaño ni contenido de los archivos.

El [resumen JSON versionado](validacion-2026-09-08.json) conserva resultados y métricas. Los reportes completos, muestras y capturas están localmente en `performance-check/parte2/`, excluido de Git. Los perfiles temporales de las pruebas se limpian al terminar.

## Reproducción

Desde `particlesvideo/visuales`:

```text
node --test --test-reporter=dot vendor/parte2/system/*.test.mjs tools/parte2.test.mjs tools/moving-line.test.mjs tools/moving-line-mapping.test.mjs tools/grid-switch.test.mjs tools/floor-retrigger.test.mjs tools/rays.test.mjs
node tools/check-parte2-osc.mjs
npm run build -- --configLoader native
node tools/check-parte2.mjs --resize --seconds=600
node tools/check-parte2.mjs --production --resize
```

El navegador de prueba simula MIDI y no se conecta al WebSocket real. El ensayo OSC usa puertos temporales propios. Estas pruebas no dispararon clips ni modificaron transporte, pistas o puertos de Ableton.

Al finalizar se dejó `npm start` funcionando en `http://localhost:5173/`. Para activar el bridge integrado se detuvieron únicamente los dos procesos identificados del show anterior: el bridge de UDP9000/WebSocket8081 y la web separada de Parte 2 en 8787/UDP1002. El arranque actual reúne UDP9000 y UDP1002 en el mismo WebSocket8081. No se cambiaron las rutas de las secuencias ni el set de Ableton.

## Contenido y comprobación operativa pendientes

Faltan cinco clips en los medios originales disponibles: **63 INCENDIO00, 64 bosqu, 65 LOMBRIZ0, 66 capulloalien0 y 67 mariposa** (5.635 frames). El sustituto del port está conservado y se indica en el panel. El **cue MIDI 49** aún no tiene contenido identificado; es distinto del clip DDS de índice 49, que sí existe y fue probado.

Queda el ensayo físico con el set de Ableton y la pared LED, incluida la selección de la entrada MIDI correcta. La prueba en este equipo no certifica todos los presets ni el rendimiento de otras máquinas. No se afirmó recuperar sesiones del almacenamiento de otro navegador: se pueden trasladar mediante export/import JSON.
