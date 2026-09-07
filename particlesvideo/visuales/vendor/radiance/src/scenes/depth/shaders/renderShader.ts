export const renderShader = /* wgsl */ `
struct SceneParams {
  viewProjection: mat4x4<f32>,
  sourceSize: vec2<f32>,
  gridSize: vec2<f32>,
  time: f32,
  depthMix: f32,
  depthScale: f32,
  depthCurve: f32,
  carryDepth: f32,
  sortPosition: f32,
  sortExtrusion: f32,
  blockScale: f32,
  blockDepth: f32,
  gap: f32,
  fog: f32,
  lightIntensity: f32,
  mixAmount: f32,
  background: f32,
  enabled: f32,
  viewMode: f32,
  cameraPosition: vec3<f32>,
  sortDirection: f32,
  maskMode: f32,
  maskThreshold: f32,
  maskFeather: f32,
  edgeSensitivity: f32,
  noiseAmount: f32,
  noiseScale: f32,
  maskInvert: f32,
  maskSpill: f32,
  maskCenterX: f32,
  maskCenterY: f32,
  maskRadius: f32,
  maskAspect: f32,
  canvasSize: vec2<f32>,
  radianceParams: vec4<f32>,
  blockParams: vec4<f32>,
  radiance2Params: vec4<f32>,
  displayParams: vec4<f32>,
}

@group(0) @binding(0) var<uniform> scene: SceneParams;
@group(0) @binding(1) var sourceTex: texture_2d<f32>;
@group(0) @binding(2) var sortedTex: texture_2d<f32>;
@group(0) @binding(3) var indexTex: texture_2d<u32>;
@group(0) @binding(4) var linearSampler: sampler;
@group(0) @binding(5) var maskTex: texture_2d<f32>;
@group(0) @binding(6) var cascadeTex: texture_2d<f32>;

fn luminance(color: vec4<f32>) -> f32 {
  return clamp(dot(color.rgb, vec3<f32>(0.298912, 0.586611, 0.114478)), 0.0, 1.0);
}

fn gradeColour(color: vec4<f32>) -> vec4<f32> {
  let brightness = max(scene.displayParams.x, 0.0);
  let contrast = max(scene.displayParams.y, 0.0);
  let graded = max((color.rgb - vec3<f32>(0.5)) * contrast + vec3<f32>(0.5), vec3<f32>(0.0)) * brightness;
  return vec4<f32>(graded, color.a);
}

fn colourSaturation(color: vec4<f32>) -> f32 {
  let hi = max(max(color.r, color.g), color.b);
  let lo = min(min(color.r, color.g), color.b);
  return select((hi - lo) / max(hi, 0.00001), 0.0, hi <= 0.00001);
}

fn colourHue(color: vec4<f32>) -> f32 {
  let hi = max(max(color.r, color.g), color.b);
  let lo = min(min(color.r, color.g), color.b);
  let delta = hi - lo;
  if (delta <= 0.00001) { return 0.0; }
  var h = 0.0;
  if (hi == color.r) {
    h = (color.g - color.b) / delta;
  } else if (hi == color.g) {
    h = 2.0 + (color.b - color.r) / delta;
  } else {
    h = 4.0 + (color.r - color.g) / delta;
  }
  return fract(h / 6.0 + 1.0);
}

fn activeTextureUv(uv: vec2<f32>) -> vec2<f32> {
  let fullSize = vec2<f32>(textureDimensions(sourceTex, 0));
  let safeUv = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
  return (safeUv * max(scene.sourceSize - vec2<f32>(1.0), vec2<f32>(1.0)) + vec2<f32>(0.5)) / fullSize;
}

fn effectPixelAt(uv: vec2<f32>) -> vec2<u32> {
  let safeUv = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
  let pixel = min(vec2<u32>(safeUv * scene.sourceSize), vec2<u32>(scene.sourceSize) - vec2<u32>(1u));
  let blockSize = max(u32(round(scene.blockParams.x)), 1u);
  // Block size controls streak thickness, never its length. Quantize only
  // across the sorting axis: X for vertical bars, Y for horizontal bars.
  if (scene.sortDirection > 0.5) {
    let blockOriginX = (pixel.x / blockSize) * blockSize;
    return vec2<u32>(
      min(blockOriginX + blockSize / 2u, u32(scene.sourceSize.x) - 1u),
      pixel.y,
    );
  }
  let blockOriginY = (pixel.y / blockSize) * blockSize;
  return vec2<u32>(
    pixel.x,
    min(blockOriginY + blockSize / 2u, u32(scene.sourceSize.y) - 1u),
  );
}

fn sampleSourceAt(uv: vec2<f32>) -> vec4<f32> {
  return textureSampleLevel(sourceTex, linearSampler, activeTextureUv(uv), 0.0);
}

fn sampleSortedAt(uv: vec2<f32>) -> vec4<f32> {
  return textureLoad(sortedTex, vec2<i32>(effectPixelAt(uv)), 0);
}

fn sampleMaskAt(uv: vec2<f32>) -> vec4<f32> {
  return textureLoad(maskTex, vec2<i32>(effectPixelAt(uv)), 0);
}

fn depthAt(uv: vec2<f32>) -> f32 {
  let safeUv = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
  let color = sampleSourceAt(safeUv);
  let radial = 1.0 - clamp(distance(safeUv, vec2<f32>(0.5)) / 0.707106, 0.0, 1.0);
  let wave = 0.5 + 0.5 * sin(safeUv.x * 13.0 + safeUv.y * 9.0 + scene.time * 0.35);
  let spatial = mix(radial, wave, 0.18);
  return clamp(mix(luminance(color), spatial, scene.depthMix), 0.0, 1.0);
}

fn sourceUvAt(uv: vec2<f32>) -> vec2<f32> {
  let pixel = effectPixelAt(uv);
  let linear = textureLoad(indexTex, vec2<i32>(pixel), 0).x;
  let width = u32(scene.sourceSize.x);
  let sourcePixel = vec2<u32>(linear % width, linear / width);
  return (vec2<f32>(sourcePixel) + vec2<f32>(0.5)) / scene.sourceSize;
}

fn effectTravelAt(uv: vec2<f32>) -> f32 {
  let sourceUv = sourceUvAt(uv);
  let deltaPixels = abs(sourceUv - uv) * scene.sourceSize;
  return select(deltaPixels.y, deltaPixels.x, scene.sortDirection < 0.5);
}

fn effectCoverageAt(uv: vec2<f32>) -> f32 {
  return smoothstep(0.5, 3.0, effectTravelAt(uv));
}

fn transportedMaskAt(uv: vec2<f32>) -> f32 {
  let packedMask = sampleMaskAt(uv);
  // G is the matte at the destination (contained); R is the same matte
  // transported with the sorted source pixel (free to escape the silhouette).
  return mix(packedMask.g, packedMask.r, scene.maskSpill);
}

fn authoritativeMaskAt(uv: vec2<f32>) -> f32 {
  // Compute already writes a feathered transported matte; linear sampling is
  // sufficient and avoids four redundant texture fetches per screen pixel.
  // Interactive circles are fixed regions in destination space, so their
  // coverage never follows the sorted source even if maskSpill is non-zero.
  if (u32(round(scene.maskMode)) == 4u) { return sampleMaskAt(uv).g; }
  return transportedMaskAt(uv);
}

struct CubeInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
}

struct CubeOutput {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) worldPosition: vec3<f32>,
  @location(3) @interpolate(flat) affected: f32,
}

@vertex
fn cubeVertex(input: CubeInput, @builtin(instance_index) instance: u32) -> CubeOutput {
  let gridWidth = u32(scene.gridSize.x);
  let gridHeight = u32(scene.gridSize.y);
  let cell = vec2<u32>(instance % gridWidth, instance / gridWidth);
  let uv = (vec2<f32>(cell) + vec2<f32>(0.5)) / vec2<f32>(f32(gridWidth), f32(gridHeight));
  let sourceUv = sourceUvAt(uv);
  let effectEnabled = scene.enabled;
  let destinationPixel = min(vec2<u32>(uv * scene.sourceSize), vec2<u32>(scene.sourceSize) - vec2<u32>(1u));
  let sourceLinear = textureLoad(indexTex, vec2<i32>(destinationPixel), 0).x;
  let destinationLinear = destinationPixel.y * u32(scene.sourceSize.x) + destinationPixel.x;
  let moved = sourceLinear != destinationLinear;
  let affected = select(0.0, effectEnabled * authoritativeMaskAt(uv) * scene.mixAmount * 0.12, moved);

  // A sorted pixel becomes a short micro-prism aligned with its displacement.
  // The full streak stays in the 2D sorted texture; geometry is only an accent.
  let horizontal = scene.sortDirection < 0.5;
  let axisSourceUv = select(vec2<f32>(uv.x, sourceUv.y), vec2<f32>(sourceUv.x, uv.y), horizontal);
  let rawDeltaUv = axisSourceUv - uv;
  let gridTexel = vec2<f32>(1.0) / scene.gridSize;
  let axisTexel = select(vec2<f32>(0.0, gridTexel.y), vec2<f32>(gridTexel.x, 0.0), horizontal);
  let maximumTrail = axisTexel * (scene.sortPosition * 2.0);
  let shortDelta = sign(rawDeltaUv) * min(abs(rawDeltaUv) * scene.sortExtrusion, maximumTrail);
  let strokeEndUv = uv + shortDelta * effectEnabled * scene.mixAmount;
  let depthUv = mix(uv, sourceUv, scene.carryDepth * effectEnabled);
  let original = sampleSourceAt(uv);
  let sorted = sampleSortedAt(uv);
  let color = mix(original, sorted, scene.mixAmount * effectEnabled);
  let shapedDepth = pow(max(depthAt(depthUv), 0.0001), max(scene.depthCurve, 0.05));
  let z = (shapedDepth - 0.5) * scene.depthScale;
  let sourceAspect = scene.sourceSize.x / scene.sourceSize.y;
  let cellSize = vec2<f32>(2.0 * sourceAspect / f32(gridWidth), 2.0 / f32(gridHeight));
  let baseScale = cellSize * scene.blockScale * (1.0 - scene.gap);
  let startPlane = vec2<f32>((uv.x - 0.5) * 2.0 * sourceAspect, (0.5 - uv.y) * 2.0);
  let endPlane = vec2<f32>((strokeEndUv.x - 0.5) * 2.0 * sourceAspect, (0.5 - strokeEndUv.y) * 2.0);
  let strokeSpan = abs(endPlane - startPlane);
  let xyScale = baseScale + strokeSpan;
  let zScale = cellSize.y * scene.blockDepth;
  let center = vec3<f32>((startPlane + endPlane) * 0.5, z);
  let world = center + vec3<f32>(input.position.xy * xyScale, input.position.z * zScale);
  var output: CubeOutput;
  output.clipPosition = scene.viewProjection * vec4<f32>(world, 1.0);
  output.color = color;
  output.normal = input.normal;
  output.worldPosition = world;
  output.affected = affected;
  return output;
}

@fragment
fn cubeFragment(input: CubeOutput) -> @location(0) vec4<f32> {
  if (input.affected < 0.015) { discard; }
  let normal = normalize(input.normal);
  let lightDirection = normalize(vec3<f32>(-0.45, 0.72, 0.52));
  let diffuse = max(dot(normal, lightDirection), 0.0);
  let viewDirection = normalize(scene.cameraPosition - input.worldPosition);
  let halfVector = normalize(lightDirection + viewDirection);
  let specular = pow(max(dot(normal, halfVector), 0.0), 32.0);
  let rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.4);
  let lighting = 0.74 + diffuse * scene.lightIntensity * 0.22 + specular * 0.1 + rim * 0.06;
  var color = input.color.rgb * lighting + input.color.rgb * input.color.rgb * rim * 0.04;
  let distanceToCamera = distance(scene.cameraPosition, input.worldPosition);
  let fogAmount = 1.0 - exp(-scene.fog * max(distanceToCamera - 2.0, 0.0) * 0.3);
  let background = vec3<f32>(scene.background, scene.background * 1.08, scene.background * 1.1);
  color = mix(color, background, clamp(fogAmount, 0.0, 0.9));
  return gradeColour(vec4<f32>(color, input.affected));
}

struct PlaneOutput {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn planeVertex(@builtin(vertex_index) vertexIndex: u32) -> PlaneOutput {
  let uvs = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(1.0, 0.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 0.0),
  );
  let uv = uvs[vertexIndex];
  let sourceAspect = scene.sourceSize.x / scene.sourceSize.y;
  let cellDepth = (2.0 / scene.gridSize.y) * scene.blockDepth;
  let z = -scene.depthScale * 0.5 - cellDepth * 0.65;
  let world = vec3<f32>((uv.x - 0.5) * 2.0 * sourceAspect, (0.5 - uv.y) * 2.0, z);
  var output: PlaneOutput;
  output.clipPosition = scene.viewProjection * vec4<f32>(world, 1.0);
  output.uv = uv;
  return output;
}

@fragment
fn planeFragment(input: PlaneOutput) -> @location(0) vec4<f32> {
  let original = sampleSourceAt(input.uv);
  let sorted = sampleSortedAt(input.uv);
  let mask = authoritativeMaskAt(input.uv);
  let amount = mask * scene.mixAmount * scene.enabled;
  var color = mix(original, sorted, amount);
  let center = effectTravelAt(input.uv);
  let coverage = smoothstep(0.5, 3.0, center) * mask * scene.enabled;
  let relief = clamp(scene.depthScale * 24.0, 0.0, 0.3);
  if (coverage <= 0.001 || relief <= 0.0001) { return gradeColour(color); }
  let texel = vec2<f32>(1.0) / scene.sourceSize;
  let right = effectTravelAt(clamp(input.uv + vec2<f32>(texel.x, 0.0), vec2<f32>(0.0), vec2<f32>(1.0)));
  let below = effectTravelAt(clamp(input.uv + vec2<f32>(0.0, texel.y), vec2<f32>(0.0), vec2<f32>(1.0)));
  let normal = normalize(vec3<f32>((center - right) * relief, (center - below) * relief, 1.0));
  let light = normalize(vec3<f32>(-0.35, 0.4, 1.0));
  let microShade = 1.0 + (dot(normal, light) - 0.88) * 0.09 * coverage;
  color = vec4<f32>(color.rgb * microShade, color.a);
  return gradeColour(color);
}

fn finalCompositeAt(uv: vec2<f32>) -> vec4<f32> {
  let original = sampleSourceAt(uv);
  let sorted = sampleSortedAt(uv);
  let mask = authoritativeMaskAt(uv);
  var color = mix(original, sorted, mask * scene.mixAmount * scene.enabled);
  let center = effectTravelAt(uv);
  let coverage = smoothstep(0.5, 3.0, center) * mask * scene.enabled;
  let relief = clamp(scene.depthScale * 24.0, 0.0, 0.3);
  if (coverage <= 0.001 || relief <= 0.0001) { return gradeColour(color); }
  let texel = vec2<f32>(1.0) / scene.sourceSize;
  let right = effectTravelAt(clamp(uv + vec2<f32>(texel.x, 0.0), vec2<f32>(0.0), vec2<f32>(1.0)));
  let below = effectTravelAt(clamp(uv + vec2<f32>(0.0, texel.y), vec2<f32>(0.0), vec2<f32>(1.0)));
  let normal = normalize(vec3<f32>((center - right) * relief, (center - below) * relief, 1.0));
  let light = normalize(vec3<f32>(-0.35, 0.4, 1.0));
  let microShade = 1.0 + (dot(normal, light) - 0.88) * 0.09 * coverage;
  return gradeColour(vec4<f32>(color.rgb * microShade, color.a));
}

struct QuadOutput {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

struct ContainedUv {
  uv: vec2<f32>,
  rawUv: vec2<f32>,
  inside: f32,
}

fn containedSourceUv(canvasUv: vec2<f32>) -> ContainedUv {
  let safeCanvasSize = max(scene.canvasSize, vec2<f32>(1.0));
  let safeSourceSize = max(scene.sourceSize, vec2<f32>(1.0));
  let canvasAspect = safeCanvasSize.x / safeCanvasSize.y;
  let sourceAspect = safeSourceSize.x / safeSourceSize.y;
  var offset = vec2<f32>(0.0);
  var extent = vec2<f32>(1.0);

  if (canvasAspect > sourceAspect) {
    extent.x = sourceAspect / canvasAspect;
    offset.x = (1.0 - extent.x) * 0.5;
  } else {
    extent.y = canvasAspect / sourceAspect;
    let waterfallMode = abs(scene.radianceParams.x - 1.0) < 0.25;
    let verticalAnchor = select(0.5, 0.18, waterfallMode);
    offset.y = (1.0 - extent.y) * verticalAnchor;
  }

  let zoom = max(scene.displayParams.z, 0.05);
  let containedUv = ((canvasUv - offset) / extent - vec2<f32>(0.5)) / zoom + vec2<f32>(0.5);
  let insideMin = step(vec2<f32>(0.0), containedUv);
  let insideMax = step(containedUv, vec2<f32>(1.0));
  var result: ContainedUv;
  result.uv = clamp(containedUv, vec2<f32>(0.0), vec2<f32>(1.0));
  result.rawUv = containedUv;
  result.inside = insideMin.x * insideMin.y * insideMax.x * insideMax.y;
  return result;
}

// The lower letterbox is a temporal waterfall texture. Each new sorted edge
// scanline enters at row zero and older scanlines move downward. Nothing from
// the source image is mirrored into this area.
fn radianceOutsideAt(contained: ContainedUv) -> vec4<f32> {
  let raw = contained.rawUv;
  let horizontalInside = step(0.0, raw.x) * step(raw.x, 1.0);
  let below = raw.y > 1.0;
  if (horizontalInside < 0.5 || !below) { return vec4<f32>(0.0); }

  let outsideDistance = max(raw.y - 1.0, 0.0);
  let canvasAspect = max(scene.canvasSize.x, 1.0) / max(scene.canvasSize.y, 1.0);
  let sourceAspect = max(scene.sourceSize.x, 1.0) / max(scene.sourceSize.y, 1.0);
  let frameExtentY = min(1.0, canvasAspect / sourceAspect);
  let frameOffsetY = (1.0 - frameExtentY) * 0.18;
  let availableOutside = max((1.0 - frameOffsetY - frameExtentY) / max(frameExtentY, 0.0001), 0.0001);
  let reach = clamp(scene.radianceParams.z, 0.05, 1.5);
  let distanceRatio = outsideDistance / max(availableOutside * reach, 0.0001);
  if (distanceRatio >= 1.0) { return vec4<f32>(0.0); }

  let historySize = textureDimensions(cascadeTex, 0);
  let blockSize = max(u32(round(scene.blockParams.x)), 1u);
  let rawPixelX = u32(clamp(round(raw.x * f32(historySize.x - 1u)), 0.0, f32(historySize.x - 1u)));
  let pixelDistance = outsideDistance * scene.sourceSize.y;
  let rawPixelY = u32(clamp(floor(pixelDistance), 0.0, f32(historySize.y - 1u)));
  let blockOriginX = (rawPixelX / blockSize) * blockSize;
  let samplePixel = vec2<u32>(
    min(blockOriginX + blockSize / 2u, historySize.x - 1u),
    rawPixelY,
  );
  // A narrow vertical joint separates neighbouring bars. There are no
  // horizontal joints: each sorted streak remains one continuous falling bar.
  let localX = rawPixelX - blockOriginX;
  let joint = select(0u, 1u, blockSize >= 4u);
  if (localX < joint) { return vec4<f32>(0.0); }
  let history = textureLoad(cascadeTex, vec2<i32>(samplePixel), 0);
  let endGate = 1.0 - smoothstep(0.94, 1.0, distanceRatio);
  let activity = history.a * endGate * scene.enabled;
  let materialLuma = luminance(vec4<f32>(history.rgb, 1.0));
  let emits = smoothstep(scene.blockParams.y - 0.09, scene.blockParams.y + 0.09, materialLuma);
  let cellX = (f32(localX) + 0.5) / f32(blockSize);
  let leftShadow = smoothstep(0.0, 0.3, cellX);
  let rightShadow = 1.0 - smoothstep(0.72, 1.0, cellX);
  let faceLight = 0.62 + 0.22 * leftShadow + 0.16 * rightShadow;
  let materialResponse = mix(0.5 + 0.18 * (1.0 - scene.blockParams.z), 1.0, emits);
  var core = history.rgb * activity * faceLight * materialResponse;
  core += history.rgb * activity * emits * 0.12;
  let premultiplied = min(clamp(core, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(activity));
  return vec4<f32>(premultiplied, activity);
}

@vertex
fn quadVertex(@builtin(vertex_index) vertexIndex: u32) -> QuadOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  let position = positions[vertexIndex];
  var output: QuadOutput;
  output.clipPosition = vec4<f32>(position, 0.0, 1.0);
  output.uv = vec2<f32>((position.x + 1.0) * 0.5, (1.0 - position.y) * 0.5);
  return output;
}

@fragment
fn quadFragment(input: QuadOutput) -> @location(0) vec4<f32> {
  let contained = containedSourceUv(input.uv);
  let mode = u32(round(scene.viewMode));
  if (contained.inside < 0.5) {
    let waterfallMode = abs(scene.radianceParams.x - 1.0) < 0.25;
    let radianceOutput = waterfallMode
      && scene.sortDirection > 0.5
      && (mode == 1u || mode == 4u);
    if (radianceOutput) { return gradeColour(radianceOutsideAt(contained)); }
    return select(
      vec4<f32>(0.0, 0.0, 0.0, 1.0),
      vec4<f32>(0.0),
      waterfallMode,
    );
  }
  let uv = contained.uv;
  let original = sampleSourceAt(uv);
  let sorted = sampleSortedAt(uv);
  if (mode == 0u) { return gradeColour(original); }
  if (mode == 1u) { return gradeColour(sorted); }
  if (mode == 2u) {
    let coverage = effectCoverageAt(uv) * authoritativeMaskAt(uv);
    return gradeColour(vec4<f32>(vec3<f32>(coverage), 1.0));
  }
  if (mode == 3u) {
    let sourceUv = sourceUvAt(uv);
    let delta = sourceUv - uv;
    let magnitude = clamp(length(delta) * 8.0, 0.0, 1.0);
    return gradeColour(vec4<f32>(0.5 + delta.x * 5.0, 0.5 + delta.y * 5.0, magnitude, 1.0));
  }
  return finalCompositeAt(uv);
}

// Radiance 2 uses an opaque two-panel canvas instead of overloading alpha.
// Left: exact RGB emission from pixels that actually travelled during sort.
// Right: scalar HRC absorption derived from the original image's hue.
@fragment
fn radiance2MaterialFragment(input: QuadOutput) -> @location(0) vec4<f32> {
  let emissionPanel = input.uv.x < 0.5;
  let uv = vec2<f32>(fract(input.uv.x * 2.0), input.uv.y);
  let mask = authoritativeMaskAt(uv);
  let moved = effectCoverageAt(uv);
  let travel = effectTravelAt(uv);
  let travelThreshold = max(scene.blockParams.w, 0.0);
  let travelGate = select(
    1.0,
    smoothstep(travelThreshold * 0.65, travelThreshold * 1.35, travel),
    travelThreshold > 0.01,
  );
  let mode = u32(round(scene.viewMode));
  let viewAllowsEmission = select(0.0, 1.0, mode == 1u || mode == 4u);
  let emissionCoverage = clamp(
    moved * travelGate * mask * scene.mixAmount * scene.enabled * viewAllowsEmission,
    0.0,
    1.0,
  );

  if (emissionPanel) {
    let sortedColour = sampleSortedAt(uv).rgb;
    let peak = max(max(sortedColour.r, sortedColour.g), sortedColour.b);
    let hueColour = select(
      vec3<f32>(0.0),
      sortedColour / max(peak, 0.00001),
      peak > 0.00001,
    );
    // Dark sorted colours remain visibly emissive without turning the soft
    // coverage edge into a halo. The lift happens before coverage is applied,
    // so only pixels that genuinely travelled inject energy into HRC.
    let emissionFloor = clamp(scene.blockParams.y, 0.0, 0.6);
    let liftWeight = smoothstep(0.04, 0.18, peak);
    let liftedPeak = mix(peak, max(peak, emissionFloor), liftWeight);
    let emission = hueColour * liftedPeak * emissionCoverage;
    return vec4<f32>(emission, 1.0);
  }

  let source = sampleSourceAt(uv);
  let saturation = colourSaturation(source);
  let hue = colourHue(source);
  let targetHue = fract(scene.radiance2Params.x + 1.0);
  let hueRange = clamp(scene.radiance2Params.y, 0.01, 0.5);
  let saturationFloor = clamp(scene.radiance2Params.z, 0.0, 0.8);
  let materialContrast = clamp(scene.radiance2Params.w, 0.0, 1.0);
  let rawDistance = abs(hue - targetHue);
  let circularDistance = min(rawDistance, 1.0 - rawDistance);
  let hueFeather = max(0.002, hueRange * mix(0.72, 0.08, materialContrast));
  let hueGate = 1.0 - smoothstep(
    max(0.0, hueRange - hueFeather),
    min(0.5, hueRange + hueFeather),
    circularDistance,
  );
  // Low-chroma white and grey are exact empty space. Higher contrast turns
  // the remaining hue field into a clean wall/void split instead of fog.
  let saturationFeather = mix(0.22, 0.035, materialContrast);
  let saturationGate = smoothstep(
    saturationFloor,
    min(1.0, saturationFloor + saturationFeather),
    saturation,
  );
  let materialScore = min(hueGate, saturationGate);
  let splitFeather = mix(0.24, 0.025, materialContrast);
  let absorption = smoothstep(
    0.5 - splitFeather,
    0.5 + splitFeather,
    materialScore,
  );
  // Emission and source material are independent layers. A sorted bar stays a
  // pure light source while the original hue below it can still cast a shadow;
  // the sorting itself never contributes absorption.
  // The atlas canvas is sampled as sRGB by WebGL. Encode this linear scalar so
  // the texture decode restores the intended optical density.
  let encodedAbsorption = pow(absorption, 1.0 / 2.2);
  return vec4<f32>(vec3<f32>(encodedAbsorption), 1.0);
}
`;
