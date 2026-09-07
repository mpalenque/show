# AGENTS.md - Moon Phases Simulator

## Project Overview

Interactive 3D lunar phases simulator built with TypeScript, Vite, Three.js, and lil-gui.
No framework -- vanilla DOM manipulation with a custom reactive store pattern.

## Build & Run Commands

```bash
npm install              # Install dependencies
npm run dev              # Vite dev server (hot reload)
npm run build            # tsc && vite build (type-check + production build)
npm run preview          # Preview production build
tsc --noEmit             # Type-check only (no output)
```

There are no tests, no linter, and no formatter configured. `tsc --noEmit` is the primary validation tool.
The build command runs `tsc` before `vite build`, so a passing build guarantees type safety.

## Project Structure

```
src/
  main.ts            # App bootstrap: renderer, camera, animation loop, scene wiring
  vite-env.d.ts      # Vite client type reference
  i18n/              # Locale dictionaries (en.ts, es.ts, it.ts) and I18n class (i18n.ts)
  scene/             # Three.js object factories: Earth, Moon, Sun, Stars, EclipseGuides
  simulation/        # Pure logic: MoonPhase math, OrbitalSystem, Eclipse state, SimulationStore
  styles/            # Single main.css (glass-panel design, responsive layout)
  ui/                # DOM UI components: InfoPanel, Timeline, Controls, ViewSwitcher, LanguageSwitcher
```

## Architecture Patterns

### State Management
- `SimulationStore` class in `simulation/SimulationState.ts` -- custom reactive store
- `get()` returns immutable snapshot via spread: `{ ...this.state }`
- `update(partial)` accepts `Partial<SimulationState>` and notifies subscribers
- `subscribe(cb)` returns an unsubscribe function
- The singleton store is exported from `main.ts` as `simulationStore`

### Module Pattern
- **Scene objects**: Factory functions returning interface objects (`createEarth()`, `createSun()`, etc.)
- **Simulation**: Pure functions + exported constants (`getPhaseInfo()`, `SYNODIC_PERIOD`)
- **UI components**: Classes with factory function wrappers (`new InfoPanel()` via `createInfoPanel()`)
- Factory functions receive `THREE.Scene` to self-register: `scene.add(mesh)`

### Animation Loop
- Single `requestAnimationFrame` loop in `main.ts` `animate()` closure
- Reads state from store each frame, updates orbital positions, manages camera modes
- Camera view modes: `default`, `observer`, `orbital`, `eclipse`

### i18n
- `I18n` singleton class with `t(key)` for translations
- Keys use dot notation: `'phase.newMoon.name'`, `'settings.title'`, `'ui.illumination'`
- Locale dictionaries are `Record<string, string>` objects
- Components subscribe to `i18n.onLanguageChange()` and rebuild/re-render

## TypeScript Configuration (Strict)

- `strict: true` with additional strictness flags
- `noUnusedLocals: true` / `noUnusedParameters: true`
- `noUncheckedIndexedAccess: true` -- indexed access may return `undefined`
- `noFallthroughCasesInSwitch: true`
- Target: ES2022, Module: ESNext, bundler resolution

**Never suppress type errors** with `as any`, `@ts-ignore`, or `@ts-expect-error`.

## Code Style

### Imports
- External libraries first, then internal modules (by layer: scene, simulation, ui, i18n)
- `import * as THREE from 'three'` -- namespace import for Three.js
- `import { named } from './Module'` -- named imports for internal modules
- `import type { T } from './Module'` -- type-only imports when only types are needed
- Default import only for lil-gui: `import GUI from 'lil-gui'`
- Relative paths, no aliases: `'../simulation/MoonPhase'`, `'./scene/Earth'`

### Naming Conventions
- `camelCase` -- variables, functions, parameters, methods
- `PascalCase` -- types, interfaces, classes, and source file names
- `UPPER_SNAKE_CASE` -- module-level constants (`SYNODIC_PERIOD`, `MOBILE_MEDIA_QUERY`)
- Files: `PascalCase.ts` for modules (e.g. `MoonPhase.ts`, `InfoPanel.ts`)
- Exceptions for entry/config: `main.ts`, `i18n.ts`, `vite-env.d.ts`

### Functions
- **Exported functions**: Named `function` declarations -- `export function createMoon(...): Promise<THREE.Mesh>`
- **Internal helpers**: Arrow function constants -- `const normalizeAngle = (angle: number): number => { ... }`
- **All functions** have explicit return type annotations (`: void`, `: number`, `: PhaseInfo`, etc.)
- Callbacks and closures use arrow functions

### Types
- `interface` for object shapes: `interface PhaseInfo { ... }`, `interface SimulationState { ... }`
- `type` for unions, aliases, and function signatures: `type EclipseType = 'solar' | 'lunar'`
- String literal unions for enumerations (not enums)
- `as const` for constant tuples: `PHASE_KEYS = [...] as const`
- `Record<K, V>` for dictionary types, `Partial<T>` for partial updates
- Prefer `ReturnType<typeof fn>` over duplicating return shapes

### Error Handling
- DOM lookups: `instanceof` type guard + `throw new Error(...)` if missing
- Async operations (texture loading): `try/catch` with graceful fallback material
- Bare `catch` clause (no error binding): `} catch {`
- Nullish coalescing for safe access: `PHASE_KEYS[phaseIndex] ?? PHASE_KEYS[0]`
- No empty catch blocks -- always handle or fallback

### Formatting
- 2-space indentation
- Single quotes for strings
- Semicolons on all statements
- Trailing commas in multi-line arrays, objects, and parameter lists
- No max line length enforced (some lines exceed 120 chars)
- Blank line between top-level declarations

### DOM Interaction
- `document.getElementById(id)` + `instanceof HTMLElement` type guard
- Template literals for building HTML strings (innerHTML assignment)
- Manual event binding with `addEventListener`
- CSS class toggling via `classList.toggle('name', condition)`
- ARIA attributes set for accessibility on all interactive elements

### Three.js Conventions
- Geometry disposal when replacing: `previousGeometry.dispose()`
- Shadow setup on creation, toggled dynamically for eclipse mode
- `THREE.MathUtils` for conversions (`degToRad`, `radToDeg`, `clamp`)
- Reuse `THREE.Vector3` instances in the animation loop (avoid per-frame allocation)
- Color spaces: `THREE.SRGBColorSpace` for textures, `THREE.ACESFilmicToneMapping`

### CSS Conventions
- Single `main.css` file -- no CSS modules or preprocessors
- Glass-panel design system: `.glass-panel` base class
- Flat BEM-ish naming: `.info-panel-header`, `.timeline-controls`, `.phase-description`
- Mobile breakpoint: `768px` (`MOBILE_MEDIA_QUERY` constant in TS)
- Responsive: mobile-aware components check `window.matchMedia` and rebuild

## Contributing Guidelines (from README)

- Small, focused pull requests
- Clear educational intent
- Conventional commit messages

## Project-Specific Persistent Instructions

- Non-negotiable: never include agent names in commit messages, co-author trailers, pull request text, generated documentation, or any other repo-written content.
- Do not remove or modify the `server` block in `vite.config.ts` (`host: '0.0.0.0'`, `allowedHosts: ['galadriel']`) -- this is a local dev convenience for LAN access and must be preserved.

## Common Pitfalls

- `simulationStore` is exported from `main.ts` -- importing it creates a module dependency on the bootstrap file
- `noUncheckedIndexedAccess` means array/object indexing returns `T | undefined` -- handle it
- Scene objects self-register via `scene.add()` inside their factory -- don't add them again
- Eclipse mode saves/restores a snapshot -- use `enterEclipseMode`/`exitEclipseMode` helpers
- i18n keys that don't exist return the key string itself (fallback behavior)
- The `void init()` pattern in `main.ts` calls async init from module-level sync context
