import * as THREE from 'three/webgpu';
import {
    Fn, attribute, positionGeometry, positionWorld, cameraViewMatrix, output,
    diffuseColor, varying,
    textureLoad, texture, uniform, ivec2, vec2, vec3, vec4, float, mix, clamp, pow,
    max, min, dot, floor, fract, abs, length, smoothstep, sin, time, select, saturate,
} from 'three/tsl';
import { conf } from './conf';
import { PANEL_WIDTH, PANEL_HEIGHT } from './mediaSource';

export const WALL_Z = 3.0;
const TAU = Math.PI * 2;

// byte -> linear-srgb and byte -> 0..1 lookup tables
const LINEAR = new Float32Array(256);
const NORM = new Float32Array(256);
for (let i = 0; i < 256; i++) {
    const c = i / 255;
    NORM[i] = c;
    LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** same curve as shape() in the shader, so the fitted plane matches it */
const shapeLuminance = (lum) => {
    const l = conf.invertDepth ? 1 - lum : lum;
    return Math.pow(Math.min(1, Math.max(0, l)), conf.depthGamma);
};

const KIND_FRONT = 0;
const KIND_SIDE = 1;
const KIND_BACK = 2;

const makeDataTexture = (size) => {
    const tex = new THREE.DataTexture(
        new Float32Array(size * size * 4), size, size,
        THREE.RGBAFormat, THREE.FloatType,
    );
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
};

// resizing in place keeps the texture object identity, so the compiled shader
// stays valid when the polygon count changes
const setTextureSize = (tex, size) => {
    if (tex.image.width === size) return;
    tex.dispose();
    tex.image = { data: new Float32Array(size * size * 4), width: size, height: size };
    tex.needsUpdate = true;
};

/** hue (turns) + saturation from gamma encoded rgb, the way the eye reads them */
const hueSat = (r, g, b, out) => {
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const d = mx - mn;
    let h = 0;
    if (d > 1e-6) {
        if (mx === r) h = ((g - b) / d) % 6;
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h /= 6;
        if (h < 0) h += 1;
    }
    out[0] = h;
    out[1] = mx > 1e-6 ? d / mx : 0;
};

/**
 * The polygon relief.
 *
 * CPU side, every frame: the average colour / luminance / hue of each polygon and
 * of each shared point, uploaded as three small float textures.
 *
 * GPU side (TSL): every vertex reads its polygon, builds a selection weight out
 * of the masks (position, brightness, hue), and that weight times the master
 * `morph` fader decides how far the polygon travels out of the wall, how flat its
 * colour becomes and how much 3d shading it receives. At weight 0 the panel is
 * simply the source image; at 1 it is a fully lit polygon relief.
 */
class PolyMesh {
    constructor(sourceTexture, plasmaTexture) {
        this.topo = null;
        this.capacity = 0;
        this.vertexCount = 0;
        this.arrays = null;
        this.sourceTexture = sourceTexture;
        this.plasmaTexture = plasmaTexture;

        this.plateTex = makeDataTexture(1);   // rgb linear + perceptual luminance
        this.plateAux = makeDataTexture(1);   // hue, saturation
        this.plateFit = makeDataTexture(1);   // least squares plane of the polygon
        this.pointTex = makeDataTexture(1);   // luminance, random, hue, saturation

        this.boundingSphere = new THREE.Sphere(
            new THREE.Vector3(0, PANEL_HEIGHT * 0.5, WALL_Z),
            Math.hypot(PANEL_WIDTH, PANEL_HEIGHT) * 0.5 + 6,
        );
        this.geometry = this._makeGeometry(0);

        this.u = {
            morph: uniform(conf.morph),
            flatten: uniform(conf.flatten),
            shadeOnset: uniform(conf.shadeOnset),

            extrude: uniform(conf.extrude),
            depthGamma: uniform(conf.depthGamma),
            invert: uniform(0),
            baseOffset: uniform(conf.baseOffset),
            separation: uniform(conf.separation),
            shrink: uniform(conf.shrink),
            thickness: uniform(conf.thickness),
            rootToWall: uniform(conf.rootToWall),
            jitter: uniform(conf.jitter),
            wobble: uniform(conf.wobble),
            wobbleSpeed: uniform(conf.wobbleSpeed),

            maskFloor: uniform(conf.maskFloor),
            shapeAmount: uniform(conf.shapeAmount),
            shapeMode: uniform(0),
            maskCenter: uniform(new THREE.Vector2(0.5, 0.5)),
            maskRadius: uniform(conf.maskRadius),
            maskSoftness: uniform(conf.maskSoftness),
            maskDir: uniform(new THREE.Vector2(1, 0)),
            maskPosition: uniform(conf.maskPosition),
            maskInvert: uniform(0),
            lumAmount: uniform(conf.lumAmount),
            lumMin: uniform(conf.lumMin),
            lumMax: uniform(conf.lumMax),
            lumSoftness: uniform(conf.lumSoftness),
            plasmaAmount: uniform(conf.plasmaMask),
            plasmaSize: uniform(new THREE.Vector2(1, 1)),
            plasmaScale: uniform(conf.plasmaScale),
            plasmaOffset: uniform(new THREE.Vector2()),
            plasmaThreshold: uniform(conf.plasmaThreshold),
            plasmaSoftness: uniform(conf.plasmaSoftness),
            plasmaInvert: uniform(0),
            hueAmount: uniform(conf.hueAmount),
            hueTarget: uniform(0),
            hueWidth: uniform(conf.hueWidth),
            hueSoftness: uniform(conf.hueSoftness),
            satMin: uniform(conf.satMin),

            exposure: uniform(conf.exposure),
            saturation: uniform(conf.saturation),
            contrast: uniform(conf.contrast),
            gradeGamma: uniform(conf.gradeGamma),
            quantize: uniform(conf.quantize),
            sideDarken: uniform(conf.sideDarken),
            backDarken: uniform(conf.backDarken),
            depthShade: uniform(conf.depthShade),
            emissive: uniform(conf.emissive),

            roughness: uniform(conf.roughness),
            roughByLum: uniform(conf.roughnessByLum),
            metalness: uniform(conf.metalness),
        };

        this.material = this._createMaterial();
        this.object = new THREE.Mesh(this.geometry, this.material);
        this.object.frustumCulled = false;
        this.object.castShadow = true;
        this.object.receiveShadow = true;
        this.object.visible = false;
    }

    // ------------------------------------------------------------ TSL material
    _createMaterial() {
        const u = this.u;
        const material = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
        material.flatShading = true;

        const aCenter = attribute('aCenter', 'vec2');
        const aTexel = attribute('aTexel', 'vec4');
        const aSide = attribute('aSide', 'vec2');
        const aMeta = attribute('aMeta', 'vec3');   // kind, layer, random

        const plate = () => textureLoad(this.plateTex, ivec2(aTexel.xy));
        const plateHS = () => textureLoad(this.plateAux, ivec2(aTexel.xy));
        const plateFit = () => textureLoad(this.plateFit, ivec2(aTexel.xy));
        const point = () => textureLoad(this.pointTex, ivec2(aTexel.zw));

        // world xy -> panel uv (u grows to the right of the image)
        const panelUV = (xy) => vec2(
            float(PANEL_WIDTH * 0.5).sub(xy.x).div(PANEL_WIDTH),
            xy.y.div(PANEL_HEIGHT),
        );

        const softBand = (edge, softness, x) =>
            smoothstep(0, 1, x.sub(edge).div(max(softness, float(0.0005))).add(0.5));

        // bilinear read of the control texture, done by hand so the vertex and the
        // fragment stage always agree (vertex stage sampling is point sampled)
        const plasmaAt = (uv) => {
            const t = fract(uv.mul(u.plasmaScale).add(u.plasmaOffset));
            const p = t.mul(u.plasmaSize).sub(0.5);
            const i0 = floor(p);
            const f = p.sub(i0);
            const hi = u.plasmaSize.sub(1);
            const c00 = ivec2(clamp(i0, vec2(0), hi));
            const c11 = ivec2(clamp(i0.add(1), vec2(0), hi));
            const a = textureLoad(this.plasmaTexture, c00).r;
            const b = textureLoad(this.plasmaTexture, ivec2(c11.x, c00.y)).r;
            const c = textureLoad(this.plasmaTexture, ivec2(c00.x, c11.y)).r;
            const d = textureLoad(this.plasmaTexture, c11).r;
            return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        };

        /**
         * How much polygonization this spot receives: position mask * brightness
         * mask * hue mask, each one dosed by its own amount fader.
         */
        const selection = (lum, hue, sat, xy) => {
            const uv = panelUV(xy);

            // --- position: radial and / or linear sweep
            const d = vec2(uv.x.sub(u.maskCenter.x), uv.y.sub(u.maskCenter.y).mul(PANEL_HEIGHT / PANEL_WIDTH));
            const radial = softBand(u.maskRadius, u.maskSoftness, length(d)).oneMinus();
            const linear = softBand(u.maskPosition, u.maskSoftness, dot(uv, u.maskDir));
            const shapeRaw = select(
                u.shapeMode.lessThan(0.5), float(1),
                select(u.shapeMode.lessThan(1.5), radial,
                    select(u.shapeMode.lessThan(2.5), linear, radial.mul(linear))),
            ).toVar();
            shapeRaw.assign(mix(shapeRaw, shapeRaw.oneMinus(), u.maskInvert));
            const shape = mix(float(1), shapeRaw, u.shapeAmount);

            // --- brightness window
            const lo = softBand(u.lumMin, u.lumSoftness, lum);
            const hi = softBand(u.lumMax, u.lumSoftness, lum).oneMinus();
            const lumMask = mix(float(1), lo.mul(hi), u.lumAmount);

            // --- hue window (circular distance in turns) + saturation gate
            const dh = abs(fract(hue.sub(u.hueTarget).add(0.5)).sub(0.5));
            const hueRaw = softBand(u.hueWidth.mul(0.5), u.hueSoftness, dh).oneMinus()
                .mul(softBand(u.satMin, float(0.06), sat));
            const hueMask = mix(float(1), hueRaw, u.hueAmount);

            // --- control texture (plasma): organic, image independent selection
            const field = plasmaAt(uv);
            const plasmaRaw = softBand(u.plasmaThreshold, u.plasmaSoftness, field).toVar();
            plasmaRaw.assign(mix(plasmaRaw, plasmaRaw.oneMinus(), u.plasmaInvert));
            const plasmaMask = mix(float(1), plasmaRaw, u.plasmaAmount);

            const w = saturate(shape.mul(lumMask).mul(hueMask).mul(plasmaMask));
            return saturate(u.maskFloor.add(w.mul(u.maskFloor.oneMinus())).mul(u.morph));
        };

        // luminance -> 0..1 relief profile (mirrors shapeLuminance() on the cpu)
        const shape = (lum) => {
            const l = mix(lum, float(1).sub(lum), u.invert);
            return pow(clamp(l, 0, 1), u.depthGamma);
        };

        // relief profile -> distance travelled out of the wall, towards the camera.
        // Kept affine in `shaped` so a fitted plane stays perfectly planar.
        const relief = (shaped, rnd) => {
            const jittered = mix(shaped, rnd, u.jitter);
            const wob = sin(time.mul(u.wobbleSpeed).add(rnd.mul(TAU))).mul(u.wobble);
            return u.baseOffset.add(u.extrude.mul(jittered)).add(wob);
        };

        // The weight of a polygon is constant across it, so it is computed once in
        // the vertex stage and carried over as a varying: the fragment stage would
        // otherwise redo the whole mask chain (including the control texture
        // lookups) for every node that needs it.
        const plateWeight = () => varying(
            selection(plate().a, plateHS().r, plateHS().g, aCenter),
            'v_plateWeight',
        );

        material.positionNode = Fn(() => {
            const pl = plate().toVar();
            const pt = point().toVar();
            const hs = plateHS().toVar();

            // the smooth term is evaluated at the shared point so neighbouring
            // polygons always agree on it and the surface stays watertight
            const wPoint = selection(pt.r, pt.b, pt.a, positionGeometry.xy);
            const wPlate = selection(pl.a, hs.r, hs.g, aCenter).toVar();

            // three ways to place the front facet, blended by a single fader:
            //   smooth  - every corner at its own height (continuous surface)
            //   planar  - the least squares plane of the polygon (a real flat facet)
            //   flat    - one constant height, parallel to the wall (loose plate)
            const fit = plateFit().toVar();
            const d = positionGeometry.xy.sub(aCenter);
            const planeShaped = fit.r.add(fit.g.mul(d.x)).add(fit.b.mul(d.y));

            const zSmooth = float(WALL_Z).sub(relief(shape(pt.r), pt.g).mul(wPoint));
            const zPlane = float(WALL_Z).sub(relief(planeShaped, aMeta.z).mul(wPlate));
            const zFlat = float(WALL_Z).sub(relief(shape(pl.a), aMeta.z).mul(wPlate));
            const s2 = u.separation.mul(2);
            const zMix = select(
                u.separation.lessThan(0.5),
                mix(zSmooth, zPlane, clamp(s2, 0, 1)),
                mix(zPlane, zFlat, clamp(s2.sub(1), 0, 1)),
            );
            // the front facet always keeps a hair of clearance from the base plane,
            // otherwise polygons at weight 0 would have coincident front/back faces
            // and the ambient occlusion pass would read flipped normals
            const z = min(zMix, float(WALL_Z - 0.005)).toVar();
            const xy = mix(positionGeometry.xy, aCenter, u.shrink.mul(wPlate));
            const zBase = max(
                mix(z.add(u.thickness.mul(wPlate)), float(WALL_Z + 0.004), u.rootToWall),
                z.add(0.004),
            );
            return vec3(xy, mix(z, zBase, aMeta.y));
        })();

        material.normalNode = Fn(() => {
            const flat = positionWorld.dFdx().cross(positionWorld.dFdy()).normalize().toVar();
            // the visible side of the relief always faces -Z, so the sign is known
            const s = select(flat.z.lessThan(0), float(1), float(-1));
            const nFront = flat.mul(s).toVar();
            const nSide = vec3(aSide, 0).normalize();
            const n = select(
                aMeta.x.lessThan(0.5), nFront,
                select(aMeta.x.greaterThan(1.5), nFront.mul(-1), nSide),
            );
            return n.transformDirection(cameraViewMatrix);
        })();

        // colour of the polygon: the source image itself, blended towards the flat
        // polygon average as the morph fader opens
        const surfaceColor = (weight) => {
            const detail = texture(this.sourceTexture, panelUV(positionGeometry.xy)).rgb;
            const flatCol = plate().rgb;
            const c = mix(detail, flatCol, saturate(u.flatten.mul(weight))).mul(u.exposure).toVar();
            const l = dot(c, vec3(0.2126, 0.7152, 0.0722));
            c.assign(mix(vec3(l), c, u.saturation));
            c.assign(c.sub(0.5).mul(u.contrast).add(0.5));
            c.assign(pow(max(c, vec3(0)), vec3(u.gradeGamma)));
            const q = max(u.quantize, float(2));
            c.assign(select(u.quantize.greaterThan(1.5), floor(c.mul(q)).div(q), c));

            // sides and backs are shaded darker than the front facets
            const kind = aMeta.x;
            const faceMul = select(
                kind.lessThan(0.5), float(1),
                select(kind.greaterThan(1.5), float(1).sub(u.backDarken), float(1).sub(u.sideDarken)),
            );
            // recessed polygons fall off towards the wall
            const span = max(u.extrude, float(0.001));
            const t = clamp(positionWorld.z.sub(float(WALL_Z).sub(span).sub(u.baseOffset)).div(span), 0, 1);
            const depthMul = mix(float(1), float(1).sub(u.depthShade.mul(weight)), t);
            return max(c.mul(faceMul).mul(depthMul), vec3(0));
        };

        // lit contribution fades in with the morph, the unlit image fades out, so
        // a weight of 0 shows the plain picture and 1 shows fully lit geometry
        material.colorNode = Fn(() => surfaceColor(plateWeight()))();

        // `diffuseColor` already holds the graded surface colour that colorNode
        // produced, so the emissive and the output stage reuse it instead of
        // evaluating the whole grading chain again
        material.emissiveNode = Fn(() => {
            return diffuseColor.rgb.mul(u.emissive).mul(pow(clamp(plate().a, 0, 1), float(3)));
        })();

        // `output` holds the fully lit result. Crossfading it against the plain
        // graded image gives a clean "no polygons at all" state at weight 0: no
        // lighting, no environment specular, just the picture.
        material.outputNode = Fn(() => {
            const lit = saturate(plateWeight().div(max(u.shadeOnset, float(0.01))));
            return vec4(mix(diffuseColor.rgb, output.rgb, lit), 1);
        })();

        material.roughnessNode = Fn(() => {
            return clamp(u.roughness.add(u.roughByLum.mul(plate().a.sub(0.5).mul(2))), 0.02, 1);
        })();
        material.metalnessNode = u.metalness;

        return material;
    }

    // --------------------------------------------------------------- rebuild
    _ensureCapacity(vertexCount) {
        if (vertexCount <= this.capacity) return;
        const cap = Math.ceil(vertexCount * 1.3);
        this.capacity = cap;
        this.arrays = {
            position: new Float32Array(cap * 3),
            aCenter: new Float32Array(cap * 2),
            aTexel: new Float32Array(cap * 4),
            aSide: new Float32Array(cap * 2),
            aMeta: new Float32Array(cap * 3),
        };
    }

    /**
     * Builds a geometry that views exactly the used slice of the pooled buffers.
     *
     * A fresh geometry (and fresh attributes) per rebuild is deliberate: reusing
     * them and relying on partial uploads left stale vertex data on the GPU when
     * the polygon count shrank, which showed up as a blob of the previous
     * triangulation instead of the new one.
     */
    _makeGeometry(vertexCount) {
        const g = new THREE.BufferGeometry();
        const sizes = { position: 3, aCenter: 2, aTexel: 4, aSide: 2, aMeta: 3 };
        if (this.arrays && vertexCount > 0) {
            for (const key of Object.keys(sizes)) {
                const itemSize = sizes[key];
                const view = this.arrays[key].subarray(0, vertexCount * itemSize);
                g.setAttribute(key, new THREE.BufferAttribute(view, itemSize));
            }
        }
        g.boundingSphere = this.boundingSphere;
        return g;
    }

    /** Rebuilds the mesh from a freshly analysed topology. */
    rebuild(topo) {
        const { plateCount, numPoints, cornerOffsets, cornerIndices, pointsXY, centerXY } = topo;
        if (plateCount === 0) { this.object.visible = false; return; }

        const solid = conf.solid;
        let vertexCount = 0;
        for (let p = 0; p < plateCount; p++) {
            const n = cornerOffsets[p + 1] - cornerOffsets[p];
            const front = n === 3 ? 1 : n;
            vertexCount += 3 * (front * 2 + (solid ? 2 * n : 0));
        }

        this._ensureCapacity(vertexCount);
        const PS = Math.max(1, Math.ceil(Math.sqrt(plateCount)));
        const QS = Math.max(1, Math.ceil(Math.sqrt(numPoints + plateCount)));
        setTextureSize(this.plateTex, PS);
        setTextureSize(this.plateAux, PS);
        setTextureSize(this.plateFit, PS);
        setTextureSize(this.pointTex, QS);
        this.plateTexSize = PS;
        this.pointTexSize = QS;

        const W = topo.width;
        const H = topo.height;
        // the camera looks towards +Z, so screen-right is -X: mirror the mapping
        // to keep the polygons aligned with the source image
        const toWorldX = (x) => PANEL_WIDTH * 0.5 - (x / W) * PANEL_WIDTH;
        const toWorldY = (y) => (1 - y / H) * PANEL_HEIGHT;

        const { position, aCenter, aTexel, aSide, aMeta } = this.arrays;

        // deterministic per-plate / per-point randoms, stable across frames
        this.pointRandom = new Float32Array(numPoints + plateCount);
        let seed = ((conf.seed * 2654435761) >>> 0) || 1;
        const rnd = () => {
            seed = (seed ^ (seed << 13)) >>> 0;
            seed = (seed ^ (seed >>> 17)) >>> 0;
            seed = (seed ^ (seed << 5)) >>> 0;
            return seed / 4294967296;
        };
        for (let i = 0; i < this.pointRandom.length; i++) this.pointRandom[i] = rnd();

        let v = 0;
        let plateTexX = 0;
        let plateTexY = 0;
        const px = [];
        const py = [];
        const ptx = [];
        const pty = [];

        const put = (x, y, cx, cy, ptX, ptY, sx, sy, kind, layer, rand) => {
            position[v * 3] = x;
            position[v * 3 + 1] = y;
            position[v * 3 + 2] = WALL_Z;
            aCenter[v * 2] = cx;
            aCenter[v * 2 + 1] = cy;
            aTexel[v * 4] = plateTexX;
            aTexel[v * 4 + 1] = plateTexY;
            aTexel[v * 4 + 2] = ptX;
            aTexel[v * 4 + 3] = ptY;
            aSide[v * 2] = sx;
            aSide[v * 2 + 1] = sy;
            aMeta[v * 3] = kind;
            aMeta[v * 3 + 1] = layer;
            aMeta[v * 3 + 2] = rand;
            v++;
        };

        for (let p = 0; p < plateCount; p++) {
            const start = cornerOffsets[p];
            const n = cornerOffsets[p + 1] - start;
            plateTexX = p % PS;
            plateTexY = (p / PS) | 0;
            const rand = this.pointRandom[numPoints + p];

            px.length = 0; py.length = 0; ptx.length = 0; pty.length = 0;
            for (let k = 0; k < n; k++) {
                const idx = cornerIndices[start + k];
                px.push(toWorldX(pointsXY[idx * 2]));
                py.push(toWorldY(pointsXY[idx * 2 + 1]));
                ptx.push(idx % QS);
                pty.push((idx / QS) | 0);
            }

            // make the ring counter clockwise so edge normals point outwards
            let area = 0;
            for (let k = 0; k < n; k++) {
                const j = (k + 1) % n;
                area += px[k] * py[j] - px[j] * py[k];
            }
            if (area < 0) { px.reverse(); py.reverse(); ptx.reverse(); pty.reverse(); }

            const cx = toWorldX(centerXY[p * 2]);
            const cy = toWorldY(centerXY[p * 2 + 1]);
            const centerIdx = numPoints + p;
            const ctx = centerIdx % QS;
            const cty = (centerIdx / QS) | 0;

            // ---- front faces
            if (n === 3) {
                for (let k = 0; k < 3; k++) {
                    put(px[k], py[k], cx, cy, ptx[k], pty[k], 0, 0, KIND_FRONT, 0, rand);
                }
            } else {
                for (let k = 0; k < n; k++) {
                    const j = (k + 1) % n;
                    put(cx, cy, cx, cy, ctx, cty, 0, 0, KIND_FRONT, 0, rand);
                    put(px[k], py[k], cx, cy, ptx[k], pty[k], 0, 0, KIND_FRONT, 0, rand);
                    put(px[j], py[j], cx, cy, ptx[j], pty[j], 0, 0, KIND_FRONT, 0, rand);
                }
            }

            // ---- back faces (reversed winding, pushed to the base plane)
            if (n === 3) {
                for (const k of [0, 2, 1]) {
                    put(px[k], py[k], cx, cy, ptx[k], pty[k], 0, 0, KIND_BACK, 1, rand);
                }
            } else {
                for (let k = 0; k < n; k++) {
                    const j = (k + 1) % n;
                    put(cx, cy, cx, cy, ctx, cty, 0, 0, KIND_BACK, 1, rand);
                    put(px[j], py[j], cx, cy, ptx[j], pty[j], 0, 0, KIND_BACK, 1, rand);
                    put(px[k], py[k], cx, cy, ptx[k], pty[k], 0, 0, KIND_BACK, 1, rand);
                }
            }

            // ---- side walls, from the front facet down to the base plane
            if (solid) {
                for (let k = 0; k < n; k++) {
                    const j = (k + 1) % n;
                    const ex = px[j] - px[k];
                    const ey = py[j] - py[k];
                    const len = Math.hypot(ex, ey) || 1;
                    const nx = ey / len;
                    const ny = -ex / len;
                    put(px[k], py[k], cx, cy, ptx[k], pty[k], nx, ny, KIND_SIDE, 0, rand);
                    put(px[j], py[j], cx, cy, ptx[j], pty[j], nx, ny, KIND_SIDE, 0, rand);
                    put(px[j], py[j], cx, cy, ptx[j], pty[j], nx, ny, KIND_SIDE, 1, rand);
                    put(px[k], py[k], cx, cy, ptx[k], pty[k], nx, ny, KIND_SIDE, 0, rand);
                    put(px[j], py[j], cx, cy, ptx[j], pty[j], nx, ny, KIND_SIDE, 1, rand);
                    put(px[k], py[k], cx, cy, ptx[k], pty[k], nx, ny, KIND_SIDE, 1, rand);
                }
            }
        }

        this.vertexCount = v;
        const previous = this.geometry;
        this.geometry = this._makeGeometry(v);
        this.object.geometry = this.geometry;
        if (previous) previous.dispose();

        this.topo = topo;
        // world position of every point, used by the per-polygon plane fit
        this._pointX = new Float32Array(numPoints);
        this._pointY = new Float32Array(numPoints);
        for (let j = 0; j < numPoints; j++) {
            this._pointX[j] = toWorldX(pointsXY[j * 2]);
            this._pointY[j] = toWorldY(pointsXY[j * 2 + 1]);
        }
        this._centerWorld = new Float32Array(plateCount * 2);
        for (let p = 0; p < plateCount; p++) {
            this._centerWorld[p * 2] = toWorldX(centerXY[p * 2]);
            this._centerWorld[p * 2 + 1] = toWorldY(centerXY[p * 2 + 1]);
        }
        this._shaped = new Float32Array(numPoints);
        this._sumR = new Float32Array(plateCount);
        this._sumG = new Float32Array(plateCount);
        this._sumB = new Float32Array(plateCount);
        this._sumRn = new Float32Array(plateCount);
        this._sumGn = new Float32Array(plateCount);
        this._sumBn = new Float32Array(plateCount);
        this._count = new Int32Array(plateCount);
        this._plateRn = new Float32Array(plateCount);
        this._plateGn = new Float32Array(plateCount);
        this._plateBn = new Float32Array(plateCount);
        this._pointLum = new Float32Array(numPoints);
        this._hs = new Float32Array(2);
        this.object.visible = true;

        conf.setPlateInfo(`${plateCount} polys · ${(v / 3) | 0} tris`);
    }

    /** Per frame: average the source colours inside every polygon. */
    updateFromPixels(pixels) {
        const topo = this.topo;
        if (!topo) return;
        // the analysis canvas may have been resized before the rebuild landed
        if (topo.plateMap.length * 4 !== pixels.length) return;
        const { plateMap, plateCount, numPoints, centerPixel, pointPlates, cornerOffsets, cornerIndices } = topo;
        const sumR = this._sumR, sumG = this._sumG, sumB = this._sumB;
        const sumRn = this._sumRn, sumGn = this._sumGn, sumBn = this._sumBn;
        const count = this._count;
        sumR.fill(0); sumG.fill(0); sumB.fill(0);
        sumRn.fill(0); sumGn.fill(0); sumBn.fill(0);
        count.fill(0);

        const total = plateMap.length;
        for (let i = 0; i < total; i++) {
            const p = plateMap[i];
            if (p < 0) continue;
            const b = i * 4;
            const r = pixels[b], g = pixels[b + 1], bl = pixels[b + 2];
            sumR[p] += LINEAR[r];
            sumG[p] += LINEAR[g];
            sumB[p] += LINEAR[bl];
            sumRn[p] += NORM[r];
            sumGn[p] += NORM[g];
            sumBn[p] += NORM[bl];
            count[p]++;
        }

        const plateData = this.plateTex.image.data;
        const auxData = this.plateAux.image.data;
        const PS = this.plateTexSize;
        const rn = this._plateRn, gn = this._plateGn, bn = this._plateBn;
        const hs = this._hs;
        for (let p = 0; p < plateCount; p++) {
            let r, g, b, nr, ng, nb;
            const c = count[p];
            if (c > 0) {
                const inv = 1 / c;
                r = sumR[p] * inv; g = sumG[p] * inv; b = sumB[p] * inv;
                nr = sumRn[p] * inv; ng = sumGn[p] * inv; nb = sumBn[p] * inv;
            } else {
                const i = centerPixel[p] * 4;
                r = LINEAR[pixels[i]]; g = LINEAR[pixels[i + 1]]; b = LINEAR[pixels[i + 2]];
                nr = NORM[pixels[i]]; ng = NORM[pixels[i + 1]]; nb = NORM[pixels[i + 2]];
            }
            rn[p] = nr; gn[p] = ng; bn[p] = nb;
            const lum = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb;
            hueSat(nr, ng, nb, hs);
            const o = ((p % PS) + ((p / PS) | 0) * PS) * 4;
            plateData[o] = r;
            plateData[o + 1] = g;
            plateData[o + 2] = b;
            plateData[o + 3] = lum;
            auxData[o] = hs[0];
            auxData[o + 1] = hs[1];
        }
        this.plateTex.needsUpdate = true;
        this.plateAux.needsUpdate = true;

        // shared points average the polygons around them: that is what keeps the
        // surface continuous when "facet separation" is 0
        const pointData = this.pointTex.image.data;
        const QS = this.pointTexSize;
        const { offsets, indices } = pointPlates;
        const pointLum = this._pointLum;
        for (let j = 0; j < numPoints; j++) {
            const from = offsets[j], to = offsets[j + 1];
            let ar = 0, ag = 0, ab = 0;
            for (let k = from; k < to; k++) {
                const p = indices[k];
                ar += rn[p]; ag += gn[p]; ab += bn[p];
            }
            const inv = to > from ? 1 / (to - from) : 0;
            ar *= inv; ag *= inv; ab *= inv;
            const lum = 0.2126 * ar + 0.7152 * ag + 0.0722 * ab;
            hueSat(ar, ag, ab, hs);
            pointLum[j] = lum;
            const o = ((j % QS) + ((j / QS) | 0) * QS) * 4;
            pointData[o] = lum;
            pointData[o + 1] = this.pointRandom[j];
            pointData[o + 2] = hs[0];
            pointData[o + 3] = hs[1];
        }

        // the fan centre of a polygon sits at the mean height of its own corners,
        // so a voronoi cell never turns into a pyramid
        const shaped = this._shaped;
        for (let j = 0; j < numPoints; j++) shaped[j] = shapeLuminance(pointLum[j]);

        const fitData = this.plateFit.image.data;
        const px = this._pointX, py = this._pointY, center = this._centerWorld;
        for (let p = 0; p < plateCount; p++) {
            const from = cornerOffsets[p], to = cornerOffsets[p + 1];
            const n = to - from;
            let sum = 0;
            for (let k = from; k < to; k++) sum += pointLum[cornerIndices[k]];
            const mean = n > 0 ? sum / n : 0;
            const j = numPoints + p;
            const o = ((j % QS) + ((j / QS) | 0) * QS) * 4;
            const po = ((p % PS) + ((p / PS) | 0) * PS) * 4;
            pointData[o] = mean;
            pointData[o + 1] = this.pointRandom[j];
            pointData[o + 2] = auxData[po];
            pointData[o + 3] = auxData[po + 1];

            // least squares plane  s = a + b*dx + c*dy  through the corners,
            // relative to the polygon centre: this is what makes every polygon a
            // genuinely flat (possibly tilted) facet instead of a fan of triangles
            const cx = center[p * 2], cy = center[p * 2 + 1];
            let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, ss = 0, ssx = 0, ssy = 0;
            for (let k = from; k < to; k++) {
                const idx = cornerIndices[k];
                const dx = px[idx] - cx;
                const dy = py[idx] - cy;
                const sv = shaped[idx];
                sx += dx; sy += dy;
                sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
                ss += sv; ssx += dx * sv; ssy += dy * sv;
            }
            let a = n > 0 ? ss / n : 0;
            let b = 0, c = 0;
            if (n >= 3) {
                // 3x3 normal equations, solved with Cramer's rule
                const m00 = n, m01 = sx, m02 = sy;
                const m11 = sxx, m12 = sxy, m22 = syy;
                const det = m00 * (m11 * m22 - m12 * m12)
                    - m01 * (m01 * m22 - m12 * m02)
                    + m02 * (m01 * m12 - m11 * m02);
                if (Math.abs(det) > 1e-12) {
                    const inv = 1 / det;
                    a = inv * (ss * (m11 * m22 - m12 * m12)
                        - m01 * (ssx * m22 - m12 * ssy)
                        + m02 * (ssx * m12 - m11 * ssy));
                    b = inv * (m00 * (ssx * m22 - m12 * ssy)
                        - ss * (m01 * m22 - m12 * m02)
                        + m02 * (m01 * ssy - ssx * m02));
                    c = inv * (m00 * (m11 * ssy - ssx * m12)
                        - m01 * (m01 * ssy - ssx * m02)
                        + ss * (m01 * m12 - m11 * m02));
                }
            }
            fitData[po] = a;
            fitData[po + 1] = b;
            fitData[po + 2] = c;
        }
        this.pointTex.needsUpdate = true;
        this.plateFit.needsUpdate = true;
    }

    syncUniforms() {
        const u = this.u;
        u.morph.value = conf.morph;
        u.flatten.value = conf.flatten;
        u.shadeOnset.value = conf.shadeOnset;

        u.extrude.value = conf.extrude;
        u.depthGamma.value = conf.depthGamma;
        u.invert.value = conf.invertDepth ? 1 : 0;
        u.baseOffset.value = conf.baseOffset;
        u.separation.value = conf.separation;
        u.shrink.value = conf.shrink;
        u.thickness.value = conf.thickness;
        u.rootToWall.value = conf.rootToWall;
        u.jitter.value = conf.jitter;
        u.wobble.value = conf.wobble;
        u.wobbleSpeed.value = conf.wobbleSpeed;

        const modes = { off: 0, radial: 1, linear: 2, both: 3 };
        u.shapeMode.value = modes[conf.shapeMode] ?? 0;
        u.shapeAmount.value = conf.shapeAmount;
        u.maskFloor.value = conf.maskFloor;
        u.maskInvert.value = conf.maskInvert ? 1 : 0;
        u.maskRadius.value = conf.maskRadius;
        u.maskSoftness.value = conf.maskSoftness;
        const drift = conf.maskAnim * Math.sin(conf.time * conf.maskAnimSpeed);
        u.maskCenter.value.set(conf.maskX + drift, conf.maskY);
        u.maskPosition.value = conf.maskPosition + drift;
        const a = THREE.MathUtils.degToRad(conf.maskAngle);
        u.maskDir.value.set(Math.cos(a), Math.sin(a));
        u.lumAmount.value = conf.lumAmount;
        u.lumMin.value = conf.lumMin;
        u.lumMax.value = conf.lumMax;
        u.lumSoftness.value = conf.lumSoftness;
        u.plasmaAmount.value = conf.plasmaMask;
        u.plasmaScale.value = conf.plasmaScale;
        const plasmaDrift = conf.time * conf.plasmaAnimSpeed * 0.05;
        u.plasmaOffset.value.set(conf.plasmaOffsetX + plasmaDrift, conf.plasmaOffsetY);
        u.plasmaThreshold.value = conf.plasmaThreshold;
        u.plasmaSoftness.value = conf.plasmaSoftness;
        u.plasmaInvert.value = conf.plasmaMaskInvert ? 1 : 0;
        if (this.plasmaTexture) {
            u.plasmaSize.value.set(this.plasmaTexture.image.width, this.plasmaTexture.image.height);
        }
        u.hueAmount.value = conf.hueAmount;
        u.hueTarget.value = (conf.hueTarget % 360) / 360;
        u.hueWidth.value = conf.hueWidth;
        u.hueSoftness.value = conf.hueSoftness;
        u.satMin.value = conf.satMin;

        u.exposure.value = conf.exposure;
        u.saturation.value = conf.saturation;
        u.contrast.value = conf.contrast;
        u.gradeGamma.value = conf.gradeGamma;
        u.quantize.value = conf.quantize;
        u.sideDarken.value = conf.sideDarken;
        u.backDarken.value = conf.backDarken;
        u.depthShade.value = conf.depthShade;
        u.emissive.value = conf.emissive;

        u.roughness.value = conf.roughness;
        u.roughByLum.value = conf.roughnessByLum;
        u.metalness.value = conf.metalness;

        if (this.material.wireframe !== conf.wireframe) this.material.wireframe = conf.wireframe;
        this.object.castShadow = conf.shadows;
        this.object.receiveShadow = conf.shadows;
    }
}

export default PolyMesh;
