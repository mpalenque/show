---
title: Eclipse Observer Moon Rendering
tags: []
related: [project_overview/moon_phases/moon_phases_simulator_overview.md]
keywords: []
importance: 50
recency: 1
maturity: draft
createdAt: '2026-04-06T21:08:54.802Z'
updatedAt: '2026-04-06T21:08:54.802Z'
---
## Raw Concept
**Task:**
Document lunar and solar rendering practices for the EclipseObserver visual plus Moon mesh creation for future adjustments.

**Changes:**
- Ranked five moon rendering approaches; highlighted textured sphere with color tinting as the preferred path
- Outlined EclipseObserver setup (canvas, orthographic camera, corona/solar/lunar discs, glow, stars) and animation loop tied to simulation state
- Captured Moon creation workflow that loads SRGB texture with fallback gray material for resilience

**Files:**
- src/ui/EclipseObserver.ts
- src/scene/Moon.ts

**Flow:**
Each frame the observer polls simulationStore, computes alignment, toggles visibility between solar and lunar discs, animates corona uniforms, adjusts moon offsets/background brightness/star opacity, and renders; Moon creation asynchronously loads an SRGB texture before adding the mesh, falling back to a neutral MeshStandardMaterial if loading fails.

**Timestamp:** 2026-04-06

**Author:** Moon Simulator Graphics Review

## Narrative
### Structure
EclipseObserver builds an orthographic scene with layered discs (sun, solar moon, lunar moon, glow) plus corona and stars, hosting the renderer in a 200×200 canvas element that becomes visible when the view mode switches to eclipse and responds to locale changes for its label.

### Dependencies
Relies on simulationStore for viewMode and eclipseType, getEclipseInfo for alignment and offsetDays, CoronaShader for corona gradients, THREE for color/geometry/material utilities, and i18n for accessible text.

### Highlights
Solar rendering updates corona uniform uTime with elapsed time, shifts the solar moon disc horizontally by (1 - alignment) * 5 * direction, lerps the background between SKY_BRIGHT and SKY_DARK, and boosts star opacity beyond 0.7 alignment to reveal the corona; lunar rendering lerps moon color toward MOON_BLOOD_COLOR, scales glow opacity linearly with alignment, fixes the background to SKY_DARK, and sets star opacity to 0.6 for the blood moon stage while the lunar moon disc takes over visibility.

### Rules
Approach 1 (textured sphere + color tinting) is recommended for reusing the existing Moon.ts texture where MeshBasicMaterial.color multiplies the sRGB-encoded texture, while approaches 2–5 (canvas textures, shaders, layered discs, normal maps) describe fallbacks and advanced alternatives.

### Examples
Example solar mood: alignment > 0.7 shows corona, dark background, and star opacity tethers between 0.1 and 0.8; example lunar mood: lunar glow disc saturates to 25% opacity while the moon color interpolates toward the given blood hue.

## Facts
- **eclipse_observer_view**: EclipseObserver renders into a 200x200 canvas using an orthographic camera with a ±3 frustum and drives animation via requestAnimationFrame. [project]
- **lunar_glow_behavior**: The lunar glow disc opacity scales as alignment * 0.25 while the lunar moon color lerps between MOON_NORMAL_COLOR and MOON_BLOOD_COLOR to simulate the blood moon tint. [project]
- **moon_texture_colorspace**: Moon textures load asynchronously with texture.colorSpace set to THREE.SRGBColorSpace so MeshStandardMaterial.color multiplies darken as expected. [project]
