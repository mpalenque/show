---
children_hash: f01017d1417041f151b53be4d160263fd144a1d2b9100d8d15f29ad57ad20ff9
compression_ratio: 0.5760322255790534
condensation_order: 1
covers: [context.md, eclipse_observer_moon_rendering.md]
covers_token_total: 993
summary_level: d1
token_count: 572
type: summary
---
# Eclipse Domain Overview (Level d1)

- **Central Focus**: The Eclipse topic details how `EclipseObserver` orchestrates the layered visual system (solar disc, lunar disc, glow, corona, stars) plus lunar mesh creation, emphasizing ranked rendering strategies and precise color handling.

- **Rendering Structure & Flow**:
  - `EclipseObserver` hosts a 200×200 canvas with an orthographic camera (±3 frustum), driven by `requestAnimationFrame`, that polls `simulationStore` for `viewMode`/`eclipseType`, fetches alignment/offset data via `getEclipseInfo`, and updates coronas, glow, background, and star opacity per frame before rendering.
  - The Moon mesh creation asynchronously loads an sRGB-corrected texture (falling back to a neutral `MeshStandardMaterial` on failure) so the texture’s colors multiply correctly with tinting.

- **Solar vs. Lunar Rendering Highlights**:
  - **Solar Phase**: Corona `uTime` tracks elapsed time; solar moon disc shifts horizontally by `(1 - alignment) * 5 * direction`; background interpolates between `SKY_BRIGHT` and `SKY_DARK`; stars ramp opacity above alignment 0.7 to reveal the corona.
  - **Lunar Phase**: Moon color linearly blends toward `MOON_BLOOD_COLOR`; glow opacity equals `alignment * 0.25`; background stays at `SKY_DARK`; star opacity fixes at 0.6 during the blood moon stage; lunar disc visibility replaces the solar disc.

- **Rules & Preferred Approach**:
  - **Preferred**: Approach 1 (textured sphere with color tinting) reuses `src/scene/Moon.ts` texture and multiplies it via `MeshBasicMaterial.color` on an sRGB-encoded texture.
  - **Alternatives** (approaches 2–5): Canvas textures, custom shaders, layered discs, and normal maps are documented as fallbacks/extensions for future adjustments.

- **Facts to Reference for Drill-Down**:
  - `eclipse_observer_view`: 200×200 orthographic canvas driven by `requestAnimationFrame`.
  - `lunar_glow_behavior`: Glow opacity scales with alignment; moon color lerps between normal and blood hues.
  - `moon_texture_colorspace`: Moon textures load with `THREE.SRGBColorSpace`, ensuring tint multiplication works.

- **Related Topic for Extended Context**:
  - Drill down into `project_overview/moon_phases/moon_phases_simulator_overview.md` for broader moon phase simulation details.