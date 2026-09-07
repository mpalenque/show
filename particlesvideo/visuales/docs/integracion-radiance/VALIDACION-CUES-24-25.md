# Validación actual — previa 24 / PLAY 25

Fecha: **2026-09-06**. Alcance: la decisión nueva de [operación](OPERACION.md), con previa negra/línea blanca, secuencia completa en 25 y audio exclusivamente externo. **Funcionamiento aprobado; rendimiento variable, sin garantía de mínimo permanente.** Las pruebas de la primera integración permanecen en [RENDIMIENTO.md](RENDIMIENTO.md) y no se presentan como validación de esta asignación.

## Código y comportamiento

- **217 tests aprobados:** 203 del paquete Radiance, 9 de sesión, 4 de preview y 1 de migración de mapeos. TypeScript y build de producción aprobados, incluido el build final tras desactivar loops al entrar.
- **6 comprobaciones del flujo aprobadas en desarrollo y producción:** cancelación de una entrada pendiente, previa vacía en tiempo 0, PLAY por nota MIDI 25 sin reiniciar por notas repetidas, retorno 25→24, suspensión del Worker al volver a Parte 1/entrada directa en 25 y cierre congelado en escena 25.
- La prueba intercepta creación de `AudioContext` y reproducción mediante `HTMLMediaElement.play`: no hubo reproducciones ni contextos audibles, incluso enviando preferencias antiguas de audio. La decodificación offline de waveform permanece disponible.
- La captura de previa contiene una banda de **320×8 píxeles**, **2552 píxeles iluminados y 0 coloreados**, en el documento y encuadre probados; población vacía y timeline detenido.
- El último ensayo de desarrollo comprueba que un loop previamente activado se desactiva al entrar en 24 y al entrar directamente en 25. Es una herramienta de ensayo, sin sincronización del loop de Ableton.
- **7 comprobaciones del editor aprobadas:** documento/lanes sin segundo renderer, transporte remoto, edición con ACK y undo, MIDI 24→25 conservando la edición, cancelación durante el drenaje, preview sin otro solver y canvas físico 2688×1008 con DPR 1/1,3/1,5/2.
- Prueba de producción bajo **`/show/`** aprobada para recursos y cues. La última modificación de loop se probó en desarrollo y en el build; no se atribuye retroactivamente a la medición de producción anterior.

[Flujo final en desarrollo](../../radiance-check/cues-24-25/smoke/report.json) · [flujo de producción](../../radiance-check/cues-24-25/production/report.json) · [editor](../../radiance-check/cues-24-25/editor/report.json) · [previa capturada](../../radiance-check/cues-24-25/production/24-entry.png).

## Mediciones nuevas y su variabilidad

Equipo de referencia: **Intel i7-12700, RTX 3090**, salida física **2688×1008**, Radiance HRC 1024, calidad alta y escala nativa 1×. Son muestras de aproximadamente 8 segundos del flujo nuevo, además de las comprobaciones funcionales; **no son tres recorridos completos nuevos de los 152,694 s**.

| Ensayo | Frames | FPS medios | p99 | Máximo | Intervalos >20 ms |
|---|---:|---:|---:|---:|---:|
| Producción, primera medición | 467 | 58,250 | 39,7 ms | **83,6 ms** | **45** |
| Producción, repetición sin cambio de código | 481 | 59,999 | 17,0 ms | 17,5 ms | 0 |
| Desarrollo final, incluye loop desactivado al entrar | 480 | 60,001 | 17,0 ms | 17,8 ms | 0 |
| Editor y preview de producción | 427 | 60,099 | 17,1 ms | 17,7 ms | 0 |

La primera producción tuvo un paso de Worker de hasta **217 ms** y una antigüedad de snapshot de **215,3 ms**. En la repetición, los máximos fueron **11,3 ms** y **19,8 ms**; en desarrollo final, **15,6 ms** y **30,1 ms**. Se conserva [la medición problemática](../../radiance-check/cues-24-25/production/first-report.json), además de [la repetición](../../radiance-check/cues-24-25/production/report.json). Un ensayo inicial de desarrollo también tuvo un intervalo de **21,3 ms** entre 481 frames; queda en [initial-report.json](../../radiance-check/cues-24-25/smoke/initial-report.json).

Después de cerrar la prueba problemática se observó actividad externa: vvvv consumió 2,625 s de CPU en una ventana de 2 s y Ableton 1,2969 s; Premiere tenía unos 35,1 GB de memoria residente. La GPU indicaba 30 % de uso, 8955 MiB y 65 °C. **La lectura no fue simultánea a los frames lentos ni aísla una causa única.** La repetición demuestra variabilidad del equipo en esa sesión; no prueba que el código sea ajeno a todas las caídas. No se cerraron las otras aplicaciones.

El preview nuevo completó **16 de 16 capturas**, sin descartes ni errores, con captura en hilo principal de **0,3 ms máximo**. Conserva JPEG 672×252 a 2 Hz, transferencia mediante ImageBitmap y codificación en Worker/OffscreenCanvas. Las lanes se redibujan cuando cambian sus datos visuales, no en cada actualización del reloj o estadísticas.

## Límite que sigue abierto

No se puede afirmar **50 FPS mínimos permanentes, 50 Hz físicos continuos o ausencia total de retrasos** con estos resultados. En las tres pasadas completas históricas el render fue estable, pero el solver bajó hasta 42,45 Hz en una ventana de 1 s y tuvo pasos de 36,4 ms. Se preservaron sus tres subpasos para mantener la evolución escrita del show. La nueva medición problemática agrega evidencia de intervalos lentos de presentación bajo las condiciones observadas.

Una futura corrección de rendimiento debe medirse sobre la pieza completa y registrar tanto presentación como frecuencia/antigüedad de física, conservando la carga del equipo y la configuración utilizadas. No marcar ese requisito como resuelto sólo por una repetición favorable.
