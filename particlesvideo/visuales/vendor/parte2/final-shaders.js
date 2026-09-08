/**
 * Extra stages used by root milky final.v4p -> distort milky final.v4p.
 * Concatenate after shaderSource from shaders.js: all common declarations,
 * UV coordinates and RGB/HSV helpers are shared, without redeclaration.
 *
 * Additional common binding 5: texC, a sampled float texture. It is used only
 * by Growth as texBRUSH; other stages may bind the engine's dummy texture.
 *
 * inkInputFrag: texA=original ink frame. Rotate UVs 180 degrees and invert RGB;
 *               equivalent to TransformTexture rotate .5 -> Invert RGB.
 * verticalFrag: texA=from/current; texB=to/last vertical output.
 *               a=[scale,progress,0,0]. Original values: .013,.97.
 * hsvPrepFrag: texA=original RGB, output circular HSV encoding. Generate mips
 *               from this rgba8unorm target before unsharpHsvFrag.
 * unsharpHsvFrag: texA=encoded HSV with mips, texB=original RGB.
 *               a=[Amount,Shape,Hue,Saturation], b=[Value,targetW,targetH,0].
 *               Original values: a=[2,-1.46,-1.42,.5], b.x=1.
 * growthFrag:   texA=map (transformed previous Growth UNORM output),
 *               texB=previous internal fColorPaint feedback, texC=brush.
 *               a=[Speed,Fade,MapShape,EdgeWidth],
 *               b=[HideBrush,Reset,targetW,targetH]. Output rgba16float.
 *               Original: [100,.12,-.4,1], HideBrush=1, Reset=0.
 * growthColorFrag: texA=current internal fColorPaint output.
 *               a=[MultiplyWithAlpha,KeepAlpha,0,0]. Original: [1,1,0,0].
 *               Output rgba8unorm. Retain the INTERNAL half-float feedback,
 *               not this output, for next frame's growthFrag texB.
 * transformFrag: texA=source. a=[scaleX,scaleY,translateX,translateY],
 *               b.x=rotationTurns. Direct vvvv texture transform, centered
 *               at .5,.5, in world coordinates with positive Y upward.
 *               Original Growth map: a=[1,1,.001,0], b.x=0. Saved XYZ=1.08
 *               is an obsolete pin; connected Scale X/Y override saved values.
 * levelsFrag: texA=source. Scalar RGB controls are sufficient for this patch:
 *               a=[inputBlack,inputWhite,outputBlack,outputWhite],
 *               b=[gammaRGB,inputBlackAlpha,inputWhiteAlpha,outputBlackAlpha],
 *               c=[outputWhiteAlpha,gammaAlpha,0,0].
 *               Original a=[.38629,1,.24456,1], b=[1,0,1,0], c=[1,1,0,0].
 *
 * References are the installed original shaders, including
 * packs/mp.dx/nodes/dx11/GrowthDX11.fx (fColorPaint + pColorPaint).
 * Numeric guards only affect singular denominators in empty/degenerate data.
 */
export const finalShaderSource = /* wgsl */ `
@group(0) @binding(5) var texC: texture_2d<f32>;

@fragment fn inkInputFrag(input: VertexOutput) -> @location(0) vec4f {
  let ink = sourceAt(vec2f(1.0) - input.uv, 0.0);
  return vec4f(vec3f(1.0) - ink.rgb, ink.a);
}

@fragment fn verticalFrag(input: VertexOutput) -> @location(0) vec4f {
  let current = textureSampleLevel(texA, repeatSampler, input.uv, 0.0);
  let previous = textureSampleLevel(texB, repeatSampler,
    input.uv + vec2f(0.0, params.a.x * current.r), 0.0);
  return mix(current, previous, params.a.y);
}

@fragment fn hsvPrepFrag(input: VertexOutput) -> @location(0) vec4f {
  let original = sourceAt(input.uv, 0.0);
  let hsv = rgbToHsv(original.rgb);
  let circular = sin((vec2f(hsv.x) + vec2f(0.25, 0.0)) * 6.283185307179586) * hsv.y;
  return vec4f(circular * 0.5 + vec2f(0.5), hsv.z, original.a);
}

@fragment fn unsharpHsvFrag(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = targetSize(params.b.yz);
  let amount = params.a.x;
  let shape = params.a.y;
  let hueAmount = params.a.z;
  let saturationAmount = params.a.w;
  let valueAmount = params.b.x;
  var average = sourceAt(input.uv, 0.0);
  let originalCircular = average.rg * 2.0 - vec2f(1.0);
  let levels = min(16.0, log2(max(dimensions.x, dimensions.y)));
  for (var mip = 1; f32(mip) < levels; mip += 1) {
    let encodedSample = sourceAt(input.uv, f32(mip));
    average += vec4f(encodedSample.rgb, 1.0) * exp2(-shape * f32(mip));
  }
  let averageHsv = average.rgb / max(average.a, 0.0000001);
  let averageCircular = averageHsv.rg * 2.0 - vec2f(1.0);
  let averageSaturation = length(averageCircular);
  let originalRgb = textureSampleLevel(texB, clampSampler, input.uv, 0.0).rgb;
  let originalHsv = rgbToHsv(originalRgb);
  let strength = amount / exp2(-shape * 0.5);
  let circular = originalCircular + (originalCircular - averageCircular) * hueAmount * strength;
  let hue = -atan2(circular.y, -circular.x) / 6.283185307179586 + 0.5;
  let saturation = max(0.0, max(
    originalHsv.y + (originalHsv.y - averageSaturation) * saturationAmount * strength,
    length(circular)));
  let value = max(0.0,
    originalHsv.z + (originalHsv.z - averageHsv.z) * valueAmount * strength);
  return vec4f(hsvToRgb(vec3f(hue, saturation, value)), 1.0);
}

@fragment fn transformFrag(input: VertexOutput) -> @location(0) vec4f {
  let centered = (input.uv - vec2f(0.5)) * vec2f(1.0, -1.0) * params.a.xy;
  let radians = params.b.x * 6.283185307179586;
  let rotated = vec2f(
    centered.x * cos(radians) - centered.y * sin(radians),
    centered.x * sin(radians) + centered.y * cos(radians));
  let uv = (rotated + params.a.zw) * vec2f(1.0, -1.0) + vec2f(0.5);
  return sourceAt(uv, 0.0);
}

fn growthSurface(uv: vec2f, dimensions: vec2f) -> f32 {
  let edgeWidth = max(params.a.w, 0.0000001);
  let offset = edgeWidth / dimensions;
  let center = sourceAt(uv, 0.0);
  let edge = 4.0 * center
    - sourceAt(uv + vec2f(offset.x, 0.0), 0.0)
    - sourceAt(uv - vec2f(offset.x, 0.0), 0.0)
    - sourceAt(uv + vec2f(0.0, offset.y), 0.0)
    - sourceAt(uv - vec2f(0.0, offset.y), 0.0);
  let shapedEdge = clamp(abs(edge) * 8.0 / edgeWidth - vec4f(0.2), vec4f(0.0), vec4f(1.0));
  // MapShape=-.4 deliberately extrapolates beyond the source color.
  let map = mix(center, shapedEdge, params.a.z).rgb;
  return smoothstep(0.03, 1.0, max(map.r, max(map.g, map.b)));
}

@fragment fn growthFrag(input: VertexOutput) -> @location(0) vec4f {
  let dimensions = targetSize(params.b.zw);
  let surface = growthSurface(input.uv, dimensions);
  var brush = textureSampleLevel(texC, clampSampler, input.uv, 0.0);
  if (params.b.x > 0.5) {
    brush.a *= pow(surface + 0.0001, 0.25);
  }
  var strongest = vec4f(brush.rgb * brush.a, brush.a);
  for (var directionIndex = 0; directionIndex < 24; directionIndex += 1) {
    let phase = f32(directionIndex) / 24.0;
    let direction = sin((vec2f(phase) + vec2f(0.25, 0.0)) * 6.283185307179586);
    let uv = input.uv + direction / dimensions * surface * params.a.x;
    let neighbor = textureSampleLevel(texB, clampSampler, uv, 0.0);
    if (neighbor.a > strongest.a) {
      // Original lerp weight saturate((strongest.a-neighbor.a)*88) is zero
      // under this strict comparison, so the full neighbor wins.
      strongest = neighbor;
    }
  }
  strongest.a *= pow(1.01, -params.a.y * params.a.y);
  let result = clamp(strongest, vec4f(0.0), vec4f(1.0));
  return select(result, vec4f(0.0), params.b.y > 0.5);
}

@fragment fn growthColorFrag(input: VertexOutput) -> @location(0) vec4f {
  let feed = sourceAt(input.uv, 0.0);
  let alphaColor = sqrt(clamp(feed.a * params.a.y, 0.0, 1.0));
  return vec4f(feed.rgb * mix(1.0, alphaColor, params.a.x), 1.0);
}

fn finalSafeDenominator(value: f32) -> f32 {
  return select(-max(abs(value), 0.0000001), max(abs(value), 0.0000001), value >= 0.0);
}

@fragment fn levelsFrag(input: VertexOutput) -> @location(0) vec4f {
  let original = sourceAt(input.uv, 0.0);
  let normalized = (original.rgb - vec3f(params.a.x)) / finalSafeDenominator(params.a.y - params.a.x);
  let gammaAdjusted = sign(normalized) * pow(abs(normalized), vec3f(params.b.x));
  let rgb = gammaAdjusted * (params.a.w - params.a.z) + vec3f(params.a.z);
  let normalizedAlpha = (original.a - params.b.y) / finalSafeDenominator(params.b.z - params.b.y);
  let alphaGamma = sign(normalizedAlpha) * pow(abs(normalizedAlpha), params.c.y);
  let alpha = alphaGamma * (params.c.x - params.b.w) + params.b.w;
  return vec4f(rgb, alpha);
}
`;
