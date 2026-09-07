import { Delaunay } from 'd3-delaunay';

/** Deterministic PRNG so a given seed always yields the same polygon layout. */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function binarySearch(cdf, value) {
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cdf[mid] < value) lo = mid + 1; else hi = mid;
    }
    return lo;
}

/**
 * Importance-samples `count` interior points from the density field and adds a
 * ring of fixed points along the border so the triangulation covers the frame.
 */
export function samplePoints({ width, height, cdf, total, count, borderPoints, rng }) {
    const interior = Math.max(4, count);
    const xs = [];
    const ys = [];
    const fixed = [];

    for (let i = 0; i < interior; i++) {
        const idx = binarySearch(cdf, rng() * total);
        const px = idx % width;
        const py = (idx / width) | 0;
        xs.push(Math.min(width, Math.max(0, px + rng())));
        ys.push(Math.min(height, Math.max(0, py + rng())));
        fixed.push(0);
    }

    const nx = Math.max(0, Math.round(borderPoints));
    const ny = Math.max(0, Math.round(borderPoints * height / width));
    const push = (x, y) => { xs.push(x); ys.push(y); fixed.push(1); };
    push(0, 0); push(width, 0); push(width, height); push(0, height);
    for (let i = 1; i < nx; i++) {
        const t = i / nx;
        push(t * width, 0);
        push(t * width, height);
    }
    for (let i = 1; i < ny; i++) {
        const t = i / ny;
        push(0, t * height);
        push(width, t * height);
    }

    const coords = new Float64Array(xs.length * 2);
    for (let i = 0; i < xs.length; i++) {
        coords[i * 2] = xs[i];
        coords[i * 2 + 1] = ys[i];
    }
    return { coords, fixed: Uint8Array.from(fixed) };
}

/** Nearest-site assignment for every pixel, walking the triangulation. */
export function assignPixels(delaunay, width, height, out) {
    let rowStart = 0;
    for (let y = 0; y < height; y++) {
        let hint = rowStart;
        for (let x = 0; x < width; x++) {
            hint = delaunay.find(x + 0.5, y + 0.5, hint);
            out[y * width + x] = hint;
        }
        rowStart = out[y * width];
    }
    return out;
}

/**
 * Density weighted Lloyd relaxation: every site walks towards the weighted
 * centroid of its Voronoi cell, which packs polygons into detailed areas and
 * makes their shapes regular and organic at the same time.
 */
export function relax({ coords, fixed, width, height, density, iterations, strength }) {
    const numSites = coords.length / 2;
    const siteOfPixel = new Int32Array(width * height);
    let delaunay = new Delaunay(coords);

    const sx = new Float64Array(numSites);
    const sy = new Float64Array(numSites);
    const sw = new Float64Array(numSites);

    const passes = Math.max(0, Math.round(iterations));
    for (let it = 0; it <= passes; it++) {
        assignPixels(delaunay, width, height, siteOfPixel);
        if (it === passes) break;

        sx.fill(0); sy.fill(0); sw.fill(0);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = y * width + x;
                const s = siteOfPixel[i];
                const d = density[i];
                sx[s] += (x + 0.5) * d;
                sy[s] += (y + 0.5) * d;
                sw[s] += d;
            }
        }
        for (let s = 0; s < numSites; s++) {
            if (fixed[s] || sw[s] <= 0) continue;
            const tx = sx[s] / sw[s];
            const ty = sy[s] / sw[s];
            coords[s * 2] += (tx - coords[s * 2]) * strength;
            coords[s * 2 + 1] += (ty - coords[s * 2 + 1]) * strength;
        }
        delaunay = new Delaunay(coords);
    }

    return { delaunay, siteOfPixel };
}
