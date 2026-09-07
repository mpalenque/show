# 🌙 Moon Phases Simulator

An interactive **3D simulator of the Moon's phases and eclipses**, built for education.

---

## ⚠️ This checkout runs in observer-only mode

This copy is stripped down for video/recording use: the app boots straight into the
**observer view** (the Moon as seen from Earth) and shows **nothing but the Moon
changing phase** on pure black — no starfield, no Earth or Sun disc, no title, no
info panel, no timeline, no view switcher, no settings GUI. The only chrome is a
small fader strip at the bottom, which **H** hides.

What was added on top of the original observer view:

- **NASA textures.** Colour is the LROC WAC mosaic and relief is a tangent-space
  normal map derived from LOLA elevation, both from the
  [CGI Moon Kit (SVS 4720)](https://svs.gsfc.nasa.gov/4720/), 4096×2048.
  Regenerate them with `python3 scripts/make_textures.py <dir-with-NASA-tifs> public/textures`
  (needs `lroc_color_poles_4k.tif` and `ldem_16_uint.tif`, plus numpy and Pillow).
  Normal map rather than displacement on purpose: the Moon's ±10 km of terrain is
  0.6% of its radius, so displacement would do nothing visible to the silhouette
  while costing heavy tessellation — the relief that reads is the *shading* near
  the terminator, which is what a normal map gives. A bump map would do the same
  job from the height field but bands badly once the 16-bit DEM is squeezed into
  8-bit, so the normals are precomputed at full precision instead.
- **Earthshine** (`src/scene/Earthshine.ts`) — sunlight bounced off Earth onto the
  lunar night side, patched into the Moon's standard material. It arrives from
  Earth's direction, its strength follows Earth's phase as seen from the Moon
  (full Earth at new moon, none at full moon), and Lommel-Seeliger backscatter
  keeps the ashen disc flat the way it photographs.
- **Glow** (`src/scene/MoonGlow.ts`) — a camera-facing halo quad tucked behind the
  Moon so the sphere masks its core. The falloff is measured from the *lit limb*
  (the sunlit half of the silhouette, with points past the cusps measuring to the
  nearest cusp), so the glare is crescent-shaped and follows the phase instead of
  washing radially around the whole disc. It opens back into a full ring at full
  moon, where the entire limb really is lit, and scales with the lit fraction.
- **Bloom** — `UnrealBloomPass` through an `EffectComposer`, for bleed out of the
  bright limb. Independent of Glow, and each has its own on/off button.
- **Defocus** (`src/postprocessing/DefocusPass.ts`) — lens blur that samples a
  uniform disc (circle of confusion) instead of a Gaussian, so edges soften into
  a flat-topped blur like a real out-of-focus lens rather than into a glow. It
  runs *before* bloom, matching the optical order: the sensor sees an already
  defocused image.
- **Tidal locking** — the same lunar face stays toward the camera, so only the
  terminator sweeps across it, as in reality.

### Controls

Two buttons (**Bloom**, **Glow**) and the faders: Earthshine, Bloom, Umbral
(bloom threshold), Glow, Desenfoque (lens blur), Relieve (normal-map strength),
Velocidad.
Moving a fader rewrites the URL, so a reload restores the look you tuned.

**Keys:** `Space` pause/resume · `←` `→` step half a day · `H` hide the panel.

### URL parameters

| Param | Default | Meaning |
|-------|---------|---------|
| `speed` | `1` | Simulated days per real second (`1` ≈ a full lunation every 29.5 s; `0` freezes) |
| `day` | `0` | Starting lunar day (`0` = new moon, `14.76` = full moon) |
| `fill` | `0.45` | Share of the viewport height the lunar disc covers |
| `sun` | `4.5` | Sunlight intensity |
| `earthshine` | `0.035` | Earthshine on the night side (`0` = pure black shadow) |
| `relief` | `1.6` | Normal-map strength (`1` = true LOLA relief) |
| `bloom` / `bloomOn` | `0.4` / `1` | Bloom strength / on-off |
| `threshold` | `0.2` | Brightness above which bloom kicks in |
| `glow` / `glowOn` | `0.25` / `1` | Halo strength / on-off |
| `blur` | `0` | Defocus radius, as a percentage of frame height |
| `ambient` | `0` | Flat uniform fill, kept off in favour of real earthshine |
| `ui` | `1` | `0` boots with the fader strip hidden |

Example: `http://localhost:5173/?speed=0.5&fill=0.6&day=7&glow=0.4`

Changed files: `index.html`, `src/main.ts`, `src/scene/Moon.ts`, plus the new
`src/scene/Earthshine.ts`, `src/scene/MoonGlow.ts`,
`src/postprocessing/DefocusPass.ts`, `src/ui/FaderPanel.ts` and
`scripts/make_textures.py`. The full simulator (UI panels, eclipse mode,
starfield, i18n) is untouched in `src/`; diff those files against
[guspatagonico/moon-simulator](https://github.com/guspatagonico/moon-simulator)
to get the original app back.

Texture credit: NASA's Scientific Visualization Studio — CGI Moon Kit (public domain).

---

Explore the Sun–Earth–Moon system in real time: watch the Moon orbit, understand why its appearance changes throughout the lunar month, and discover how solar and lunar eclipses emerge from rare alignments — all from four different camera perspectives.

Designed to be visually clear, mobile-friendly, and accessible in English, Spanish, and Italian.

## What You Can Do

### 🌓 Explore Lunar Phases

The simulator models a complete **synodic month** (29.53 days). As the Moon orbits Earth, an information panel shows you:

- The current **phase name** (🌑 New Moon → 🌒 Waxing Crescent → 🌓 First Quarter → 🌔 Waxing Gibbous → 🌕 Full Moon → 🌖 Waning Gibbous → 🌗 Last Quarter → 🌘 Waning Crescent)
- **Illumination** percentage
- **Lunar day** and **phase angle**
- A concise **explanation** of why the Moon looks the way it does at each phase
- **Common misconception** notes — such as the widespread but incorrect belief that phases are caused by Earth's shadow

### 🔭 Four Camera Views

Switch perspectives to understand the geometry from different angles:

| View | What it shows |
|------|---------------|
| **Default** | Balanced overview of the entire Sun–Earth–Moon system |
| **Observer** | Moon-focused view from Earth's perspective — the Moon is the visual hero |
| **Orbital** | Top-down view for understanding the orbital geometry |
| **Eclipse** | Dedicated teaching mode for solar and lunar eclipses |

### 🌑 Eclipse Learning Mode

A focused teaching view that separates eclipse geometry from everyday lunar phases.

**Why this matters:** Normal moon phases are _not_ caused by Earth's shadow. The simulator deliberately disables shadow projection outside of Eclipse mode so learners don't confuse the two phenomena.

In Eclipse mode you can:

- Toggle between **solar** and **lunar** eclipse scenarios
- See a **tilted lunar orbit** (5.1°) that explains why eclipses are rare
- Track the **alignment window** percentage as the Sun, Earth, and Moon line up
- Watch **shadow casting** activate when the alignment reaches the 70%+ threshold
- Follow **guide lines** that make the Sun–Earth–Moon geometry easier to read

#### "As Seen from Earth" Inset

A circular observation panel appears in the corner, showing what an observer on Earth would actually see:

- **Solar eclipse** — the Moon's dark silhouette slides across the Sun. Near totality, an animated **solar corona** with wispy radial streamers becomes visible, the sky darkens, and stars fade in.
- **Lunar eclipse** — the Moon gradually darkens and shifts to a deep **copper-red blood moon**, with a subtle reddish glow at peak alignment.

### ⏱ Timeline Controls

- **Play / Pause** the simulation (or press **Space**)
- Choose from **5 speed presets**: 0.25×, 0.5×, 1×, 2×, 4×
- **Scrub** through the lunar month with a slider marked at key phase positions
- **Step** backward or forward by half a day (or press **← →** arrow keys)

### ⚙️ Settings

A compact settings panel lets you fine-tune:

- Current day and playback speed
- Orbit line visibility
- Realistic vs. exaggerated scale
- Camera auto-rotation and rotation speed
- Sun and ambient lighting intensity

When entering Eclipse mode, the simulator automatically adjusts to a clearer teaching setup: slower playback, orbit line visible, and readable non-realistic scale.

### 🌍 Three Languages

All interface text, phase names, eclipse content, educational descriptions, and accessibility labels are fully translated in:

- **English**
- **Spanish**
- **Italian**

### 📱 Mobile-Friendly

The app adapts to smaller screens with:

- A compact control cluster at the top
- A native dropdown for view switching
- A collapsible info panel drawer
- Touch-friendly timeline controls
- Responsive eclipse inset sizing

### 💾 Remembers Your Preferences

Your last selected **language** and **view mode** are saved automatically and restored on your next visit.

## Getting Started

```bash
npm install       # Install dependencies
npm run dev       # Start the dev server
npm run build     # Production build
npm run preview   # Preview the production build
```

The build uses a relative base, and is deployed as one of the pages of
[mpalenque.github.io/particlesvideo](https://mpalenque.github.io/particlesvideo/)
at `/moon-simulator/` (see `.github/workflows/deploy-pages.yml` in the repo root).

Built with [Three.js](https://threejs.org/), TypeScript, and [Vite](https://vitejs.dev/).

## Roadmap

- Stronger accessibility refinements
- Richer educational overlays
- Diamond ring effect and Baily's beads for the solar eclipse observation inset
- Screenshots and animated previews in this README
- Deployment as a public demo

## Contributing

Issues, ideas, and educational improvements are welcome.

Please prefer small, focused pull requests with clear educational intent and conventional commit messages.

## License

This project is licensed under the **MIT License**. See [LICENSE](./LICENSE) for details.
