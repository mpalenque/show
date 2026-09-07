# Radiance Live Show

Sistema unificado de visuales en vivo. Usa una sola aplicación con dos ventanas:

- `/control`: operación, configuración, audio y rendimiento.
- `/output`: salida limpia con master fijo de `3360×1008` (10:3). En una pantalla de otra proporción se muestra centrada, sin deformarla.

Escenas incluidas: Radiance Fluid, Depth Sorter, Bloques y Voronoi. Piano FFT no forma parte de esta aplicación. El análisis de audio es global y cada parámetro puede trabajar en modo manual, audio o híbrido. Fluid incluye `Reactive original`, una portación de la escena `/reactive` anterior con su director completo.

El control global **AUTO REACTIVO** puede recorrer escenas, looks y parámetros siguiendo el audio. Es una capa temporal: al apagarla se recuperan exactamente todos los valores manuales guardados. Sus tiempos, intensidad y recorrido entre escenas se ajustan desde LIVE.

## Desarrollo

```powershell
npm install
npm run dev
```

Abrir `http://localhost:4180/control` y usar **Abrir salida**. El micrófono se habilita únicamente desde la ventana de control.

Atajos de operación (cuando no se está editando un control): `1–4` cambia de escena, `←/→` cambia de look, `A` alterna AUTO/MANUAL y `B` activa o quita blackout. En Bloques, `Q` alterna gravedad, `W` gira 90°, `E` cambia la escala de emisores y `R` reinicia la escena.

La separación de responsabilidades y las decisiones de rendimiento están documentadas en [ARCHITECTURE.md](./ARCHITECTURE.md).

## Distribución

El solver WASM heredado de `radiance-2d-fluid` conserva su aviso de procedencia. Antes de publicar o redistribuir el proyecto fuera de este entorno hay que verificar la licencia de esos binarios.

## GitHub Pages

El despliegue se realiza automaticamente desde `.github/workflows/deploy-pages.yml` cada vez que se actualiza `main`. La aplicacion queda disponible en:

`https://mpalenque.github.io/radiance-live-show/`

La ventana de salida se abre con el boton **Abrir salida** o anadiendo `?view=output` a esa URL. GitHub Pages debe tener configurada la fuente **GitHub Actions** en **Settings -> Pages** la primera vez.
