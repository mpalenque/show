---
title: Moon Phases Simulator Overview
tags: []
keywords: []
importance: 50
recency: 1
maturity: draft
createdAt: '2026-04-06T21:03:35.750Z'
updatedAt: '2026-04-06T21:03:35.750Z'
---
## Raw Concept
**Task:**
Document the project overview and contributor expectations captured in AGENTS.md.

**Changes:**
- Summarized build commands and tooling expectations
- Captured architecture, code-style, and TypeScript constraints
- Recorded contribution rules and persistent project instructions

**Files:**
- AGENTS.md

**Flow:**
Review project overview -> describe architecture & conventions -> enumerate contribution rules.

**Timestamp:** 2026-04-06

**Author:** Moon Phases Simulator team

## Narrative
### Structure
The project centers on a vanilla TypeScript + Three.js stack with the main bootstrap in src/main.ts wiring renderer, camera, animation loop, scene factories, simulation logic, and UI components. Scenes are provided by factory functions that self-register onto THREE.Scene, simulation logic lives in pure functions with exported constants, and UI components are class-based wrappers that build DOM controls and panels.

### Dependencies
Build relies on npm scripts (install, dev, build, preview) and tsc --noEmit for validation. There are no tests, no linter, and no formatter; TypeScript strict mode (strict, noUnusedLocals, noUnusedParameters, noUncheckedIndexedAccess, noFallthroughCasesInSwitch) is the primary enforcement mechanism. I18n is handled by a singleton with locale dictionaries and change subscriptions, and the animation loop reads from a singleton SimulationStore that exposes get/update/subscribe with immutable snapshots.

### Highlights
State management uses a custom SimulationStore singleton exported from main.ts; requestAnimationFrame drives a loop that reads store state, updates orbital positions, and switches camera views (default, observer, orbital, eclipse). Scene conventions emphasize geometry disposal, shadow toggling, Vector3 reuse, and ACESFilmic tone mapping. CSS follows a single main.css with a glass-panel look, BEM-ish naming, responsive handling, and a 768px breakpoint with matchMedia-aware components.

### Rules
Never suppress type errors with as any, @ts-ignore, or @ts-expect-error. Non-negotiable: never include agent names in commits, co-author trailers, PR text, or generated documentation. Do not remove or modify the server block in vite.config.ts (host: 0.0.0.0, allowedHosts: [galadriel]).

### Examples
Build/run commands include npm install, npm run dev (Vite dev server), npm run build (tsc && vite build), npm run preview, and tsc --noEmit for type checking. Import order follows external libraries first, followed by internal modules organized by layer (scene, simulation, ui, i18n); default import only for lil-gui, namespace import for three, type-only imports for types, and PascalCase filenames with camelCase identifiers.

## Facts
- **tech_stack**: Moon Phases Simulator is built with TypeScript, Vite, Three.js, and lil-gui. [project]
- **build_pipeline**: Build command runs tsc before vite build so a passing build implies type safety. [project]
- **ts_flags**: The repository configures strict TypeScript flags including strict, noUnusedLocals, noUnusedParameters, noUncheckedIndexedAccess, and noFallthroughCasesInSwitch. [convention]
