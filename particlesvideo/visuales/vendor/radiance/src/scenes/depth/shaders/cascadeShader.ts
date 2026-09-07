export const CASCADE_HEIGHT = 256;

export const cascadeShader = /* wgsl */ `
struct CascadeParams {
  activeWidth: u32,
  activeHeight: u32,
  historyHeight: u32,
  scrollRows: u32,
  clearHistory: u32,
  blockSize: u32,
  seed: u32,
  injectNewEdge: u32,
}

@group(0) @binding(0) var<uniform> params: CascadeParams;
@group(0) @binding(1) var previousHistory: texture_2d<f32>;
@group(0) @binding(2) var nextHistory: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var sortedTex: texture_2d<f32>;
@group(0) @binding(4) var indexTex: texture_2d<u32>;
@group(0) @binding(5) var maskTex: texture_2d<f32>;

fn edgeEmitter(x: u32) -> vec4<f32> {
  if (x >= params.activeWidth || params.activeHeight == 0u) {
    return vec4<f32>(0.0);
  }

  // Strict boundary rule: only a pixel that is actually sorted in the final
  // source row may enter the waterfall. Streaks ending even one row earlier
  // remain inside the image.
  let destinationY = params.activeHeight - 1u;
  let blockSize = min(max(params.blockSize, 1u), 32u);
  let blockStart = (x / blockSize) * blockSize;
  var gateSum = 0.0;
  var weightedColour = vec3<f32>(0.0);
  // Average coverage across the cell. One hot pixel may widen into a subtle
  // bar, but can no longer turn the entire cell into a full-power emitter.
  for (var offset = 0u; offset < 32u; offset += 1u) {
    if (offset >= blockSize || blockStart + offset >= params.activeWidth) { break; }
    let position = vec2<i32>(i32(blockStart + offset), i32(destinationY));
    let sourceLinear = textureLoad(indexTex, position, 0).x;
    let sourceY = sourceLinear / params.activeWidth;
    let travel = abs(i32(sourceY) - i32(destinationY));
    let packedMask = textureLoad(maskTex, position, 0);
    let gate = smoothstep(0.5, 3.0, f32(travel)) * max(packedMask.r, packedMask.g);
    let colour = textureLoad(sortedTex, position, 0);
    gateSum += gate;
    weightedColour += colour.rgb * gate;
  }
  let averageGate = gateSum / f32(blockSize);
  if (averageGate > 0.008) {
    let colour = weightedColour / max(gateSum, 0.0001);
    let coverage = smoothstep(0.015, 0.48, averageGate);
    // Coverage is independent of RGB. A black sorted bar remains a physical
    // HRC material and can absorb light / cast a shadow.
    return vec4<f32>(colour, coverage);
  }
  return vec4<f32>(0.0);
}

fn barSpeed(x: u32) -> u32 {
  let blockSize = min(max(params.blockSize, 1u), 32u);
  let barIndex = x / blockSize;
  var value = barIndex * 747796405u + params.seed * 2891336453u + 277803737u;
  value = ((value >> ((value >> 28u) + 4u)) ^ value) * 277803737u;
  value = (value >> 22u) ^ value;
  // Stable per-bar speeds keep every pixel of a thick bar together while
  // neighbouring bars fall at visibly different rates.
  return 1u + value % 3u;
}

@compute @workgroup_size(8, 8, 1)
fn cascadeMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.activeWidth || gid.y >= params.historyHeight) { return; }
  let outputPosition = vec2<i32>(i32(gid.x), i32(gid.y));
  if (params.clearHistory != 0u) {
    var initial = vec4<f32>(0.0);
    if (params.injectNewEdge != 0u && gid.y < barSpeed(gid.x)) {
      initial = edgeEmitter(gid.x);
    }
    textureStore(nextHistory, outputPosition, initial);
    return;
  }

  let rows = max(barSpeed(gid.x), 1u);
  if (gid.y < rows) {
    let heldEdge = textureLoad(previousHistory, vec2<i32>(i32(gid.x), 0), 0);
    var nextEdge = heldEdge;
    if (params.injectNewEdge != 0u) { nextEdge = edgeEmitter(gid.x); }
    textureStore(nextHistory, outputPosition, nextEdge);
    return;
  }

  let previous = textureLoad(previousHistory, vec2<i32>(i32(gid.x), i32(gid.y - rows)), 0);
  // Preserve optical density while the bar falls. Distance fading belongs to
  // the compositor; decaying alpha here would make dark blockers lose their
  // ability to cast shadows before reaching the bottom.
  textureStore(nextHistory, outputPosition, previous);
}
`;
