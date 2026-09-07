---
children_hash: 14f793529d5433a1b07b64c4ad9cd1ff69351a932ae2896c7823226b821a0465
compression_ratio: 0.8111432706222865
condensation_order: 3
covers: [project_overview/_index.md, rendering/_index.md]
covers_token_total: 1382
summary_level: d3
token_count: 1121
type: summary
---
# Structural Summary (Level d3)

## project_overview domain
- **Purpose & Scope** (`project_overview/_index.md` covering `context.md`, `moon_phases/_index.md`)
  - Captures the Moon Phases Simulator stack, architecture layers, build/runtime commands, and contribution guardrails; excludes feature implementations or runtime data.
  - Serves as onboarding/architecture reference maintained by context engineering.

- **Key Structural Layers**
  - **Scene & Simulation wiring** (`moon_phases/_index.md` → `moon_phases_simulator_overview.md`)
    - Vanilla TypeScript + Three.js + Vite stack centered on `src/main.ts`: instantiates renderer, camera, animation loop, scene factories, simulation logic, and UI controllers.
    - Scene factories produce `THREE.Scene`; simulation logic modeled as pure functions with exported constants; UI components (controls, panels) wrap DOM nodes.
  - **State & Loop Management**
    - `SimulationStore` singleton exposes `get/update/subscribe`; `requestAnimationFrame` loop updates orbits and switches camera modes (default/observer/orbital/eclipse).
    - I18n singleton loads locale dictionaries with subscription callbacks; import order rules enforce external-before-internal conventions.

- **Build & Tooling Guidelines**
  - Commands: `npm install`, `npm run dev`, `npm run build` (runs `tsc` then `vite build`), `npm run preview`, plus `tsc --noEmit` for validation.
  - TypeScript strict flags set (`strict`, `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`) ensure correctness before bundling.
  - Build pipeline gatekeeps via `tsc` before `vite build`.

- **Scene/UI Conventions**
  - Geometry disposal, shadow toggles, Vector3 reuse, ACESFilmic tone mapping enforced; styling lives in `styles/main.css` (glass-panel feel, BEM-ish naming, responsive at 768px, matchMedia aware).
  - UI components reuse centralized styling and follow documented conventions.

- **Contribution & Safety Rules**
  - Absolutely ban `as any`, `@ts-ignore`, `@ts-expect-error`; no agent names in commits/PRs/docs/co-authors.
  - Preserve `server` block in `vite.config.ts` (`host: 0.0.0.0`, `allowedHosts: [galadriel]`).

- **Key Facts**
  - Tech stack: TypeScript, Vite, Three.js, lil-gui.
  - Build pipeline enforces type safety via `tsc` + `vite build`.
  - Highlighted TypeScript flags ensure strict enforcement.

## rendering domain
- **Purpose & Scope** (`rendering/_index.md` → `context.md`, `eclipse/_index.md`)
  - Documents eclipse visualization patterns (Observer, moon mesh, textures, color blending) for the observer UI; excludes orbital mechanics/localization content.
  - Owned by Graphics Team; use when adjusting eclipse visuals or shader behavior.

- **Eclipse Visual System** (`eclipse/_index.md`)
  - **Observer Rendering Pipeline**
    - `EclipseObserver` renders on 200×200 orthographic canvas (frustum ±3) with `requestAnimationFrame`.
    - Each frame polls `SimulationStore` (`viewMode`, `eclipseType`), obtains alignment via `getEclipseInfo`, animates corona/glow/background, updates star opacity, then renders scene.
    - Corona animation driven by `uTime`; moon disc shifts horizontally during solar phase via `(1 - alignment) * 5 * direction`.
  - **Moon Mesh & Textures**
    - Textured sphere from `src/scene/Moon.ts`; textures decoded as `THREE.SRGBColorSpace` so `MeshBasicMaterial.color` tint multiplies correctly.
    - Async texture loading with fallback to neutral `MeshStandardMaterial` guards render stability.
  - **Solar vs. Lunar Rendering Rules**
    - Solar: background lerps between `SKY_BRIGHT` and `SKY_DARK`; stars fade in once alignment > 0.7; glow/corona animated per frame.
    - Lunar: moon color shifts toward `MOON_BLOOD_COLOR`; glow opacity capped at `alignment * 0.25`; background fixed at `SKY_DARK`; stars hold constant 0.6 opacity.
    - Approach 1 (textured sphere with tinting) preferred; alternative approaches (canvas, shaders, layered discs, normal maps) noted for extensions—see `eclipse/_index.md` for details.
  - **Facts for Drill-Down**
    - `eclipse_observer_view`: 200×200 orthographic render loop.
    - `lunar_glow_behavior`: Glow opacity scales linearly with alignment; color blends toward blood hue.
    - `moon_texture_colorspace`: Textures use sRGB for correct tint multiplication.

- **Relationships**
  - Supported by simulation context in `project_overview/moon_phases/moon_phases_simulator_overview.md` for timing and alignment data.