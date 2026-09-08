// Decode BC1 on GPU at the original size. Integer palette math matches decodeDDS,
// including partial edge blocks and alpha. No CPU decoding, rescaling or file writes.
const pipelines = new WeakMap();
export function prepareDDSCrop(device) {
  if (!pipelines.has(device)) {
    const module = device.createShaderModule({ label: 'DDS crop without CPU decode', code: `
      @group(0) @binding(0) var<storage, read> blocks: array<vec2<u32>>;
      @group(0) @binding(1) var outputImage: texture_storage_2d<rgba8unorm, write>;
      fn rgb565(c: u32) -> vec4<u32> {
        let r = (c >> 11u) & 31u; let g = (c >> 5u) & 63u; let b = c & 31u;
        return vec4<u32>((r << 3u) | (r >> 2u), (g << 2u) | (g >> 4u), (b << 3u) | (b >> 2u), 255u);
      }
      @compute @workgroup_size(8, 8)
      fn main(@builtin(global_invocation_id) id: vec3<u32>) {
        let size = textureDimensions(outputImage);
        if (id.x >= size.x || id.y >= size.y) { return; }
        let block = blocks[(id.y / 4u) * ((size.x + 3u) / 4u) + id.x / 4u];
        let c0 = block.x & 65535u; let c1 = block.x >> 16u;
        let a = rgb565(c0); let b = rgb565(c1);
        let index = (block.y >> (2u * ((id.y % 4u) * 4u + id.x % 4u))) & 3u;
        var color = a;
        if (index == 1u) { color = b; }
        if (index == 2u) {
          if (c0 > c1) { color = (2u * a + b) / 3u; }
          else { color = (a + b) / 2u; }
        }
        if (index == 3u) {
          if (c0 > c1) { color = (a + 2u * b) / 3u; }
          else { color = vec4<u32>(0u); }
        }
        textureStore(outputImage, vec2<i32>(id.xy), vec4<f32>(color) / 255.0);
      }` });
    pipelines.set(device, device.createComputePipelineAsync({ label: 'DDS crop', layout: 'auto', compute: { module, entryPoint: 'main' } }));
  }
  return pipelines.get(device);
}

export async function uploadCroppedDDS(library, clip, frame, bytes, header) {
  const device = library.device, pipeline = await prepareDDSCrop(device);
  if (library.disposed) throw new DOMException('Carga cancelada.', 'AbortError');
  const packed = device.createBuffer({ label: 'DDS BC1 blocks', size: header.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  let output;
  try {
    output = library.createTexture(clip, frame, header.width, header.height, 'rgba8unorm', header.width * header.height * 4,
      false, GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC);
    device.queue.writeBuffer(packed, 0, bytes.subarray(header.offset, header.totalBytes));
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: packed } }, { binding: 1, resource: output.view },
    ] });
    const encoder = device.createCommandEncoder({ label: 'DDS crop upload' });
    const pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil(header.width / 8), Math.ceil(header.height / 8)); pass.end();
    device.queue.submit([encoder.finish()]); await device.queue.onSubmittedWorkDone();
    if (library.disposed) throw new DOMException('Carga cancelada.', 'AbortError');
    return output;
  } catch (error) { output?.texture.destroy(); throw error; }
  finally { packed.destroy(); }
}
