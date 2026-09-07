import * as THREE from 'three/webgpu';
import { Fn, pass, mrt, output, transformedNormalView, uniform, vec4, mix, pow, clamp } from 'three/tsl';
import { ao } from 'three/examples/jsm/tsl/display/GTAONode.js';
import { denoise } from 'three/examples/jsm/tsl/display/DenoiseNode.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { conf } from './conf';

/**
 * Deferred-ish post chain: the scene pass exports colour + view normals, GTAO
 * computes ground truth ambient occlusion from depth/normals, a bilateral
 * denoiser cleans it up, then bloom is added on top.
 */
class PostFx {
    constructor(renderer, scene, camera) {
        this.renderer = renderer;

        const scenePass = pass(scene, camera);
        scenePass.setMRT(mrt({ output, normal: transformedNormalView }));

        const colorTex = scenePass.getTextureNode('output');
        const normalTex = scenePass.getTextureNode('normal');
        const depthTex = scenePass.getTextureNode('depth');

        const aoPass = ao(depthTex, normalTex, camera);
        aoPass.resolutionScale = conf.aoResolutionScale;
        this.aoPass = aoPass;

        const aoRaw = aoPass.getTextureNode();
        const aoSoft = denoise(aoRaw, depthTex, normalTex, camera);
        this.denoisePass = aoSoft;

        this.u = {
            aoStrength: uniform(conf.aoStrength),
            aoDenoise: uniform(conf.aoDenoise),
        };

        const lit = Fn(() => {
            const raw = clamp(aoRaw.r, 0, 1);
            const soft = clamp(aoSoft.r, 0, 1);
            const occ = mix(raw, soft, this.u.aoDenoise);
            const shaded = pow(clamp(occ, 0, 1), this.u.aoStrength);
            return colorTex.rgb.mul(shaded);
        })();

        const bloomPass = bloom(vec4(lit, 1), conf.bloomStrength, conf.bloomRadius, conf.bloomThreshold);
        this.bloomPass = bloomPass;

        const postProcessing = new THREE.PostProcessing(renderer);
        postProcessing.outputNode = vec4(lit.add(bloomPass.rgb), 1);
        this.postProcessing = postProcessing;
    }

    update() {
        const p = this.aoPass;
        p.radius.value = conf.aoRadius;
        p.distanceExponent.value = conf.aoDistanceExponent;
        p.thickness.value = conf.aoThickness;
        p.scale.value = conf.aoScale;
        p.samples.value = conf.aoSamples;
        this.denoisePass.radius.value = conf.aoDenoiseRadius;
        this.u.aoStrength.value = conf.aoStrength;
        this.u.aoDenoise.value = conf.aoDenoise;
        this.bloomPass.strength.value = conf.bloomStrength;
        this.bloomPass.threshold.value = conf.bloomThreshold;
        this.bloomPass.radius.value = conf.bloomRadius;
    }

    setAoResolution(scale) {
        this.aoPass.resolutionScale = scale;
        this.aoPass.setSize(window.innerWidth, window.innerHeight);
    }

    async render() {
        await this.postProcessing.renderAsync();
    }
}

export default PostFx;
