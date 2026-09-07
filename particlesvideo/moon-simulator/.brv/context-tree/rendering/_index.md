---
children_hash: 55751bf5be98dfa0ddb02fb9fc3e12e2ce0b700dbe26a74cbed4064f5812e84f
compression_ratio: 0.7703889585947302
condensation_order: 2
covers: [context.md, eclipse/_index.md]
covers_token_total: 797
summary_level: d2
token_count: 614
type: summary
---
# Rendering Domain (Level d2 Structural Summary)

## Purpose & Scope
- **Domain Goal**: Document practical rendering patterns for eclipse visuals in the observer UI, covering EclipseObserver setup, moon mesh creation, textures, and layered color transitions (refer to `context.md` for guidance).
- **Included Content**: EclipseObserver render loop and UI, lunar mesh/texture workflow, solar/lunar color blending techniques.
- **Exclusions**: Orbital mechanics and unrelated localization content remain outside this domain.

## Key Topics

### Eclipse Visual System (`eclipse/_index.md`)
- **Observer Rendering Pipeline** (see `EclipseObserver` entry)
  - 200×200 orthographic canvas, ±3 frustum, `requestAnimationFrame` loop.
  - Each frame polls `simulationStore` for `viewMode`/`eclipseType`, obtains alignment via `getEclipseInfo`, animates corona/glow/background, updates star opacity, then renders scene.
  - Corona animation driven by `uTime`; moon disc shifts horizontally during solar phase using `(1 - alignment) * 5 * direction`.
- **Moon Mesh & Texture Handling**
  - Textured sphere using `src/scene/Moon.ts` texture.
  - Textures decoded as `THREE.SRGBColorSpace` so `MeshBasicMaterial.color` tinting multiplies correctly.
  - Async texture loading with fallback to neutral `MeshStandardMaterial` ensures render stability.
- **Solar vs. Lunar Rendering Rules**
  - Solar: background interpolates between `SKY_BRIGHT` and `SKY_DARK`, stars fade in above 0.7 alignment, glow/corona animated per frame.
  - Lunar: moon color lerps toward `MOON_BLOOD_COLOR`, glow opacity clamps to `alignment * 0.25`, background fixed at `SKY_DARK`, stars at constant 0.6 opacity.
  - Preferred approach: textured sphere with color tinting (Approach 1); additional documented approaches (canvas, shaders, layered discs, normal maps) are noted for extensions.
- **Facts for Drill-Down**
  - `eclipse_observer_view`: 200×200 orthographic render loop.
  - `lunar_glow_behavior`: Glow opacity scales linearly with alignment; color blends to blood hue.
  - `moon_texture_colorspace`: Textures use sRGB for correct tint multiplication.

## Relationships
- **Related Topics**: For broader simulation context (moon phases and timing logic), refer to `project_overview/moon_phases/moon_phases_simulator_overview.md`.
- **Ownership & Usage**: Graphics Team owns domain; use this material when modifying eclipse visuals, color blending, or shader behavior in the observer UI.