---
children_hash: fea0f9fbf37d0814dd67932455d9bdba1ac4f1ea5d3613d674cd4976fb1317e5
compression_ratio: 0.726027397260274
condensation_order: 2
covers: [context.md, moon_phases/_index.md]
covers_token_total: 876
summary_level: d2
token_count: 636
type: summary
---
# project_overview domain (level d2 structural summary)

- **Purpose & Scope** (`context.md`): Sets expectations for documenting the Moon Phases Simulator stack, architecture layers, build/runtime commands, and contribution guardrails; excludes feature-specific implementation and runtime data. Owned by context engineering and serves as onboarding/architecture reference.

- **Architecture & Execution Flow** (`moon_phases/_index.md` covering `moon_phases_simulator_overview.md`):
  - Stack: Vanilla TypeScript + Three.js + Vite with `src/main.ts` wiring renderer, camera, animation loop, scene factories, simulation logic, and UI classes.
  - Scene factories return `THREE.Scene` instances; simulation logic is pure functions/exported constants; UI components wrap DOM controls/panels.
  - State via `SimulationStore` singleton exposing `get/update/subscribe`, feeding an `requestAnimationFrame` loop that updates orbits and switches camera modes (default, observer, orbital, eclipse).
  - I18n singleton with locale dictionaries and change subscriptions; import ordering enforces external-before-internal and specific import styles.

- **Build & Tooling Guidelines** (`moon_phases/_index.md`):
  - Scripts: `npm install`, `npm run dev`, `npm run build` (runs `tsc` then `vite build`), `npm run preview`, plus `tsc --noEmit` for validation.
  - No tests/linters/formatters; TypeScript compiler enforced with strict+specific flags (`noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`) to guarantee correctness.
  - Build pipeline ensures type safety by running `tsc` before bundling.

- **Scene/UI Conventions & Assets** (`moon_phases/_index.md`):
  - Geometry disposal, shadow toggles, Vector3 reuse, ACESFilmic tone mapping enforced.
  - Styling centralized in `styles/main.css` (glass-panel look, BEM-ish naming, responsive at 768px, matchMedia-aware).
  - UI components reuse centralized styling and follow the documented conventions.

- **Contribution & Safety Rules** (`moon_phases/_index.md`):
  - Strictly avoid `as any`, `@ts-ignore`, `@ts-expect-error`.
  - No agent names in commits/PRs/docs/co-author trailers.
  - Preserve `server` block in `vite.config.ts` (host `0.0.0.0`, `allowedHosts: [galadriel]`).

- **Key Facts** (`moon_phases/_index.md` referencing `moon_phases_simulator_overview.md`):
  - Tech stack: TypeScript, Vite, Three.js, lil-gui.
  - Build pipeline ensures type safety by running `tsc` before `vite build`.
  - TypeScript flags singled out for strict enforcement.