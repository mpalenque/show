# Rayos con luz y torbellino — 2026-09-06

Alcance: Parte 1, ancho de rays 0,042 m, luz puntual por slot y palitos iluminados sólo por rays en escena 21. [Decisión vigente](CONTEXTO-ACTUAL.md) · [Controles](CONFIGURACION.md#rays-y-torbellino-de-parte-1).

## Implementación

Los 32 `RayPointLight` heredan de `PointLight` y permanecen en la escena sin sombras por cubemap. Su nodo conserva el sombreado Standard, con ramas que omiten luces apagadas y superficies fuera de alcance. Cada luz sigue el centro del rayo, comparte color/opacidad y se apaga con la cola del impacto. No se modifica la cantidad de palitos ni el solver.

En 21, `particles.raysOnly` apaga emisión y bloom propios, las luces de estudio y cualquier luz residual del orbe. El bloom cambia mediante uniforme, sin invalidar el material de los palitos. Las normales incorporan la escala y el estrechamiento de la cola; el AO existente aumenta su contraste ×1,3 sólo en esta escena, sin sumar muestras ni resolución. Las demás escenas recuperan sus luces y presets.

## Verificación reproducible

Desde `visuales`:

```powershell
npm.cmd run test:rays
npm.cmd run check:ray-lighting -- performance-check/ray-lighting/validated-3s 3
npm.cmd run check:radiance
npm.cmd run build
```

Resultado: **6 tests de ciclo de rayos**, **44 comprobaciones del navegador**, **217 tests existentes**, TypeScript y build aprobados. El script de navegador abre Chrome headless con perfil temporal, salida limpia y MIDI/OSC ignorados dentro de la prueba; no altera las entradas de la salida del show.

Las pruebas cubren seguimiento de posición, ancho real, color/intensidad/alcance, caída e impacto, fades, saturación de 40 disparos en 32 slots únicos, limpieza de luces y fuerzas al salir, material estable y restauración del look. El cambio 20→21 con orbe disparado lleva su luz de intensidad 18 a 0.

Para comparar la luz y el AO se oculta únicamente la geometría ajena a los palitos en el navegador de prueba y se detiene la física: los tres renders conservan el mismo hash del buffer de partículas y el mismo reloj. Sin luz de rays hay **0 píxeles iluminados**; con luz y AO, **109.892**. El AO oscurece **122.510 píxeles** respecto de la misma imagen sin AO. El umbral de cambio es 2 niveles de luminancia sRGB; estas cifras corresponden al fixture, no a todo el show.

## Rendimiento observado

Chrome 152/WebGPU, 2688×1008, 131.072 palitos, calidad high. Se miden intervalos entre frames completados, después del calentamiento. Cada caso vuelve a sembrar partículas y conserva escena 21; el par cambia sólo la intensidad de las luces. Prueba final de 3 s por caso:

| Disparos | Luz | FPS | p95 (ms) | Máximo (ms) | Intervalos >20 ms | Luces activas máx. |
|---|---|---:|---:|---:|---:|---:|
| Ninguno | Apagada | 60,00 | 17,9 | 19,1 | 0 | 0 |
| Ninguno | Habilitada | 59,98 | 18,1 | 19,6 | 0 | 0 |
| Uno cada 1,5 s | Apagada | 60,02 | 18,0 | 19,0 | 0 | 0 |
| Uno cada 1,5 s | Encendida | 60,01 | 18,3 | 19,8 | 0 | 1 |
| Ráfaga 14,5/s | Apagada | 60,02 | 17,9 | 19,1 | 0 | 0 |
| Ráfaga 14,5/s | Encendida | 59,98 | 18,4 | 20,0 | 0 | 19 |

Sin errores WebGPU ni invalidaciones del material durante los disparos. Esta prueba corta no garantiza un mínimo continuo en todo el show, otros equipos o con 32 luces activas sostenidas. Tampoco mide por separado el tiempo GPU de cada luz; a 60 Hz puede existir costo dentro del margen disponible.

## Artefactos y pasadas anteriores

Los PNG y JSON quedan localmente bajo `performance-check/ray-lighting/`, ignorados por Git. La entrega final está en `validated-3s/report.json` y sus capturas.

Se conservan dos pasadas anteriores: `report-first-pass.json` recibió entradas externas que cambiaron la escena y no sirve como comparación de rendimiento. `report.json` aisló esas entradas y midió seis casos de 5 s: ~60 FPS, hasta 19 luces; con luces, máximos de 18,2–18,9 ms y ningún intervalo >20 ms. Los casos de rayos sin luz tuvieron un intervalo de 20,2 ms y otro de 20,3 ms. Esa segunda pasada falló únicamente la comprobación del orbe porque el fixture no lo había disparado (0→0); se corrigió el fixture y se ejecutó completa la pasada final de 3 s, con 44/44 comprobaciones aprobadas.
