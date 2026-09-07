import { Pane } from 'tweakpane';
import * as EssentialsPlugin from '@tweakpane/plugin-essentials';

/**
 * Every knob of the retopology pipeline lives here.
 *
 * Parameters are split in two families:
 *  - structural ones (how the image is cut into polygons). Changing them bumps
 *    `topoVersion`, which makes the app re-run the Voronoi/Delaunay analysis.
 *  - live ones (relief, color, material, lighting, post). Those are pushed into
 *    TSL uniforms every frame, so they are free to drag around in realtime.
 */
class Conf {
    // ----------------------------------------------------------------- morph
    morph = 1;              // 0 = plain image, 1 = full polygon relief
    flatten = 1;            // how flat the colour of each polygon becomes
    shadeOnset = 0.3;       // where along the morph the 3d shading takes over
    time = 0;

    // ------------------------------------------------------------- selection
    shapeMode = 'off';      // off | radial | linear | both
    shapeAmount = 1;
    maskX = 0.5;
    maskY = 0.5;
    maskRadius = 0.3;
    maskSoftness = 0.15;
    maskAngle = 0;
    maskPosition = 0.5;
    maskInvert = false;
    maskAnim = 0;
    maskAnimSpeed = 0.5;
    maskFloor = 0;
    lumAmount = 0;
    lumMin = 0.15;
    lumMax = 1;
    lumSoftness = 0.15;
    hueAmount = 0;
    hueTarget = 30;
    hueWidth = 0.25;
    hueSoftness = 0.08;
    satMin = 0.15;

    // ------------------------------------------------- control texture (plasma)
    plasmaBase = 8;             // lattice of the first octave (bigger = smaller blobs)
    plasmaOctaves = 5;
    plasmaGain = 0.55;
    plasmaWarp = 0.35;
    plasmaGradient = 0;
    plasmaGradientAngle = 0;
    plasmaContrast = 1.2;
    plasmaInvert = false;
    plasmaSeed = 1;
    plasmaScale = 1;
    plasmaOffsetX = 0;
    plasmaOffsetY = 0;
    plasmaAnimSpeed = 0;
    plasmaDensity = 0;          // how much it drives polygon sizes (rebuild)
    plasmaMask = 0;             // how much it drives where the relief applies (live)
    plasmaThreshold = 0.5;
    plasmaSoftness = 0.15;
    plasmaMaskInvert = false;
    showPlasma = false;

    // ---------------------------------------------------------------- source
    fit = 'cover';
    zoom = 1;
    offsetX = 0;
    offsetY = 0;
    mirror = false;
    showSource = false;
    sourceOpacity = 0.35;
    analysisRes = 512;
    preBlur = 1.0;

    // -------------------------------------------------------------- topology
    mode = 'triangles';         // 'triangles' = Delaunay, 'cells' = Voronoi
    sites = 2200;
    sizeVariation = 1.5;        // spread of polygon sizes (0 = all equal)
    edgeInfluence = 0.75;       // how much image detail attracts polygons
    edgeGamma = 0.8;
    darkBias = 0;
    borderPoints = 48;
    relaxIterations = 3;        // weighted Lloyd relaxation over Voronoi cells
    relaxStrength = 1;
    seed = 1;
    autoRebuild = false;
    rebuildFps = 4;

    // ---------------------------------------------------------------- relief
    extrude = 0.7;
    depthGamma = 1.0;
    invertDepth = false;
    baseOffset = 0.02;
    separation = 0.5;           // 0 = continuous crumpled surface, 1 = loose facets
    shrink = 0.014;             // gap between neighbour polygons
    thickness = 0.08;
    rootToWall = 1;             // 1 = polygons are prisms growing out of the wall
    jitter = 0;
    wobble = 0;
    wobbleSpeed = 0.5;
    solid = true;               // build side walls + back faces

    // ----------------------------------------------------------------- color
    exposure = 1;
    saturation = 1.05;
    contrast = 1.05;
    gradeGamma = 1;
    quantize = 0;
    sideDarken = 0.55;
    backDarken = 0.2;
    depthShade = 0.25;
    emissive = 0;

    // -------------------------------------------------------------- material
    roughness = 0.62;
    metalness = 0;
    roughnessByLum = 0.25;
    envIntensity = 0.45;

    // ------------------------------------------------------------------ light
    keyIntensity = 2.0;
    keyX = -3.2;
    keyY = 5.2;
    keyZ = -4.0;
    fillIntensity = 0.7;
    rimIntensity = 0.9;
    ambient = 0.12;
    shadows = true;

    // ------------------------------------------------------------------- post
    postFx = true;
    aoStrength = 1;
    aoRadius = 0.12;
    aoDistanceExponent = 1.4;
    aoThickness = 0.35;
    aoScale = 1.2;
    aoSamples = 16;
    aoResolutionScale = 1;
    aoDenoise = 1;
    aoDenoiseRadius = 5;
    bloomStrength = 0.22;
    bloomThreshold = 0.85;
    bloomRadius = 0.5;
    toneExposure = 1;
    toneMapping = 'aces';

    // ------------------------------------------------------------------ frame
    frameVisible = true;
    frameFollowRelief = true;
    frameWidth = 0.2;
    frameDepth = 0.55;
    frameBrightness = 0.05;

    // ------------------------------------------------------------------- view
    fitPadding = 1.03;
    fov = 45;
    autoOrbit = 0;
    wireframe = false;

    // ---------------------------------------------------------------- runtime
    topoVersion = 0;            // bumped whenever the polygon layout must change
    resetView = false;
    plateInfo = '-';

    constructor() {
        this.gui = null;
        this.fpsGraph = null;
        this.topoStamp = 0;
        this.onAoResolutionChange = null;
    }

    bumpTopology() {
        this.topoVersion++;
        this.topoStamp = (typeof performance !== 'undefined' ? performance.now() : 0);
    }

    init() {
        const gui = new Pane({ container: document.getElementById('settings-panel') });
        gui.registerPlugin(EssentialsPlugin);
        this.gui = gui;

        const stats = gui.addFolder({ title: 'stats', expanded: false });
        this.fpsGraph = stats.addBlade({ view: 'fpsgraph', label: 'fps', rows: 2 });
        stats.addBinding(this, 'plateInfo', { label: 'polygons', readonly: true });

        const bump = () => { this.bumpTopology(); };

        // -- morph ----------------------------------------------------------
        const morph = gui.addFolder({ title: '0 · morph', expanded: true });
        morph.addBinding(this, 'morph', { label: 'polygonize', min: 0, max: 1, step: 0.005 });
        morph.addBinding(this, 'extrude', { label: 'extrude Z', min: 0, max: 3, step: 0.01 });
        morph.addBinding(this, 'flatten', { label: 'flatten colour', min: 0, max: 1, step: 0.01 });
        morph.addBinding(this, 'shadeOnset', { label: 'shading onset', min: 0.02, max: 1, step: 0.01 });

        // -- selection ------------------------------------------------------
        const sel = gui.addFolder({ title: '0b · where it applies', expanded: true });
        sel.addBinding(this, 'maskFloor', { label: 'base everywhere', min: 0, max: 1, step: 0.01 });
        sel.addBlade({
            view: 'list',
            label: 'shape mask',
            options: [
                { text: 'off', value: 'off' },
                { text: 'radial', value: 'radial' },
                { text: 'linear sweep', value: 'linear' },
                { text: 'radial × linear', value: 'both' },
            ],
            value: this.shapeMode,
        }).on('change', (ev) => { this.shapeMode = ev.value; });
        sel.addBinding(this, 'shapeAmount', { label: 'shape amount', min: 0, max: 1, step: 0.01 });
        sel.addBinding(this, 'maskX', { label: 'center x', min: -0.5, max: 1.5, step: 0.01 });
        sel.addBinding(this, 'maskY', { label: 'center y', min: -0.5, max: 1.5, step: 0.01 });
        sel.addBinding(this, 'maskRadius', { label: 'radius', min: 0, max: 1.2, step: 0.01 });
        sel.addBinding(this, 'maskAngle', { label: 'sweep angle', min: 0, max: 360, step: 1 });
        sel.addBinding(this, 'maskPosition', { label: 'sweep position', min: -0.6, max: 1.6, step: 0.01 });
        sel.addBinding(this, 'maskSoftness', { label: 'softness', min: 0.001, max: 1, step: 0.005 });
        sel.addBinding(this, 'maskInvert', { label: 'invert' });
        sel.addBinding(this, 'maskAnim', { label: 'animate', min: 0, max: 1, step: 0.01 });
        sel.addBinding(this, 'maskAnimSpeed', { label: 'animate speed', min: 0, max: 3, step: 0.01 });

        const byLum = sel.addFolder({ title: 'by brightness', expanded: false });
        byLum.addBinding(this, 'lumAmount', { label: 'amount', min: 0, max: 1, step: 0.01 });
        byLum.addBinding(this, 'lumMin', { label: 'from', min: -0.2, max: 1.2, step: 0.01 });
        byLum.addBinding(this, 'lumMax', { label: 'to', min: -0.2, max: 1.2, step: 0.01 });
        byLum.addBinding(this, 'lumSoftness', { label: 'softness', min: 0.001, max: 0.6, step: 0.005 });

        const byHue = sel.addFolder({ title: 'by colour (hue)', expanded: false });
        byHue.addBinding(this, 'hueAmount', { label: 'amount', min: 0, max: 1, step: 0.01 });
        byHue.addBinding(this, 'hueTarget', { label: 'hue °', min: 0, max: 360, step: 1 });
        byHue.addBinding(this, 'hueWidth', { label: 'width', min: 0.01, max: 1.2, step: 0.01 });
        byHue.addBinding(this, 'hueSoftness', { label: 'softness', min: 0.001, max: 0.5, step: 0.005 });
        byHue.addBinding(this, 'satMin', { label: 'min saturation', min: -0.1, max: 1, step: 0.01 });

        const plasma = sel.addFolder({ title: 'by control texture (plasma)', expanded: false });
        plasma.addBinding(this, 'plasmaMask', { label: 'amount (mask)', min: 0, max: 1, step: 0.01 });
        plasma.addBinding(this, 'plasmaDensity', { label: 'amount (sizes)', min: 0, max: 1, step: 0.01 }).on('change', bump);
        plasma.addBinding(this, 'plasmaThreshold', { label: 'threshold', min: 0, max: 1, step: 0.01 });
        plasma.addBinding(this, 'plasmaSoftness', { label: 'softness', min: 0.001, max: 0.6, step: 0.005 });
        plasma.addBinding(this, 'plasmaMaskInvert', { label: 'invert mask' });
        plasma.addBinding(this, 'plasmaScale', { label: 'scale', min: 0.1, max: 6, step: 0.05 }).on('change', bump);
        plasma.addBinding(this, 'plasmaOffsetX', { label: 'offset x', min: -2, max: 2, step: 0.01 }).on('change', bump);
        plasma.addBinding(this, 'plasmaOffsetY', { label: 'offset y', min: -2, max: 2, step: 0.01 }).on('change', bump);
        plasma.addBinding(this, 'plasmaAnimSpeed', { label: 'drift speed', min: 0, max: 4, step: 0.01 });
        plasma.addBinding(this, 'plasmaBase', { label: 'blob size', min: 2, max: 32, step: 1 }).on('change', bump);
        plasma.addBinding(this, 'plasmaOctaves', { label: 'octaves', min: 1, max: 8, step: 1 }).on('change', bump);
        plasma.addBinding(this, 'plasmaGain', { label: 'roughness', min: 0.2, max: 0.85, step: 0.01 }).on('change', bump);
        plasma.addBinding(this, 'plasmaWarp', { label: 'warp', min: 0, max: 1.5, step: 0.01 }).on('change', bump);
        plasma.addBinding(this, 'plasmaContrast', { label: 'contrast', min: 0.2, max: 4, step: 0.05 }).on('change', bump);
        plasma.addBinding(this, 'plasmaGradient', { label: 'gradient mix', min: 0, max: 1, step: 0.01 }).on('change', bump);
        plasma.addBinding(this, 'plasmaGradientAngle', { label: 'gradient angle', min: 0, max: 360, step: 1 }).on('change', bump);
        plasma.addBinding(this, 'plasmaInvert', { label: 'invert texture' }).on('change', bump);
        plasma.addBinding(this, 'plasmaSeed', { label: 'seed', min: 1, max: 999, step: 1 }).on('change', bump);
        plasma.addBinding(this, 'showPlasma', { label: 'show texture' });

        // -- topology -------------------------------------------------------
        const topo = gui.addFolder({ title: '1 · polygonization', expanded: true });
        topo.addBlade({
            view: 'list',
            label: 'mode',
            options: [
                { text: 'delaunay triangles', value: 'triangles' },
                { text: 'voronoi cells', value: 'cells' },
            ],
            value: this.mode,
        }).on('change', (ev) => { this.mode = ev.value; bump(); });
        topo.addBinding(this, 'sites', { min: 100, max: 12000, step: 50 }).on('change', bump);
        topo.addBinding(this, 'sizeVariation', { label: 'size variation', min: 0, max: 4, step: 0.05 }).on('change', bump);
        topo.addBinding(this, 'edgeInfluence', { label: 'edge attraction', min: 0, max: 1, step: 0.01 }).on('change', bump);
        topo.addBinding(this, 'edgeGamma', { label: 'edge gamma', min: 0.2, max: 3, step: 0.05 }).on('change', bump);
        topo.addBinding(this, 'darkBias', { label: 'dark attraction', min: 0, max: 1, step: 0.01 }).on('change', bump);
        topo.addBinding(this, 'relaxIterations', { label: 'lloyd iterations', min: 0, max: 12, step: 1 }).on('change', bump);
        topo.addBinding(this, 'relaxStrength', { label: 'lloyd strength', min: 0, max: 1, step: 0.01 }).on('change', bump);
        topo.addBinding(this, 'borderPoints', { label: 'border points', min: 0, max: 200, step: 2 }).on('change', bump);
        topo.addBinding(this, 'analysisRes', { label: 'analysis width', min: 128, max: 1024, step: 32 }).on('change', bump);
        topo.addBinding(this, 'preBlur', { label: 'pre blur (px)', min: 0, max: 8, step: 0.25 }).on('change', bump);
        topo.addBinding(this, 'seed', { min: 1, max: 9999, step: 1 }).on('change', bump);
        topo.addBinding(this, 'solid', { label: 'solid (sides+back)' }).on('change', bump);
        topo.addButton({ title: 'retopologize now' }).on('click', bump);
        topo.addBinding(this, 'autoRebuild', { label: 'auto (video)' });
        topo.addBinding(this, 'rebuildFps', { label: 'auto rate (hz)', min: 0.25, max: 30, step: 0.25 });

        // -- relief ---------------------------------------------------------
        const relief = gui.addFolder({ title: '2 · relief (Z)', expanded: true });
        relief.addBinding(this, 'depthGamma', { label: 'depth gamma', min: 0.2, max: 4, step: 0.05 });
        relief.addBinding(this, 'invertDepth', { label: 'invert' });
        relief.addBinding(this, 'separation', { label: 'smooth→flat→loose', min: 0, max: 1, step: 0.01 });
        relief.addBinding(this, 'shrink', { label: 'gap', min: 0, max: 0.4, step: 0.005 });
        relief.addBinding(this, 'thickness', { min: 0, max: 1, step: 0.01 });
        relief.addBinding(this, 'rootToWall', { label: 'root to wall', min: 0, max: 1, step: 0.01 });
        relief.addBinding(this, 'baseOffset', { label: 'lift', min: -0.5, max: 1, step: 0.01 });
        relief.addBinding(this, 'jitter', { label: 'random jitter', min: 0, max: 1, step: 0.01 });
        relief.addBinding(this, 'wobble', { min: 0, max: 0.5, step: 0.005 });
        relief.addBinding(this, 'wobbleSpeed', { label: 'wobble speed', min: 0, max: 4, step: 0.05 });

        // -- color ----------------------------------------------------------
        const color = gui.addFolder({ title: '3 · color', expanded: false });
        color.addBinding(this, 'exposure', { min: 0, max: 3, step: 0.01 });
        color.addBinding(this, 'saturation', { min: 0, max: 2, step: 0.01 });
        color.addBinding(this, 'contrast', { min: 0.2, max: 2.5, step: 0.01 });
        color.addBinding(this, 'gradeGamma', { label: 'gamma', min: 0.2, max: 3, step: 0.01 });
        color.addBinding(this, 'quantize', { label: 'posterize', min: 0, max: 32, step: 1 });
        color.addBinding(this, 'sideDarken', { label: 'side shade', min: 0, max: 1, step: 0.01 });
        color.addBinding(this, 'backDarken', { label: 'back shade', min: 0, max: 1, step: 0.01 });
        color.addBinding(this, 'depthShade', { label: 'depth shade', min: 0, max: 1, step: 0.01 });
        color.addBinding(this, 'emissive', { min: 0, max: 2, step: 0.01 });

        // -- material -------------------------------------------------------
        const mat = gui.addFolder({ title: '4 · material', expanded: false });
        mat.addBinding(this, 'roughness', { min: 0.02, max: 1, step: 0.01 });
        mat.addBinding(this, 'roughnessByLum', { label: 'rough by lum', min: -1, max: 1, step: 0.01 });
        mat.addBinding(this, 'metalness', { min: 0, max: 1, step: 0.01 });
        mat.addBinding(this, 'envIntensity', { label: 'env light', min: 0, max: 2, step: 0.01 });
        mat.addBinding(this, 'wireframe');

        // -- lighting -------------------------------------------------------
        const light = gui.addFolder({ title: '5 · lighting', expanded: false });
        light.addBinding(this, 'keyIntensity', { label: 'key', min: 0, max: 10, step: 0.05 });
        light.addBinding(this, 'keyX', { label: 'key x', min: -10, max: 10, step: 0.1 });
        light.addBinding(this, 'keyY', { label: 'key y', min: -6, max: 12, step: 0.1 });
        light.addBinding(this, 'keyZ', { label: 'key z', min: -10, max: 6, step: 0.1 });
        light.addBinding(this, 'fillIntensity', { label: 'fill', min: 0, max: 6, step: 0.05 });
        light.addBinding(this, 'rimIntensity', { label: 'rim (grazing)', min: 0, max: 6, step: 0.05 });
        light.addBinding(this, 'ambient', { min: 0, max: 1, step: 0.01 });
        light.addBinding(this, 'shadows');

        // -- post -----------------------------------------------------------
        const post = gui.addFolder({ title: '6 · ambient occlusion & post', expanded: true });
        post.addBinding(this, 'postFx', { label: 'post pipeline' });
        post.addBinding(this, 'aoStrength', { label: 'AO strength', min: 0, max: 2, step: 0.01 });
        post.addBinding(this, 'aoRadius', { label: 'AO radius', min: 0.01, max: 1, step: 0.005 });
        post.addBinding(this, 'aoDistanceExponent', { label: 'AO falloff', min: 0.2, max: 4, step: 0.05 });
        post.addBinding(this, 'aoThickness', { label: 'AO thickness', min: 0.02, max: 2, step: 0.01 });
        post.addBinding(this, 'aoScale', { label: 'AO contrast', min: 0.2, max: 4, step: 0.05 });
        post.addBinding(this, 'aoSamples', { label: 'AO samples', min: 4, max: 64, step: 1 });
        post.addBinding(this, 'aoDenoise', { label: 'AO denoise', min: 0, max: 1, step: 0.01 });
        post.addBinding(this, 'aoDenoiseRadius', { label: 'denoise radius', min: 1, max: 12, step: 0.5 });
        post.addBinding(this, 'aoResolutionScale', { label: 'AO resolution', min: 0.25, max: 1, step: 0.25 })
            .on('change', () => { if (this.onAoResolutionChange) this.onAoResolutionChange(); });
        post.addBinding(this, 'bloomStrength', { label: 'bloom', min: 0, max: 2, step: 0.01 });
        post.addBinding(this, 'bloomThreshold', { label: 'bloom threshold', min: 0, max: 2, step: 0.01 });
        post.addBinding(this, 'bloomRadius', { label: 'bloom radius', min: 0, max: 1, step: 0.01 });
        post.addBinding(this, 'toneExposure', { label: 'exposure', min: 0.1, max: 3, step: 0.01 });
        post.addBlade({
            view: 'list',
            label: 'tone map',
            options: [
                { text: 'aces filmic', value: 'aces' },
                { text: 'neutral', value: 'neutral' },
                { text: 'agx', value: 'agx' },
                { text: 'none', value: 'none' },
            ],
            value: this.toneMapping,
        }).on('change', (ev) => { this.toneMapping = ev.value; });

        // -- framing --------------------------------------------------------
        const view = gui.addFolder({ title: '7 · framing', expanded: false });
        view.addBlade({
            view: 'list',
            label: 'fit',
            options: [{ text: 'cover', value: 'cover' }, { text: 'contain', value: 'contain' }],
            value: this.fit,
        }).on('change', (ev) => { this.fit = ev.value; bump(); });
        view.addBinding(this, 'zoom', { min: 0.25, max: 4, step: 0.01 }).on('change', bump);
        view.addBinding(this, 'offsetX', { label: 'offset x', min: -1, max: 1, step: 0.01 }).on('change', bump);
        view.addBinding(this, 'offsetY', { label: 'offset y', min: -1, max: 1, step: 0.01 }).on('change', bump);
        view.addBinding(this, 'mirror').on('change', bump);
        view.addBinding(this, 'showSource', { label: 'show source' });
        view.addBinding(this, 'sourceOpacity', { label: 'source opacity', min: 0, max: 1, step: 0.01 });
        view.addBinding(this, 'frameVisible', { label: 'frame' });
        view.addBinding(this, 'frameWidth', { label: 'frame width', min: 0, max: 1, step: 0.01 });
        view.addBinding(this, 'frameFollowRelief', { label: 'frame ≥ relief' });
        view.addBinding(this, 'frameDepth', { label: 'frame depth', min: 0.05, max: 2, step: 0.01 });
        view.addBinding(this, 'frameBrightness', { label: 'frame value', min: 0, max: 1, step: 0.01 });
        view.addBinding(this, 'fov', { min: 20, max: 90, step: 1 });
        view.addBinding(this, 'fitPadding', { label: 'fit padding', min: 0.8, max: 2, step: 0.01 });
        view.addBinding(this, 'autoOrbit', { label: 'auto orbit', min: -0.5, max: 0.5, step: 0.005 });
        view.addButton({ title: 'reset camera' }).on('click', () => { this.resetView = true; });
    }

    setPlateInfo(text) {
        this.plateInfo = text;
        if (this.gui) this.gui.refresh();
    }

    begin() { if (this.fpsGraph) this.fpsGraph.begin(); }
    end() { if (this.fpsGraph) this.fpsGraph.end(); }
}

export const conf = new Conf();
