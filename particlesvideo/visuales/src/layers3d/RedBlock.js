import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

// Bloque rojo (escenas 14 y 15). Publica el atractor 0 al simulador, aunque hoy esas dos escenas
// lo usan solo como presencia: se ve y titila, pero no tira.
export class RedBlock {
  static defineParams(params) {
    params.define({ id: 'redBlock.opacity', type: 'float', min: 0, max: 1, default: 0, label: 'Bloque rojo', group: 'redBlock' });
    params.define({ id: 'redBlock.side', type: 'enum', options: ['left', 'right'], default: 'left', label: 'Lado', group: 'redBlock' });
    params.define({ id: 'redBlock.x', type: 'float', min: 0, max: 6, default: 3.3, label: 'X (m)', group: 'redBlock' });
    params.define({ id: 'redBlock.z', type: 'float', min: -5, max: 0, default: -1.0, label: 'Z (m)', group: 'redBlock' });
    params.define({ id: 'redBlock.width', type: 'float', min: 0.2, max: 12, default: 3.2, label: 'Ancho (m)', group: 'redBlock' });
    // Alto y centro pensados para que el bloque SE PASE del cuadro por arriba y por abajo
    // (la pantalla va de y=0 a y=3): centrado en 1.5 con 7 m de alto va de -2 a 5, así que
    // nunca se le ven los bordes horizontales y lee como un bloque entero, no como un rectángulo.
    params.define({ id: 'redBlock.height', type: 'float', min: 0.2, max: 16, default: 7.0, label: 'Alto (m)', group: 'redBlock' });
    params.define({ id: 'redBlock.y', type: 'float', min: -4, max: 6, default: 1.5, label: 'Centro Y (m)', group: 'redBlock' });
    params.define({ id: 'redBlock.yaw', type: 'float', min: -90, max: 90, default: 20, label: 'Giro (°)', group: 'redBlock' });
    params.define({ id: 'redBlock.color', type: 'color', default: '#B00000', label: 'Color', group: 'redBlock' });
    // El techo pasó de 10 a 400 (Manuel: "40 veces más fuerte, onda super violenta"). El valor
    // es una aceleración en unidades de grilla: 240 son 24 m/s², o sea dos veces y media la
    // gravedad terrestre tirando de costado. Con eso la masa no "va" hacia el bloque, la
    // arranca de una. Los palitos igual no se escapan: el clamp del final del kernel de la
    // caja es incondicional mientras `box.enabled` esté prendido.
    params.define({ id: 'redBlock.attract', type: 'float', min: 0, max: 400, default: 0, label: 'Atracción', group: 'redBlock' });
    // Radio grande a propósito: es la distancia a la que la fuerza cae a la mitad, y en modo
    // plano se mide perpendicular al bloque. Con 2 m la mitad de la caja quedaba fuera de
    // alcance y solo se movían los palitos más cercanos.
    params.define({ id: 'redBlock.attractRadius', type: 'float', min: 0.2, max: 12, default: 5.0, label: 'Radio atracción (m)', group: 'redBlock' });
    // 0 = atrae a un punto (todo converge en un embudo), 1 = empuja en la dirección del bloque
    // (la masa entera se corre para ese lado y golpea la pared del bound a lo ancho).
    params.define({ id: 'redBlock.attractDir', type: 'float', min: 0, max: 1, default: 1, label: 'Dirección vs. punto', group: 'redBlock' });
    // Pulso de la FUERZA (no de la placa). 0 = constante. 1 = va de 0 a 2× la nominal.
    // **Por encima de 1 la fuerza SE DA VUELTA en el valle**: el bloque deja de atraer y empuja.
    // Ahí es donde aparece el movimiento de verdad — los palitos salen despedidos hacia el
    // fondo de la caja, rebotan contra la pared de enfrente y el siguiente pico los vuelve a
    // traer. Con el pulso solo positivo la masa se queda pegada a la pared y late apenas.
    params.define({ id: 'redBlock.attractPulse', type: 'float', min: 0, max: 2, default: 0, label: 'Pulso de la fuerza', group: 'redBlock' });
    // Ojo con la frecuencia: arriba de ~4 Hz esto es una vibración y la masa no llega a moverse
    // (a 7 Hz tiene 70 ms para expandirse, o sea unos centímetros). Para que se vea el envión
    // —embestida, rebote, vuelta— hay que estar en 1 a 2.5 Hz.
    params.define({ id: 'redBlock.attractPulseRate', type: 'float', min: 0.2, max: 30, default: 2, label: 'Pulso (Hz)', group: 'redBlock' });
    // El bloque NO SE MUEVE por defecto (Manuel: *"los cuadrados rojos que atraen no tienen que
    // moverse, sino que tiene que titilar su intensidad de rojo"*). El temblor de posición sigue
    // existiendo y ahora anda de verdad —iba por la normal de la placa, que es casi toda
    // profundidad, y no se veía— pero arranca en 0 y hay que pedirlo.
    params.define({ id: 'redBlock.vibrate', type: 'float', min: 0, max: 0.8, default: 0, label: 'Vibración (m)', group: 'redBlock' });
    params.define({ id: 'redBlock.vibrateRate', type: 'float', min: 0.5, max: 40, default: 17, label: 'Vibración (Hz)', group: 'redBlock' });
    // TITILEO DE INTENSIDAD: lo que late es el ROJO, no la placa. 0 = brillo fijo; 1 = va de
    // negro a rojo pleno. No es un parpadeo de encendido/apagado (para eso está `box.flicker`,
    // que es una puerta dura): acá el bloque nunca se apaga del todo, respira.
    params.define({ id: 'redBlock.flicker', type: 'float', min: 0, max: 1, default: 0, label: 'Titileo del rojo', group: 'redBlock' });
    params.define({ id: 'redBlock.flickerRate', type: 'float', min: 0.2, max: 30, default: 9, label: 'Titileo (Hz)', group: 'redBlock' });
  }

  constructor(ctx) {
    this.params = ctx.params;
    this.ctx = ctx;
    this.uColor = uniform(new THREE.Color('#B00000'));
    this.uOpacity = uniform(0);
    this.uGain = uniform(1);
    this._color = '';
    this._center = new THREE.Vector3();
  }

  async init(scene) {
    // ÚLTIMO EN DIBUJARSE (renderOrder 1000) pero CON test de profundidad. Esa combinación es
    // la que hace las dos cosas a la vez:
    //  · tapa el piso, porque el piso no escribe profundidad (`depthWrite: false`) y entonces
    //    no puede rechazar al bloque. Antes el bloque se dibujaba PRIMERO y los dashes que
    //    caen más cerca de la cámara le pasaban por encima: correcto en 3D, pero no es lo que
    //    se quiere ver.
    //  · no borra los palitos, porque ellos sí escriben profundidad: los que están delante del
    //    plano del bloque le ganan, los de atrás quedan tapados. Con `depthTest: false` el
    //    bloque tapaba TODO y la masa azul de la 14/15 desaparecía detrás del rojo.
    //
    // Sigue siendo `transparent` porque `redBlock.opacity` tiene que poder fundirlo en las
    // transiciones de escena; con alpha 1 se comporta como un opaco.
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: true, depthTest: true, side: THREE.DoubleSide });
    // El titileo va en el COLOR y no en la opacidad: bajando el alfa el bloque se volvería
    // translúcido y se vería el piso a través, que es justo lo que la quinta vuelta arregló
    // (`renderOrder 1000` con test de profundidad). Bajando el brillo el bloque sigue siendo
    // opaco y lo que cambia es cuánto rojo tira.
    material.colorNode = this.uColor.mul(this.uGain);
    material.opacityNode = this.uOpacity;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.renderOrder = 1000;
    scene.add(this.mesh);
  }

  update(dt) {
    const p = this.params;
    const forces = this.ctx.forces;

    const opacity = p.get('redBlock.opacity') * p.get('layer3d.opacity');
    this.uOpacity.value = opacity;
    this.mesh.visible = opacity > 0.001;

    const sign = p.get('redBlock.side') === 'left' ? -1 : 1;
    const x = sign * p.get('redBlock.x');
    const z = p.get('redBlock.z');
    const height = p.get('redBlock.height');
    const yaw = THREE.MathUtils.degToRad(-sign * p.get('redBlock.yaw'));   // mira hacia el centro
    this._center.set(x, p.get('redBlock.y'), z);

    // Vibración: dos senos de frecuencias que no son múltiplos entre sí, así no se ve el ciclo.
    // Es un temblor de la PLACA, no un parpadeo: el bloque nunca deja de ser rojo pleno.
    this._fase = (this._fase ?? 0) + (dt ?? 0) * p.get('redBlock.vibrateRate') * Math.PI * 2;
    const amp = p.get('redBlock.vibrate');
    const tembX = Math.sin(this._fase) * 0.6 + Math.sin(this._fase * 1.73 + 1.1) * 0.4;
    const tembY = Math.sin(this._fase * 1.31 + 2.4) * 0.5 + Math.sin(this._fase * 2.11) * 0.5;

    // Titileo del rojo. Tres senos de frecuencias que no son múltiplos entre sí —igual que el
    // temblor y que el pulso de la fuerza— para que no se escuche el ciclo; el tercero, mucho más
    // rápido, es el que le da el nervio eléctrico en vez de quedar en un latido de respiración.
    // El piso en 0.12 evita el negro absoluto: un bloque que desaparece del todo se lee como un
    // error de video, no como un bloque que titila.
    const flicker = p.get('redBlock.flicker');
    if (flicker > 0.001) {
      this._faseTit = (this._faseTit ?? 0) + (dt ?? 0) * p.get('redBlock.flickerRate') * Math.PI * 2;
      const t = this._faseTit;
      // BAJONES, no una onda centrada. La primera versión promediaba tres senos y modulaba con
      // eso: matemáticamente llegaba al rojo pleno, pero solo cuando los tres coincidían en el
      // pico — o sea casi nunca, y Manuel lo vio enseguida ("no parece verse con el brillo máximo
      // de rojo"). El bloque vivía a media luz.
      //
      // Ahora el rojo está SIEMPRE al máximo salvo cuando cae un bajón: se rectifica la onda
      // (`max(0, …)`) así la mitad del ciclo vale exactamente 0 y el gain queda clavado en 1, y
      // se eleva al cuadrado para que los bajones sean cortos y secos en vez de un vaivén. Lo que
      // se ve es un rojo pleno que parpadea, no un rojo lavado que respira.
      const onda = Math.sin(t) * 0.6 + Math.sin(t * 1.71 + 0.9) * 0.4;
      const bajon = Math.max(0, onda) ** 2;
      this.uGain.value = 1 - flicker * bajon;
    } else {
      this.uGain.value = 1;
    }

    if (this.mesh.visible) {
      const color = p.get('redBlock.color');
      if (color !== this._color) { this.uColor.value.set(color); this._color = color; }
      // EL TEMBLOR VA LATERAL, en el eje X del mundo. Antes iba perpendicular al bloque, por su
      // normal, que es lo "correcto" en 3D y NO SE VE: el bloque está apenas inclinado (`yaw` 20°),
      // así que su normal es casi todo Z y el temblor se iba en profundidad. Medido sobre cuatro
      // frames seguidos, el borde del bloque se movía 4 px de 2688 con la amplitud en 14 cm — o
      // sea, nada. En X del mundo esos mismos 14 cm son ~45 px y el bloque tiembla de verdad.
      // La componente vertical se queda, a la mitad: mezclada con la lateral el temblor deja de
      // leerse como un deslizamiento y pasa a ser un zumbido.
      this.mesh.position.set(
        this._center.x + amp * tembX,
        this._center.y + amp * tembY * 0.5,
        this._center.z,
      );
      this.mesh.scale.set(p.get('redBlock.width'), height, 1);
      this.mesh.rotation.y = yaw;
    }

    // El atractor vive aunque el plano esté oculto: en 14/15 el bloque se ve, pero
    // la fuerza es un param aparte y puede quedar sola.
    //
    // La fuerza pulsa. Con una fuerza constante la masa llega a la pared y se queda ahí quieta,
    // y no se lee que la esté arrancando nada. Modulándola, la masa embiste, afloja y vuelve a
    // embestir: se ve el forcejeo. Dos senos de frecuencias no múltiplas para que no se
    // escuche el ciclo, igual que el temblor de la placa.
    const pulso = p.get('redBlock.attractPulse');
    this._fasePulso = (this._fasePulso ?? 0) + (dt ?? 0) * p.get('redBlock.attractPulseRate') * Math.PI * 2;
    // Sin clamp a 0: con `attractPulse` > 1 el modulador se va a negativo y la fuerza cambia de
    // signo, que es justamente lo que se busca (el bloque empuja en vez de atraer).
    const mod = 1 + pulso * (Math.sin(this._fasePulso) * 0.6 + Math.sin(this._fasePulso * 1.61 + 0.7) * 0.4);
    const strength = p.get('redBlock.attract') * mod;

    if (Math.abs(strength) > 0.001) {
      // La dirección del empuje es el eje X DE LA PANTALLA, a secas: todo a la izquierda o todo
      // a la derecha.
      //
      // Antes se usaba la normal del plano del bloque, y eso estaba mal: la geometría es un
      // PlaneGeometry (normal +Z, o sea mirando a cámara) al que `redBlock.yaw` le da apenas
      // 20° de inclinación estética. Su normal queda en (sin 20°, 0, cos 20°) ≈ (0.34, 0, 0.94),
      // o sea que el empuje era CASI TODO EN Z: los palitos se iban contra la pared de adelante
      // o la de atrás de la caja en vez de ir hacia el bloque. Eso es lo que se veía.
      this._normal ??= new THREE.Vector3();
      this._normal.set(sign, 0, 0);
      forces.setAttractor(0, this._center, strength, p.get('redBlock.attractRadius'), this._normal, p.get('redBlock.attractDir'));
    } else {
      forces.clearAttractor(0);
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
