# Escenas 14 y 15 — plan EJECUTADO (2026-09-05)

> Estado: **hecho y verificado**. Este documento queda como registro de qué se hizo y en qué se
> apartó del plan original. El detalle técnico completo está en
> [visuales/NOTAS.md](particlesvideo/visuales/NOTAS.md), sección "Octava vuelta".

## El problema

Las escenas **14** y **15** eran el mismo stream duplicado: mismos valores, mismo comentario,
solo cambiaba el signo de `particles.flowX` y el lado del bloque rojo. Manuel pidió dos escenas
completamente distintas, azules, sin bound, recorriendo todo el espacio.

## Lo que quedó

**Escena 14 — «Cardumen azul».** Campo de direcciones (el de la 20) que peina los palitos en
filamentos, más un flujo lateral flojo que hace migrar la bandada entera; el que sale por un
borde renace en el de enfrente. Sin caja: la huella (10 m de ancho) solo hace de dominio del
reciclado, porque el kernel no mira `box.enabled`.

**Escena 15 — «Fuga azul».** Las partículas nacen en el eje del medio y **salen despedidas hacia
afuera**, ganando velocidad, hasta perderse fuera de cuadro. Es lo contrario de los torbellinos
(21, 22, 23), que juntan. Queda un túnel radial con punto de fuga en el centro.

> Segunda versión. La primera fue un «torbellino errante» y Manuel la rechazó: *"no podés repetir
> lo que ya pasa después; hacé que las partículas se vayan lejos"*. Tenía razón — era el cuarto
> torbellino del show. El paseo del centro (`vortex.travel*`) quedó implementado y disponible,
> pero ninguna escena lo usa hoy.

El bloque rojo ya no aparece en ninguna escena del show. El elemento sigue vivo y disponible por
MIDI/OSC, apagado por defecto.

## En qué se apartó del plan

| El plan decía | Quedó | Por qué |
|---|---|---|
| `box.width` 7.6 en la 14 | **10**, y el techo del param de 8 → 11 | En perspectiva la pantalla se abre con la profundidad: a 1.8 m de fondo abarca ±5.8 m, no ±4. Con 7.6 quedaban franjas negras a los costados. |
| 15 = un torbellino que pasea | **15 = una fuga radial** (`vortex.pull` negativo + `wrapMode: 'radial'`) | Manuel: repetía lo que ya hacen la 21, 22 y 23. |
| 14 con `resetInBox` al entrar | **Sin reset** | Manuel pidió que la transición desde la 13 sea progresiva: color de golpe, forma desde donde estaba. |

## Tres bugs que aparecieron en el camino (y se arreglaron)

1. **`box.yaw` nunca llegaba al ángulo que pedía la escena.** El integrador de giro de `BoxWire`
   pisaba el tween del ángulo mientras `box.yawSpeed` bajaba a cero. Medido: yendo de la 13 a una
   escena con `box.yaw: 0` terminaba en 14°; desde la 16, en 96°. **Las viejas 14/15 también lo
   sufrían** sin que se notara. Arreglado mirando el *destino* de `yawSpeed` en vez de su valor.
2. **Las acciones de entrada corrían con la caja de la escena anterior.** `SceneManager.goto`
   funde los params y dispara las acciones enseguida, así que `resetInBox` usaba la huella vieja.
   Arreglado con la constante `HUELLA_YA` (transición 0 para la geometría de la caja).
3. **Se veía una caja de alambre del tamaño del escenario** durante el fundido de entrada a la
   14 y la 15: `HUELLA_YA` agranda la huella a 10-11 m de golpe, pero `box.visible` seguía
   fundiéndose desde la escena anterior. Arreglado metiendo `box.visible` en `HUELLA_YA`.

Además, sacar `redBlock.*` de las escenas dejó huérfanos cinco params (más dos que ya lo estaban):
sin dueño, moverlos desde el editor le pisaba el valor de fábrica a todas las escenas. Se
agregaron a `BASE` con su valor de fábrica — no cambia nada de lo que se ve, cambia de quién son.

## Archivos tocados

| Archivo | Qué |
|---|---|
| `src/scenes/index.js` | Escenas 14 y 15 nuevas + constante `HUELLA_YA` |
| `src/scenes/base.js` | 7 params que quedaron sin dueño |
| `src/layers3d/particles/Forces.js` | `vortex.pull` puede ser negativo (repele); modo `radial`; params `vortex.travelX/Z/Rate` |
| `src/layers3d/particles/MlsMpmSimulator.js` | Kernel del reciclado radial (la fuga de la 15) |
| `src/layers3d/BoxWire.js` | Techo de `box.width` 8 → 11; arreglo del giro que pisaba el tween |
| `NOTAS.md`, `REFERENCIA-MIDI-OSC.md/.csv` | Bitácora y hoja de referencia regenerada |

## Verificación

- Las 23 escenas a 60 fps; la 14 y la 15 en 1.0–1.1 ms por frame, de las más baratas del show.
- Recorrido 13 → 14 → 15 → 16 con las transiciones reales, y salto directo a la 15 desde una
  escena 2D: todo lo de la 14/15 (wrap, `pull`, `emitSpread`, rozamiento, huella) vuelve solo a
  su valor de fábrica al salir.
- La 14 verificada a 10 s, 35 s y 95 s: el cuadro sigue lleno y estable. La 15, a 16 s y 30 s:
  la fuga se sostiene, no se vacía ni se apelmaza contra la pared del escenario.
- `walk-scenes`, `smoke`, `smoke-learn`, `smoke-persist` y `smoke-settings` en verde.
- `smoke-io` tiene 4 fallas **preexistentes y ajenas a esto**: espera escenas con id `testA` /
  `testB` que no existen en `SCENES` (ni existían antes). La prueba quedó desactualizada.
