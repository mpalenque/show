import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import hdri from './assets/autumn_field_puresky_1k.hdr';

import { conf } from './conf';
import MediaSource, { PANEL_WIDTH, PANEL_HEIGHT } from './mediaSource';
import PolyMesh, { WALL_Z } from './polyMesh';
import Frame from './frame';
import { Lights } from './lights';
import PostFx from './postfx';
import { retopologize } from './retopologizer';
import { Plasma } from './analysis/plasma';

const TONE_MAPPING = {
    aces: THREE.ACESFilmicToneMapping,
    neutral: THREE.NeutralToneMapping,
    agx: THREE.AgXToneMapping,
    none: THREE.NoToneMapping,
};

const loadHdr = (file) => new Promise((resolve) => {
    new RGBELoader().load(file, (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        resolve(texture);
    });
});

class App {
    constructor(renderer) {
        this.renderer = renderer;
        this.topoVersion = -1;
        this.lastRebuild = -1e9;
        this.rebuildMs = 0;
    }

    async init(progress) {
        conf.init();

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);

        this.camera = new THREE.PerspectiveCamera(conf.fov, window.innerWidth / window.innerHeight, 0.1, 60);
        this.camera.position.set(0, PANEL_HEIGHT * 0.5, WALL_Z - 9);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.target.set(0, PANEL_HEIGHT * 0.5, WALL_Z);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.minDistance = 1.5;
        this.controls.maxDistance = 30;
        this.controls.minPolarAngle = 0.12 * Math.PI;
        this.controls.maxPolarAngle = 0.88 * Math.PI;
        this.controls.minAzimuthAngle = 0.6 * Math.PI;
        this.controls.maxAzimuthAngle = 1.4 * Math.PI;
        // as soon as the user frames the shot by hand we stop auto fitting
        this.userFramed = false;
        this.controls.addEventListener('start', () => { this.userFramed = true; });

        await progress(0.15);

        const hdriTexture = await loadHdr(hdri);
        this.scene.environment = hdriTexture;
        this.scene.environmentRotation = new THREE.Euler(0, -2.15, 0);
        this.scene.environmentIntensity = conf.envIntensity;

        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = conf.toneExposure;

        await progress(0.45);

        this.media = new MediaSource();
        this.media.initUI();

        // procedural control texture, shared by the analysis and the gpu mask
        this.plasma = new Plasma();
        this.plasma.sync(conf);
        this.plasmaTexture = new THREE.DataTexture(
            this.plasma.bytes, this.plasma.width, this.plasma.height,
            THREE.RGBAFormat, THREE.UnsignedByteType,
        );
        this.plasmaTexture.minFilter = THREE.NearestFilter;
        this.plasmaTexture.magFilter = THREE.NearestFilter;
        this.plasmaTexture.wrapS = THREE.RepeatWrapping;
        this.plasmaTexture.wrapT = THREE.RepeatWrapping;
        this.plasmaTexture.generateMipmaps = false;
        this.plasmaTexture.needsUpdate = true;
        // same bytes, but tagged as sRGB and filtered, just for the on screen preview
        this.plasmaPreview = new THREE.DataTexture(
            this.plasma.bytes, this.plasma.width, this.plasma.height,
            THREE.RGBAFormat, THREE.UnsignedByteType,
        );
        this.plasmaPreview.colorSpace = THREE.SRGBColorSpace;
        this.plasmaPreview.minFilter = THREE.LinearFilter;
        this.plasmaPreview.magFilter = THREE.LinearFilter;
        this.plasmaPreview.generateMipmaps = false;
        this.plasmaPreview.needsUpdate = true;

        this.polyMesh = new PolyMesh(this.media.texture, this.plasmaTexture);
        this.scene.add(this.polyMesh.object);

        // low res preview of the framed source, right against the wall
        this.backdrop = new THREE.Mesh(
            new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT),
            new THREE.MeshBasicNodeMaterial({
                map: this.media.texture,
                transparent: true,
                toneMapped: false,
                depthWrite: false,
            }),
        );
        this.backdrop.position.set(0, PANEL_HEIGHT * 0.5, WALL_Z - 0.006);
        this.backdrop.rotation.y = Math.PI;
        this.backdrop.visible = false;
        this.scene.add(this.backdrop);

        this.frame = new Frame();
        await this.frame.init(hdriTexture);
        this.scene.add(this.frame.object);

        this.lights = new Lights();
        this.scene.add(this.lights.object);

        await progress(0.8);

        this.postFx = new PostFx(this.renderer, this.scene, this.camera);
        conf.onAoResolutionChange = () => this.postFx.setAoResolution(conf.aoResolutionScale);

        this.media.onLoaded = () => { conf.bumpTopology(); };

        // handy for scripting / automation from the console
        window.conf = conf;
        window.app = this;

        this.fitCamera();
        await progress(1.0, 120);
    }

    fitCamera(keepDirection = true) {
        const aspect = Math.max(0.2, this.camera.aspect);
        const vFov = THREE.MathUtils.degToRad(conf.fov);
        const halfH = PANEL_HEIGHT * 0.5 * conf.fitPadding;
        const halfW = PANEL_WIDTH * 0.5 * conf.fitPadding;
        // frame the *front* plane of the relief so the polygons never spill out
        // of the viewport when the extrusion grows
        const relief = conf.baseOffset + conf.extrude + conf.wobble;
        const dist = Math.max(halfH / Math.tan(vFov * 0.5), halfW / (Math.tan(vFov * 0.5) * aspect)) + relief;
        const target = new THREE.Vector3(0, PANEL_HEIGHT * 0.5, WALL_Z);
        let dir = new THREE.Vector3(0, 0, -1);
        if (keepDirection) {
            dir.subVectors(this.camera.position, this.controls.target);
            if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
            dir.normalize();
        }
        this.controls.target.copy(target);
        this.camera.position.copy(target).addScaledVector(dir, dist);
        this.camera.updateProjectionMatrix();
    }

    resize(width, height) {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        if (!this.userFramed) this.fitCamera();
    }

    retopologize() {
        if (!this.media.pixels) return;
        const t0 = performance.now();
        const topo = retopologize(this.media.pixels, this.media.canvas.width, this.media.canvas.height, this.plasma);
        this.polyMesh.rebuild(topo);
        this.rebuildMs = performance.now() - t0;
        conf.setPlateInfo(`${conf.plateInfo} · ${this.rebuildMs.toFixed(0)}ms`);
    }

    async update(delta, elapsed) {
        conf.begin();
        conf.time = elapsed;

        if (conf.resetView) {
            conf.resetView = false;
            this.userFramed = false;
            this.fitCamera(false);
        }
        if (this.camera.fov !== conf.fov) {
            this.camera.fov = conf.fov;
            this.fitCamera();
        }
        const reliefDepth = conf.baseOffset + conf.extrude + conf.wobble;
        if (this._reliefDepth === undefined || Math.abs(this._reliefDepth - reliefDepth) > 0.001) {
            this._reliefDepth = reliefDepth;
            if (!this.userFramed) this.fitCamera();
        }
        if (Math.abs(conf.autoOrbit) > 1e-4) {
            const angle = conf.autoOrbit * delta;
            const offset = this.camera.position.clone().sub(this.controls.target);
            offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
            this.camera.position.copy(this.controls.target).add(offset);
        }
        this.controls.update(delta);

        this.renderer.toneMapping = TONE_MAPPING[conf.toneMapping] ?? THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = conf.toneExposure;
        this.scene.environmentIntensity = conf.envIntensity;

        if (this.plasma.sync(conf)) {
            this.plasmaTexture.needsUpdate = true;
            this.plasmaPreview.needsUpdate = true;
        }

        this.lights.update();
        this.frame.update();
        this.polyMesh.syncUniforms();

        // ------------------------------------------------ source -> polygons
        const structureDirty = conf.topoVersion !== this.topoVersion;
        const autoDue = conf.autoRebuild && this.media.isVideo
            && (elapsed - this.lastRebuild) > 1 / Math.max(0.25, conf.rebuildFps);
        // dragging a topology slider fires on every step: wait until it settles
        // so we never queue up a dozen full analyses in a row
        const settled = (performance.now() - conf.topoStamp) > 140;

        if (this.media.needsGrab() || structureDirty) {
            const frame = this.media.grab();
            if (frame) {
                if ((structureDirty && settled) || autoDue || !this.polyMesh.topo) {
                    this.topoVersion = conf.topoVersion;
                    this.lastRebuild = elapsed;
                    this.retopologize();
                }
                this.polyMesh.updateFromPixels(frame.pixels);
            }
        }

        // "show texture" replaces the relief with the raw control texture so it can
        // be calibrated; otherwise the backdrop is the source image reference that
        // sits right behind the polygons
        const backdropMap = conf.showPlasma ? this.plasmaPreview : this.media.texture;
        if (this.backdrop.material.map !== backdropMap) {
            this.backdrop.material.map = backdropMap;
            this.backdrop.material.needsUpdate = true;
        }
        this.backdrop.visible = (conf.showSource || conf.showPlasma) && (this.media.ready || conf.showPlasma);
        this.backdrop.material.opacity = conf.showPlasma ? 1 : conf.sourceOpacity;
        if (conf.showPlasma) this.polyMesh.object.visible = false;

        if (conf.postFx) {
            this.postFx.update();
            await this.postFx.render();
        } else {
            await this.renderer.renderAsync(this.scene, this.camera);
        }

        conf.end();
    }
}

export default App;
