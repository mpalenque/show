# Radiance source preservation

Current contract (2026-09-06): **scene 24 is standby; scene 25 starts the
authored timeline; all audible playback belongs to Ableton**. Start with the
[current context](../../docs/CONTEXTO-ACTUAL.md) and
[system architecture](../../docs/ARQUITECTURA-Y-SISTEMAS.md).

Imported from the local copy of `radiance-live-show`, source commit
`18998e4bd48558b88013c2242194001ed33923dc`. The full original project remains
beside `particlesvideo` in the workspace. This directory preserves its entire
`src`, package lock and TypeScript configuration; public assets are in
`../../public/radiance/`, including the WAV, show document, analysis, worker,
WASM and their notices. Optional engines remain available without loading them
in the scene 24/25 output.

Install these dependencies with `npm ci --prefix vendor/radiance` from
`visuales`; local module resolution keeps Radiance's Three 0.181 separate from
the original show's Three 0.176. The destination Vite build consumes the runtime
and remote editor entries. Do not deduplicate Three across these packages.

`src/integration/FluidRuntime.ts` owns one fluid worker and one renderer. It has
no animation loop, audio context, MIDI input or document persistence. The main
application owns the visual clock, document and input. `enterStandby()` drains
and clears the worker, prepares the director at zero, and shows only the initial
white line on black. The line does not emit light into HRC during standby.
`startTimeline()` starts scene 25 synchronously from that prepared state;
`enterTimeline()` prepares a direct entry when needed. The original director
and lighting govern scene 25, driven by absolute time from the cue. Repeated
scene notes do not restart. Entering 24/25 disables editing loops; explicit
restart repeats 25 from zero. Scrubbing retains the original fluid history
semantics.

The host never plays the WAV. `ShowSession` uses `OfflineAudioContext` only to
decode a reference waveform; no audible context or player is created. The
remote timeline editor is `http://localhost:5173/fluids.html`. A start cue does
not communicate Ableton's subsequent seeks, pauses or transport position.

Live values: emission 0–1 (2400 particles/s at 1), x/y 0–1, hue 0–1, gravity
−1–1, viscosity/cohesion 0–1, light 0–3, forceX/Y −1–1. Actions: `burst`
(`count`, `x`, `y`, `material` 0–2), `attractor` (`mode`, `x`, `y`, `radius`,
`strength`) and `reset`. These are engine controls; future MIDI choreography
belongs in the host mapping editor. The live engine is preserved without an
assigned scene; scenes 26–29 remain free.

Public asset paths use the application base followed by `radiance/`. The
original exported document may contain `/audio/fluids.wav`; the host resolves
this to its namespaced asset. The original browser's local storage is not
modified by the imported runtime.
