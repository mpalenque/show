# Rendimiento medido de la integración Fluids

> **INFORME HISTÓRICO — asignación anterior «24 PLAY / 25 live».** Estas mediciones y sus 210 tests se conservan como evidencia de aquella implementación. La decisión vigente es **24 previa / 25 PLAY / audio siempre externo**. Este informe no valida ese cambio: consultar [el contexto actual](../CONTEXTO-ACTUAL.md) y los nuevos artefactos bajo `radiance-check/cues-24-25/`.

2026-09-06. **La presentación de la salida cumple el presupuesto de 20 ms en las tres pasadas de producción y en la prueba final con preview. La física no sostiene un mínimo de 50 actualizaciones/s en todas las ventanas medidas.** La integración funcional está comprobada; el requisito estricto de física permanece abierto.

## Condiciones y método

- Equipo medido: Intel Core i7-12700 y NVIDIA RTX 3090.
- Salida: **2688×1008**, buffer nativo 1×, calidad Radiance `high`, resolución HRC reportada **1024**.
- Build de producción, tres reproducciones de la pieza de **152,694 s**, desde una entrada preparada. Documento conservado: 256 eventos y 400 claves.
- Presentación: intervalos del bucle de salida, media efectiva, percentiles y máximo. Física: avance de `solverFrame`, duración del trabajo WASM y edad de la última respuesta disponible.
- El análisis excluye muestras con tiempo de timeline **≥152,694 s**. El cierre está congelado por diseño; contarlo como una simulación en reproducción falsearía sus métricas.

Datos: [reporte de producción](../../radiance-check/production/report.json), [pasada 1](../../radiance-check/production/pass-1.json), [pasada 2](../../radiance-check/production/pass-2.json), [pasada 3](../../radiance-check/production/pass-3.json). El resumen se recalcula con [analyze-radiance.mjs](../../tools/analyze-radiance.mjs).

## Presentación de la escena 24

| Pasada | Frames activos | FPS | p95 | p99 | Mayor intervalo | Intervalos >20 ms |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 9.156 | 60,001 | 16,9 ms | 17,1 ms | 17,8 ms | 0 |
| 2 | 9.156 | 60,001 | 16,9 ms | 17,1 ms | 17,8 ms | 0 |
| 3 | 9.155 | 60,001 | 16,9 ms | 17,1 ms | 17,9 ms | 0 |

En estas tres reproducciones no hubo intervalos de salida mayores a 20 ms ni errores de JavaScript registrados. Estos números describen la cadencia de la salida; no certifican que cada frame contenga un nuevo paso de física.

## Física del Worker: límite observado

| Pasada | Actualizaciones/s promedio | Menor tasa en ventana de 1 s | Paso Worker p95 | Paso Worker máximo | Edad máxima del snapshot |
|---|---:|---:|---:|---:|---:|
| 1 | 58,52 Hz | 50,95 Hz | 20,1 ms | 32,7 ms | 31,4 ms |
| 2 | 57,13 Hz | **42,45 Hz** | 22,0 ms | 36,4 ms | 38,2 ms |
| 3 | 57,94 Hz | **45,49 Hz** | 20,8 ms | 33,3 ms | 32,2 ms |

Las peores ventanas corresponden aproximadamente a los segundos 149, 115 y 65 de las respectivas pasadas. La salida reutilizó la misma respuesta del solver en 596, 681 y 733 muestras; la mayor racha fue de una, dos y una muestras consecutivas. La interpolación permite seguir presentando a 60 FPS, pero no convierte esas respuestas repetidas en nueva simulación.

El costo observado está en el solver WASM con fluido denso. **No se cumplió el mínimo estricto de 50 Hz de física durante toda la pieza**, y estos resultados no justifican prometer ausencia de retrasos. Tampoco permiten atribuir las ventanas lentas exclusivamente a otras aplicaciones abiertas.

La integración recicla buffers y evita duplicar motores o trabajo de render. Conserva los **tres subpasos** y la física del show escrito. Reducirlos, alterar población o reemplazar el solver cambiaría la simulación y necesita una comparación visual y musical específica; no se presenta como una optimización transparente ya realizada. La fase de rendimiento continúa abierta por este límite.

## Regresión de Parte 1

La pasada por escenas 1–23 no activó frames de Fluids ni produjo errores. Se comprobó la línea vertical de la 2, la reentrada del piso con fuga de la 7 y su despliegue de 9 s, los rayos de **0,014 m** y el torbellino inmediato de la 21. [Reporte de regresión](../../radiance-check/regression/report.json).

| Escena | Rayos | Frames | FPS | Mayor intervalo | Intervalos >20 ms |
|---|---|---:|---:|---:|---:|
| 20 | Apagados | 601 | 60,002 | 18,5 ms | 0 |
| 20 | Activos | 601 | 60,002 | 18,0 ms | 0 |
| 21 | Apagados | 601 | 60,002 | 17,9 ms | 0 |
| 21 | Activos | 601 | 60,002 | 17,3 ms | 0 |

## Integración y editor

El reporte de producción aprobó cinco casos: cancelación de una 24 pendiente, PLAY y protección frente a notas repetidas, transferencia 24→25 con conservación de población/documento, regreso a Parte 1 y entrada directa en 25, y reinicio 25→24 con congelado del cierre.

El [reporte del editor](../../radiance-check/editor/report.json) aprobó siete comprobaciones funcionales: lanes sin segundo renderer, play/pausa remotos, edición con ACK y deshacer, selección 25 y ráfaga por la ruta MIDI del Mapper sin editar el timeline, cancelación durante el drenaje del Worker, preview remoto y salida física 2688×1008 con DPR **1 / 1,3 / 1,5 / 2**. Las notas se inyectaron al Mapper en el test: esto no reemplaza un ensayo de cableado MIDI con Ableton y el dispositivo físico.

**Preview corregido y medido con el editor visible:** 427 frames a **60,001 FPS**, p99 **17,2 ms**, máximo **18,6 ms** y **ningún intervalo >20 ms**. Se completaron las 15 capturas solicitadas, sin descartes ni errores; después de la preparación inicial, el costo máximo de captura en el hilo principal fue **0,3 ms**.

La captura transfiere un `ImageBitmap` y codifica JPEG en un Worker con `OffscreenCanvas`, a **672×252 y 2 Hz**. No añade otro solver de Fluids. Las lanes y waveform del editor ahora se redibujan cuando cambia su contenido visual; las actualizaciones del contador de tiempo y las estadísticas ya no obligan a repintarlas unas 16 veces por segundo.

La [medición previa a la corrección](../../radiance-check/editor/before-preview-fix.json) conserva el problema encontrado: 426 frames, 8 intervalos >20 ms, p99 23 ms y máximo **44,4 ms**. El [reporte final del editor](../../radiance-check/editor/report.json) contiene el resultado corregido y las métricas de captura. El presupuesto de presentación con preview queda aprobado para esta medición; permanece el límite físico descrito arriba.

Verificación final de código: **210 tests aprobados** —198 del paquete Radiance, 8 de documento/transporte y 4 del preview—, comprobación TypeScript y build de producción aprobados. [Operación de las escenas](OPERACION.md) y [estado del plan](PLAN-INTEGRACION-RADIANCE.md).
