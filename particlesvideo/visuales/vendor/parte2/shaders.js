/**
 * WGSL translations of the installed vvvv beta DX11 TextureFX shaders.
 * Source: C:/vvvv_beta_42_x64/packs/dx11/nodes/texture11/{Filter,Mixer}.
 * The stages do not introduce noise, tone mapping or time-dependent decoration.
 * UV origin is top-left, as in the original DX11 TextureFX passes.
 *
 * All fragment entry points share this bind-group layout:
 *   0: 64-byte uniform buffer containing four vec4f values a, b, c, d
 *   1: texA; 2: texB; 3: linear/mipmap-linear clamp sampler
 *   4: linear/mipmap-linear repeat sampler (anisotropy may be enabled)
 *
 * Uniforms (unused values may be zero):
 * normalFrag   a=[Radius, Depth, 0, 0], b=[targetWidth,targetHeight,0,0]
 * displaceFrag a=[Amount, DirectionX, DirectionY, MapSmooth],
 *              b=[targetWidth,targetHeight,technique,0]
 *              technique: 0=RedGreenXY, 1=NormalMap, 2=Height
 * ditherFrag   a=[Threshold,0,0,0], b=[targetWidth,targetHeight,0,0]
 * flowFrag     a=[Amount, MapSmooth, Iterations,0], b=[targetWidth,targetHeight,0,0]
 *              texA=INITIAL; texB=mipmapped Control (original PASSRESULT0)
 * unsharpFrag  a=[Amount,Shape,Saturation,MinRadius],
 *              b=[MaxRadius,Gamma,targetWidth,targetHeight]
 * blendFrag    a=[Opacity,technique,0,0]
 *              technique: 0=Normal,1=Add,2=Exclusion,3=Glow,4=Reflect
 * hscbFrag     a=[Hue,Saturation,Contrast,Brightness]
 * seedFrag     a=[kind,rotationTurns,scale,intensity]
 *              b=[targetWidth,targetHeight,gridCellCount,lineWidthPixels]
 *              c=[seedRed,seedGreen,seedBlue,0]
 *              d=[brushXuv,brushYuv,brushRadiusUV,brushActive]
 *              kind: 0=black,1=filled quad,2=triangulated wireframe grid,
 *              3=full white frame (original DX11 null-input WhiteTexture).
 *              Suggested quad: scale .81, color white; grid: .73, color red.
 *              Grid Resolution X/Y=2 creates one cell (gridCellCount=1).
 *              intensity=0 disables seed, retaining the optional brush.
 * copyFrag / displayFrag: no uniforms; direct unmodified texA sample.
 *
 * Render targets should use rgba8unorm to preserve clamping/quantization at
 * each stage. NormalMap/DistortFlow/UnsharpMask need mip chains supplied by
 * the engine, corresponding to the original mips/wantmips annotations.
 * Singular denominators are kept finite below 1e-7. This matches UNORM
 * saturation away from undefined NaNs and makes an empty feedback frame safe.
 * Seed geometry is rasterized analytically; subpixel wireframe edge coverage
 * can differ from DX11's hardware line rasterization.
 */
export const shaderSource = /* wgsl */ `
struct Params {
  a: vec4f,
  b: vec4f,
  c: vec4f,
  d: vec4f,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var texA: texture_2d<f32>;
@group(0) @binding(2) var texB: texture_2d<f32>;
@group(0) @binding(3) var clampSampler: sampler;
@group(0) @binding(4) var repeatSampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex fn vsMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let uv = vec2f(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
  var output: VertexOutput;
  output.position = vec4f(uv * vec2f(2.0, -2.0) + vec2f(-1.0, 1.0), 0.0, 1.0);
  output.uv = uv;
  return output;
}

fn targetSize(requested: vec2f) -> vec2f {
  return select(vec2f(textureDimensions(texA)), requested, requested > vec2f(0.0));
}

fn sourceAt(uv: vec2f, level: f32) -> vec4f {
  return textureSampleLevel(texA, clampSampler, uv, level);
}

@fragment fn copyFrag(input: VertexOutput) -> @location(0) vec4f {
  return sourceAt(input.uv, 0.0);
}

@fragment fn displayFrag(input: VertexOutput) -> @location(0) vec4f {
  return sourceAt(input.uv, 0.0);
}

fn normalDifference(positive: vec4f, negative: vec4f) -> f32 {
  let p = dot(positive.rgb, vec3f(1.0 / 3.0));
  let n = dot(negative.rgb, vec3f(1.0 / 3.0));
  return (p - n) / sqrt(0.00001 + abs(p + n));
}

@fragment fn normalFrag(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = targetSize(params.b.xy);
  let radius = max(params.a.x, 0.0);
  let level = log2(max(radius, 0.0000001));
  let offset = vec2f(radius) / dimensions;
  let depth = exp2(params.a.y);
  let xGradient = depth * normalDifference(
    sourceAt(input.uv + vec2f(offset.x, 0.0), level),
    sourceAt(input.uv - vec2f(offset.x, 0.0), level));
  let yGradient = depth * normalDifference(
    sourceAt(input.uv + vec2f(0.0, offset.y), level),
    sourceAt(input.uv - vec2f(0.0, offset.y), level));
  let n = normalize(vec3f(xGradient, yGradient, 1.0));
  return vec4f(n.xy + vec2f(0.5), n.z, sourceAt(input.uv, 0.0).a);
}

@fragment fn displaceFrag(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = targetSize(params.b.xy);
  let level = clamp(params.a.w, 0.0, 1.0) * log2(max(dimensions.x, dimensions.y));
  let amountDirection = params.a.yz * params.a.x;
  let technique = i32(params.b.z);
  if (technique == 1) {
    // Original pNORMALMAP intentionally ignores MapSmooth.
    let control = textureSampleLevel(texB, clampSampler, input.uv, 0.0).xy;
    return sourceAt(input.uv + (control - vec2f(0.5)) * amountDirection, 0.0);
  }
  if (technique == 2) {
    let offset = 0.25 / dimensions * exp2(level) * clamp(level - 1.0, 0.0, 1.0) + 1.0 / dimensions;
    let ht = vec2f(
      textureSampleLevel(texB, clampSampler, input.uv - vec2f(offset.x, 0.0), level).r -
      textureSampleLevel(texB, clampSampler, input.uv + vec2f(offset.x, 0.0), level).r,
      textureSampleLevel(texB, clampSampler, input.uv - vec2f(0.0, offset.y), level).r -
      textureSampleLevel(texB, clampSampler, input.uv + vec2f(0.0, offset.y), level).r);
    return sourceAt(input.uv + ht * amountDirection, 1.0);
  }
  let control = textureSampleLevel(texB, clampSampler, input.uv, level).xy;
  return sourceAt(mix(input.uv, control, amountDirection), 0.0);
}

const DITHER_MATRIX = array<f32, 16>(
  1.0, 33.0, 9.0, 41.0,
  49.0, 17.0, 57.0, 25.0,
  13.0, 45.0, 5.0, 37.0,
  61.0, 29.0, 53.0, 21.0);

@fragment fn ditherFrag(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = targetSize(params.b.xy);
  let pixel = vec2u(input.uv * dimensions) % vec2u(8u);
  // Keep the original unusual 8x8 quadrant offsets and HLSL [x][y] order.
  let index = (pixel.x % 4u) * 4u + pixel.y % 4u;
  let bias = select(0.0, 3.0, pixel.x < 4u && pixel.y >= 4u);
  let threshold = (DITHER_MATRIX[index] + bias) / max(params.a.x * 10.0, 0.0000001);
  let rgb = sourceAt(input.uv, 0.0).rgb;
  return vec4f(select(vec3f(0.0), vec3f(1.0), rgb >= vec3f(threshold)), 1.0);
}

fn flowControl(uv: vec2f, level: f32) -> f32 {
  let color = textureSampleLevel(texB, repeatSampler, uv, level);
  return max(color.r, max(color.g, color.b)) * color.a;
}

@fragment fn flowFrag(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = targetSize(params.b.xy);
  let smoothness = params.a.y;
  let level = clamp(smoothness, 0.0, 1.0) * log2(max(dimensions.x, dimensions.y));
  // In the HLSL source, off = 2^(smooth*6) * R/R.x, then off/R.
  let offset = vec2f(exp2(smoothness * 6.0) / dimensions.x);
  let strength = 0.01 * params.a.x * exp(abs(params.a.x)) * exp2(smoothness * 8.0);
  var uv = input.uv;
  let iterations = clamp(i32(params.a.z), 0, 64);
  for (var iteration = 0; iteration < iterations; iteration += 1) {
    let gradient = vec2f(
      flowControl(uv - vec2f(offset.x, 0.0), level) - flowControl(uv + vec2f(offset.x, 0.0), level),
      flowControl(uv - vec2f(0.0, offset.y), level) - flowControl(uv + vec2f(0.0, offset.y), level));
    uv += gradient.yx * vec2f(1.0, -1.0) * strength;
  }
  return textureSample(texA, repeatSampler, uv);
}

@fragment fn unsharpFrag(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = targetSize(params.b.zw);
  let amount = params.a.x;
  let shape = params.a.y;
  let saturation = params.a.z;
  let minRadius = params.a.w;
  let maxRadius = params.b.x;
  let gamma = params.b.y;
  let original = sourceAt(input.uv, 0.0);
  let maxDimension = max(dimensions.x, dimensions.y);
  let maxLevel = log2(maxDimension) + 0.5;
  let normalization = exp2(maxRadius / maxDimension * exp2(maxLevel * maxRadius));
  var sharp = vec3f(0.0);
  for (var levelIndex = 0; levelIndex < 7; levelIndex += 1) {
    let radius = mix(f32(levelIndex), 7.0, minRadius);
    let fine = sourceAt(input.uv, maxLevel * clamp(maxRadius * radius / 7.0, 0.0, 1.0));
    let coarse = sourceAt(input.uv, maxLevel * clamp(maxRadius * (radius + 1.0) / 7.0, 0.0, 1.0));
    sharp += (fine - coarse).rgb / exp2(radius * shape) * 4.0 * amount / normalization;
  }
  sharp = mix(vec3f(dot(sharp, vec3f(1.0)) / 3.0), sharp, saturation);
  sharp = sign(sharp) * pow(abs(sharp) * 5.0, vec3f(exp2(gamma * 2.0))) / 5.0;
  sharp /= max(vec3f(0.0000001), vec3f(1.0) + original.rgb);
  let result = original.rgb + sharp * pow(exp2(3.0 * min(shape, 0.0)), 2.0);
  return max(vec4f(0.0), vec4f(result, original.a));
}

fn blendWithAlpha(operation: vec3f, foreground: vec4f, background: vec4f) -> vec4f {
  let alpha = clamp(foreground.a + background.a * (1.0 - foreground.a), 0.0, 1.0);
  let base = (foreground.rgb * foreground.a + background.rgb * background.a * (1.0 - foreground.a)) / max(alpha, 0.0000001);
  return vec4f(mix(base, operation, foreground.a * background.a), alpha);
}

fn finiteDenominator(value: vec3f) -> vec3f {
  return select(-max(abs(value), vec3f(0.0000001)), max(abs(value), vec3f(0.0000001)), value >= vec3f(0.0));
}

@fragment fn blendFrag(input: VertexOutput) -> @location(0) vec4f {
  let first = sourceAt(input.uv, 0.0);
  let second = textureSampleLevel(texB, clampSampler, input.uv, 0.0) * vec4f(1.0, 1.0, 1.0, params.a.x);
  let technique = i32(params.a.y);
  if (technique == 0) {
    return blendWithAlpha(mix(first.rgb, second.rgb, params.a.x), second, first);
  }
  var operation = first.rgb + second.rgb;
  if (technique == 2) {
    operation = first.rgb + second.rgb - 2.0 * first.rgb * second.rgb;
  } else if (technique == 3) {
    operation = select(second.rgb * second.rgb / finiteDenominator(vec3f(1.0) - first.rgb), vec3f(1.0), first.rgb == vec3f(1.0));
  } else if (technique == 4) {
    operation = select(first.rgb * first.rgb / finiteDenominator(vec3f(1.0) - second.rgb), vec3f(1.0), second.rgb == vec3f(1.0));
  }
  return blendWithAlpha(operation, first, second);
}

fn hueToRgb(hue: f32) -> vec3f {
  let h = fract(hue) * 6.0;
  return clamp(vec3f(abs(h - 3.0) - 1.0, 2.0 - abs(h - 2.0), 2.0 - abs(h - 4.0)), vec3f(0.0), vec3f(1.0));
}

fn hsvToRgb(hsv: vec3f) -> vec3f {
  return ((hueToRgb(hsv.x) - vec3f(1.0)) * hsv.y + vec3f(1.0)) * hsv.z;
}

fn rgbToHsv(rgb: vec3f) -> vec3f {
  let value = max(rgb.r, max(rgb.g, rgb.b));
  let minimum = min(rgb.r, min(rgb.g, rgb.b));
  let chroma = value - minimum;
  if (chroma != 0.0) {
    let rawDelta = (vec3f(value) - rgb) / chroma;
    let delta = (rawDelta - rawDelta.zxy + vec3f(2.0, 4.0, 6.0)) * step(vec3f(value), rgb.yzx);
    let hue = fract(max(delta.r, max(delta.g, delta.b)) / 6.0);
    return vec3f(hue, chroma / value, value);
  }
  return vec3f(0.0, 0.0, value);
}

@fragment fn hscbFrag(input: VertexOutput) -> @location(0) vec4f {
  let original = sourceAt(input.uv, 0.0);
  let hsv = rgbToHsv(original.rgb);
  let hue = fract(hsv.x + params.a.x);
  let saturation = hsv.y * params.a.y;
  let first = hsvToRgb(vec3f(hue, saturation, hsv.z));
  let second = hsvToRgb(vec3f(hue - 1.0, saturation, hsv.z));
  let color = mix(first, second, pow(smoothstep(0.0, 1.0, hsv.x), 2.0));
  let safeColor = select(color, color + vec3f(0.00001), color == vec3f(0.0));
  let adjusted = normalize(safeColor) * sqrt(3.0) * pow(length(color) / sqrt(3.0), exp2(params.a.z)) * exp2(params.a.w);
  return vec4f(adjusted, original.a);
}

@fragment fn seedFrag(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = max(params.b.xy, vec2f(1.0));
  let aspect = dimensions.x / dimensions.y;
  // AspectRatio (DX11.Layer) FitIn compensation, world coordinate y upward.
  var point = (input.uv * 2.0 - vec2f(1.0)) * vec2f(1.0, -1.0);
  // Verified in installed VVVV.DX11.Nodes.dll: FitIn projection scales
  // (height/width,1) for portrait, (1,width/height) for landscape.
  point *= vec2f(min(1.0, aspect), min(1.0, 1.0 / aspect));
  let angle = params.a.y * 6.283185307179586;
  let rotated = vec2f(cos(angle) * point.x + sin(angle) * point.y,
    -sin(angle) * point.x + cos(angle) * point.y) / max(params.a.z, 0.0000001);
  let inside = all(abs(rotated) <= vec2f(0.5));
  var ink = 0.0;
  if (params.a.x > 0.5 && params.a.x < 1.5) {
    ink = select(0.0, 1.0, inside);
  } else if (params.a.x >= 1.5 && params.a.x < 2.5) {
    let subdivisions = max(params.b.z, 1.0);
    let cell = (rotated + vec2f(0.5)) * subdivisions;
    let vertical = abs(cell.x - round(cell.x));
    let horizontal = abs(cell.y - round(cell.y));
    // Installed FeralTic grid indices are [0,2,1],[1,2,3]: diagonal x+y=0.
    let diagonal = abs((cell.x + cell.y) - round(cell.x + cell.y)) * 0.7071067811865475;
    let edgeDistance = min(vertical, min(horizontal, diagonal));
    let gridUnitsPerPixel = 2.0 * subdivisions / (max(dimensions.x, dimensions.y) * max(params.a.z, 0.0000001));
    let halfWidth = 0.5 * max(params.b.w, 1.0) * gridUnitsPerPixel;
    ink = select(0.0, 1.0, inside && edgeDistance <= halfWidth);
  }
  var color = params.c.rgb * ink * params.a.w;
  if (params.a.x >= 2.5) {
    color = vec3f(params.a.w);
  }
  let brushDelta = (input.uv - params.d.xy) * vec2f(aspect, 1.0);
  if (params.d.w > 0.5 && length(brushDelta) < params.d.z) {
    color = max(color, params.c.rgb);
  }
  return vec4f(color, 1.0);
}
`;
