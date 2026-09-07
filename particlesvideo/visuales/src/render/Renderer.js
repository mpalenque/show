import * as THREE from 'three/webgpu';
import { STAGE } from '../config/stage.js';

// Crea el WebGPURenderer a tamaño fijo (2688 × 1008, pixelRatio 1) y lo mete en #stage.
// El buffer de dibujo SIEMPRE es 2688 × 1008; lo único que cambia es a qué tamaño lo muestra
// el navegador. En la LED se ve 1:1; en una ventana más chica el navegador lo reduce.
export async function createRenderer() {
  // ?stats activa las consultas de timestamp de la GPU (tienen costo, no van en el show).
  const trackTimestamp = new URLSearchParams(location.search).has('stats');
  const renderer = new THREE.WebGPURenderer({ antialias: false, alpha: false, powerPreference: 'high-performance', trackTimestamp });
  await renderer.init();

  if (!renderer.backend.isWebGPUBackend) {
    throw new Error('WebGPU no disponible en este navegador/GPU.');
  }

  renderer.setPixelRatio(1);
  renderer.setSize(STAGE.width, STAGE.height, false);   // false: no toca el CSS
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const stageEl = document.getElementById('stage');
  stageEl.appendChild(renderer.domElement);

  // Nativo: 1:1 con la LED mientras entre en la ventana, y si no entra se achica para que se
  // vea el cuadro COMPLETO. Nunca agranda más allá de 1:1, así lo que se ve en la máquina del
  // show es exactamente lo que sale por el panel.
  const view = { mode: 'native' };
  const apply = () => fitStage(stageEl, renderer.domElement, view.mode);
  apply();
  window.addEventListener('resize', apply);
  // Mover la ventana a un monitor con otra escala cambia el dpr sin disparar `resize`.
  // Esta media query se reevalúa exactamente cuando el dpr deja de valer lo que valía.
  const seguirDpr = () => {
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      .addEventListener('change', () => { apply(); seguirDpr(); }, { once: true });
  };
  seguirDpr();

  // El modo 'fit' ESTIRA el cuadro hasta llenar la ventana aunque tenga que agrandarlo más
  // allá de 1:1. Queda accesible con la tecla, pero no es el del show: agrandar interpola y
  // deshace las líneas de 1 px del 2D.
  view.toggleNative = () => {
    view.mode = view.mode === 'fit' ? 'native' : 'fit';
    apply();
    return view.mode;
  };

  return { renderer, view };
}

// Se ajusta el tamaño CSS del canvas (no un transform): así el navegador lo reescala
// con filtrado, en vez de con el muestreo duro que deja los bordes escalonados.
//
// El tamaño CSS se divide por el devicePixelRatio. El buffer de dibujo siempre mide
// 2688 × 1008 píxeles REALES, pero `style.width` está en píxeles CSS, que solo son lo mismo
// con la escala de pantalla de Windows en 100%. Con la escala en 130% (dpr 1.3) poner
// `width: 2688px` hacía que el navegador estirara el cuadro a 3494 píxeles físicos: todo
// borroso, las líneas de 1 px del 2D deshechas, y encima el cuadro más ancho que el panel de
// 2688 así que ni siquiera entraba entero. Dividiendo, 2688/1.3 = 2068 px CSS × 1.3 = 2688
// físicos: uno a uno de nuevo, sin depender de cómo esté configurada la máquina.
function fitStage(stageEl, canvas, mode) {
  const dpr = window.devicePixelRatio || 1;

  // SIEMPRE arriba a la izquierda (pedido de Manuel). Lo que no entre queda fuera por abajo y
  // por la derecha, nunca repartido a los cuatro lados.
  stageEl.style.left = '0px';
  stageEl.style.top = '0px';

  if (mode === 'native') {
    // La escala se calcula en píxeles FÍSICOS, no CSS, y por eso `innerWidth` va multiplicado
    // por el dpr: la ventana mide `innerWidth` píxeles CSS, que son `innerWidth · dpr` reales.
    // El tope en 1 es lo que evita que el cuadro se agrande: a 1:1 la LED lo muestra pixel a
    // pixel, y estirarlo lo único que hace es interpolar.
    //
    // El `+ 1` es un píxel de TOLERANCIA y no un capricho: el ancho de la ventana en físicos sale
    // de multiplicar un entero de píxeles CSS por el dpr, así que con la escala de Windows en
    // 130 % una ventana que en teoría mide 2688 cae en 2687.7. Sin tolerancia ese caso de borde
    // achica el cuadro y lo saca del uno a uno por un píxel — lo cazó `smoke-dpr.mjs`.
    const cabe = (fisicos) => (fisicos + 1);
    const escala = Math.min(1, cabe(window.innerWidth * dpr) / STAGE.width, cabe(window.innerHeight * dpr) / STAGE.height);
    // Y acá se vuelve a CSS dividiendo por el dpr, que es lo que mantiene el uno a uno con la
    // escala de Windows en 130 % o 150 % (ver el comentario largo de arriba).
    canvas.style.width = `${(STAGE.width * escala) / dpr}px`;
    canvas.style.height = `${(STAGE.height * escala) / dpr}px`;
    return;
  }
  const scale = Math.min(window.innerWidth / STAGE.width, window.innerHeight / STAGE.height);
  canvas.style.width = `${Math.round(STAGE.width * scale)}px`;
  canvas.style.height = `${Math.round(STAGE.height * scale)}px`;
}

export function showFatalError(err) {
  console.error('[vis]', err);
  const div = document.createElement('div');
  div.id = 'fatal';
  div.textContent = `Error fatal:\n${err && err.stack ? err.stack : err}`;
  document.body.appendChild(div);
}
