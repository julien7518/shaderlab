// Fragment shader - runs once per pixel
@fragment
fn fs_main(
  @builtin(position) fragCoord: vec4<f32>
) -> @location(0) vec4<f32> {
  // Normalize pixel coords to [0, 1]
  let uv = fragCoord.xy / uniforms.resolution;

  // Animated gradient: cos(time + position * frequency + phase)
  let frequency = vec3<f32>(1.0, 2.0, 4.0);
  let phase = vec3<f32>(0.0, 2.0, 4.0);
  let color = 0.5 + 0.5 * cos(uniforms.time + uv.xyx * frequency + phase);

  // Mouse position & aspect ratio correction
  let mouse = uniforms.mouse.xy / uniforms.resolution;
  let aspect_ratio = uniforms.resolution.x / uniforms.resolution.y;

  // Fix stretching: multiply x by aspect
  let corrected_uv = uv * vec2<f32>(aspect_ratio, 1.0);
  let corrected_mouse = mouse * vec2<f32>(aspect_ratio, 1.0);

  // Soft circle around mouse using smoothstep
  let dist = length(corrected_uv - corrected_mouse);
  let mask = 1.0 - smoothstep(0.0, 0.05, dist);
  return vec4<f32>(color * mask, 1.0);
}
