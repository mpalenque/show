/**
 * Image analysis: luminance, Sobel edge energy and the resulting density field
 * that tells the sampler where polygons should concentrate.
 */

const LUM_R = 0.2126, LUM_G = 0.7152, LUM_B = 0.0722;

export function computeFields(pixels, w, h, opts) {
    const n = w * h;
    const lum = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
        lum[i] = (LUM_R * pixels[p] + LUM_G * pixels[p + 1] + LUM_B * pixels[p + 2]) / 255;
    }

    // Sobel gradient magnitude
    const edge = new Float32Array(n);
    let maxMag = 1e-6;
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const tl = lum[i - w - 1], t = lum[i - w], tr = lum[i - w + 1];
            const l = lum[i - 1], r = lum[i + 1];
            const bl = lum[i + w - 1], b = lum[i + w], br = lum[i + w + 1];
            const gx = (tr + 2 * r + br) - (tl + 2 * l + bl);
            const gy = (bl + 2 * b + br) - (tl + 2 * t + tr);
            const mag = Math.sqrt(gx * gx + gy * gy);
            edge[i] = mag;
            if (mag > maxMag) maxMag = mag;
        }
    }

    // robust normalisation: use the 99th percentile instead of the raw maximum
    const BINS = 256;
    const hist = new Int32Array(BINS);
    for (let i = 0; i < n; i++) {
        const b = Math.min(BINS - 1, (edge[i] / maxMag * (BINS - 1)) | 0);
        hist[b]++;
    }
    let acc = 0, cut = BINS - 1;
    const target = n * 0.99;
    for (let b = 0; b < BINS; b++) {
        acc += hist[b];
        if (acc >= target) { cut = b; break; }
    }
    const norm = Math.max(1e-6, (cut + 1) / BINS * maxMag);
    for (let i = 0; i < n; i++) {
        edge[i] = Math.min(1, edge[i] / norm);
    }

    // density = flat floor + edge attraction (+ shadows) blended with the plasma
    // control texture, then pushed through `sizeVariation`.
    //
    // Weighted Lloyd equalises the *mass* of every cell, so the cell area ends up
    // proportional to 1/density: raising the exponent stretches the range of
    // polygon sizes, lowering it towards 0 makes them all the same size.
    const influence = opts.edgeInfluence;
    const gamma = opts.edgeGamma;
    const dark = opts.darkBias;
    const variation = Math.max(0, opts.sizeVariation ?? 1);
    const plasma = opts.plasma;
    const plasmaAmount = plasma ? Math.min(1, Math.max(0, opts.plasmaAmount)) : 0;
    const scale = opts.plasmaScale ?? 1;
    const offX = opts.plasmaOffsetX ?? 0;
    const offY = opts.plasmaOffsetY ?? 0;
    const density = new Float32Array(n);
    const cdf = new Float64Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
        const x = i % w;
        const y = (i / w) | 0;
        let d = (1 - influence) + influence * Math.pow(edge[i], gamma) + dark * (1 - lum[i]);
        if (plasmaAmount > 0) {
            const p = plasma.sample((x / w) * scale + offX, (1 - y / h) * scale + offY);
            d = d * (1 - plasmaAmount) + (0.04 + 0.96 * p) * plasmaAmount;
        }
        d = Math.pow(d, variation);
        if (d < 1e-4) d = 1e-4;
        density[i] = d;
        sum += d;
        cdf[i] = sum;
    }

    return { lum, edge, density, cdf, total: sum, width: w, height: h };
}
