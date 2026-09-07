import * as THREE from "three/webgpu";
import { conf } from "./conf";

class ImageUploadManager {
    constructor() {
        this.imageTexture = null;
        this.videoTexture = null;
        this.imageData = null;
        this.isVideo = false;
        this.videoElement = null;
        this.videoUrl = null;
        this.textureLoader = new THREE.TextureLoader();
        this.onImageLoaded = null; // Callback when image loads
        this.onReset = null; // Callback when reset is clicked
        this.onReEmit = null; // Callback when re-emit is clicked
        this.displayCanvas = null;
        this.displayCtx = null;
    }

    async init() {
        // Setup file input
        const fileInput = document.getElementById('image-file-input');
        const uploadButton = document.getElementById('upload-button');
        const resetButton = document.getElementById('reset-button');
        const reEmitButton = document.getElementById('re-emit-button');
        const toggleImageButton = document.getElementById('toggle-image-button');
        const previewContainer = document.getElementById('image-preview');
        const previewImg = document.getElementById('preview-img');
        const previewVideo = document.getElementById('preview-video');
        const previewInfo = document.getElementById('preview-info');

        this.displayCanvas = document.getElementById('image-display-canvas');
        this.displayCtx = this.displayCanvas.getContext('2d');

        uploadButton.addEventListener('click', () => {
            fileInput.click();
        });

        resetButton.addEventListener('click', () => {
            this.reset();
        });

        reEmitButton.addEventListener('click', () => {
            if (this.onReEmit) {
                this.onReEmit();
            }
        });

        toggleImageButton.addEventListener('click', () => {
            const displaySection = document.getElementById('image-display-section');
            const isVisible = displaySection.style.display !== 'none';
            if (isVisible) {
                displaySection.style.display = 'none';
                toggleImageButton.textContent = '🔍 Show Image Preview';
            } else {
                this.displayImage();
                displaySection.style.display = 'block';
                toggleImageButton.textContent = '🔍 Hide Image Preview';
            }
        });

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            this.showLoader(true);
            try {
                await this.loadFile(file);
                
                // Update preview
                const isImageFile = file.type.startsWith('image/');
                const isVideoFile = file.type.startsWith('video/');
                const resetButton = document.getElementById('reset-button');
                const reEmitButton = document.getElementById('re-emit-button');
                const displaySection = document.getElementById('image-display-section');

                previewContainer.style.display = 'block';
                resetButton.classList.add('active');
                reEmitButton.classList.add('active');
                displaySection.style.display = 'block';
                previewInfo.textContent = `${file.name} (${file.type})`;

                if (isImageFile) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        previewImg.src = event.target.result;
                        previewImg.style.display = 'block';
                        previewVideo.style.display = 'none';
                    };
                    reader.readAsDataURL(file);
                } else if (isVideoFile) {
                    previewVideo.style.display = 'block';
                    previewImg.style.display = 'none';
                }

                // Enable image emission in conf
                conf.useImageEmission = true;
                conf.imageSourceType = isVideoFile ? 'video' : 'image';
                conf.gui.refresh();

                // Call callback if registered
                if (this.onImageLoaded) {
                    this.onImageLoaded();
                }
            } catch (error) {
                console.error('Error loading file:', error);
                previewInfo.textContent = `Error: ${error.message}`;
                previewInfo.style.color = '#ff6b6b';
            } finally {
                this.showLoader(false);
            }
        });
    }

    async loadFile(file) {
        const isImageFile = file.type.startsWith('image/');
        const isVideoFile = file.type.startsWith('video/');

        if (isImageFile) {
            await this.loadImage(file);
        } else if (isVideoFile) {
            await this.loadVideo(file);
        } else {
            throw new Error('Unsupported file type. Please upload an image or video.');
        }
    }

    async loadImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    this.isVideo = false;
                    this.imageData = {
                        width: img.naturalWidth,
                        height: img.naturalHeight,
                        element: img,
                    };

                    // Load as Three.js texture
                    const texture = new THREE.Texture(img);
                    texture.colorSpace = THREE.SRGBColorSpace;
                    texture.magFilter = THREE.NearestFilter;
                    texture.minFilter = THREE.NearestFilter;
                    texture.needsUpdate = true;
                    this.imageTexture = texture;

                    console.log(`Image loaded: ${img.naturalWidth}x${img.naturalHeight}`);
                    resolve();
                };
                img.onerror = () => reject(new Error('Failed to load image'));
                img.src = event.target.result;
            };
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    }

    async loadVideo(file) {
        return new Promise((resolve, reject) => {
            const video = document.getElementById('preview-video');
            if (this.videoUrl) URL.revokeObjectURL(this.videoUrl);

            video.muted = true;
            video.autoplay = true;
            video.loop = true;
            video.playsInline = true;
            video.preload = 'auto';
            video.playbackRate = 1.0;

            const handleCanPlay = () => {
                this.isVideo = true;
                this.videoElement = video;
                this.imageData = {
                    width: video.videoWidth,
                    height: video.videoHeight,
                    element: video,
                };

                // Create VideoTexture
                this.videoTexture = new THREE.VideoTexture(video);
                this.videoTexture.colorSpace = THREE.SRGBColorSpace;
                this.videoTexture.magFilter = THREE.LinearFilter;
                this.videoTexture.minFilter = THREE.LinearFilter;
                this.videoTexture.needsUpdate = true;
                this.imageTexture = this.videoTexture;

                // Auto-play video
                video.play().catch(err => console.warn('Video autoplay failed:', err));

                console.log(`Video loaded: ${video.videoWidth}x${video.videoHeight}`);
                video.removeEventListener('canplay', handleCanPlay);
                resolve();
            };

            video.addEventListener('canplay', handleCanPlay, { once: true });
            video.onerror = () => reject(new Error('Failed to load video'));

            this.videoUrl = URL.createObjectURL(file);
            video.src = this.videoUrl;
            video.load();
        });
    }

    getTexture() {
        return this.imageTexture;
    }

    getImageData() {
        return this.imageData;
    }

    isVideoSource() {
        return this.isVideo;
    }

    getVideoElement() {
        return this.videoElement;
    }

    playVideo() {
        if (this.videoElement) {
            this.videoElement.play();
        }
    }

    pauseVideo() {
        if (this.videoElement) {
            this.videoElement.pause();
        }
    }

    setVideoPlaybackSpeed(speed) {
        if (this.videoElement) {
            this.videoElement.playbackRate = speed;
        }
    }

    reset() {
        if (this.videoElement) this.videoElement.pause();
        if (this.videoUrl) URL.revokeObjectURL(this.videoUrl);
        this.imageTexture = null;
        this.videoTexture = null;
        this.imageData = null;
        this.isVideo = false;
        this.videoElement = null;
        this.videoUrl = null;

        // Clear preview
        const previewContainer = document.getElementById('image-preview');
        const previewInfo = document.getElementById('preview-info');
        const resetButton = document.getElementById('reset-button');
        const previewVideo = document.getElementById('preview-video');
        previewContainer.style.display = 'none';
        previewInfo.textContent = '';
        resetButton.classList.remove('active');
        previewVideo.removeAttribute('src');
        previewVideo.load();

        // Reset conf
        conf.useImageEmission = false;
        conf.imageSourceType = 'none';
        conf.gui.refresh();

        // Call reset callback
        if (this.onReset) {
            this.onReset();
        }
    }

    showLoader(show) {
        const loader = document.getElementById('loader');
        if (show) {
            loader.classList.add('active');
        } else {
            loader.classList.remove('active');
        }
    }

    /**
     * Register a callback to be called when an image is successfully loaded
     * @param {Function} callback - Callback function to call on image load
     */
    setOnImageLoadedCallback(callback) {
        this.onImageLoaded = callback;
    }

    /**
     * Register a callback to be called when reset is clicked
     * @param {Function} callback - Callback function to call on reset
     */
    setOnResetCallback(callback) {
        this.onReset = callback;
    }

    /**
     * Sync video playback speed from conf
     */
    updateVideoPlaybackSpeed() {
        if (this.isVideo && this.videoElement) {
            this.videoElement.playbackRate = conf.videoPlaybackSpeed;
        }
    }

    /**
     * Display the image on the canvas
     */
    displayImage() {
        if (!this.imageData || !this.displayCanvas || !this.displayCtx) return;

        const source = this.imageData.element;
        const width = this.imageData.width;
        const height = this.imageData.height;

        // Set canvas size to maintain aspect ratio
        const maxWidth = 280;
        const maxHeight = 250;
        let displayWidth = width;
        let displayHeight = height;

        if (displayWidth > maxWidth) {
            displayHeight = Math.round(displayHeight * (maxWidth / displayWidth));
            displayWidth = maxWidth;
        }
        if (displayHeight > maxHeight) {
            displayWidth = Math.round(displayWidth * (maxHeight / displayHeight));
            displayHeight = maxHeight;
        }

        this.displayCanvas.width = displayWidth;
        this.displayCanvas.height = displayHeight;

        // Draw image/video on canvas
        this.displayCtx.drawImage(source, 0, 0, displayWidth, displayHeight);

        // Update display info
        const displayInfo = document.getElementById('image-display-info');
        displayInfo.textContent = `${width}×${height} pixels`;
    }

    /**
     * Register a callback to be called when re-emit is clicked
     * @param {Function} callback - Callback function to call on re-emit
     */
    setOnReEmitCallback(callback) {
        this.onReEmit = callback;
    }

    /**
     * Trigger image display update (for video frames)
     */
    updateImageDisplay() {
        // The video element and in-scene VideoTexture already render the live frame.
        // Avoid a third canvas copy every frame, which stalls high-resolution local videos.
    }
}

export default ImageUploadManager;
