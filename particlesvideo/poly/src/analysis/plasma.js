/**
 * Procedural control texture: a tileable fbm "plasma" with domain warping and an
 * optional linear gradient.
 *
 * The very same field feeds two things, so they always agree:
 *  - the analysis density (where polygons concentrate, i.e. their size)
 *  - a selection mask on the GPU (where the relief is allowed to grow)
 */

const hash2 = (x, y, seed) => {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** periodic value noise on an Lx by Ly lattice, so the field tiles seamlessly */
const valueNoise = (u, v, lx, ly, seed) => {
    const x = u * lx;
    const y = v * ly;
    let x0 = Math.floor(x);
    let y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const i0 = ((x0 % lx) + lx) % lx;
    const j0 = ((y0 % ly) + ly) % ly;
    const i1 = (i0 + 1) % lx;
    const j1 = (j0 + 1) % ly;
    const a = hash2(i0, j0, seed);
    const b = hash2(i1, j0, seed);
    const c = hash2(i0, j1, seed);
    const d = hash2(i1, j1, seed);
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
};

const fbm = (u, v, octaves, lx0, ly0, gain, seed) => {
    let amp = 1, sum = 0, norm = 0, lx = lx0, ly = ly0;
    for (let o = 0; o < octaves; o++) {
        sum += amp * valueNoise(u, v, lx, ly, seed + o * 1013);
        norm += amp;
        amp *= gain;
        lx *= 2;
        ly *= 2;
    }
    return sum / norm;
};

export const PLASMA_W = 512;
export const PLASMA_H = 192;

export class Plasma {
    constructor() {
        this.width = PLASMA_W;
        this.height = PLASMA_H;
        this.field = new Float32Array(PLASMA_W * PLASMA_H);
        this.bytes = new Uint8Array(PLASMA_W * PLASMA_H * 4);
        this.signature = null;
    }

    /** Regenerates only when the shape parameters actually changed. */
    sync(conf) {
        const sig = [
            conf.plasmaOctaves, conf.plasmaGain, conf.plasmaWarp, conf.plasmaGradient,
            conf.plasmaGradientAngle, conf.plasmaContrast, conf.plasmaInvert, conf.plasmaSeed,
            conf.plasmaBase,
        ].join('|');
        if (sig === this.signature) return false;
        this.signature = sig;
        this.generate(conf);
        return true;
    }

    generate(conf) {
        const W = this.width;
        const H = this.height;
        const field = this.field;
        const octaves = Math.max(1, Math.round(conf.plasmaOctaves));
        const gain = conf.plasmaGain;
        const warp = conf.plasmaWarp;
        const seed = Math.round(conf.plasmaSeed) * 7919;
        const lx0 = Math.max(1, Math.round(conf.plasmaBase));
        const ly0 = Math.max(1, Math.round(conf.plasmaBase * 3 / 8));
        const ga = conf.plasmaGradientAngle * Math.PI / 180;
        const gc = Math.cos(ga);
        const gs = Math.sin(ga);

        let min = Infinity;
        let max = -Infinity;
        for (let y = 0; y < H; y++) {
            const v = (y + 0.5) / H;
            for (let x = 0; x < W; x++) {
                const u = (x + 0.5) / W;
                let su = u;
                let sv = v;
                if (warp > 0.001) {
                    const wu = fbm(u, v, 2, lx0, ly0, 0.5, seed + 77) - 0.5;
                    const wv = fbm(u, v, 2, lx0, ly0, 0.5, seed + 131) - 0.5;
                    su = u + warp * wu;
                    sv = v + warp * wv;
                }
                let n = fbm(su, sv, octaves, lx0, ly0, gain, seed);
                if (conf.plasmaGradient > 0.001) {
                    const g = 0.5 + ((u - 0.5) * gc + (v - 0.5) * gs) * 1.15;
                    n = n * (1 - conf.plasmaGradient) + g * conf.plasmaGradient;
                }
                field[y * W + x] = n;
                if (n < min) min = n;
                if (n > max) max = n;
            }
        }

        // normalise, then contrast around the middle grey
        const span = Math.max(1e-6, max - min);
        const contrast = conf.plasmaContrast;
        const invert = conf.plasmaInvert;
        const bytes = this.bytes;
        for (let i = 0; i < field.length; i++) {
            let n = (field[i] - min) / span;
            n = (n - 0.5) * contrast + 0.5;
            if (invert) n = 1 - n;
            n = n < 0 ? 0 : n > 1 ? 1 : n;
            field[i] = n;
            const b = (n * 255) | 0;
            const o = i * 4;
            bytes[o] = b; bytes[o + 1] = b; bytes[o + 2] = b; bytes[o + 3] = 255;
        }
    }

    /** bilinear sample with wrap, in the same 0..1 space as the panel */
    sample(u, v) {
        const W = this.width;
        const H = this.height;
        let x = (u - Math.floor(u)) * W - 0.5;
        let y = (v - Math.floor(v)) * H - 0.5;
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const fx = x - x0;
        const fy = y - y0;
        const i0 = ((x0 % W) + W) % W;
        const j0 = ((y0 % H) + H) % H;
        const i1 = (i0 + 1) % W;
        const j1 = (j0 + 1) % H;
        const f = this.field;
        const a = f[j0 * W + i0], b = f[j0 * W + i1];
        const c = f[j1 * W + i0], d = f[j1 * W + i1];
        return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
}
