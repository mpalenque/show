/**
 * Turns a relaxed point set into a list of "plates": either the Delaunay
 * triangles (low poly look) or the Voronoi cells (mosaic look).
 *
 * Everything is expressed in analysis-canvas pixel space (x right, y down).
 * Besides the polygons, we also produce:
 *  - plateMap: pixel -> plate, used to average the source colour per polygon
 *  - pointPlates: point -> adjacent plates, used to build a continuous surface
 */

function rasterize(ax, ay, bx, by, cx, cy, w, h, plateMap, plate) {
    let area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (area < 0) { // keep a positive orientation for the inside test
        const tx = bx, ty = by;
        bx = cx; by = cy; cx = tx; cy = ty;
        area = -area;
    }
    if (area < 1e-9) return 0;
    const inv = 1 / area;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
    let count = 0;
    for (let y = minY; y <= maxY; y++) {
        const py = y + 0.5;
        for (let x = minX; x <= maxX; x++) {
            const px = x + 0.5;
            const l0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) * inv;
            if (l0 < -1e-7) continue;
            const l1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) * inv;
            if (l1 < -1e-7) continue;
            if (l0 + l1 > 1 + 1e-7) continue;
            plateMap[y * w + x] = plate;
            count++;
        }
    }
    return count;
}

function buildPointPlates(numPoints, cornerOffsets, cornerIndices, plateCount) {
    const counts = new Int32Array(numPoints);
    for (let i = 0; i < cornerOffsets[plateCount]; i++) counts[cornerIndices[i]]++;
    const offsets = new Int32Array(numPoints + 1);
    for (let i = 0; i < numPoints; i++) offsets[i + 1] = offsets[i] + counts[i];
    const indices = new Int32Array(offsets[numPoints]);
    const cursor = offsets.slice(0, numPoints);
    for (let p = 0; p < plateCount; p++) {
        for (let k = cornerOffsets[p]; k < cornerOffsets[p + 1]; k++) {
            indices[cursor[cornerIndices[k]]++] = p;
        }
    }
    return { offsets, indices };
}

export function buildTopology({ delaunay, coords, siteOfPixel, width, height, mode, minArea = 0.25 }) {
    const plateMap = new Int32Array(width * height).fill(-1);
    const cornerOffsets = [0];
    const cornerIndices = [];
    const centerXY = [];
    const centerPixel = [];
    let pointsXY;
    let numPoints;

    if (mode === 'cells') {
        const voronoi = delaunay.voronoi([0, 0, width, height]);
        const numSites = coords.length / 2;
        const siteToPlate = new Int32Array(numSites).fill(-1);
        const lookup = new Map();
        const px = [];
        const py = [];

        for (let s = 0; s < numSites; s++) {
            const poly = voronoi.cellPolygon(s);
            if (!poly || poly.length < 4) continue; // closed ring => at least 4 entries
            const ring = poly.slice(0, poly.length - 1);
            if (ring.length < 3) continue;
            const plate = cornerOffsets.length - 1;
            for (const [x, y] of ring) {
                const key = `${Math.round(x * 64)}|${Math.round(y * 64)}`;
                let idx = lookup.get(key);
                if (idx === undefined) {
                    idx = px.length;
                    lookup.set(key, idx);
                    px.push(x);
                    py.push(y);
                }
                cornerIndices.push(idx);
            }
            cornerOffsets.push(cornerIndices.length);
            const sx = coords[s * 2];
            const sy = coords[s * 2 + 1];
            centerXY.push(sx, sy);
            const cxi = Math.min(width - 1, Math.max(0, sx | 0));
            const cyi = Math.min(height - 1, Math.max(0, sy | 0));
            centerPixel.push(cyi * width + cxi);
            siteToPlate[s] = plate;
        }

        for (let i = 0; i < plateMap.length; i++) {
            plateMap[i] = siteToPlate[siteOfPixel[i]];
        }

        numPoints = px.length;
        pointsXY = new Float64Array(numPoints * 2);
        for (let i = 0; i < numPoints; i++) {
            pointsXY[i * 2] = px[i];
            pointsXY[i * 2 + 1] = py[i];
        }
    } else {
        const tri = delaunay.triangles;
        numPoints = coords.length / 2;
        pointsXY = coords.slice();
        for (let t = 0; t < tri.length; t += 3) {
            const a = tri[t], b = tri[t + 1], c = tri[t + 2];
            const ax = coords[a * 2], ay = coords[a * 2 + 1];
            const bx = coords[b * 2], by = coords[b * 2 + 1];
            const cx = coords[c * 2], cy = coords[c * 2 + 1];
            const area = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) * 0.5;
            if (area < minArea) continue;
            const plate = cornerOffsets.length - 1;
            cornerIndices.push(a, b, c);
            cornerOffsets.push(cornerIndices.length);
            const mx = (ax + bx + cx) / 3;
            const my = (ay + by + cy) / 3;
            centerXY.push(mx, my);
            const cxi = Math.min(width - 1, Math.max(0, mx | 0));
            const cyi = Math.min(height - 1, Math.max(0, my | 0));
            centerPixel.push(cyi * width + cxi);
            rasterize(ax, ay, bx, by, cx, cy, width, height, plateMap, plate);
        }
    }

    const plateCount = cornerOffsets.length - 1;
    const offsets = Int32Array.from(cornerOffsets);
    const corners = Int32Array.from(cornerIndices);
    const pointPlates = buildPointPlates(numPoints, offsets, corners, plateCount);

    return {
        width,
        height,
        mode,
        plateCount,
        numPoints,
        pointsXY,
        cornerOffsets: offsets,
        cornerIndices: corners,
        centerXY: Float64Array.from(centerXY),
        centerPixel: Int32Array.from(centerPixel),
        plateMap,
        pointPlates,
    };
}
