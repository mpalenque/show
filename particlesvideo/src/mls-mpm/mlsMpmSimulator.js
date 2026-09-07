import * as THREE from "three/webgpu";
import {
    array,
    Fn,
    If,
    instancedArray,
    instanceIndex,
    Return,
    uniform,
    int,
    float,
    Loop,
    vec3,
    vec4,
    atomicAdd,
    uint,
    max,
    pow,
    mat3,
    clamp,
    time,
    cross, mix, mx_hsvtorgb, select, ivec3
} from "three/tsl";
import {triNoise3Dvec} from "../common/noise";
import {conf} from "../conf";
import {StructuredArray} from "./structuredArray.js";
import {hsvtorgb} from "../common/hsv.js";
import ImageGridSampler from "../imageGridSampler.js";

class mlsMpmSimulator {
    renderer = null;
    numParticles = 0;
    gridSize = new THREE.Vector3(0,0,0);
    gridCellSize = new THREE.Vector3(0,0,0);
    uniforms = {};
    kernels = {};
    fixedPointMultiplier = 1e7;
    mousePos = new THREE.Vector3();
    mousePosArray = [];
    imageGridSampler = null;
    imageUploadManager = null;
    particleLifetimes = null;
    particleAlive = null;
    emissionAccumulator = 0;
    emissionCursor = 0;
    pixelOrder = [];
    pixelOrderCursor = 0;
    cachedPixelData = null;
    videoSamplingGeneration = 0;
    videoSamplePending = false;
    lastVideoSampleTime = 0;
    particleOpacity = 1.0;
    isFading = false;
    fadeSpeed = 3.0; // Speed of fade in/out

    constructor(renderer) {
        this.renderer = renderer;
        this.imageGridSampler = new ImageGridSampler();
    }
    async init() {
        const {maxParticles} = conf;
        this.gridSize.set(64,64,64);

        const particleStruct =  {
            position: { type: 'vec3' },
            density: { type: 'float' },
            velocity: { type: 'vec3' },
            mass: { type: 'float' },
            C: { type: 'mat3' },
            direction: { type: 'vec3' },
            color: { type: 'vec3' },
            birthTime: { type: 'float' },
            lifetime: { type: 'float' },
            alive: { type: 'uint' },
        };
        this.particleBuffer = new StructuredArray(particleStruct, maxParticles, "particleData");
        this.particleLifetimes = new Float32Array(maxParticles);
        this.particleAlive = new Uint8Array(maxParticles);

        // Initialize particles with sphere pattern
        this.initParticlesWithSphere(maxParticles);
        this.particleBuffer.updateAll();

        const cellCount = this.gridSize.x * this.gridSize.y * this.gridSize.z;
        const cellStruct ={
            x: { type: 'int', atomic: true },
            y: { type: 'int', atomic: true },
            z: { type: 'int', atomic: true },
            mass: { type: 'int', atomic: true },
        };
        this.cellBuffer = new StructuredArray(cellStruct, cellCount, "cellData");
        this.cellBufferF = instancedArray(cellCount, 'vec4').label('cellDataF');

        this.uniforms.gravityType = uniform(0, "uint");
        this.uniforms.gravity = uniform(new THREE.Vector3());
        this.uniforms.stiffness = uniform(0);
        this.uniforms.restDensity = uniform(0);
        this.uniforms.dynamicViscosity = uniform(0);
        this.uniforms.noise = uniform(0);

        this.uniforms.gridSize = uniform(this.gridSize, "ivec3");
        this.uniforms.gridCellSize = uniform(this.gridCellSize);
        this.uniforms.dt = uniform(0.1);
        this.uniforms.elapsedTime = uniform(0);
        this.uniforms.numParticles = uniform(0, "uint");

        this.uniforms.mouseRayDirection = uniform(new THREE.Vector3());
        this.uniforms.mouseRayOrigin = uniform(new THREE.Vector3());
        this.uniforms.mouseForce = uniform(new THREE.Vector3());
        this.uniforms.force = uniform(1);
        this.uniforms.containParticles = uniform(1, "uint");
        this.uniforms.useImageEmission = uniform(0, "uint");
        this.uniforms.emissionDirection = uniform(new THREE.Vector3(0, 0, -1));
        this.uniforms.emissionVelocity = uniform(0);

        this.kernels.clearGrid = Fn(() => {
            this.cellBuffer.setAtomic("x", false);
            this.cellBuffer.setAtomic("y", false);
            this.cellBuffer.setAtomic("z", false);
            this.cellBuffer.setAtomic("mass", false);

            If(instanceIndex.greaterThanEqual(uint(cellCount)), () => {
                Return();
            });

            this.cellBuffer.element(instanceIndex).get('x').assign(0);
            this.cellBuffer.element(instanceIndex).get('y').assign(0);
            this.cellBuffer.element(instanceIndex).get('z').assign(0);
            this.cellBuffer.element(instanceIndex).get('mass').assign(0);
            this.cellBufferF.element(instanceIndex).assign(0);
        })().compute(cellCount);

        const encodeFixedPoint = (f32) => {
            return int(f32.mul(this.fixedPointMultiplier));
        }
        const decodeFixedPoint = (i32) => {
            return float(i32).div(this.fixedPointMultiplier);
        }

        const getCellPtr = (ipos) => {
            const gridSize = this.uniforms.gridSize;
            const cellPtr = int(ipos.x).mul(gridSize.y).mul(gridSize.z).add(int(ipos.y).mul(gridSize.z)).add(int(ipos.z)).toConst();
            return cellPtr;
        };
        const getCell = (ipos) => {
            return this.cellBuffer.element(getCellPtr(ipos));
        };

        this.kernels.p2g1 = Fn(() => {
            this.cellBuffer.setAtomic("x", true);
            this.cellBuffer.setAtomic("y", true);
            this.cellBuffer.setAtomic("z", true);
            this.cellBuffer.setAtomic("mass", true);

            If(instanceIndex.greaterThanEqual(uint(this.uniforms.numParticles)), () => {
                Return();
            });
            If(this.particleBuffer.element(instanceIndex).get('alive').equal(uint(0)), () => {
                Return();
            });
            const particlePosition = this.particleBuffer.element(instanceIndex).get('position').xyz.toConst("particlePosition");
            const particleVelocity = this.particleBuffer.element(instanceIndex).get('velocity').xyz.toConst("particleVelocity");
            If(
                particlePosition.x.lessThan(2).or(particlePosition.x.greaterThan(this.uniforms.gridSize.x.sub(2)))
                    .or(particlePosition.y.lessThan(2)).or(particlePosition.y.greaterThan(this.uniforms.gridSize.y.sub(2)))
                    .or(particlePosition.z.lessThan(2)).or(particlePosition.z.greaterThan(this.uniforms.gridSize.z.sub(2))),
                () => { Return(); }
            );

            const cellIndex =  ivec3(particlePosition).sub(1).toConst("cellIndex");
            const cellDiff = particlePosition.fract().sub(0.5).toConst("cellDiff");
            const w0 = float(0.5).mul(float(0.5).sub(cellDiff)).mul(float(0.5).sub(cellDiff));
            const w1 = float(0.75).sub(cellDiff.mul(cellDiff));
            const w2 = float(0.5).mul(float(0.5).add(cellDiff)).mul(float(0.5).add(cellDiff));
            const weights = array([w0,w1,w2]).toConst("weights");

            const C = this.particleBuffer.element(instanceIndex).get('C').toConst();
            Loop({ start: 0, end: 3, type: 'int', name: 'gx', condition: '<' }, ({gx}) => {
                Loop({ start: 0, end: 3, type: 'int', name: 'gy', condition: '<' }, ({gy}) => {
                    Loop({ start: 0, end: 3, type: 'int', name: 'gz', condition: '<' }, ({gz}) => {
                        const weight = weights.element(gx).x.mul(weights.element(gy).y).mul(weights.element(gz).z);
                        const cellX = cellIndex.add(ivec3(gx,gy,gz)).toConst();
                        const cellDist = vec3(cellX).add(0.5).sub(particlePosition).toConst("cellDist");
                        const Q = C.mul(cellDist);

                        const massContrib = weight; // assuming particle mass = 1.0
                        const velContrib = massContrib.mul(particleVelocity.add(Q)).toConst("velContrib");
                        const cell = getCell(cellX);
                        atomicAdd(cell.get('x'), encodeFixedPoint(velContrib.x));
                        atomicAdd(cell.get('y'), encodeFixedPoint(velContrib.y));
                        atomicAdd(cell.get('z'), encodeFixedPoint(velContrib.z));
                        atomicAdd(cell.get('mass'), encodeFixedPoint(massContrib));
                    });
                });
            });
        })().compute(1);


        this.kernels.p2g2 = Fn(() => {
            this.cellBuffer.setAtomic("x", true);
            this.cellBuffer.setAtomic("y", true);
            this.cellBuffer.setAtomic("z", true);
            this.cellBuffer.setAtomic("mass", false);

            If(instanceIndex.greaterThanEqual(uint(this.uniforms.numParticles)), () => {
                Return();
            });
            If(this.particleBuffer.element(instanceIndex).get('alive').equal(uint(0)), () => {
                Return();
            });
            const particlePosition = this.particleBuffer.element(instanceIndex).get('position').xyz.toConst("particlePosition");
            If(
                particlePosition.x.lessThan(2).or(particlePosition.x.greaterThan(this.uniforms.gridSize.x.sub(2)))
                    .or(particlePosition.y.lessThan(2)).or(particlePosition.y.greaterThan(this.uniforms.gridSize.y.sub(2)))
                    .or(particlePosition.z.lessThan(2)).or(particlePosition.z.greaterThan(this.uniforms.gridSize.z.sub(2))),
                () => { Return(); }
            );

            const cellIndex =  ivec3(particlePosition).sub(1).toConst("cellIndex");
            const cellDiff = particlePosition.fract().sub(0.5).toConst("cellDiff");
            const w0 = float(0.5).mul(float(0.5).sub(cellDiff)).mul(float(0.5).sub(cellDiff));
            const w1 = float(0.75).sub(cellDiff.mul(cellDiff));
            const w2 = float(0.5).mul(float(0.5).add(cellDiff)).mul(float(0.5).add(cellDiff));
            const weights = array([w0,w1,w2]).toConst("weights");

            const density = float(0).toVar("density");
            Loop({ start: 0, end: 3, type: 'int', name: 'gx', condition: '<' }, ({gx}) => {
                Loop({ start: 0, end: 3, type: 'int', name: 'gy', condition: '<' }, ({gy}) => {
                    Loop({ start: 0, end: 3, type: 'int', name: 'gz', condition: '<' }, ({gz}) => {
                        const weight = weights.element(gx).x.mul(weights.element(gy).y).mul(weights.element(gz).z);
                        const cellX = cellIndex.add(ivec3(gx,gy,gz)).toConst();
                        const cell = getCell(cellX);
                        density.addAssign(decodeFixedPoint(cell.get('mass')).mul(weight));
                    });
                });
            });
            const densityStore = this.particleBuffer.element(instanceIndex).get('density');
            densityStore.assign(mix(densityStore, density, 0.05));

            const volume = float(1).div(density);
            const pressure = max(0.0, pow(density.div(this.uniforms.restDensity), 5.0).sub(1).mul(this.uniforms.stiffness)).toConst('pressure');
            const stress = mat3(pressure.negate(), 0, 0, 0, pressure.negate(), 0, 0, 0, pressure.negate()).toVar('stress');
            const dudv = this.particleBuffer.element(instanceIndex).get('C').toConst('C');

            const strain = dudv.add(dudv.transpose());
            stress.addAssign(strain.mul(this.uniforms.dynamicViscosity));
            const eq16Term0 = volume.mul(-4).mul(stress).mul(this.uniforms.dt);

            Loop({ start: 0, end: 3, type: 'int', name: 'gx', condition: '<' }, ({gx}) => {
                Loop({ start: 0, end: 3, type: 'int', name: 'gy', condition: '<' }, ({gy}) => {
                    Loop({ start: 0, end: 3, type: 'int', name: 'gz', condition: '<' }, ({gz}) => {
                        const weight = weights.element(gx).x.mul(weights.element(gy).y).mul(weights.element(gz).z);
                        const cellX = cellIndex.add(ivec3(gx,gy,gz)).toConst();
                        const cellDist = vec3(cellX).add(0.5).sub(particlePosition).toConst("cellDist");
                        const cell= getCell(cellX);

                        const momentum = eq16Term0.mul(weight).mul(cellDist).toConst("momentum");
                        atomicAdd(cell.get('x'), encodeFixedPoint(momentum.x));
                        atomicAdd(cell.get('y'), encodeFixedPoint(momentum.y));
                        atomicAdd(cell.get('z'), encodeFixedPoint(momentum.z));
                    });
                });
            });
        })().compute(1);


        this.kernels.updateGrid = Fn(() => {
            this.cellBuffer.setAtomic("x", false);
            this.cellBuffer.setAtomic("y", false);
            this.cellBuffer.setAtomic("z", false);
            this.cellBuffer.setAtomic("mass", false);

            If(instanceIndex.greaterThanEqual(uint(cellCount)), () => {
                Return();
            });
            const cell = this.cellBuffer.element(instanceIndex).toConst("cell");

            const mass = decodeFixedPoint(cell.get('mass')).toConst();
            If(mass.lessThanEqual(0), () => { Return(); });

            const vx = decodeFixedPoint(cell.get('x')).div(mass).toVar();
            const vy = decodeFixedPoint(cell.get('y')).div(mass).toVar();
            const vz = decodeFixedPoint(cell.get('z')).div(mass).toVar();

            const x = int(instanceIndex).div(this.uniforms.gridSize.z).div(this.uniforms.gridSize.y);
            const y = int(instanceIndex).div(this.uniforms.gridSize.z).mod(this.uniforms.gridSize.y);
            const z = int(instanceIndex).mod(this.uniforms.gridSize.z);


            If(x.lessThan(int(2)).or(x.greaterThan(this.uniforms.gridSize.x.sub(int(2)))), () => {
                vx.assign(0);
            });
            If(y.lessThan(int(2)).or(y.greaterThan(this.uniforms.gridSize.y.sub(int(2)))), () => {
                vy.assign(0);
            });
            If(z.lessThan(int(2)).or(z.greaterThan(this.uniforms.gridSize.z.sub(int(2)))), () => {
                vz.assign(0);
            });

            this.cellBufferF.element(instanceIndex).assign(vec4(vx,vy,vz,mass));
        })().compute(cellCount);

        this.kernels.g2p = Fn(() => {
            If(instanceIndex.greaterThanEqual(uint(this.uniforms.numParticles)), () => {
                Return();
            });
            If(this.particleBuffer.element(instanceIndex).get('alive').equal(uint(0)), () => {
                Return();
            });
            const particleMass = this.particleBuffer.element(instanceIndex).get('mass').toConst("particleMass");
            const particleDensity = this.particleBuffer.element(instanceIndex).get('density').toConst("particleDensity");
            const particlePosition = this.particleBuffer.element(instanceIndex).get('position').xyz.toVar("particlePosition");
            const storedParticleVelocity = this.particleBuffer.element(instanceIndex).get('velocity').xyz.toConst("storedParticleVelocity");
            If(this.uniforms.containParticles.equal(uint(0)), () => {
                If(
                    particlePosition.x.lessThan(2).or(particlePosition.x.greaterThan(this.uniforms.gridSize.x.sub(2)))
                        .or(particlePosition.y.lessThan(2)).or(particlePosition.y.greaterThan(this.uniforms.gridSize.y.sub(2)))
                        .or(particlePosition.z.lessThan(2)).or(particlePosition.z.greaterThan(this.uniforms.gridSize.z.sub(2))),
                    () => {
                        particlePosition.addAssign(storedParticleVelocity.mul(this.uniforms.dt));
                        this.particleBuffer.element(instanceIndex).get('position').assign(particlePosition);
                        Return();
                    }
                );
            });
            const particleVelocity = vec3(0).toVar();
            If(this.uniforms.gravityType.equal(uint(2)), () => {
                const pn = particlePosition.div(vec3(this.uniforms.gridSize.sub(1))).sub(0.5).normalize().toConst();
                particleVelocity.subAssign(pn.mul(0.3).mul(this.uniforms.dt));
            }).Else(() => {
                particleVelocity.addAssign(this.uniforms.gravity.mul(this.uniforms.dt));
            });

            If(this.uniforms.useImageEmission.equal(uint(1)), () => {
                particleVelocity.addAssign(this.uniforms.emissionDirection.mul(this.uniforms.emissionVelocity).mul(this.uniforms.dt));
            });


            const noise = triNoise3Dvec(particlePosition.mul(0.015), time, 0.11).sub(0.285).normalize().mul(0.28).toVar();
            particleVelocity.subAssign(noise.mul(this.uniforms.noise).mul(this.uniforms.dt));

            const cellIndex =  ivec3(particlePosition).sub(1).toConst("cellIndex");
            const cellDiff = particlePosition.fract().sub(0.5).toConst("cellDiff");

            const w0 = float(0.5).mul(float(0.5).sub(cellDiff)).mul(float(0.5).sub(cellDiff));
            const w1 = float(0.75).sub(cellDiff.mul(cellDiff));
            const w2 = float(0.5).mul(float(0.5).add(cellDiff)).mul(float(0.5).add(cellDiff));
            const weights = array([w0,w1,w2]).toConst("weights");

            const B = mat3(0).toVar("B");
            Loop({ start: 0, end: 3, type: 'int', name: 'gx', condition: '<' }, ({gx}) => {
                Loop({ start: 0, end: 3, type: 'int', name: 'gy', condition: '<' }, ({gy}) => {
                    Loop({ start: 0, end: 3, type: 'int', name: 'gz', condition: '<' }, ({gz}) => {
                        const weight = weights.element(gx).x.mul(weights.element(gy).y).mul(weights.element(gz).z);
                        const cellX = cellIndex.add(ivec3(gx,gy,gz)).toConst();
                        const cellDist = vec3(cellX).add(0.5).sub(particlePosition).toConst("cellDist");
                        const cellPtr = getCellPtr(cellX);

                        const weightedVelocity = this.cellBufferF.element(cellPtr).xyz.mul(weight).toConst("weightedVelocity");
                        const term = mat3(
                            weightedVelocity.mul(cellDist.x),
                            weightedVelocity.mul(cellDist.y),
                            weightedVelocity.mul(cellDist.z)
                        );
                        B.addAssign(term);
                        particleVelocity.addAssign(weightedVelocity);
                    });
                });
            });

            const dist = cross(this.uniforms.mouseRayDirection, particlePosition.sub(this.uniforms.mouseRayOrigin)).length()
            const force = dist.mul(0.1).oneMinus().max(0.0).pow(2);
            //particleVelocity.assign(mix(particleVelocity, this.uniforms.mouseForce.mul(6), force));
            particleVelocity.addAssign(this.uniforms.mouseForce.mul(this.uniforms.force).mul(force));
            particleVelocity.mulAssign(particleMass); // to ensure difference between particles

            this.particleBuffer.element(instanceIndex).get('C').assign(B.mul(4));
            particlePosition.addAssign(particleVelocity.mul(this.uniforms.dt));
            If(this.uniforms.containParticles.equal(uint(1)), () => {
                particlePosition.assign(clamp(particlePosition, vec3(2), this.uniforms.gridSize.sub(2)));

                const wallStiffness = 0.3;
                const xN = particlePosition.add(particleVelocity.mul(this.uniforms.dt).mul(3.0)).toConst("xN");
                const wallMin = vec3(3).toConst("wallMin");
                const wallMax = vec3(this.uniforms.gridSize).sub(3).toConst("wallMax");
                If(xN.x.lessThan(wallMin.x), () => { particleVelocity.x.addAssign(wallMin.x.sub(xN.x).mul(wallStiffness)); });
                If(xN.x.greaterThan(wallMax.x), () => { particleVelocity.x.addAssign(wallMax.x.sub(xN.x).mul(wallStiffness)); });
                If(xN.y.lessThan(wallMin.y), () => { particleVelocity.y.addAssign(wallMin.y.sub(xN.y).mul(wallStiffness)); });
                If(xN.y.greaterThan(wallMax.y), () => { particleVelocity.y.addAssign(wallMax.y.sub(xN.y).mul(wallStiffness)); });
                If(xN.z.lessThan(wallMin.z), () => { particleVelocity.z.addAssign(wallMin.z.sub(xN.z).mul(wallStiffness)); });
                If(xN.z.greaterThan(wallMax.z), () => { particleVelocity.z.addAssign(wallMax.z.sub(xN.z).mul(wallStiffness)); });
            });

            this.particleBuffer.element(instanceIndex).get('position').assign(particlePosition)
            this.particleBuffer.element(instanceIndex).get('velocity').assign(particleVelocity)

            const direction = this.particleBuffer.element(instanceIndex).get('direction');
            direction.assign(mix(direction,particleVelocity, 0.1));

            If(this.uniforms.useImageEmission.equal(uint(0)), () => {
                const simulationColor = hsvtorgb(vec3(particleDensity.div(this.uniforms.restDensity).mul(0.25).add(time.mul(0.05)), particleVelocity.length().mul(0.5).clamp(0,1).mul(0.3).add(0.7), force.mul(0.3).add(0.7)));
                this.particleBuffer.element(instanceIndex).get('color').assign(simulationColor);
            });
        })().compute(1);
    }

    setMouseRay(origin, direction, pos) {
        const worldToSimulationScale = new THREE.Vector3(64 / 8, 64 / 3, 64 / 3);
        const simulationOrigin = origin.clone().add(new THREE.Vector3(4, 0, 0)).multiply(worldToSimulationScale);
        const simulationDirection = direction.clone().multiply(worldToSimulationScale).normalize();
        const simulationPosition = pos.clone().add(new THREE.Vector3(4, 0, 0)).multiply(worldToSimulationScale);

        this.uniforms.mouseRayDirection.value.copy(simulationDirection);
        this.uniforms.mouseRayOrigin.value.copy(simulationOrigin);
        this.mousePos.copy(simulationPosition);
    }

    async update(interval, elapsed) {
        const { particles, run, noise, noiseVariationAmplitude, noiseVariationSpeed, force, dynamicViscosity, stiffness, restDensity, speed, gravity, gravitySensorReading, accelerometerReading } = conf;

        const noiseVariation = noiseVariationSpeed > 0
            ? noiseVariationAmplitude * (0.5 + 0.5 * Math.sin(elapsed * noiseVariationSpeed * Math.PI * 2))
            : 0;
        this.uniforms.noise.value = noise + noiseVariation;
        this.uniforms.elapsedTime.value = elapsed;
        this.uniforms.force.value = force;
        this.uniforms.containParticles.value = conf.containParticles ? 1 : 0;
        this.uniforms.stiffness.value = stiffness;
        this.uniforms.gravityType.value = gravity;
        this.uniforms.gravity.value.set(0,0,0);
        if (gravity === 0) {
            this.uniforms.gravity.value.set(0,0,0.2);
        } else if (gravity === 1) {
            this.uniforms.gravity.value.set(0,-0.2,0);
        } else if (gravity === 3) {
            this.uniforms.gravity.value.copy(gravitySensorReading).add(accelerometerReading);
        }
        this.uniforms.dynamicViscosity.value = dynamicViscosity;
        this.uniforms.restDensity.value = restDensity;
        this.uniforms.useImageEmission.value = conf.useImageEmission && this.imageUploadManager ? 1 : 0;
        this.uniforms.emissionDirection.value.set(
            conf.emissionDirectionX,
            conf.emissionDirectionY,
            conf.emissionDirectionZ
        );
        if (this.uniforms.emissionDirection.value.lengthSq() > 0) {
            this.uniforms.emissionDirection.value.normalize();
        }
        this.uniforms.emissionVelocity.value = conf.emissionVelocity;

        if (conf.useImageEmission && this.imageUploadManager) {
            this.updateEmitter(interval, elapsed);
        }

        if (particles !== this.numParticles) {
            this.numParticles = particles;
            this.uniforms.numParticles.value = particles;
            this.kernels.p2g1.count = particles;
            this.kernels.p2g1.updateDispatchCount();
            this.kernels.p2g2.count = particles;
            this.kernels.p2g2.updateDispatchCount();
            this.kernels.g2p.count = particles;
            this.kernels.g2p.updateDispatchCount();
        }

        interval = Math.min(interval, 1/60);
        const dt = interval * 6 * speed;
        this.uniforms.dt.value = dt;

        this.mousePosArray.push(this.mousePos.clone())
        if (this.mousePosArray.length > 3) { this.mousePosArray.shift(); }
        if (this.mousePosArray.length > 1) {
            this.uniforms.mouseForce.value.copy(this.mousePosArray[this.mousePosArray.length - 1]).sub(this.mousePosArray[0]).divideScalar(this.mousePosArray.length);
        }


        if (run) {
            const kernels = [this.kernels.clearGrid, this.kernels.p2g1, this.kernels.p2g2, this.kernels.updateGrid, this.kernels.g2p];
            await this.renderer.computeAsync(kernels);
        }
    }

    /**
     * Initialize particles in a sphere pattern (original behavior)
     */
    initParticlesWithSphere(maxParticles) {
        const vec = new THREE.Vector3();
        for (let i = 0; i < maxParticles; i++) {
            let dist = 2;
            while (dist > 1) {
                vec.set(Math.random(), Math.random(), Math.random())
                    .multiplyScalar(2.0)
                    .subScalar(1.0);
                dist = vec.length();
                vec.multiplyScalar(0.8).addScalar(1.0).divideScalar(2.0).multiply(this.gridSize);
            }
            const mass = 1.0 - Math.random() * 0.002;
            this.particleBuffer.set(i, "position", vec);
            this.particleBuffer.set(i, "mass", mass);
            this.particleBuffer.set(i, "birthTime", 0);
            this.particleBuffer.set(i, "lifetime", 999999);
            this.particleBuffer.set(i, "alive", 1);
        }
    }

    /**
     * Initialize particles from an image/video source
     * @param {ImageUploadManager} imageUploadManager - The upload manager with loaded image/video
     */
    async initializeFromImage(imageUploadManager) {
        const texture = imageUploadManager.getTexture();
        const imageDataInfo = imageUploadManager.getImageData();

        if (!texture || !imageDataInfo) {
            console.error('No image/video loaded');
            return;
        }

        this.imageUploadManager = imageUploadManager;
        this.emissionAccumulator = conf.emissionInterval;
        this.emissionCursor = 0;
        this.pixelOrder = [];
        this.pixelOrderCursor = 0;
        this.cachedPixelData = this.imageGridSampler.extractPixelData(
            imageDataInfo.element,
            conf.gridResolution
        );
        this.videoSamplingGeneration++;
        if (imageUploadManager.isVideoSource()) {
            this.startVideoSampling(imageDataInfo.element, this.videoSamplingGeneration);
        }

        for (let i = 0; i < conf.particles; i++) {
            this.particleLifetimes[i] = 0;
            this.particleAlive[i] = 0;
            this.particleBuffer.set(i, "alive", 0);
        }
        this.particleBuffer.updateAll();

        console.log('Image emitter initialized');
    }

    startVideoSampling(video, generation) {
        const scheduleNextFrame = () => {
            if (generation !== this.videoSamplingGeneration) return;

            if (typeof video.requestVideoFrameCallback === 'function') {
                video.requestVideoFrameCallback(sampleFrame);
            } else {
                setTimeout(() => sampleFrame(performance.now()), 100);
            }
        };

        const sampleFrame = (now) => {
            scheduleNextFrame();
            if (this.videoSamplePending || now - this.lastVideoSampleTime < 100) return;

            this.lastVideoSampleTime = now;
            this.videoSamplePending = true;
            const targetWidth = conf.gridResolution;
            const targetHeight = Math.max(1, Math.round(targetWidth * video.videoHeight / video.videoWidth));

            createImageBitmap(video, {
                resizeWidth: targetWidth,
                resizeHeight: targetHeight,
                resizeQuality: 'pixelated',
            }).then((bitmap) => {
                if (generation === this.videoSamplingGeneration) {
                    this.cachedPixelData = this.imageGridSampler.extractPixelData(bitmap, targetWidth);
                }
                bitmap.close();
            }).catch(() => {
                // Keep the last valid frame when the browser skips a decoded video frame.
            }).finally(() => {
                this.videoSamplePending = false;
            });
        };

        scheduleNextFrame();
    }

    updateEmitter(delta, elapsed) {
        const particleCount = Math.min(conf.particles, this.particleLifetimes.length);
        const changedParticleIndices = [];

        for (let i = 0; i < particleCount; i++) {
            if (this.particleAlive[i] === 0) continue;
            this.particleLifetimes[i] -= delta;
            if (this.particleLifetimes[i] > 0) continue;

            this.particleAlive[i] = 0;
            this.particleBuffer.set(i, "alive", 0);
            changedParticleIndices.push(i);
        }

        this.emissionAccumulator = Math.min(
            this.emissionAccumulator + delta,
            conf.emissionInterval
        );
        if (this.emissionAccumulator < conf.emissionInterval) {
            this.particleBuffer.updateRanges(changedParticleIndices);
            return;
        }
        this.emissionAccumulator = 0;

        if (!this.cachedPixelData) {
            this.particleBuffer.updateRanges(changedParticleIndices);
            return;
        }

        if (!this.imageUploadManager.isVideoSource() && this.cachedPixelData.width !== conf.gridResolution) {
            this.cachedPixelData = this.imageGridSampler.extractPixelData(
                this.imageUploadManager.getImageData().element,
                conf.gridResolution
            );
        }

        const pixelData = this.cachedPixelData;
        const { pixels, width, height } = pixelData;
        const pixelCount = width * height;
        const emissionDirection = new THREE.Vector3(
            conf.emissionDirectionX,
            conf.emissionDirectionY,
            conf.emissionDirectionZ
        );
        if (emissionDirection.lengthSq() > 0) emissionDirection.normalize();
        const spawnCount = conf.emitFullGrid
            ? Math.min(pixelCount, particleCount)
            : conf.emissionBatchSize;

        if (conf.emitFullGrid) this.shufflePixelOrder(pixelCount);
        let emitted = 0;

        for (let attempt = 0; attempt < particleCount && emitted < spawnCount; attempt++) {
            const particleIndex = this.emissionCursor;
            this.emissionCursor = (this.emissionCursor + 1) % particleCount;
            if (this.particleAlive[particleIndex] === 1) continue;

            const pixelIndex = this.getNextPixelIndex(pixelCount);
            const gridX = pixelIndex % width;
            const gridY = Math.floor(pixelIndex / width);
            const position = this.imageGridSampler.getGridWorldPosition(
                gridX,
                gridY,
                width,
                height,
                this.gridSize,
                conf.imageScale
            );
            const color = this.imageGridSampler.samplePixelColor(pixels, gridX, gridY, width, height);

            this.particleBuffer.set(particleIndex, "position", position);
            this.particleBuffer.set(particleIndex, "velocity", emissionDirection.clone().multiplyScalar(conf.emissionVelocity));
            this.particleBuffer.set(particleIndex, "density", 1);
            this.particleBuffer.set(particleIndex, "C", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            this.particleBuffer.set(particleIndex, "direction", emissionDirection);
            this.particleBuffer.set(particleIndex, "color", new THREE.Vector3(color.r, color.g, color.b));
            this.particleBuffer.set(particleIndex, "mass", 1.0 - Math.random() * 0.002);
            this.particleBuffer.set(particleIndex, "birthTime", elapsed);
            this.particleBuffer.set(particleIndex, "lifetime", conf.particleLifetime);
            this.particleBuffer.set(particleIndex, "alive", 1);
            this.particleLifetimes[particleIndex] = conf.particleLifetime;
            this.particleAlive[particleIndex] = 1;
            changedParticleIndices.push(particleIndex);
            emitted++;
        }

        this.particleBuffer.updateRanges(changedParticleIndices);
    }

    shufflePixelOrder(pixelCount) {
        this.pixelOrder = Array.from({ length: pixelCount }, (_, index) => index);
        for (let index = pixelCount - 1; index > 0; index--) {
            const randomIndex = Math.floor(Math.random() * (index + 1));
            const currentPixel = this.pixelOrder[index];
            this.pixelOrder[index] = this.pixelOrder[randomIndex];
            this.pixelOrder[randomIndex] = currentPixel;
        }
        this.pixelOrderCursor = 0;
    }

    getNextPixelIndex(pixelCount) {
        if (this.pixelOrder.length !== pixelCount || this.pixelOrderCursor >= pixelCount) {
            this.shufflePixelOrder(pixelCount);
        }
        return this.pixelOrder[this.pixelOrderCursor++];
    }

    /**
     * Reset particles to sphere pattern
     */
    resetParticlesToSphere() {
        this.initParticlesWithSphere(conf.particles);
        this.imageUploadManager = null;
        this.videoSamplingGeneration++;
        this.cachedPixelData = null;
        this.particleLifetimes.fill(0);
        this.particleAlive.fill(1);
        this.particleBuffer.updateAll();
        this.imageGridSampler.reset();
        console.log('Particles reset to sphere pattern');
    }

}

export default mlsMpmSimulator;