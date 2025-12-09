@fragment
fn fs_main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = (fragCoord.xy - uniforms.resolution * 0.5) / min(uniforms.resolution.x, uniforms.resolution.y);

  // Orbital Controll
  let pitch = clamp((uniforms.mouse.y / uniforms.resolution.y), 0.05, 1.5);
  let yaw = (((1 - uniforms.auto_rotate) * clamp((uniforms.mouse.x / uniforms.resolution.x), 0.05, 1.5)) + (uniforms.time * uniforms.auto_rotate * 0.5));

  // Camera Coords
  let cam_dist = 4.0 * uniforms.zoom; // Distance from the target
  let cam_target = vec3<f32>(0.0, 0.0, 0.0);
  let cam_pos = vec3<f32>(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)) * cam_dist;

  // Camera Matrix
  let cam_forward = normalize(cam_target - cam_pos);
  let cam_right = normalize(cross(cam_forward, vec3<f32>(0.0, 1.0, 0.0)));
  let cam_up = cross(cam_right, cam_forward); // Re-orthogonalized up

  // Ray Direction
  // 1.5 is the "focal length" or distance to the projection plane
  let focal_length = 1.5;
  let rd = normalize(cam_right * uv.x - cam_up * uv.y + cam_forward * focal_length);

  // Ray march
  let result = ray_march(cam_pos, rd);

  // If we are in ID rendering mode, return the encoded object id color immediately
  if (editor.id_mode == 1u) {
    // ray_march returns (distance, color.xyz). In ID mode we store object index in color.x
    let idFloat = result.y; // encoded object index as float (1 = first object)
    // If nothing hit, idFloat will be <= 0.0 -> return transparent/black
    if (idFloat <= 0.0) {
      return vec4<f32>(0.0, 0.0, 0.0, 1.0);
    }
    let idColor = idToColor(idFloat);
    return vec4<f32>(idColor, 1.0);
  }

  if result.x < MAX_DIST {
    // Hit something - calculate lighting
    let hit_pos = cam_pos + rd * result.x;
    let normal = get_normal(hit_pos);

    // Diffuse Lighting
    let light_pos = vec3<f32>(2.0, 5.0, -1.0);
    let light_dir = normalize(light_pos - hit_pos);
    let diffuse = max(dot(normal, light_dir), 0.0);

    // Shadow Casting
    let shadow_origin = hit_pos + normal * 0.01;
    let shadow_result = ray_march(shadow_origin, light_dir);
    let shadow = select(0.3, 1.0, shadow_result.x > length(light_pos - shadow_origin));

    // Phong Shading
    let ambient = 0.2;
    var albedo = result.yzw;
    let phong = albedo * (ambient + diffuse * shadow * 0.8);

    // Exponential Fog
    let fog = exp(-result.x * uniforms.fog_ratio);
    let color = mix(MAT_SKY_COLOR, phong, fog);

    return vec4<f32>(gamma_correct(color), 1.0);
  }

  // Sky gradient
  let sky = mix(MAT_SKY_COLOR, MAT_SKY_COLOR * 0.9, uv.y * 0.5 + 0.5);
  return vec4<f32>(gamma_correct(sky), 1.0);
}

fn idToColor(idf: f32) -> vec3<f32> {
    let id = i32(idf);
    let r = f32(id & 255) / 255.0;
    let g = f32((id >> 8) & 255) / 255.0;
    let b = f32((id >> 16) & 255) / 255.0;
    return vec3<f32>(r, g, b);
}

// Gamma Correction
fn gamma_correct(color: vec3<f32>) -> vec3<f32> {
  return pow(color, vec3<f32>(1.0 / uniforms.gamma_correct_ratio));
}

// Constants
const MAX_DIST: f32 = 100.0;
const SURF_DIST: f32 = 0.001;
const MAX_STEPS: i32 = 256;

// Material Colors
const MAT_SKY_COLOR: vec3<f32> = vec3<f32>(0.7, 0.8, 0.9);

// SDF Primitives
fn sd_sphere(p: vec3<f32>, r: f32) -> f32 {
  return length(p) - r;
}

fn sd_box(p: vec3<f32>, b: vec3<f32>) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn sd_torus(p: vec3<f32>, t: vec2<f32>) -> f32 {
  let q = vec2<f32>(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

fn sd_plane(p: vec3<f32>, n: vec3<f32>, h: f32) -> f32 {
  return dot(p, n) + h;
}

fn sd_cone(p: vec3<f32>, c: vec2<f32>, h: f32) -> f32 {
  var pos = p;
  let q = h * vec2<f32>(c.x / c.y, -1.0);
  let w = vec2<f32>(length(vec2<f32>(pos.x, pos.z)), pos.y);

  let dot_wq = dot(w, q);
  let dot_qq = dot(q, q);

  let a = w - q * clamp(dot_wq / dot_qq, 0.0, 1.0);
  let b = w - q * vec2<f32>(clamp(w.x / q.x, 0.0, 1.0), 1.0);
  let k = sign(q.y);
  let d = min(dot(a, a), dot(b, b));
  let s = max(k * (w.x * q.y - w.y * q.x), k * (w.y - q.y));

  return sqrt(d) * sign(s);
}

fn sd_pyramid(p: vec3<f32>, h: f32) -> f32 {
  var pos = p;
  let m2 = h*h + 0.25;

  var px = abs(pos.x);
  var pz = abs(pos.z);

  if (pz > px) {
      let tmp = px;
      px = pz;
      pz = tmp;
  }

  px = px - 0.5;
  pz = pz - 0.5;

  pos = vec3<f32>(px, pos.y, pz);

  let q = vec3<f32>(pos.z, h*pos.y - 0.5*pos.x, h*pos.x + 0.5*pos.y);
  let s = max(-q.x, 0.0);
  let t = clamp((q.y - 0.5*p.z) / (m2 + 0.25), 0.0, 1.0);
  let a = m2 * (q.x + s)*(q.x + s) + q.y*q.y;
  let b = m2 * (q.x + 0.5*t)*(q.x + 0.5*t) + (q.y - m2*t)*(q.y - m2*t);
  var d2 = 0.0;

  if (min(q.y, -q.x*m2 - q.y*0.5) <= 0.0) {
      d2 = min(a, b);
  }

  return sqrt((d2 + q.z*q.z) / m2) * sign(max(q.z, -p.y));
}

fn sd_cylinder(p: vec3<f32>, r: f32, h: f32) -> f32 {
    let d: vec2<f32> = abs(vec2<f32>(length(p.xz), p.y)) - vec2<f32>(r, h);
    return min(max(d.x, d.y), 0.0) + length(max(d, vec2<f32>(0.0)));
}

// SDF Operations
fn op_smooth_union(d1: f32, d2: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) - k * h * (1.0 - h);
}

fn op_round(dist: f32, rad: f32) -> f32 {
  return dist - rad;
}

// Scene description - returns (distance, material_id)
fn get_dist(p: vec3<f32>) -> vec4<f32> {
  let time = uniforms.time;
  // Start with a background distance and sky color to avoid invalid color mixing
  var res = vec4<f32>(MAX_DIST, MAT_SKY_COLOR);
  var from_plane = false;

  // Ground plane
  let plane_dist = sd_plane(p, vec3<f32>(0.0, 1.0, 0.0), 0.5);
  if plane_dist < res.x {
    let checker = floor(p.x) + floor(p.z);
    let col1 = vec3<f32>(0.9, 0.9, 0.9);
    let col2 = vec3<f32>(0.2, 0.2, 0.2);
    if (editor.id_mode == 1u) {
      // encode no-object for ground as id = 0 -> color black
      res = vec4<f32>(plane_dist, vec3<f32>(0.0, 0.0, 0.0));
      from_plane = true;
    } else {
      res = vec4<f32>(plane_dist, select(col2, col1, i32(checker) % 2 == 0));
      from_plane = true;
    }
  }

  let count = scene.num_objects;

  for (var i: u32 = 0u; i < u32(count); i = i + 1u) {
    let obj = scene.objects[i];
    var d = 99999.0;

    // Object position
    let pos = obj.pos.xyz;
    let size = obj.size.xyz;
    let col  = obj.color.xyz;

    if obj.type_obj == 0 {
      d = sd_sphere(p - pos, size.x);
    } else if obj.type_obj == 1 {
      d = sd_box(p - pos, size);
    } else if obj.type_obj == 2 {
      d = sd_torus(p - pos, vec2<f32>(size.x, size.y));
    } else if obj.type_obj == 3 {
      d = sd_plane(p - pos, size, size.x);
    } else if obj.type_obj == 4 {
      d = sd_cone(p - pos, vec2<f32>(size.x, size.y), size.z);
    } else if obj.type_obj == 5 {
      d = sd_pyramid(p - pos, size.y);
    } else if obj.type_obj == 6 {
      d = sd_cylinder(p - pos, size.x, size.y);
    }
    
    let currentDist = res.x;
    let objDist = d;

    if (from_plane) {
      if (objDist < currentDist) {
        if (editor.id_mode == 1u) {
          // encode object index (i+1) into the color channels for ID picking
          res = vec4<f32>(objDist, vec3<f32>(f32(i + 1u), 0.0, 0.0));
        } else {
          res = vec4<f32>(objDist, col);
        }
        from_plane = false;
      }
    } else {
      if (editor.id_mode == 1u) {
        if (objDist < res.x) {
          res = vec4<f32>(objDist, vec3<f32>(f32(i + 1u), 0.0, 0.0));
        }
      } else {
        if (objDist < res.x) {
          res = vec4<f32>(objDist, col);
        }
      }
    }
  }

  return res;
}

// Ray marching function - returns (distance, material_id)
fn ray_march(ro: vec3<f32>, rd: vec3<f32>) -> vec4<f32> {
  var d = 0.0;
  var color = vec3<f32>(-1.0, -1.0, -1.0);

  for (var i = 0; i < MAX_STEPS; i++) {
    let p = ro + rd * d;
    let dist_mat = get_dist(p);
    d += dist_mat.x;
    color = dist_mat.yzw;

    if dist_mat.x < SURF_DIST || d > MAX_DIST {
      break;
    }
  }

  return vec4<f32>(d, color);
}

// Calculate normal using gradient
fn get_normal(p: vec3<f32>) -> vec3<f32> {
  let e = vec2<f32>(0.001, 0.0);
  let n = vec3<f32>(
    get_dist(p + e.xyy).x - get_dist(p - e.xyy).x,
    get_dist(p + e.yxy).x - get_dist(p - e.yxy).x,
    get_dist(p + e.yyx).x - get_dist(p - e.yyx).x
  );
  return normalize(n);
}
