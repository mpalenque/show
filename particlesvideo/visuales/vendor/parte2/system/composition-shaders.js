/**
 * Extensions for ../shaders.js, sharing its 64-byte Params, VertexOutput,
 * texA/texB and samplers. Layers output premultiplied alpha to fixed-function
 * GPU blending. UV transforms use vvvv's centered, Y-up texture coordinates.
 */
export const compositionShaderSource = /* wgsl */ `
// a: normalized geometry center.xy,size.xy
// b: texture scale.xy, rotation in turns, opacity
// c: geometry rotation in turns, texture translation.xy, address mode
// d: RGB tint, unused
@fragment fn comp_layerFrag(input: VertexOutput) -> @location(0) vec4f {
  let angle = params.c.x * 6.283185307179586;
  let delta = (input.uv - params.a.xy) * vec2f(1.0, -1.0);
  let point = vec2f(cos(angle) * delta.x + sin(angle) * delta.y,
                   -sin(angle) * delta.x + cos(angle) * delta.y);
  let extent = max(abs(params.a.zw), vec2f(0.0000001));
  let local = point / extent;
  if (any(abs(local) > vec2f(0.5))) { discard; }
  let texAngle = params.b.z * 6.283185307179586;
  let scaled = local * params.b.xy;
  let transformed = vec2f(cos(texAngle) * scaled.x - sin(texAngle) * scaled.y,
                         sin(texAngle) * scaled.x + cos(texAngle) * scaled.y) + params.c.yz;
  let uv = transformed * vec2f(1.0, -1.0) + vec2f(0.5);
  var color = textureSampleLevel(texA, clampSampler, uv, 0.0);
  if (params.c.w > 0.5) { color = textureSampleLevel(texA, repeatSampler, uv, 0.0); }
  let alpha = clamp(color.a * params.b.w, 0.0, 1.0);
  return vec4f(color.rgb * params.d.rgb * alpha, alpha);
}

// Original packs/dx11-vvvv-girlpower/.../NormalGlow.tfx pBLUR.
// a: Depth, Shape, MaxRadius, unused; b: target dimensions.xy.
@fragment fn comp_glowFrag(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = max(params.b.xy, vec2f(1.0));
  let maximum = max(dimensions.x, dimensions.y);
  let lod = log2(maximum);
  let limit = min(lod - (1.0 - params.a.z * lod), 14.0);
  var gradient = vec2f(0.0);
  var gradientLength = 0.0;
  var weightSum = 0.0;
  for (var index = 1; index < 14; index += 1) {
    let level = f32(index);
    if (level >= limit) { break; }
    let offset = exp2(level) / maximum * 0.5;
    let weight = exp2(-level * params.a.y + lod - 1.0) * clamp(params.a.z * lod - level + 1.0, 0.0, 1.0);
    let left = sourceAt(input.uv - vec2f(offset, 0.0), level).rgb;
    let right = sourceAt(input.uv + vec2f(offset, 0.0), level).rgb;
    let top = sourceAt(input.uv - vec2f(0.0, offset), level).rgb;
    let bottom = sourceAt(input.uv + vec2f(0.0, offset), level).rgb;
    let dx = (max(left.r, max(left.g, left.b)) - max(right.r, max(right.g, right.b))) * weight;
    let dy = (max(top.r, max(top.g, top.b)) - max(bottom.r, max(bottom.g, bottom.b))) * weight;
    gradient += vec2f(dx, dy) * sqrt(vec2f(dimensions.x) / dimensions);
    gradientLength += length(vec2f(dx, dy));
    weightSum += weight;
  }
  // The HLSL is undefined at an exactly uniform image (0/0). Keep the neutral
  // normal finite so a cold, black control does not poison later GPU passes.
  gradient /= max(pow(abs(gradientLength) * 0.1, 0.3) / 0.1, 0.0000001);
  let depth = params.a.x / max(pow(abs(weightSum), 0.7), 0.0000001) * 8.0;
  let z = sqrt(clamp(1.0 - depth * length(gradient), 0.0, 1.0));
  return vec4f(gradient * depth + vec2f(0.5), z, sourceAt(input.uv, 0.0).a);
}

@fragment fn comp_maskFrag(input: VertexOutput) -> @location(0) vec4f {
  return sourceAt(input.uv, 0.0) * textureSampleLevel(texB, clampSampler, input.uv, 0.0);
}

// Displace NormalMap: MapSmooth is intentionally unused in the source shader.
// a: Amount, DirectionX, DirectionY, unused.
@fragment fn comp_warpFrag(input: VertexOutput) -> @location(0) vec4f {
  let normal = textureSampleLevel(texB, clampSampler, input.uv, 0.0).rg;
  return sourceAt(input.uv + (normal - vec2f(0.5)) * params.a.x * params.a.yz, 0.0);
}
`;
