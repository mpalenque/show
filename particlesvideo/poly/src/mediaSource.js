import * as THREE from 'three/webgpu';
import { conf } from './conf';

export const PANEL_WIDTH = 8;
export const PANEL_HEIGHT = 3;
export const PANEL_ASPECT = PANEL_WIDTH / PANEL_HEIGHT;

/**
 * Owns the uploaded image/video and turns it into an 8:3 framed raster that the
 * analysis stage can read on the CPU and the backdrop plane can display.
 */
class MediaSource {
    constructor() {
        this.element = null;
        this.isVideo = false;
        this.videoUrl = null;
        this.width = 0;
        this.height = 0;

        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;
        this.texture.generateMipmaps = false;

        this.pixels = null;        // Uint8ClampedArray of the last grab
        this.frameId = 0;          // bumped on every successful grab
        this.onLoaded = null;

        this._resize(conf.analysisRes);
    }

    get ready() { return this.element !== null; }

    _resize(widthPx) {
        const w = Math.max(64, Math.round(widthPx));
        const h = Math.max(24, Math.round(w / PANEL_ASPECT));
        if (this.canvas.width === w && this.canvas.height === h) return;
        this.canvas.width = w;
        this.canvas.height = h;
        this.pixels = null;
    }

    initUI() {
        const fileInput = document.getElementById('file-input');
        const uploadButton = document.getElementById('upload-button');
        const info = document.getElementById('source-info');

        uploadButton.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) await this._handleFile(file, info);
        });

        // drag & drop anywhere on the page
        window.addEventListener('dragover', (e) => { e.preventDefault(); });
        window.addEventListener('drop', async (e) => {
            e.preventDefault();
            const file = e.dataTransfer?.files?.[0];
            if (file) await this._handleFile(file, info);
        });

        const playPause = document.getElementById('play-button');
        playPause.addEventListener('click', () => {
            if (!this.isVideo || !this.element) return;
            if (this.element.paused) { this.element.play(); playPause.textContent = '⏸ Pause'; }
            else { this.element.pause(); playPause.textContent = '▶ Play'; }
        });
    }

    async _handleFile(file, infoEl) {
        try {
            infoEl.textContent = 'loading…';
            await this.load(file);
            infoEl.textContent = `${file.name} — ${this.width}×${this.height}${this.isVideo ? ' (video)' : ''}`;
            document.getElementById('play-button').style.display = this.isVideo ? 'block' : 'none';
            if (this.onLoaded) this.onLoaded();
        } catch (err) {
            console.error(err);
            infoEl.textContent = `error: ${err.message}`;
        }
    }

    async load(file) {
        if (file.type.startsWith('image/')) return this._loadImage(file);
        if (file.type.startsWith('video/')) return this._loadVideo(file);
        throw new Error('unsupported file, use an image or a video');
    }

    _loadImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = () => {
                    this._disposeVideo();
                    this.element = img;
                    this.isVideo = false;
                    this.width = img.naturalWidth;
                    this.height = img.naturalHeight;
                    resolve();
                };
                img.onerror = () => reject(new Error('could not decode image'));
                img.src = ev.target.result;
            };
            reader.onerror = () => reject(new Error('could not read file'));
            reader.readAsDataURL(file);
        });
    }

    _loadVideo(file) {
        return new Promise((resolve, reject) => {
            const video = document.getElementById('source-video');
            this._disposeVideo();
            video.muted = true;
            video.loop = true;
            video.playsInline = true;
            video.preload = 'auto';
            const onReady = () => {
                this.element = video;
                this.isVideo = true;
                this.width = video.videoWidth;
                this.height = video.videoHeight;
                video.play().catch(() => {});
                resolve();
            };
            video.addEventListener('canplay', onReady, { once: true });
            video.onerror = () => reject(new Error('could not decode video'));
            this.videoUrl = URL.createObjectURL(file);
            video.src = this.videoUrl;
            video.load();
        });
    }

    _disposeVideo() {
        const video = document.getElementById('source-video');
        if (this.videoUrl) {
            video.pause();
            video.removeAttribute('src');
            video.load();
            URL.revokeObjectURL(this.videoUrl);
            this.videoUrl = null;
        }
    }

    /** True when the video advanced (or an image needs its first grab). */
    needsGrab() {
        if (!this.ready) return false;
        if (!this.isVideo) return this.pixels === null;
        if (this.element.readyState < 2) return false;
        return true;
    }

    /**
     * Draws the source into the 8:3 analysis canvas honouring fit/zoom/offset,
     * then reads it back. Returns {pixels, width, height} or null.
     */
    grab() {
        if (!this.ready) return null;
        this._resize(conf.analysisRes);

        const W = this.canvas.width;
        const H = this.canvas.height;
        const ctx = this.ctx;
        const sw = this.width;
        const sh = this.height;
        if (!sw || !sh) return null;

        const srcAspect = sw / sh;
        const cover = conf.fit === 'cover';
        let cw, ch;
        if ((srcAspect > PANEL_ASPECT) === cover) {
            ch = sh;
            cw = sh * PANEL_ASPECT;
        } else {
            cw = sw;
            ch = sw / PANEL_ASPECT;
        }
        cw /= conf.zoom;
        ch /= conf.zoom;
        const cx = (sw - cw) * 0.5 + conf.offsetX * sw * 0.5;
        const cy = (sh - ch) * 0.5 - conf.offsetY * sh * 0.5;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.filter = 'none';
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        if (conf.preBlur > 0.01) ctx.filter = `blur(${conf.preBlur.toFixed(2)}px)`;
        if (conf.mirror) ctx.setTransform(-1, 0, 0, 1, W, 0);
        try {
            ctx.drawImage(this.element, cx, cy, cw, ch, 0, 0, W, H);
        } catch (e) {
            return null;
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.filter = 'none';

        this.pixels = ctx.getImageData(0, 0, W, H).data;
        this.texture.needsUpdate = true;
        this.frameId++;
        return { pixels: this.pixels, width: W, height: H };
    }
}

export default MediaSource;
