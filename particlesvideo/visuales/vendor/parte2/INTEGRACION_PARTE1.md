# Integración futura con PARTE 1

Documento general para trasladar al proyecto principal: [Entrega de Parte 2 WebGPU](ENTREGA_PARTE2_WEBGPU.md). Incluye estado actual, medios externos, armado explícito del show en modo hosted y medición de rendimiento a 2688 × 1008.

PARTE 1 permanece sin modificaciones. `system/host-adapter.js` deja preparada una integración explícita con su `ctx.params`, su reloj y su entrada MIDI. No publica escenas nuevas dentro del sistema actual ni abre `vis-bus`.

La aplicación de PARTE 1 mantiene la autoridad sobre la salida, la selección de parte y su audio web. Sus escenas24 (previa),25 (PLAY Fluidos),26 (Fluidos live) y reservas27–29 conservan su significado. Parte 2 mantiene sus números vvvv dentro de un namespace: `parte2.scene.current` y `parte2.scene.goto`. Una nota recibida por Parte 2 cambia esa escena interna; nunca dispara `scene.goto` de Parte 1.

## Archivos y API

- `system/midi.js`: Web MIDI autónomo para la aplicación independiente. En el host no se crea otro receptor.
- `system/mappings.js`: formato de filas compatible con Parte 1; defaults extraídos de `MIDI SEQ PLAYER.v4p` y rutas OSC `/fx1`,`/fx2`,`/fx4`.
- `system/parameter-midi.js`: asignación nueva de todos los controles públicos a CC de canales11/12/14/15/16, acciones por notas ch16 y exportación CSV. Se distingue del perfil vvvv original.
- `system/host-adapter.js`: registro de controles/acciones bajo `parte2.*`, sincronización bidireccional, tick externo y salida con identidad del GPUDevice.
- `system/io-contract.md`: tablas MIDI completas, fórmulas de velocidades, eventos, OSC y límites de fidelidad.

Exports: `createParte2HostAdapter(host, options)`, `Parte2HostAdapter`, `createParte2ViteProxy(target?)`. La importación no inicializa dispositivos, red ni DOM. El controller se importa de manera diferida al crear una instancia real.

## Montaje en el host

Este código es una propuesta concreta para el futuro punto de inicialización del **output**, no para el editor de PARTE 1:

```js
import { createParte2HostAdapter } from '@parte2/system/host-adapter.js';

// El host aporta un canvas exclusivo para esta salida intermedia.
const parte2 = await createParte2HostAdapter(ctx, {
  canvas: parte2Canvas,
  // Opcionales: inyectar exactamente el device/adapter usados por el compositor.
  device: hostGPUDevice,
  adapter: hostGPUAdapter,
  systemOptions: { restore: false },
});

// Los controles aparecen en ctx.params.list() y pueden aprenderse desde su editor.
ctx.params.set('parte2.final.fx2', 0.35);
ctx.params.trigger('parte2.scene.goto', 69);

function onHostFrame(dtSeconds) {
  if (activePart !== 2) return;
  const output = parte2.render(dtSeconds);
  // output = { texture, view, device, width, height, format, canvas }
  hostCompositorConsume(output); // Punto de integración propio del renderer del host.
}

function onNormalizedMidi(message) {
  if (activePart === 2) parte2.dispatch(message);
  else parte1Mapper.dispatch(message);
}

// Al desmontar, deja intactos el renderer, Params, MIDI y audio del host.
parte2.dispose();
```

`hostGPUDevice`, `hostGPUAdapter`, `activePart` y `hostCompositorConsume` representan dependencias que el host debe aportar; no son APIs inventadas de Three.js. El adapter no busca por su cuenta un device en campos internos del renderer ni modifica los handlers existentes. El host decide cuándo reenviar notas, CC, clock y OSC. Los mensajes normalizados conservan los canales1–16 de Parte 1.

La factory fuerza `hosted:true`, `autoStart:false`, `connectOSC:false`, `bridge:false`, `connectMidi:false`, y entrega el device/adapter al sistema en `gpu:{device,adapter}`. Una instancia integrada no debe abrir EventSource/UDP/otro bus, pedir permiso MIDI ni crear otro requestAnimationFrame. Una instancia ya creada se puede entregar con `system`; en ese caso debe haberse iniciado sin loop autónomo y el llamador conserva su ownership.

`render(dt)` recibe segundos del reloj del host y mantiene pasos fijos según `parte2.transport.rate`; `parte2.transport.playing=false` permite recomponer la imagen sin avanzar las simulaciones. Los controles Start/Stop del host no se conectan automáticamente al transporte de Parte 2. El routing explícito puede disparar `parte2.transport.start`, `continue`, `stop`, `reset` según la política del show.

La API del adapter acepta sólo nombres completos: `get('parte2.final.fx2')`, `set(...)`, `trigger('parte2.scene.goto',69)`. `dispatch(message)` recibe una entrada normalizada y la entrega al mapper interno; no crea hooks sobre `MidiInput` de Parte 1.

## GPU y salida compartida

Un GPUTexture sólo se puede usar en el GPUDevice que lo creó. El getter `outputTexture` devuelve también `device`; `getTextureFor(hostGPUDevice)` rechaza un device diferente. Que ambos renderers usen la misma placa no alcanza: la instancia de GPUDevice debe ser idéntica.

Inyectar el device evita pedir otro y permite que un compositor WebGPU del host consuma la textura. El renderer de Parte 1 está basado en Three/WebGPU: además de compartir el device, su backend necesita un punto compatible para importar/bindear esa textura. No se afirma que `THREE.Texture` acepte directamente un GPUTexture. Ese enlace al backend de Three queda como trabajo de integración y debe probarse con la versión instalada; el ejemplo deja el punto visible en `hostCompositorConsume`.

Si se conservan devices separados, la alternativa es componer a partir del canvas/salida de Parte 2 mediante una copia de imagen admitida por el renderer, con costo adicional. No pasar un GPUTexture entre devices. No hacer readback CPU por frame como ruta normal de composición. `dispose()` de la instancia que recibió un device compartido sólo debe destruir recursos propios; nunca el GPUDevice del host.

La textura de salida puede cambiar al modificar resolución: consultar `outputTexture` después del render, sin retener indefinidamente una view vieja. La salida actual de ambas partes es **2688×1008**. Parte 2 distribuye seis bloques de **448×1008**; sus fuentes DDS y buffers internos de efectos conservan sus tamaños propios. No hay estiramiento implícito en el adapter.

## Vite y servicio de medios

La interfaz integrada necesita alcanzar el servidor Parte 2 para catálogo, DDS, tinta y overlay. El helper genera rutas precisas y deja libres las demás APIs del host. Ejemplo de configuración futura:

```js
import { defineConfig } from 'vite';
import { pathToFileURL } from 'node:url';

const parte2Root = 'H:/BACKUP/desktop/ultra backup/001Set tecnopolis/milky-webgpu';

export default defineConfig(async () => {
  const { createParte2ViteProxy } = await import(
    pathToFileURL(`${parte2Root}/system/host-adapter.js`).href
  );
  return {
  resolve: {
    alias: {
      // Ajustar ubicación al equipo. El alias apunta al código, no a los DDS.
      '@parte2': parte2Root,
    },
  },
  server: {
    // Conservar los allow/proxy ya existentes; este ejemplo sólo muestra lo nuevo.
    fs: { allow: ['.', parte2Root] },
    proxy: {
      ...createParte2ViteProxy('http://127.0.0.1:8787'),
    },
  },
  };
});
```

El helper se importa en la configuración mediante una URL de archivo real, sin depender del alias que se está declarando. El alias `@parte2` se usa en el código de la aplicación. `parte2Root` es la carpeta copiada del paquete (aquí `milky-webgpu`; puede tener otro nombre en el repositorio destino, nada dentro depende del nombre).

El servidor de medios (`node server.mjs`, puerto 8787) encuentra solo los DDS, la tinta y el overlay si la carpeta `media/` viaja junto con el código. En otra máquina o con los medios en otro disco, definir antes de arrancarlo `PARTE2_DDS_ROOT`, `PARTE2_INK_ROOT` y `PARTE2_OVERLAY`; al iniciar imprime las rutas activas y `GET /api/catalog` las devuelve en `paths`. Conservar además las opciones actuales de PARTE 1: `base:'./'`, esbuild/worker y las entradas de build main/editor/fluids. No se escribió esta configuración sobre la de PARTE 1.

Rutas generadas: `/api/catalog`, `/api/media/remap`, `/api/osc/*`, `/media/*`, `/ink/*`, `/assets/part2-overlay.png`. No se utiliza un catch-all `/api`. El proxy OSC no abre una conexión por sí mismo; el modo integrado recibe OSC normalizado del host. Si se usa el bridge WS existente de Parte 1 (`localhost:8081`), no enviar `rebind` para no cambiar su puerto UDP.

## Registro, persistencia y desmontaje

El adapter comprueba todas las colisiones de `parte2.*` antes de registrar. Cada definición se crea con `sceneReset:false` y sin smoothing adicional; los cambios de escena de Parte 1 no resetean automáticamente los controles de Parte 2. Los valores y acciones se sincronizan en ambas direcciones con guardas que evitan eco y disparos duplicados. Los valores derivados de una acción también se reflejan en el host.

La versión actual de `Params` de Parte 1 devuelve `void` en `onChange(id,fn)` y `onAction(id,fn)`. Por eso el desmontaje compatible retira únicamente las funciones propias de `_changeListeners`/`_actionListeners`. Si una versión futura devuelve una función para desuscribirse, se usa esa función. No se reemplazan métodos ni se vacían las colecciones del host. Por defecto también se retiran sólo las definiciones registradas por este adapter; `unregisterOnDispose:false` permite conservarlas si el host lo requiere.

`createParte2HostAdapter` es dueño de la instancia que crea y la destruye al desmontar. Si recibe `system`, sólo desmonta sus bindings; no destruye esa instancia salvo `dispose({destroySystem:true})`. Nunca destruye el host. La persistencia Parte 2 conserva las claves `parte2.*` y no escribe `vis.*`; `restore:false` evita recuperar una sesión autónoma cuando el host debe aportar el estado inicial.

Los mapeos existentes de Parte 1 no se reescriben. Su editor puede asignar manualmente notas/CC a los nuevos destinos con prefijo. Para reproducir el perfil vvvv exacto, reenviar al mapper Parte 2 sólo cuando la parte2 esté activa; no ejecutar ambos mappers sobre una nota de escena sin routing, porque comparten canales MIDI.

## Pruebas realizadas

`node --test system/host-adapter.test.mjs system/midi-mappings.test.mjs system/parameter-midi.test.mjs`:25 pruebas pasan. Incluyen namespace de escenas, valores bidireccionales, acciones una sola vez, sincronización de valores derivados, rechazo de colisiones antes de mutar, cleanup de listeners heredados, ownership, loop externo, pausa, rechazo de GPUDevice distinto, rutas proxy sin capturar APIs ajenas, MIDI Learn (también al cambiar OSC/nota/CC), clock y perfil completo de controles públicos. Los tests usan un host que replica la API real leída de Parte 1 y no solicitan hardware ni audio.

Pendiente para la unión real: montaje en el output de Parte 1, importación de textura en su versión concreta de Three/WebGPU, routing de parte activa, encuadre del LED y prueba con Ableton/loopMIDI. Esos pasos no se aplicaron al proyecto Parte 1 durante la construcción independiente de Parte 2.
