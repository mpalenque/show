import * as THREE from "three/webgpu";
import { conf } from "./conf";

class ImageGridSampler {
    constructor() {
        this.canvas = null;
        this.ctx = null;
    }

    /**
     * Extract pixel data from image/video to a 2D array
     * @param {HTMLImageElement | HTMLVideoElement} source - Image or video element
     * @param {number} resolution - Width of the grid (square grid)
     * @returns {Object} { pixels: Uint8ClampedArray, width, height, originalWidth, originalHeight }
     */
    extractPixelData(source, resolution) {
        if (!this.canvas) {
            this.canvas = document.createElement('canvas');
            this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
            this.ctx.imageSmoothingEnabled = false;
        }

        const sourceWidth = source.videoWidth || source.naturalWidth || source.width;
        const sourceHeight = source.videoHeight || source.naturalHeight || source.height;

        // Maintain aspect ratio
        let targetWidth = resolution;
        let targetHeight = Math.round(resolution * (sourceHeight / sourceWidth));

        // Clamp to grid resolution if needed
        const maxGridSize = 256;
        if (targetHeight > maxGridSize) {
            targetHeight = maxGridSize;
            targetWidth = Math.round(maxGridSize * (sourceWidth / sourceHeight));
        }

        this.canvas.width = targetWidth;
        this.canvas.height = targetHeight;

        // Draw source onto canvas
        this.ctx.drawImage(source, 0, 0, targetWidth, targetHeight);

        // Get pixel data
        const imageData = this.ctx.getImageData(0, 0, targetWidth, targetHeight);
        const pixels = imageData.data;

        return {
            pixels,
            width: targetWidth,
            height: targetHeight,
            originalWidth: sourceWidth,
            originalHeight: sourceHeight,
            imageData,
        };
    }

    /**
     * Sample color from pixel data at grid coordinates
     * @param {Uint8ClampedArray} pixels - Pixel data from extractPixelData
     * @param {number} x - Grid X coordinate (0 to width-1)
     * @param {number} y - Grid Y coordinate (0 to height-1)
     * @param {number} width - Grid width
     * @param {number} height - Grid height
     * @returns {THREE.Color} Color at grid coordinate
     */
    samplePixelColor(pixels, x, y, width, height) {
        // Clamp coordinates
        const ix = Math.max(0, Math.min(Math.floor(x), width - 1));
        const iy = Math.max(0, Math.min(Math.floor(y), height - 1));

        // Get pixel index
        const pixelIndex = (iy * width + ix) * 4;

        // Extract RGBA
        const r = pixels[pixelIndex] / 255;
        const g = pixels[pixelIndex + 1] / 255;
        const b = pixels[pixelIndex + 2] / 255;

        return new THREE.Color(r, g, b);
    }

    /**
     * Get grid position in world space
     * @param {number} gridX - X index in grid (0 to gridWidth-1)
     * @param {number} gridY - Y index in grid (0 to gridHeight-1)
     * @param {number} gridWidth - Total grid width
     * @param {number} gridHeight - Total grid height
     * @param {THREE.Vector3} gridSize - Simulation grid size
     * @param {number} scale - Scale multiplier
     * @returns {THREE.Vector3} World position
     */
    getGridWorldPosition(gridX, gridY, gridWidth, gridHeight, gridSize, scale = 1.0) {
        // Center the grid in the simulation space
        const centerX = gridSize.x / 2;
        const centerY = gridSize.y / 2;
        const centerZ = gridSize.z / 2;

        // Calculate normalized coordinates (-0.5 to 0.5)
        const normX = (gridX / (gridWidth - 1)) - 0.5;
        const normY = 0.5 - (gridY / (gridHeight - 1));

        // Map to simulation grid with scale
        const posX = centerX + normX * gridSize.x * scale;
        const posY = centerY + normY * gridSize.y * scale;
        const posZ = centerZ; // Place at center depth initially

        return new THREE.Vector3(posX, posY, posZ);
    }

    /**
     * Initialize particles in a grid pattern from image
     * @param {Object} imageData - Data from extractPixelData
     * @param {StructuredArray} particleBuffer - Particle buffer to populate
     * @param {number} maxParticles - Maximum particles available
     * @param {THREE.Vector3} gridSize - Simulation grid size
     * @param {number} gridResolution - Target grid resolution (will be adjusted for aspect ratio)
     * @param {number} scale - Scale multiplier for grid
     * @returns {number} Number of particles actually initialized
     */
    initializeParticlesFromImage(
        imageData,
        particleBuffer,
        maxParticles,
        gridSize,
        gridResolution = 32,
        scale = 1.0
    ) {
        const { pixels, width, height } = imageData;

        let particleIndex = 0;
        const totalCells = width * height;

        // Ensure we don't exceed max particles
        const cellsToUse = Math.min(totalCells, maxParticles);

        // Fill remaining particles with sphere pattern (original behavior)
        for (let i = 0; i < maxParticles; i++) {
            if (i < cellsToUse) {
                // Linear index to grid coordinates
                const gridY = Math.floor(i / width);
                const gridX = i % width;

                // Get world position
                const worldPos = this.getGridWorldPosition(gridX, gridY, width, height, gridSize, scale);

                // Sample color from image
                const color = this.samplePixelColor(pixels, gridX, gridY, width, height);

                // Set particle
                particleBuffer.set(i, "position", worldPos);
                particleBuffer.set(i, "color", new THREE.Vector3(color.r, color.g, color.b));
                particleBuffer.set(i, "mass", 1.0 - Math.random() * 0.002);

                particleIndex++;
            } else {
                // Fill remaining with sphere pattern
                let dist = 2;
                const vec = new THREE.Vector3();
                while (dist > 1) {
                    vec.set(Math.random(), Math.random(), Math.random())
                        .multiplyScalar(2.0)
                        .subScalar(1.0);
                    dist = vec.length();
                    vec.multiplyScalar(0.8).addScalar(1.0).divideScalar(2.0).multiply(gridSize);
                }
                particleBuffer.set(i, "position", vec);
                const imageColorIndex = i % totalCells;
                const imageColorX = imageColorIndex % width;
                const imageColorY = Math.floor(imageColorIndex / width);
                const imageColor = this.samplePixelColor(pixels, imageColorX, imageColorY, width, height);
                particleBuffer.set(i, "color", new THREE.Vector3(imageColor.r, imageColor.g, imageColor.b));
                particleBuffer.set(i, "mass", 1.0 - Math.random() * 0.002);
            }
        }

        console.log(`Initialized ${particleIndex} particles from image grid (${width}x${height})`);
        return particleIndex;
    }

    /**
     * Reset pixel data and clean up resources
     */
    reset() {
        if (this.canvas) {
            this.canvas.width = 0;
            this.canvas.height = 0;
        }
    }
}

export default ImageGridSampler;
