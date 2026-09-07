/*
 * Segmented bitonic layout derived from ruccho/BitonicPixelSorter.
 * Copyright (c) 2020 ruccho, distributed under the MIT License.
 * See THIRD_PARTY_NOTICES.md.
 */
export const SORT_SIZE = 1024;
export const SORT_WIDTH = 1024;
export const SORT_HEIGHT = 576;

export const sortShader = /* wgsl */ `
struct SortParams {
  thresholdMin: f32,
  thresholdMax: f32,
  depthMix: f32,
  time: f32,
  width: u32,
  height: u32,
  direction: u32,
  ordering: u32,
  triggerMetric: u32,
  sortMetric: u32,
  affectOutside: u32,
  seed: u32,
  maskMode: u32,
  maskInvert: u32,
  maskThreshold: f32,
  maskFeather: f32,
  edgeSensitivity: f32,
  noiseAmount: f32,
  noiseScale: f32,
  maxSpan: u32,
  maskCenterX: f32,
  maskCenterY: f32,
  maskRadius: f32,
  maskAspect: f32,
  outsideReach: u32,
  spillDirection: u32,
  stripOffset: f32,
  offsetRandom: f32,
  fillEnabled: u32,
  affectBackground: u32,
  noiseComplexity: u32,
  noiseSeed: u32,
  stripSeed: u32,
  featherStart: f32,
  featherEnd: f32,
  sortAmount: f32,
}

@group(0) @binding(0) var<uniform> params: SortParams;
@group(0) @binding(1) var sourceTex: texture_2d<f32>;
@group(0) @binding(2) var sortedTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var indexTex: texture_storage_2d<r32uint, write>;
@group(0) @binding(4) var maskTex: texture_storage_2d<rgba8unorm, write>;

var<workgroup> groupCache: array<u32, 1024>;
var<workgroup> seedCache: array<u32, 1024>;
var<workgroup> tonalCache: array<u32, 1024>;
var<workgroup> scanCache: array<u32, 128>;

fn luminance(color: vec4<f32>) -> f32 {
  return clamp(dot(color.rgb, vec3<f32>(0.298912, 0.586611, 0.114478)), 0.0, 1.0);
}

fn saturation(color: vec4<f32>) -> f32 {
  let hi = max(max(color.r, color.g), color.b);
  let lo = min(min(color.r, color.g), color.b);
  return select((hi - lo) / max(hi, 0.00001), 0.0, hi <= 0.00001);
}

fn hue(color: vec4<f32>) -> f32 {
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

fn proceduralDepth(color: vec4<f32>, position: vec2<u32>) -> f32 {
  let uv = (vec2<f32>(position) + vec2<f32>(0.5)) / vec2<f32>(f32(params.width), f32(params.height));
  let radial = 1.0 - clamp(distance(uv, vec2<f32>(0.5, 0.5)) / 0.707106, 0.0, 1.0);
  let wave = 0.5 + 0.5 * sin(uv.x * 13.0 + uv.y * 9.0 + params.time * 0.35 + f32(params.seed));
  let spatial = mix(radial, wave, 0.18);
  return clamp(mix(luminance(color), spatial, params.depthMix), 0.0, 1.0);
}

fn metric(kind: u32, color: vec4<f32>, position: vec2<u32>) -> f32 {
  switch kind {
    case 1u: { return hue(color); }
    case 2u: { return saturation(color); }
    case 3u: { return proceduralDepth(color, position); }
    default: {
      // Canvas/video uploads expose display-referred values while the Adobe
      // effect evaluates its luminosity after host color processing. This
      // transfer was calibrated against the same UHD frame in Premiere so a
      // visible threshold of 0.776 selects the same mid/dark regions instead
      // of incorrectly swallowing the warm wall into one giant interval.
      return pow(max(luminance(color), 0.000001), 0.60);
    }
  }
}

fn readColor(position: vec2<u32>) -> vec4<f32> {
  if (position.x >= params.width || position.y >= params.height) {
    return vec4<f32>(0.0);
  }
  return textureLoad(sourceTex, vec2<i32>(position), 0);
}

fn hashU32(value: u32) -> u32 {
  var result = value;
  result = (result ^ (result >> 16u)) * 2246822519u;
  result = (result ^ (result >> 13u)) * 3266489917u;
  return result ^ (result >> 16u);
}

fn hashCell(cell: vec2<i32>, seed: u32) -> f32 {
  let mixed = bitcast<u32>(cell.x) * 374761393u
    + bitcast<u32>(cell.y) * 668265263u
    + seed * 2246822519u;
  return f32(hashU32(mixed) & 0x00ffffffu) / 16777215.0;
}

fn valueNoise(point: vec2<f32>, seed: u32) -> f32 {
  let base = vec2<i32>(floor(point));
  let fraction = fract(point);
  let blend = fraction * fraction * (vec2<f32>(3.0) - 2.0 * fraction);
  let bottomLeft = hashCell(base, seed);
  let bottomRight = hashCell(base + vec2<i32>(1, 0), seed);
  let topLeft = hashCell(base + vec2<i32>(0, 1), seed);
  let topRight = hashCell(base + vec2<i32>(1, 1), seed);
  return mix(
    mix(bottomLeft, bottomRight, blend.x),
    mix(topLeft, topRight, blend.x),
    blend.y,
  );
}

fn triggerNoise(position: vec2<u32>) -> f32 {
  let uv = (vec2<f32>(position) + vec2<f32>(0.5))
    / vec2<f32>(f32(params.width), f32(params.height));
  // Pixel Sorter's scale is most useful in the low tens. Dividing by 3.2
  // makes a scale of 18 produce roughly six broad cycles across the image.
  var point = uv * max(params.noiseScale / 3.2, 0.05);
  let octaveCount = clamp(params.noiseComplexity, 1u, 8u);
  var amplitude = 0.5;
  var total = 0.0;
  var normalization = 0.0;
  for (var octave = 0u; octave < 8u; octave += 1u) {
    if (octave < octaveCount) {
      total += valueNoise(point, params.noiseSeed + octave * 1013904223u) * amplitude;
      normalization += amplitude;
      // Rotate/offset each octave to avoid axis-aligned repeated contours.
      point = vec2<f32>(point.y * 1.91 + 17.17, point.x * -1.83 + 29.41);
      amplitude *= 0.5;
    }
  }
  return total / max(normalization, 0.00001);
}

fn noisyTrigger(trigger: f32, position: vec2<u32>) -> f32 {
  if (params.noiseAmount <= 0.0001) { return trigger; }
  let organicOffset = (triggerNoise(position) - 0.5)
    * 0.08
    * clamp(params.noiseAmount, 0.0, 1.0);
  return clamp(trigger + organicOffset, 0.0, 1.0);
}

fn circleMaskAt(position: vec2<u32>) -> f32 {
  let uv = (vec2<f32>(position) + vec2<f32>(0.5)) / vec2<f32>(f32(params.width), f32(params.height));
  // X is scaled by source aspect so a UV distance becomes a true circle in
  // display pixels instead of a 16:9 ellipse.
  let sourceAspect = f32(params.width) / max(f32(params.height), 1.0);
  let focusDelta = uv - vec2<f32>(params.maskCenterX, params.maskCenterY);
  let circleDistance = length(vec2<f32>(focusDelta.x * sourceAspect, focusDelta.y));
  let radius = max(params.maskRadius, 0.01);
  let circleFeather = max(params.maskFeather, 0.0005);
  var coverage = 1.0 - smoothstep(
    max(0.0, radius - circleFeather),
    radius + circleFeather,
    circleDistance,
  );
  if (params.maskInvert != 0u) { coverage = 1.0 - coverage; }
  return coverage;
}

fn circleDomainAllows(position: vec2<u32>) -> bool {
  return params.maskMode != 4u || circleMaskAt(position) > 0.0001;
}

fn contentMask(color: vec4<f32>, position: vec2<u32>) -> f32 {
  let centerLuma = luminance(color);
  let uv = (vec2<f32>(position) + vec2<f32>(0.5)) / vec2<f32>(f32(params.width), f32(params.height));
  let highlights = smoothstep(0.18, 0.92, centerLuma);
  var score = 1.0;
  if (params.maskMode == 4u) {
    return circleMaskAt(position);
  } else if (params.maskMode == 3u) {
    score = highlights;
  } else if (params.maskMode == 1u && params.width <= 256u) {
    // Low-latency profiles keep the subject prior and tonal/chroma cues but
    // skip four neighbour reads per pixel. Full profiles retain edge-aware
    // separation below.
    let focusDelta = uv - vec2<f32>(params.maskCenterX, params.maskCenterY);
    let focusDistance = length(vec2<f32>(focusDelta.x / max(params.maskAspect, 0.05), focusDelta.y));
    let radius = max(params.maskRadius, 0.05);
    let centerPrior = 1.0 - smoothstep(radius * 0.5, radius, focusDistance);
    score = clamp(centerPrior * (0.58 + highlights * 0.34 + saturation(color) * 0.08), 0.0, 1.0);
  } else if (params.maskMode == 1u || params.maskMode == 2u) {
    let dimensions = vec2<i32>(i32(params.width), i32(params.height));
    let maxPosition = dimensions - vec2<i32>(1);
    let pixel = vec2<i32>(position);
    let left = textureLoad(sourceTex, clamp(pixel + vec2<i32>(-2, 0), vec2<i32>(0), maxPosition), 0);
    let right = textureLoad(sourceTex, clamp(pixel + vec2<i32>(2, 0), vec2<i32>(0), maxPosition), 0);
    let above = textureLoad(sourceTex, clamp(pixel + vec2<i32>(0, -2), vec2<i32>(0), maxPosition), 0);
    let below = textureLoad(sourceTex, clamp(pixel + vec2<i32>(0, 2), vec2<i32>(0), maxPosition), 0);
    let leftLuma = luminance(left);
    let rightLuma = luminance(right);
    let aboveLuma = luminance(above);
    let belowLuma = luminance(below);
    let edge = clamp((abs(rightLuma - leftLuma) + abs(belowLuma - aboveLuma)) * params.edgeSensitivity, 0.0, 1.0);
    if (params.maskMode == 2u) {
      let neighborhood = (leftLuma + rightLuma + aboveLuma + belowLuma) * 0.25;
      let contrast = clamp(abs(centerLuma - neighborhood) * params.edgeSensitivity * 1.6, 0.0, 1.0);
      score = max(edge, contrast);
    } else {
      let focusDelta = uv - vec2<f32>(params.maskCenterX, params.maskCenterY);
      let focusDistance = length(vec2<f32>(focusDelta.x / max(params.maskAspect, 0.05), focusDelta.y));
      let radius = max(params.maskRadius, 0.05);
      let centerPrior = 1.0 - smoothstep(radius * 0.5, radius, focusDistance);
      let edgeBarrier = 1.0 - smoothstep(0.52, 0.96, edge);
      score = clamp(
        centerPrior * (0.52 + highlights * 0.32 + saturation(color) * 0.08)
          * mix(0.3, 1.0, edgeBarrier),
        0.0,
        1.0,
      );
    }
  }
  if (params.maskInvert != 0u) { score = 1.0 - score; }
  return score;
}

fn positionOnLine(line: u32, x: u32) -> vec2<u32> {
  if (params.direction == 0u) { return vec2<u32>(x, line); }
  return vec2<u32>(line, x);
}

fn intervalAllows(position: vec2<u32>) -> bool {
  if (params.maxSpan == 0u) { return true; }
  let span = max(params.maxSpan, 1u);
  let coordinate = select(position.y, position.x, params.direction == 0u);
  let line = select(position.x, position.y, params.direction == 0u);
  let lineHash = hashU32(line + params.seed * 2246822519u);
  // A per-line phase hides the comb while retaining a strict deterministic
  // cap. Strip offset/randomness no longer changes interval boundaries.
  return (coordinate + lineHash % span) % span != 0u;
}

fn intervalRandom(line: u32, start: u32, end: u32) -> f32 {
  let mixed = line * 668265263u
    + start * 374761393u
    + end * 1274126177u
    + params.stripSeed * 2246822519u;
  return f32(hashU32(mixed) & 0x00ffffffu) / 16777215.0;
}

fn offsetSlot(line: u32, slot: u32, start: u32, end: u32) -> u32 {
  if (end <= start || slot < start || slot > end) { return slot; }
  if (abs(params.stripOffset) <= 0.000001 && params.offsetRandom <= 0.000001) { return slot; }
  let length = end - start + 1u;
  let randomOffset = (intervalRandom(line, start, end) * 2.0 - 1.0) * params.offsetRandom;
  let phase = fract(params.stripOffset + randomOffset);
  let shift = u32(floor(phase * f32(length) + 0.5)) % length;
  return start + ((slot - start + shift) % length);
}

// Controls the *permutation* rather than compositing two images. A value of
// zero returns the source pixel already at this output position; a value of
// one returns the fully sorted source pixel. Intermediate values shorten the
// actual movement of each pixel, so the streaks contract into the original.
fn sourceIndexWithSortAmount(sortedSlot: u32, outputSlot: u32, start: u32, end: u32) -> u32 {
  let sortedSourceIndex = groupCache[sortedSlot] >> 16u;
  let amount = clamp(params.sortAmount, 0.0, 1.0);
  if (amount <= 0.000001) { return outputSlot; }
  if (amount >= 0.999999) { return sortedSourceIndex; }
  let interpolated = f32(outputSlot) + (f32(sortedSourceIndex) - f32(outputSlot)) * amount;
  return u32(clamp(round(interpolated), f32(start), f32(end)));
}

fn normalizedFeather(value: f32) -> f32 {
  let positive = max(value, 0.0);
  return select(clamp(positive, 0.0, 1.0), clamp(positive / 100.0, 0.0, 1.0), positive > 1.0);
}

fn intervalFeather(slot: u32, start: u32, end: u32) -> f32 {
  if (end <= start || slot < start || slot > end) { return 1.0; }
  let length = f32(end - start + 1u);
  let startExtent = normalizedFeather(params.featherStart) * length * 0.5;
  let endExtent = normalizedFeather(params.featherEnd) * length * 0.5;
  var coverage = 1.0;
  if (startExtent > 0.0001) {
    coverage *= smoothstep(0.0, startExtent, f32(slot - start) + 0.5);
  }
  if (endExtent > 0.0001) {
    coverage *= smoothstep(0.0, endExtent, f32(end - slot) + 0.5);
  }
  return coverage;
}

fn storePassthrough(line: u32, pairBase: u32, ops: u32, size: u32) {
  for (var t = 0u; t < ops; t += 1u) {
    let xL = (pairBase + t) << 1u;
    let xR = xL + 1u;
    if (xL < size) {
      let outputPos = positionOnLine(line, xL);
      textureStore(sortedTex, vec2<i32>(outputPos), readColor(outputPos));
      textureStore(indexTex, vec2<i32>(outputPos), vec4<u32>(outputPos.y * params.width + outputPos.x, 0u, 0u, 1u));
      textureStore(maskTex, vec2<i32>(outputPos), vec4<f32>(0.0, 0.0, 0.0, 1.0));
    }
    if (xR < size) {
      let outputPos = positionOnLine(line, xR);
      textureStore(sortedTex, vec2<i32>(outputPos), readColor(outputPos));
      textureStore(indexTex, vec2<i32>(outputPos), vec4<u32>(outputPos.y * params.width + outputPos.x, 0u, 0u, 1u));
      textureStore(maskTex, vec2<i32>(outputPos), vec4<f32>(0.0, 0.0, 0.0, 1.0));
    }
  }
}

@compute @workgroup_size(128, 1, 1)
fn sortMain(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
) {
  let line = workgroupId.x;
  let gtid = localId.x;
  let size = select(params.height, params.width, params.direction == 0u);
  let reducedSize = (size + 1u) >> 1u;
  let ops = (reducedSize + 127u) / 128u;
  let pairBase = gtid * ops;

  var rangeMask = 0u;
  for (var t = 0u; t < ops; t += 1u) {
    let xL = (pairBase + t) << 1u;
    let xR = xL + 1u;
    let posL = positionOnLine(line, xL);
    let posR = positionOnLine(line, xR);
    let colorL = readColor(posL);
    let colorR = readColor(posR);
    let triggerL = metric(params.triggerMetric, colorL, posL);
    let triggerR = metric(params.triggerMetric, colorR, posR);
    let eligibilityL = noisyTrigger(triggerL, posL);
    let eligibilityR = noisyTrigger(triggerR, posR);
    var tonalL = params.thresholdMin <= eligibilityL && eligibilityL <= params.thresholdMax;
    var tonalR = params.thresholdMin <= eligibilityR && eligibilityR <= params.thresholdMax;
    if (params.affectOutside != 0u) {
      tonalL = !tonalL;
      tonalR = !tonalR;
    }
    let feather = max(params.maskFeather, 0.0001);
    var maskL = 1.0;
    var maskR = 1.0;
    if (params.affectBackground == 0u || params.maskMode == 4u) {
      let contentL = contentMask(colorL, posL);
      let contentR = contentMask(colorR, posR);
      if (params.maskMode == 4u) {
        maskL = contentL;
        maskR = contentR;
      } else {
        maskL = smoothstep(params.maskThreshold - feather, params.maskThreshold + feather, contentL);
        maskR = smoothstep(params.maskThreshold - feather, params.maskThreshold + feather, contentR);
      }
    }
    let seedL = select(0.0, maskL, xL < size && tonalL);
    let seedR = select(0.0, maskR, xR < size && tonalR);
    seedCache[xL] = u32(round(seedL * 255.0));
    seedCache[xR] = u32(round(seedR * 255.0));
    tonalCache[xL] = select(0u, 1u, xL < size && tonalL);
    tonalCache[xR] = select(0u, 1u, xR < size && tonalR);
    // Ten-bit keys reduce frame-to-frame shimmer from tiny video noise while
    // the original index remains a deterministic stable tie-break.
    var sortValueL = triggerL;
    var sortValueR = triggerR;
    if (params.sortMetric != params.triggerMetric) {
      sortValueL = metric(params.sortMetric, colorL, posL);
      sortValueR = metric(params.sortMetric, colorR, posR);
    }
    let keyL = u32(round(clamp(sortValueL, 0.0, 1.0) * 1023.0));
    let keyR = u32(round(clamp(sortValueR, 0.0, 1.0) * 1023.0));
    groupCache[xL] = (xL << 16u) | keyL;
    groupCache[xR] = (xR << 16u) | keyR;
  }
  workgroupBarrier();

  let reach = min(params.outsideReach, size - 1u);
  var lineHasSeed = 0u;

  // Positive flow: nearest seed behind the current pixel. We build the local
  // range bits immediately, so no 4 KiB distance cache is required.
  if (params.spillDirection != 2u) {
    var previousSeed = 0u;
    for (var t = 0u; t < ops; t += 1u) {
      let xL = (pairBase + t) << 1u;
      let xR = xL + 1u;
      if (seedCache[xL] != 0u) { previousSeed = xL + 1u; }
      if (seedCache[xR] != 0u) { previousSeed = xR + 1u; }
    }
    scanCache[gtid] = previousSeed;
    workgroupBarrier();
    for (var offset = 1u; offset < 128u; offset <<= 1u) {
      let own = scanCache[gtid];
      let other = scanCache[max(gtid, offset) - offset];
      workgroupBarrier();
      scanCache[gtid] = max(own, select(0u, other, gtid >= offset));
      workgroupBarrier();
    }
    lineHasSeed = select(0u, 1u, workgroupUniformLoad(&scanCache[127]) != 0u);
    if (lineHasSeed == 0u) {
      storePassthrough(line, pairBase, ops, size);
      return;
    }
    previousSeed = scanCache[max(gtid, 1u) - 1u];
    if (gtid == 0u) { previousSeed = 0u; }
    for (var t = 0u; t < ops; t += 1u) {
      let xL = (pairBase + t) << 1u;
      let xR = xL + 1u;
      let posL = positionOnLine(line, xL);
      let posR = positionOnLine(line, xR);
      if (seedCache[xL] != 0u) { previousSeed = xL + 1u; }
      let distanceL = select(0xffffu, xL - (previousSeed - 1u), previousSeed != 0u && xL < size);
      let inL = xL < size && tonalCache[xL] != 0u && distanceL <= reach && intervalAllows(posL) && circleDomainAllows(posL);
      rangeMask |= select(0u, 1u, inL) << (t * 2u);
      if (seedCache[xR] != 0u) { previousSeed = xR + 1u; }
      let distanceR = select(0xffffu, xR - (previousSeed - 1u), previousSeed != 0u && xR < size);
      let inR = xR < size && tonalCache[xR] != 0u && distanceR <= reach && intervalAllows(posR) && circleDomainAllows(posR);
      rangeMask |= select(0u, 1u, inR) << (t * 2u + 1u);
    }
    workgroupBarrier();
  }

  // Negative flow: nearest seed ahead of the current pixel. Both mode ORs
  // this domain with the positive domain above.
  if (params.spillDirection != 1u) {
    var nextSeed = 0xffffu;
    var spillReverseT = ops;
    loop {
      if (spillReverseT == 0u) { break; }
      spillReverseT -= 1u;
      let xL = (pairBase + spillReverseT) << 1u;
      let xR = xL + 1u;
      if (seedCache[xR] != 0u) { nextSeed = xR; }
      if (seedCache[xL] != 0u) { nextSeed = xL; }
    }
    scanCache[gtid] = nextSeed;
    workgroupBarrier();
    for (var offset = 1u; offset < 128u; offset <<= 1u) {
      let own = scanCache[gtid];
      let other = scanCache[min(gtid + offset, 127u)];
      workgroupBarrier();
      scanCache[gtid] = min(own, select(0xffffu, other, gtid + offset < 128u));
      workgroupBarrier();
    }
    if (params.spillDirection == 2u) {
      lineHasSeed = select(0u, 1u, workgroupUniformLoad(&scanCache[0]) != 0xffffu);
      if (lineHasSeed == 0u) {
        storePassthrough(line, pairBase, ops, size);
        return;
      }
    }
    nextSeed = scanCache[min(gtid + 1u, 127u)];
    if (gtid + 1u >= 128u) { nextSeed = 0xffffu; }
    spillReverseT = ops;
    loop {
      if (spillReverseT == 0u) { break; }
      spillReverseT -= 1u;
      let xL = (pairBase + spillReverseT) << 1u;
      let xR = xL + 1u;
      if (seedCache[xR] != 0u) { nextSeed = xR; }
      let nextDistanceR = select(0xffffu, nextSeed - xR, nextSeed != 0xffffu && xR < size);
      let posR = positionOnLine(line, xR);
      let inR = xR < size && tonalCache[xR] != 0u && nextDistanceR <= reach && intervalAllows(posR) && circleDomainAllows(posR);
      rangeMask |= select(0u, 1u, inR) << (spillReverseT * 2u + 1u);
      if (seedCache[xL] != 0u) { nextSeed = xL; }
      let nextDistanceL = select(0xffffu, nextSeed - xL, nextSeed != 0xffffu && xL < size);
      let posL = positionOnLine(line, xL);
      let inL = xL < size && tonalCache[xL] != 0u && nextDistanceL <= reach && intervalAllows(posL) && circleDomainAllows(posL);
      rangeMask |= select(0u, 1u, inL) << (spillReverseT * 2u);
    }
    workgroupBarrier();
  }
  workgroupBarrier();

  var preMeta: array<u32, 4>;

  var forwardSeed = 0u;
  for (var t = 0u; t < ops; t += 1u) {
    let xL = (pairBase + t) << 1u;
    if ((rangeMask & (1u << (t * 2u))) == 0u) { forwardSeed = xL + 1u; }
    if ((rangeMask & (2u << (t * 2u))) == 0u) { forwardSeed = xL + 2u; }
  }
  scanCache[gtid] = forwardSeed;
  workgroupBarrier();

  for (var offset = 1u; offset < 128u; offset <<= 1u) {
    let own = scanCache[gtid];
    let other = scanCache[max(gtid, offset) - offset];
    workgroupBarrier();
    scanCache[gtid] = max(own, select(0u, other, gtid >= offset));
    workgroupBarrier();
  }

  var forwardCarry = scanCache[max(gtid, 1u) - 1u];
  if (gtid == 0u) { forwardCarry = 0u; }
  for (var t = 0u; t < ops; t += 1u) {
    let xL = (pairBase + t) << 1u;
    let inL = (rangeMask & (1u << (t * 2u))) != 0u;
    let inR = (rangeMask & (2u << (t * 2u))) != 0u;
    var start = 0u;
    if (inL) {
      start = forwardCarry;
    } else {
      forwardCarry = xL + 1u;
      start = select(xL, forwardCarry, inR);
    }
    if (!inR) { forwardCarry = xL + 2u; }
    preMeta[t] = start << 16u;
  }
  workgroupBarrier();

  var backwardSeed = 0xffffu;
  var reverseT = ops;
  loop {
    if (reverseT == 0u) { break; }
    reverseT -= 1u;
    let xL = (pairBase + reverseT) << 1u;
    if ((rangeMask & (2u << (reverseT * 2u))) == 0u) { backwardSeed = xL + 1u; }
    if ((rangeMask & (1u << (reverseT * 2u))) == 0u) { backwardSeed = xL; }
  }
  scanCache[gtid] = backwardSeed;
  workgroupBarrier();

  for (var offset = 1u; offset < 128u; offset <<= 1u) {
    let own = scanCache[gtid];
    let other = scanCache[min(gtid + offset, 127u)];
    workgroupBarrier();
    scanCache[gtid] = min(own, select(0xffffu, other, gtid + offset < 128u));
    workgroupBarrier();
  }

  var backwardCarry = scanCache[min(gtid + 1u, 127u)];
  if (gtid + 1u >= 128u) { backwardCarry = 0xffffu; }
  var maxLen = 1u;
  reverseT = ops;
  loop {
    if (reverseT == 0u) { break; }
    reverseT -= 1u;
    let xL = (pairBase + reverseT) << 1u;
    let inL = (rangeMask & (1u << (reverseT * 2u))) != 0u;
    let inR = (rangeMask & (2u << (reverseT * 2u))) != 0u;
    if (!inR) { backwardCarry = xL + 1u; }
    var start = preMeta[reverseT] >> 16u;
    var end = select(xL, min(backwardCarry, size) - 1u, inL || inR);
    if (!inL) { backwardCarry = xL; }
    let xSlot = xL + (start & 1u);
    let valid = end > start && xSlot <= end;
    start = select(xSlot, start, valid);
    end = select(xSlot, end, valid);
    preMeta[reverseT] = (start << 16u) | end;
    maxLen = max(maxLen, end - start + 1u);
  }
  workgroupBarrier();

  scanCache[gtid] = maxLen;
  workgroupBarrier();
  for (var offset = 64u; offset > 0u; offset >>= 1u) {
    if (gtid < offset) {
      scanCache[gtid] = max(scanCache[gtid], scanCache[gtid + offset]);
    }
    workgroupBarrier();
  }

  let uniformMaxLen = workgroupUniformLoad(&scanCache[0]);
  var lineLevels = 0u;
  if (uniformMaxLen > 1u) {
    var bits = uniformMaxLen;
    loop {
      if (bits == 0u) { break; }
      lineLevels += 1u;
      bits >>= 1u;
    }
  }

  for (var level = 0u; level < lineLevels; level += 1u) {
    var inner = level + 1u;
    loop {
      if (inner == 0u) { break; }
      inner -= 1u;
      workgroupBarrier();
      for (var t = 0u; t < ops; t += 1u) {
        let spanMeta = preMeta[t];
        let rangeStart = spanMeta >> 16u;
        let rangeEnd = spanMeta & 0xffffu;
        let x = (pairBase + t) << 1u;
        let useR = rangeStart & 1u;
        let posInRange = x - rangeStart + useR;
        let swapIndex = posInRange >> 1u;
        let comparatorSize = 1u << inner;
        let a = rangeStart
          + (swapIndex & (comparatorSize - 1u))
          + (swapIndex >> inner) * (comparatorSize << 1u);
        let candidateB = a + comparatorSize;
        let b = select(a, candidateB, candidateB <= rangeEnd);
        let block = (posInRange >> 1u) >> level;
        let n = rangeEnd - rangeStart + 1u;
        let endBlock = n >> (level + 1u);
        let ascPattern = (((endBlock & 1u) == 0u) == (params.ordering != 0u));
        let asc = (((block & 1u) == 0u) == ascPattern);
        let valueA = groupCache[a];
        let valueB = groupCache[b];
        let keyA = valueA & 0xffffu;
        let keyB = valueB & 0xffffu;
        let indexA = valueA >> 16u;
        let indexB = valueB >> 16u;
        let less = keyA < keyB || (keyA == keyB && indexA < indexB);
        let keepA = asc == less;
        groupCache[a] = select(valueB, valueA, keepA);
        groupCache[b] = select(valueA, valueB, keepA);
      }
    }
  }
  workgroupBarrier();

  for (var t = 0u; t < ops; t += 1u) {
    let xL = (pairBase + t) << 1u;
    let xR = xL + 1u;
    let spanMeta = preMeta[t];
    let rangeStart = spanMeta >> 16u;
    let rangeEnd = spanMeta & 0xffffu;
    if (xL < size) {
      let outputPos = positionOnLine(line, xL);
      let sortedSlot = offsetSlot(line, xL, rangeStart, rangeEnd);
      let sourceIndex = sourceIndexWithSortAmount(sortedSlot, xL, rangeStart, rangeEnd);
      let sourcePos = positionOnLine(line, sourceIndex);
      textureStore(sortedTex, vec2<i32>(outputPos), readColor(sourcePos));
      textureStore(indexTex, vec2<i32>(outputPos), vec4<u32>(sourcePos.y * params.width + sourcePos.x, 0u, 0u, 1u));
      let originCoverage = f32(seedCache[sourceIndex]) / 255.0;
      let destinationCoverage = f32(seedCache[xL]) / 255.0;
      let inDomain = (rangeMask & (1u << (t * 2u))) != 0u;
      let domainCoverage = select(0.0, 1.0, inDomain);
      let featherCoverage = intervalFeather(xL, rangeStart, rangeEnd);
      let fillMask = params.fillEnabled != 0u && params.maskMode != 4u;
      var outputOriginCoverage = select(originCoverage, domainCoverage, fillMask) * featherCoverage;
      let outputDestinationCoverage = select(destinationCoverage, domainCoverage, fillMask) * featherCoverage;
      // A circle is a destination-locked spatial matte. It must not travel
      // with sorted source pixels even when Mask escape is enabled.
      if (params.maskMode == 4u) { outputOriginCoverage = outputDestinationCoverage; }
      textureStore(maskTex, vec2<i32>(outputPos), vec4<f32>(outputOriginCoverage, outputDestinationCoverage, 0.0, 1.0));
    }
    if (xR < size) {
      let outputPos = positionOnLine(line, xR);
      let sortedSlot = offsetSlot(line, xR, rangeStart, rangeEnd);
      let sourceIndex = sourceIndexWithSortAmount(sortedSlot, xR, rangeStart, rangeEnd);
      let sourcePos = positionOnLine(line, sourceIndex);
      textureStore(sortedTex, vec2<i32>(outputPos), readColor(sourcePos));
      textureStore(indexTex, vec2<i32>(outputPos), vec4<u32>(sourcePos.y * params.width + sourcePos.x, 0u, 0u, 1u));
      let originCoverage = f32(seedCache[sourceIndex]) / 255.0;
      let destinationCoverage = f32(seedCache[xR]) / 255.0;
      let inDomain = (rangeMask & (2u << (t * 2u))) != 0u;
      let domainCoverage = select(0.0, 1.0, inDomain);
      let featherCoverage = intervalFeather(xR, rangeStart, rangeEnd);
      let fillMask = params.fillEnabled != 0u && params.maskMode != 4u;
      var outputOriginCoverage = select(originCoverage, domainCoverage, fillMask) * featherCoverage;
      let outputDestinationCoverage = select(destinationCoverage, domainCoverage, fillMask) * featherCoverage;
      if (params.maskMode == 4u) { outputOriginCoverage = outputDestinationCoverage; }
      textureStore(maskTex, vec2<i32>(outputPos), vec4<f32>(outputOriginCoverage, outputDestinationCoverage, 0.0, 1.0));
    }
  }
}
`;
