import * as THREE from "three/webgpu";
import {Fn, attribute, triNoise3D, time, vec3, vec4, float, uint, varying,instanceIndex,mix,normalize,cross,mat3,normalLocal,transformNormalToView,mx_hsvtorgb,mrt,uniform,smoothstep} from "three/tsl";
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {conf} from "../conf";


export const calcLookAtMatrix = /*#__PURE__*/ Fn( ( [ target_immutable ] ) => {
    const target = vec3( target_immutable ).toVar();
    const rr = vec3( 0,0,1.0 ).toVar();
    const ww = vec3( normalize( target ) ).toVar();
    const uu = vec3( normalize( cross( ww, rr ) ).negate() ).toVar();
    const vv = vec3( normalize( cross( uu, ww ) ).negate() ).toVar();

    return mat3( uu, vv, ww );
} ).setLayout( {
    name: 'calcLookAtMatrix',
    type: 'mat3',
    inputs: [
        { name: 'direction', type: 'vec3' },
    ]
} );

const createRoundedBox = (width, height, depth, radius) => {
    //completely overengineered late night programming lol
    const box = new THREE.BoxGeometry(width - radius*2, height - radius*2, depth - radius*2);
    const epsilon = Math.min(width, height, depth) * 0.01;
    const positionArray = box.attributes.position.array;
    const normalArray = box.attributes.normal.array;
    const indices = [...(box.getIndex().array)];
    const vertices = [];
    const posMap = {};
    const edgeMap = {};
    for (let i=0; i<positionArray.length / 3; i++) {
        const oldPosition = new THREE.Vector3(positionArray[i*3], positionArray[i*3+1], positionArray[i*3+2]);
        positionArray[i*3+0] += normalArray[i*3+0] * radius;
        positionArray[i*3+1] += normalArray[i*3+1] * radius;
        positionArray[i*3+2] += normalArray[i*3+2] * radius;
        const vertex = new THREE.Vector3(positionArray[i*3], positionArray[i*3+1], positionArray[i*3+2]);
        vertex.normal = new THREE.Vector3(normalArray[i*3], normalArray[i*3+1], normalArray[i*3+2]);
        vertex.id = i;
        vertex.faces = [];
        vertex.posHash = oldPosition.toArray().map(v => Math.round(v / epsilon)).join("_");
        posMap[vertex.posHash] = [...(posMap[vertex.posHash] || []), vertex];
        vertices.push(vertex);
    }
    vertices.forEach(vertex => {
        const face = vertex.normal.toArray().map(v => Math.round(v)).join("_");
        vertex.face = face;
        posMap[vertex.posHash].forEach(vertex => { vertex.faces.push(face); } );
    });
    vertices.forEach(vertex => {
        const addVertexToEdgeMap = (vertex, entry) => {
            edgeMap[entry] = [...(edgeMap[entry] || []), vertex];
        }
        vertex.faces.sort();
        const f0 = vertex.faces[0];
        const f1 = vertex.faces[1];
        const f2 = vertex.faces[2];
        const face = vertex.face;
        if (f0 === face || f1 === face) addVertexToEdgeMap(vertex, f0 + "_" + f1);
        if (f0 === face || f2 === face) addVertexToEdgeMap(vertex, f0 + "_" + f2);
        if (f1 === face || f2 === face) addVertexToEdgeMap(vertex, f1 + "_" + f2);
    });

    const addFace = (v0,v1,v2) => {
        const a = v1.clone().sub(v0);
        const b = v2.clone().sub(v0);
        if (a.cross(b).dot(v0) > 0) {
            indices.push(v0.id, v1.id, v2.id);
        } else {
            indices.push(v0.id, v2.id, v1.id);
        }
    }

    Object.keys(posMap).forEach(key => {
        addFace(...posMap[key])
    });

    Object.keys(edgeMap).forEach(key => {
        const edgeVertices = edgeMap[key];
        const v0 = edgeVertices[0];
        edgeVertices.sort((v1,v2) => v1.distanceTo(v0) - v2.distanceTo(v0));
        addFace(...edgeVertices.slice(0,3));
        addFace(...edgeVertices.slice(1,4));
    });

    box.setIndex(indices);
    return box;
}


class ParticleRenderer {
    mlsMpmSim = null;
    object = null;
    bloom = false;
    uniforms = {};

    constructor(mlsMpmSim) {
        this.mlsMpmSim = mlsMpmSim;

        /*const box = new THREE.BoxGeometry(0.7, 0.7,3);
        const cone = new THREE.ConeGeometry( 0.5, 3.0, 8 );
        cone.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI* 0.5, 0, 0)))
        this.geometry =  new THREE.InstancedBufferGeometry().copy(cone);
        console.log(this.geometry);*/

        //const sphereGeometry = BufferGeometryUtils.mergeVertices(new THREE.IcosahedronGeometry(0.5, 1));
        const boxGeometry = BufferGeometryUtils.mergeVertices(new THREE.BoxGeometry(7, 7,30), 3.0);
        boxGeometry.attributes.position.array = boxGeometry.attributes.position.array.map(v => v*0.1);
        const roundedBoxGeometry = createRoundedBox(0.7,0.7,3,0.1); //BufferGeometryUtils.mergeVertices(new RoundedBoxGeometry(0.7,0.7,3,1,0.1));

        this.defaultIndexCount = roundedBoxGeometry.index.count;
        this.shadowIndexCount = boxGeometry.index.count;

        const mergedGeometry = BufferGeometryUtils.mergeGeometries([roundedBoxGeometry, boxGeometry]);

        this.geometry = new THREE.InstancedBufferGeometry().copy(mergedGeometry);

        this.geometry.setDrawRange(0, this.defaultIndexCount);
        this.geometry.instanceCount = this.mlsMpmSim.numParticles;

        this.material = new THREE.MeshBasicNodeMaterial();
        this.material.transparent = true;
        this.material.depthWrite = false;

        this.uniforms.size = uniform(1);
        this.uniforms.length = uniform(1);
        this.uniforms.minimumBrightness = uniform(0.12);
        const vAo = varying(0, "vAo");
        const vNormal = varying(vec3(0), "v_normalView");

        const particle = this.mlsMpmSim.particleBuffer.element(instanceIndex);
        this.material.positionNode = Fn(() => {
            const particlePosition = particle.get("position");
            const particleDensity = particle.get("density");
            const particleDirection = particle.get("direction");
            const particleAlive = particle.get("alive").equal(uint(1));
            const lifetime = particle.get("lifetime");
            const remainingLifetime = lifetime.sub(this.mlsMpmSim.uniforms.elapsedTime.sub(particle.get("birthTime")));
            const fadeFactor = smoothstep(float(0), float(1), remainingLifetime.div(lifetime.mul(0.15))).mul(float(particleAlive));

            //return attribute("position").xyz.mul(10).add(vec3(32,32,0));
            //return attribute("position").xyz.mul(0.1).add(positionAttribute.mul(vec3(1,1,0.4)));
            const mat = calcLookAtMatrix(particleDirection.xyz);
            vNormal.assign(transformNormalToView(mat.mul(normalLocal)));
            vAo.assign(particlePosition.z.div(64));
            vAo.assign(vAo.mul(vAo).oneMinus());
            return mat.mul(attribute("position").xyz.mul(this.uniforms.size).mul(vec3(1 / 8, 1 / 3, this.uniforms.length))).mul(particleDensity.mul(0.4).add(0.5).clamp(0,1)).mul(fadeFactor).add(particlePosition);
        })();
        this.material.colorNode = particle.get("color").max(vec3(this.uniforms.minimumBrightness));
        this.material.opacityNode = Fn(() => {
            const lifetime = particle.get("lifetime");
            const remainingLifetime = lifetime.sub(this.mlsMpmSim.uniforms.elapsedTime.sub(particle.get("birthTime")));
            return smoothstep(float(0), float(1), remainingLifetime.div(lifetime.mul(0.15))).mul(particle.get("alive").equal(uint(1)));
        })();
        this.material.aoNode = vAo;

        //this.material.fragmentNode = vec4(0,0,0,1);
        //this.material.envNode = vec3(0.5);

        this.object = new THREE.Mesh(this.geometry, this.material);
        this.object.onBeforeShadow = () => { this.geometry.setDrawRange(this.defaultIndexCount, Infinity); }
        this.object.onAfterShadow = () => { this.geometry.setDrawRange(0, this.defaultIndexCount); }


        this.object.frustumCulled = false;

        this.object.position.set(-4,0,0);
        this.object.scale.set(8 / 64, 3 / 64, 3 / 64);
        this.object.castShadow = true;
        this.object.receiveShadow = true;
    }

    update() {
        const { particles, bloom, actualSize, particleLength } = conf;
        this.uniforms.size.value = actualSize;
        this.uniforms.length.value = particleLength;
        this.uniforms.minimumBrightness.value = conf.minimumParticleBrightness;
        this.geometry.instanceCount = particles;

        if (bloom !== this.bloom) {
            this.bloom = bloom;
            this.material.mrtNode = bloom ? mrt( {
                bloomIntensity: 1
            } ) : null;
        }
    }
}
export default ParticleRenderer;