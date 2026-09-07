import * as THREE from 'three/webgpu';
import App from './src/app';

THREE.ColorManagement.enabled = true;

const setProgress = async (frac, delay = 0) => new Promise((resolve) => {
    const progress = document.getElementById('progress');
    progress.style.width = `${frac * 200}px`;
    if (delay === 0) resolve(); else setTimeout(resolve, delay);
});

const fail = (msg) => {
    document.getElementById('progress-bar').style.opacity = 0;
    const error = document.getElementById('error');
    error.style.visibility = 'visible';
    error.innerText = `Error: ${msg}`;
};

const run = async () => {
    if (!navigator.gpu) {
        fail('This browser does not support WebGPU. Use Chrome/Edge 113+ or Safari 18+.');
        return;
    }

    const renderer = new THREE.WebGPURenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    await renderer.init();

    if (!renderer.backend.isWebGPUBackend) {
        fail("Couldn't initialize WebGPU.");
        return;
    }

    document.getElementById('container').appendChild(renderer.domElement);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.inset = '0';

    const app = new App(renderer);
    await app.init(setProgress);

    const resize = () => {
        renderer.setSize(window.innerWidth, window.innerHeight);
        app.resize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', resize);
    resize();

    document.getElementById('veil').style.opacity = 0;
    document.getElementById('progress-bar').style.opacity = 0;

    const clock = new THREE.Clock();
    const animate = async () => {
        const delta = clock.getDelta();
        const elapsed = clock.getElapsedTime();
        await app.update(delta, elapsed);
        requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
};

run().catch((err) => {
    console.error(err);
    fail(err.message ?? String(err));
});
