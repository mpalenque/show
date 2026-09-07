# Corrección de escenas 7, 20 y 21 — 2026-09-06

Se eliminaron las seis luces puntuales y los dos halos añadidos a cada rayo. Al aparecer y desaparecer rayos cambiaba la lista de luces visible y Three invalidaba los shaders de iluminación. Los rayos vuelven a ser blancos, con 0.01 m de ancho: aproximadamente 2–3 píxeles a las profundidades usadas. Se conservan impactos, repulsión y esquirlas.

El piso de la escena 7 se reinicia desde cero en cada entrada y se despliega en 9 segundos. La animación compensa la perspectiva: el avance se aprecia durante toda la duración. Las notas duplicadas de la escena activa conservan la protección contra redisparos.

La escena 21 modifica directamente la velocidad reconstruida de los palitos, dentro del mismo kernel de simulación. `vortex.response=45` hace inmediata la respuesta y el cambio de eje; el radio pasa a 1.6 m. Al salir se desactiva el modificador. Las otras escenas conservan sus fuerzas anteriores.

También se omiten realmente los pases de AO/bloom apagados, GTAO trabaja a media resolución con opción de volver a resolución completa, y los pases se preparan antes de arrancar el show. La salida permanece en 2688×1008 y la cantidad de palitos en 131072. El contador de FPS ahora usa tiempo real, sin el límite temporal de la física.

## Medición

RTX 3090, Chrome con WebGPU, 2688×1008, calidad high, 131072 partículas. Se midió tiempo entre frames completados; los tiempos CPU de envío de comandos no se presentan como tiempos GPU. Cada caso final duró 25 segundos. La ráfaga dispara un rayo cada 69 ms (~14.5/s); en la 21 también alterna eje y dispara el kick.

| Caso | Promedio final | Peor intervalo final | Intervalos >20 ms |
|---|---:|---:|---:|
| Escena 20 sin rayos | 60.00 FPS | 18.9 ms | 0 |
| Escena 20 con ráfagas | 60.00 FPS | 18.7 ms | 0 |
| Escena 21 sin rayos | 60.00 FPS | 19.4 ms | 0 |
| Escena 21 con ráfagas y cambio de eje | 60.00 FPS | 19.4 ms | 0 |

Antes de la corrección, la comparación con el comportamiento de las luces/halos anteriores produjo pausas de **257.4 ms en la 20** y **75.8 ms en la 21**. La comparación usó snapshots del motor/compositor/simulador anterior y una reconstrucción funcional de Rays anterior; no fue un checkout limpio del repositorio, que ya tenía cambios locales.

Una pasada intermedia de 80 segundos tuvo un intervalo aislado de 26.4 ms en la 21 sin rayos. No se reprodujo en la pasada final de 100 segundos. No se atribuye ese caso a una aplicación específica: no se capturó una traza que permita hacerlo.

Antes de abrir la prueba, `nvidia-smi` indicó 55% de uso de GPU y unos 10 GB ocupados, con Premiere, vvvv, Chrome y otras aplicaciones registradas. No se cerraron aplicaciones del usuario. La prueba final cumple el presupuesto de 20 ms; no demuestra una garantía absoluta bajo cualquier carga externa del sistema.

Datos: [comparación anterior](performance-check/before.json), [pasada intermedia](performance-check/extended/after.json), [pasada final](performance-check/final/after.json).

## Verificación

- Piso: reinicio probado desde las otras 28 escenas; avance y cancelación comprobados con tres distancias de cámara.
- Rayos: ancho proyectado, blanco, ausencia de luces adicionales, impactos y saturación del pool comprobados.
- Torbellino: 131072/131072 partículas con posición y velocidad finitas; captura 200 ms después del cambio de eje; salida hacia otras escenas desactiva el modificador inmediatamente.
- Chrome no informó errores de renderizado ni de shaders. El permiso Web MIDI se denegó en el perfil headless, por lo que los golpes de la prueba se inyectaron por las acciones reales de la aplicación.
- `npm.cmd run build` y comprobaciones de sintaxis pasaron.

Capturas: [piso a mitad del despliegue](performance-check/final/7-reveal-1.png), [rayos finos](performance-check/final/20-after.png), [torbellino](performance-check/final/21-turn.png), [cambio de eje](performance-check/final/21-axis-flip.png).

Para repetir: `node tools/check-show-performance.mjs performance-check/nueva 25`. Abre su propio servidor local y Chrome headless, los cierra al terminar y guarda métricas/capturas.
