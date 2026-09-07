---
children_hash: 32aeda9f3380fc4eefd70abf709a720bd501bf8574bbde64570776b4a8ed5843
compression_ratio: 0.6825053995680346
condensation_order: 1
covers: [context.md, moon_phases_simulator_overview.md]
covers_token_total: 926
summary_level: d1
token_count: 632
type: summary
---
# Moon Phases Topic Overview (d1)

- **Purpose & Scope**: Captures AGENTS.md guidance for the Moon Phases Simulator’s setup, architecture, and collaboration rules (see `context.md` and `moon_phases_simulator_overview.md` for full detail).

- **Architecture & Layers** (`moon_phases_simulator_overview.md`):
  - Vanilla TypeScript + Three.js + Vite stack with entry point `src/main.ts` tying renderer, camera, animation loop, scene factories, simulation logic, and UI class-based components.
  - Scenes delivered by factory functions that register with `THREE.Scene`; simulation logic uses pure functions and exported constants; UI components wrap DOM controls/panels.

- **Build & Tooling** (`moon_phases_simulator_overview.md`):
  - NPM scripts: `npm install`, `npm run dev`, `npm run build` (runs `tsc` then `vite build`), `npm run preview`, plus `tsc --noEmit` for validation.
  - No tests, linters, or formatters; strict TypeScript (strict, noUnusedLocals, noUnusedParameters, noUncheckedIndexedAccess, noFallthroughCasesInSwitch) guarantees correctness.
  - Build pipeline ensures type safety by executing `tsc` before bundling.

- **State & Dependency Patterns**:
  - `SimulationStore` singleton (exported from `main.ts`) exposes `get/update/subscribe` with immutable snapshots consumed by an `requestAnimationFrame` loop to update orbits and switch camera modes (default, observer, orbital, eclipse).
  - I18n provided by singleton with locale dictionaries and change subscriptions; `three`, `lil-gui`, and type-only modules follow explicit import ordering rules (external before internal, specific import styles).

- **Scene/UI Conventions**:
  - Geometry disposal, shadow toggles, Vector3 reuse, and ACESFilmic tone mapping enforced.
  - UI styling centralized in `styles/main.css` with glass-panel aesthetic, BEM-ish naming, responsive handling (768px breakpoint) and matchMedia-aware components.

- **Contribution & Safety Rules**:
  - Never bypass type checking with `as any`, `@ts-ignore`, or `@ts-expect-error`.
  - Do not mention agent names in commits, PR texts, documentation, or co-author trailers.
  - Preserve the `server` block in `vite.config.ts` (host `0.0.0.0`, `allowedHosts: [galadriel]`).

- **Facts (see `moon_phases_simulator_overview.md`)**:
  - Tech stack: TypeScript, Vite, Three.js, lil-gui.
  - Build pipeline: runs `tsc` before `vite build` to ensure type safety.
  - TypeScript flags: strict, `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`.