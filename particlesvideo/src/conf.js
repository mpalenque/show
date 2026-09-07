import {Pane} from 'tweakpane';
import * as EssentialsPlugin from '@tweakpane/plugin-essentials';
import mobile from "is-mobile";
import * as THREE from "three/webgpu";

class Conf {
    gui = null;
    maxParticles = 8192 * 32;
    particles = 8192 * 32;

    bloom = true;

    run = true;
    noise = 0;
    noiseVariationAmplitude = 1;
    noiseVariationSpeed = 0.5;
    speed = 0.8;
    force = 0;
    containParticles = true;
    stiffness = 3.;
    restDensity = 1.;
    density = 0.4;
    dynamicViscosity = 0.1;
    gravity = 4;
    gravitySensorReading = new THREE.Vector3();
    accelerometerReading = new THREE.Vector3();
    actualSize = 1;
    size = 2;
    particleLength = 0.02;

    points = false;

    // Image/Video parameters
    gridResolution = 80;
    imageScale = 1.0;
    colorMode = 0; // 0: image-only, 1: image+density, 2: image+velocity
    videoPlaybackSpeed = 1.0;
    particleLifetime = 5.0;
    emissionBatchSize = 128;
    emissionInterval = 0.15;
    emitFullGrid = true;
    emissionVelocity = 0.35;
    emissionDirectionX = 0;
    emissionDirectionY = 0;
    emissionDirectionZ = -1;
    showSourceImage = true;
    sourceImageOpacity = 1;
    minimumParticleBrightness = 0.12;
    useImageEmission = true;
    imageSourceType = 'none'; // 'none', 'image', 'video'

    constructor(info) {
        if (mobile()) {
            this.maxParticles = 8192 * 16;
            this.particles = 4096;
        }
        this.updateParams();

    }

    updateParams() {
        const level = Math.max(this.particles / 8192,1);
        const size = 1.6/Math.pow(level, 1/3);
        this.actualSize = size * this.size;
        this.restDensity = 0.25 * level * this.density;
    }

    setupGravitySensor() {
        if (this.gravitySensor) { return; }
        this.gravitySensor = new GravitySensor({ frequency: 60 });
        this.gravitySensor.addEventListener("reading", (e) => {
            this.gravitySensorReading.copy(this.gravitySensor).divideScalar(50);
            this.gravitySensorReading.setY(this.gravitySensorReading.y * -1);
        });
        this.gravitySensor.start();
    }

    init() {
        const gui = new Pane({ container: document.getElementById('settings-panel') })
        gui.registerPlugin(EssentialsPlugin);

        const stats = gui.addFolder({
            title: "stats",
            expanded: false,
        });
        this.fpsGraph = stats.addBlade({
            view: 'fpsgraph',
            label: 'fps',
            rows: 2,
        });

        const settings = gui.addFolder({
            title: "settings",
            expanded: true,
        });
        settings.addBinding(this, "particles", { min: 4096, max: this.maxParticles, step: 4096 }).on('change', () => { this.updateParams(); });
        settings.addBinding(this, "size", { min: 0.5, max: 6, step: 0.1 }).on('change', () => { this.updateParams(); });
        settings.addBinding(this, "particleLength", { label: "particle length", min: 0.02, max: 4, step: 0.01 });
        settings.addBinding(this, "bloom");
        //settings.addBinding(this, "points");

        const simulation = settings.addFolder({
            title: "simulation",
            expanded: true,
        });
        simulation.addBinding(this, "run");
        simulation.addBinding(this, "noise", { min: 0, max: 2, step: 0.01 });
        simulation.addBinding(this, "noiseVariationAmplitude", { label: "noise variation amplitude", min: 0, max: 4, step: 0.01 });
        simulation.addBinding(this, "noiseVariationSpeed", { label: "noise variation speed", min: 0, max: 4, step: 0.01 });
        simulation.addBinding(this, "speed", { min: 0, max: 2, step: 0.1 });
        simulation.addBinding(this, "force", { min: 0, max: 4, step: 0.05 });
        simulation.addBinding(this, "containParticles", { label: "contain particles" });
        simulation.addBlade({
            view: 'list',
            label: 'gravity',
            options: [
                {text: 'none', value: 4},
                {text: 'back', value: 0},
                {text: 'down', value: 1},
                {text: 'center', value: 2},
                {text: 'device gravity', value: 3},
            ],
            value: this.gravity,
        }).on('change', (ev) => {
            if (ev.value === 3) {
                this.setupGravitySensor();
            }
            this.gravity = ev.value;
        });
        simulation.addBinding(this, "density", { min: 0.4, max: 2, step: 0.1 }).on('change', () => { this.updateParams(); });;
        /*simulation.addBinding(this, "stiffness", { min: 0.5, max: 10, step: 0.1 });
        simulation.addBinding(this, "restDensity", { min: 0.5, max: 10, step: 0.1 });
        simulation.addBinding(this, "dynamicViscosity", { min: 0.01, max: 0.4, step: 0.01 });*/

        /*settings.addBinding(this, "roughness", { min: 0.0, max: 1, step: 0.01 });
        settings.addBinding(this, "metalness", { min: 0.0, max: 1, step: 0.01 });*/

        // Image/Video Emission Controls
        const imageFolder = settings.addFolder({
            title: "Image/Video Source",
            expanded: true,
        });
        imageFolder.addBinding(this, "useImageEmission");
        imageFolder.addBinding(this, "gridResolution", { min: 8, max: 256, step: 8 });
        imageFolder.addBinding(this, "imageScale", { min: 0.1, max: 1, step: 0.05 });
        imageFolder.addBinding(this, "emissionBatchSize", { min: 1, max: this.maxParticles, step: 1 });
        imageFolder.addBinding(this, "emissionInterval", { min: 0.01, max: 5, step: 0.01 });
        imageFolder.addBinding(this, "emitFullGrid");
        imageFolder.addBinding(this, "particleLifetime", { min: 0.5, max: 15, step: 0.5 });
        imageFolder.addBinding(this, "emissionVelocity", { min: 0, max: 3, step: 0.05 });
        imageFolder.addBinding(this, "emissionDirectionX", { label: "direction X", min: -1, max: 1, step: 0.05 });
        imageFolder.addBinding(this, "emissionDirectionY", { label: "direction Y", min: -1, max: 1, step: 0.05 });
        imageFolder.addBinding(this, "emissionDirectionZ", { label: "direction Z (- camera)", min: -1, max: 1, step: 0.05 });
        imageFolder.addBinding(this, "showSourceImage");
        imageFolder.addBinding(this, "sourceImageOpacity", { min: 0, max: 1, step: 0.05 });
        imageFolder.addBinding(this, "minimumParticleBrightness", { label: "minimum brightness", min: 0, max: 0.5, step: 0.01 });
        imageFolder.addBlade({
            view: 'list',
            label: 'color mode',
            options: [
                {text: 'image only', value: 0},
                {text: 'image + density', value: 1},
                {text: 'image + velocity', value: 2},
            ],
            value: 0,
        }).on('change', (ev) => {
            this.colorMode = ev.value;
        });
        imageFolder.addBinding(this, "videoPlaybackSpeed", { min: 0.1, max: 2, step: 0.1 });
        this.gui = gui;
    }

    update() {
    }

    begin() {
        this.fpsGraph.begin();
    }
    end() {
        this.fpsGraph.end();
    }
}
export const conf = new Conf();