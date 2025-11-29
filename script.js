const shaders = {};
let fallbackShader = `// Fragment shader - runs once per pixel
@fragment
fn fs_main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
    // Simple gradient as fallback
    let uv = fragCoord.xy / uniforms.resolution;
    return vec4<f32>(uv, 0.5, 1.0);
}`;

CodeMirror.defineSimpleMode("wgsl", {
              start: [
                { regex: /\b(fn|let|var|const|if|else|for|while|loop|return|break|continue|discard|switch|case|default|struct|type|alias)\b/, token: "keyword" },
                { regex: /\b(bool|i32|u32|f32|f16|vec2|vec3|vec4|mat2x2|mat3x3|mat4x4|array|sampler|texture_2d|texture_3d)\b/, token: "type" },
                { regex: /\b(vec2|vec3|vec4|mat2x2|mat3x3|mat4x4|array)<[^>]+>/, token: "type" },
                { regex: /\b(abs|acos|all|any|asin|atan|atan2|ceil|clamp|cos|cosh|cross|degrees|determinant|distance|dot|exp|exp2|faceforward|floor|fma|fract|frexp|inversesqrt|ldexp|length|log|log2|max|min|mix|modf|normalize|pow|radians|reflect|refract|round|sign|sin|sinh|smoothstep|sqrt|step|tan|tanh|transpose|trunc)\b/, token: "builtin" },
                { regex: /@(vertex|fragment|compute|builtin|location|binding|group|stage|workgroup_size|interpolate|invariant)/, token: "attribute" },
                { regex: /\b\d+\.?\d*[fu]?\b|0x[0-9a-fA-F]+[ul]?/, token: "number" },
                { regex: /\/\/.*/, token: "comment" },
                { regex: /\/\*/, token: "comment", next: "comment" },
                { regex: /[+\-*/%=<>!&|^~?:]/, token: "operator" },
                { regex: /[{}()\[\];,\.]/, token: "punctuation" },
              ],
              comment: [
                { regex: /.*?\*\//, token: "comment", next: "start" },
                { regex: /.*/, token: "comment" },
              ],
            }); // prettier-ignore

const editor = CodeMirror.fromTextArea(document.getElementById("code-editor"), {
  mode: "wgsl",
  theme: "gruvbox-dark-hard",
  lineNumbers: true,
  lineWrapping: true,
  value: fallbackShader,
  tabSize: 2,
  indentUnit: 2,
  viewportMargin: Infinity,
  scrollbarStyle: "native",
});
editor.setValue(fallbackShader);

let device;
let context;
let pipeline;
let uniformBuffer;
let sceneBuffer;
let bindGroup;
let startTime = performance.now();
let lastFrameTime = startTime;
let frameCount = 0;
let lastFpsUpdate = startTime;
let mouseX = 0;
let mouseY = 0;
let mouseDown = false;
let zoom = 1.0;
let auto_rotate = 0;
let fog_ratio = 0.02;
let gamma_correct_ratio = 2.2;
let isPanelOpen = true;
let isFullscreen = false;

const $ = (id) => document.getElementById(id);
const canvas = $("canvas");
const errorMsg = $("error-message");
const compileBtn = $("compile-btn");
const autoRotateBtn = $("auto-rotate-btn");
const fullscreenBtn = $("fullscreen-btn");
const fullscreenEnterIcon = $("fullscreen-enter-icon");
const fullscreenExitIcon = $("fullscreen-exit-icon");
const canvasContainer = $("canvas-container");
const editorContainer = $("editor-container");
const uniforms = {
  resolution: {
    label: "resolution",
    initial: "0 × 0",
    update: (w, h) => `${w} × ${h}`,
  },
  time: {
    label: "time",
    initial: "0.00s",
    update: (t) => `${t.toFixed(2)}s`,
  },
  deltaTime: {
    label: "deltaTime",
    initial: "0.00ms",
    update: (dt) => `${(dt * 1000).toFixed(2)}ms`,
  },
  mousexy: {
    label: "mouse.xy",
    initial: "0, 0",
    update: (x, y) => `${Math.round(x)}, ${Math.round(y)}`,
  },
  mousez: {
    label: "mouse.z",
    initial: "false",
    update: (down) => `${down}`,
  },
  zoom: {
    label: "zoom factor",
    initial: "1.0",
    update: (zoom) => `${Math.round(zoom * 100) / 100}`,
  },
  auto_rotate: {
    label: "auto rotation",
    initial: "0",
    update: (auto_rotate) => `${auto_rotate}`,
  },
  fog_ratio: {
    label: "fog",
    initial: "0.02",
    update: (fog_ratio) => `${fog_ratio}`,
  },
  gamma_correct_ratio: {
    label: "gamma",
    initial: "2.2",
    update: (gamma_correct_ratio) => `${gamma_correct_ratio}`,
  },
  frame: {
    label: "frame",
    initial: "0",
    update: (f) => f.toString(),
  },
};
const scene = {
  num_objects: 0, // on commence avec 2 objets
  objects: [],
};

$("uniforms-table").innerHTML = Object.entries(uniforms)
  .map(
    ([key, u], i, arr) =>
      `<tr
        style="border-color:#504945">
        <td class="py-0.5 pr-2 text-sm" style="color:#666666ff">${u.label}</td>
        <td class="py-0.5 text-right text-sm font-mono" id="u-${key}">${u.initial}</td>
      </tr>`
  )
  .join("");

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  [mouseX, mouseY] = [
    (e.clientX - rect.left) * dpr,
    (e.clientY - rect.top) * dpr,
  ];
});
canvas.addEventListener("mousedown", () => (mouseDown = true));
canvas.addEventListener("mouseup", () => (mouseDown = false));
canvas.addEventListener("mouseleave", () => (mouseDown = false));
window.addEventListener(
  "wheel",
  (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const zoomSpeed = 0.01; // tweak to taste
      zoom += e.deltaY * zoomSpeed;

      zoom = Math.max(0.1, Math.min(10.0, zoom));

      $("u-zoom").textContent = uniforms.zoom.update(zoom);
    }
  },
  { passive: false }
);

$("panel-toggle").onclick = () => {
  isPanelOpen = !isPanelOpen;
  $("uniforms-panel").style.width = isPanelOpen ? "250px" : "24px";
  $("panel-content").style.visibility = isPanelOpen ? "visible" : "hidden";
  $("panel-content").style.height = $("panel-content").offsetHeight + "px";
  $("toggle-arrow").textContent = isPanelOpen ? "▶" : "◀";
};

const vertexShader = `@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  return vec4<f32>(pos[vertexIndex], 0.0, 1.0);
}`;

const uniformsStruct = `struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  deltaTime: f32,
  mouse: vec4<f32>,
  zoom: f32,
  frame: u32,
  auto_rotate: f32,
  fog_ratio: f32,
  gamma_correct_ratio: f32,
};

struct Object3D {
  type_obj: f32,        // 0: Sphere, 1: Box, 2: Torus, 3: Plane, 4: Cone, 5: Pyramid
  _padding: f32,
  _padding1: f32,
  _padding2: f32,
  pos: vec4<f32>,
  size: vec4<f32>,
  color: vec4<f32>,
  rotation: vec4<f32>,
};

struct Scene {
  num_objects: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
  objects: array<Object3D>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> scene: Scene;`;

autoRotateBtn.onclick = () => {
  auto_rotate = auto_rotate === 1 ? 0 : 1;
};
const fogSlider = document.getElementById("fog-slider");
const gammaSlider = document.getElementById("gamma-slider");
fogSlider.addEventListener("input", (e) => {
  fog_ratio = parseFloat(e.target.value);
});
gammaSlider.addEventListener("input", (e) => {
  gamma_correct_ratio = parseFloat(e.target.value);
});

const primitiveSelector = document.getElementById("primitive-selector");
const addBtn = document.getElementById("add-btn");
const objectPanel = document.getElementById("scene-objects");

function createObject3D(type) {
  return {
    type: type,
    pos: [0.0, 0.0, 0.0],
    size: [0.5, 0.5, 0.5],
    color: [0.5, 0.5, 0.5],
    rotation: [0.0, 0.0, 0.0],
  };
}

// Fonction utilitaire pour convertir [r,g,b] float => hex
function rgbToHex(rgb) {
  return (
    "#" +
    rgb
      .map((v) => {
        let h = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16);
        return h.length === 1 ? "0" + h : h;
      })
      .join("")
  );
}
// hex => [r,g,b] float
function hexToRgb(hex) {
  hex = hex.replace("#", "");
  return [
    parseInt(hex.substring(0, 2), 16) / 255,
    parseInt(hex.substring(2, 4), 16) / 255,
    parseInt(hex.substring(4, 6), 16) / 255,
  ];
}

function updateObjectPanel() {
  if (!objectPanel) return;
  objectPanel.innerHTML = "";
  scene.objects.forEach((obj, idx) => {
    const container = document.createElement("div");
    container.className = "object-controls";
    container.style.paddingBottom = "6px";
    container.style.paddingTop = "6px";
    container.style.borderBottom = "1px solid #3c3836";
    // Titre
    const title = document.createElement("div");
    title.textContent =
      "Objet #" +
      (idx + 1) +
      " (" +
      (["Sphere", "Cube", "Torus", "Plane", "Cone", "Pyramid"][obj.type] ||
        "Type " + obj.type) +
      ")";
    title.style.fontWeight = "bold";
    title.style.fontSize = "13px";
    title.style.marginBottom = "4px";
    container.appendChild(title);
    // Position sliders (toujours x, y, z)
    ["x", "y", "z"].forEach((axis, i) => {
      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.alignItems = "center";
      wrap.style.marginBottom = "2px";
      const label = document.createElement("span");
      label.textContent = "Pos " + axis + ":";
      label.style.width = "60px";
      label.style.fontSize = "12px";
      wrap.appendChild(label);
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = -5;
      slider.max = 5;
      slider.step = 0.01;
      slider.value = obj.pos[i];
      slider.style.flex = "1";
      slider.addEventListener("input", (e) => {
        obj.pos[i] = parseFloat(e.target.value);
      });
      wrap.appendChild(slider);
      const val = document.createElement("span");
      val.textContent = obj.pos[i].toFixed(2);
      val.style.width = "36px";
      val.style.fontSize = "11px";
      val.style.textAlign = "right";
      slider.addEventListener("input", (e) => {
        val.textContent = parseFloat(e.target.value).toFixed(2);
      });
      wrap.appendChild(val);
      container.appendChild(wrap);
    });
    // Taille sliders selon primitive
    // 0: Sphere (X), 1: Cube (X,Y,Z), 2: Torus (X,Y), 3: Plane (X,Y), 4: Cone (X,Y,Z), 5: Pyramid (X,Y,Z)
    let sizeAxes = [];
    switch (obj.type) {
      case 0: // Sphere
        sizeAxes = ["x"];
        break;
      case 1: // Cube/Box
      case 4: // Cone
      case 5: // Pyramid
        sizeAxes = ["x", "y", "z"];
        break;
      case 2: // Torus
      case 3: // Plane
        sizeAxes = ["x", "y"];
        break;
      default:
        sizeAxes = ["x", "y", "z"];
    }
    sizeAxes.forEach((axis, i) => {
      // i: index in sizeAxes, but must use correct index for obj.size (x=0,y=1,z=2)
      let sizeIndex = { x: 0, y: 1, z: 2 }[axis];
      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.alignItems = "center";
      wrap.style.marginBottom = "2px";
      const label = document.createElement("span");
      label.textContent = "Taille " + axis + ":";
      label.style.width = "60px";
      label.style.fontSize = "12px";
      wrap.appendChild(label);
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = 0.05;
      slider.max = 3;
      slider.step = 0.01;
      slider.value = obj.size[sizeIndex];
      slider.style.flex = "1";
      slider.addEventListener("input", (e) => {
        obj.size[sizeIndex] = parseFloat(e.target.value);
      });
      wrap.appendChild(slider);
      const val = document.createElement("span");
      val.textContent = obj.size[sizeIndex].toFixed(2);
      val.style.width = "36px";
      val.style.fontSize = "11px";
      val.style.textAlign = "right";
      slider.addEventListener("input", (e) => {
        val.textContent = parseFloat(e.target.value).toFixed(2);
      });
      wrap.appendChild(val);
      container.appendChild(wrap);
    });
    // Couleur picker
    const colorWrap = document.createElement("div");
    colorWrap.style.display = "flex";
    colorWrap.style.alignItems = "center";
    colorWrap.style.marginBottom = "2px";
    const colorLabel = document.createElement("span");
    colorLabel.textContent = "Couleur:";
    colorLabel.style.width = "60px";
    colorLabel.style.fontSize = "12px";
    colorWrap.appendChild(colorLabel);
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = rgbToHex(obj.color);
    colorInput.addEventListener("input", (e) => {
      obj.color = hexToRgb(e.target.value);
    });
    colorWrap.appendChild(colorInput);
    container.appendChild(colorWrap);
    objectPanel.appendChild(container);
  });
}

function updateObjectCount() {
  const counter = document.getElementById("object-count");
  const addBtn = document.getElementById("add-btn");
  const maxObjects = 128;

  const current = scene.objects.length;
  counter.textContent = `${current} / ${maxObjects}`;

  if (current >= maxObjects) {
    addBtn.disabled = true;
    addBtn.classList.add("opacity-50", "cursor-not-allowed");
  } else {
    addBtn.disabled = false;
    addBtn.classList.remove("opacity-50", "cursor-not-allowed");
  }
}

addBtn.onclick = () => {
  const typeValue = parseFloat(primitiveSelector.value);
  const newObj = createObject3D(typeValue);
  scene.objects.push(newObj);
  scene.num_objects = scene.objects.length;
  updateObjectCount();
  updateObjectPanel();
  console.log("Added object:", newObj);
};

updateObjectPanel();

async function initWebGPU() {
  if (!navigator.gpu)
    return (errorMsg.textContent = "WebGPU not supported"), false;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return (errorMsg.textContent = "No GPU adapter"), false;
  device = await adapter.requestDevice();
  context = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format });
  uniformBuffer = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  sceneBuffer = device.createBuffer({
    size: 16 + 128 * 80,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  await compileShader(fallbackShader);
  return true;
}

async function compileShader(fragmentCode) {
  const start = performance.now();
  try {
    errorMsg.classList.add("hidden");
    const code = vertexShader + "\n" + uniformsStruct + "\n" + fragmentCode; // prettier-ignore
    const shaderModule = device.createShaderModule({ code });
    const info = await shaderModule.getCompilationInfo();
    const lineOffset = (vertexShader + "\n" + uniformsStruct).split("\n").length; // prettier-ignore
    const errors = info.messages
      .filter((m) => m.type === "error")
      .map((m) => {
        const fragmentLine = m.lineNum - lineOffset;
        return fragmentLine > 0
          ? `Line ${fragmentLine}: ${m.message}`
          : `Line ${m.lineNum}: ${m.message}`;
      })
      .join("\n");
    if (errors)
      return (
        (errorMsg.textContent = "Shader error:\n" + errors),
        errorMsg.classList.remove("hidden")
      );

    const format = navigator.gpu.getPreferredCanvasFormat();
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage" },
        },
      ],
    });
    pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
      }),
      vertex: { module: shaderModule, entryPoint: "vs_main" },
      fragment: {
        module: shaderModule,
        entryPoint: "fs_main",
        targets: [{ format }],
      },
      primitive: { topology: "triangle-list" },
    });
    bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: sceneBuffer } },
      ],
    });
    $("compile-time").textContent = `${(performance.now() - start).toFixed(2)}ms`; // prettier-ignore
  } catch (e) {
    errorMsg.textContent = "Compile error: " + e.message;
    errorMsg.classList.remove("hidden");
  }
}

function render() {
  if (!pipeline) return;
  scene.num_objects = scene.objects.length;
  const currentTime = performance.now();
  const deltaTime = (currentTime - lastFrameTime) / 1000;
  const elapsedTime = (currentTime - startTime) / 1000;
  const uniformData = [canvas.width, canvas.height, elapsedTime, deltaTime, mouseX, mouseY, mouseDown ? 1 : 0, 0, zoom, frameCount, auto_rotate, fog_ratio, gamma_correct_ratio]; // prettier-ignore

  const OBJECT_SIZE_FLOATS = 20;
  const HEADER_SIZE_FLOATS = 4;
  const totalFloats = HEADER_SIZE_FLOATS + scene.num_objects * OBJECT_SIZE_FLOATS; //prettier-ignore

  const sceneData = new Float32Array(totalFloats);

  sceneData[0] = scene.num_objects;
  sceneData[1] = 0.0;
  sceneData[2] = 0.0;
  sceneData[3] = 0.0;

  for (let i = 0; i < scene.num_objects; i++) {
    const obj = scene.objects[i];
    const base = HEADER_SIZE_FLOATS + i * OBJECT_SIZE_FLOATS;

    // type + padding
    sceneData[base + 0] = obj.type;
    sceneData[base + 1] = 0.0;
    sceneData[base + 2] = 0.0;
    sceneData[base + 3] = 0.0;

    // pos (vec4)
    sceneData[base + 4] = obj.pos[0];
    sceneData[base + 5] = obj.pos[1];
    sceneData[base + 6] = obj.pos[2];
    sceneData[base + 7] = 0.0;

    // size (vec4)
    sceneData[base + 8] = obj.size[0];
    sceneData[base + 9] = obj.size[1];
    sceneData[base + 10] = obj.size[2];
    sceneData[base + 11] = 0.0;

    // color (vec4)
    sceneData[base + 12] = obj.color[0];
    sceneData[base + 13] = obj.color[1];
    sceneData[base + 14] = obj.color[2];
    sceneData[base + 15] = 0.0;

    // rotation (vec4)
    sceneData[base + 16] = obj.rotation[0];
    sceneData[base + 17] = obj.rotation[1];
    sceneData[base + 18] = obj.rotation[2];
    sceneData[base + 19] = 0.0;
  }

  device.queue.writeBuffer(uniformBuffer, 0, new Float32Array(uniformData));
  device.queue.writeBuffer(sceneBuffer, 0, sceneData);

  const val = uniforms.resolution.update(canvas.width, canvas.height);
  if (val) $("u-resolution").textContent = val;
  $("u-time").textContent = uniforms.time.update(elapsedTime);
  $("u-deltaTime").textContent = uniforms.deltaTime.update(deltaTime);
  $("u-mousexy").textContent = uniforms.mousexy.update(mouseX, mouseY);
  $("u-mousez").textContent = uniforms.mousez.update(mouseDown);
  $("u-frame").textContent = uniforms.frame.update(frameCount);
  $("u-auto_rotate").textContent = uniforms.auto_rotate.update(auto_rotate);
  $("u-fog_ratio").textContent = uniforms.fog_ratio.update(fog_ratio);
  $("u-gamma_correct_ratio").textContent =
    uniforms.gamma_correct_ratio.update(gamma_correct_ratio);

  lastFrameTime = currentTime;

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        storeOp: "store",
      },
    ],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3);
  pass.end();
  device.queue.submit([encoder.finish()]);

  if (++frameCount && currentTime - lastFpsUpdate > 100) {
    const fps = Math.round(frameCount / ((currentTime - lastFpsUpdate) / 1_000)); // prettier-ignore
    $("fps").textContent = fps;
    $("frame-time").textContent = `${((currentTime - lastFpsUpdate) / frameCount).toFixed(1)}ms`; // prettier-ignore
    frameCount = 0;
    lastFpsUpdate = currentTime;
  }
  requestAnimationFrame(render);
}

function resizeCanvas() {
  const container = $("canvas-container");
  const dpr = devicePixelRatio || 1;
  canvas.width = container.clientWidth * dpr;
  canvas.height = container.clientHeight * dpr;
  canvas.style.width = container.clientWidth + "px";
  canvas.style.height = container.clientHeight + "px";
}

compileBtn.onclick = () => compileShader(editor.getValue());

function toggleFullscreen() {
  if (
    !document.fullscreenElement &&
    !document.webkitFullscreenElement &&
    !document.mozFullScreenElement &&
    !document.msFullscreenElement
  ) {
    const elem = canvasContainer;
    if (elem.requestFullscreen) {
      elem.requestFullscreen();
    } else if (elem.webkitRequestFullscreen) {
      elem.webkitRequestFullscreen();
    } else if (elem.mozRequestFullScreen) {
      elem.mozRequestFullScreen();
    } else if (elem.msRequestFullscreen) {
      elem.msRequestFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
  }
}

function updateFullscreenUI() {
  const fullscreenElement =
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement;

  isFullscreen = !!fullscreenElement;
  if (isFullscreen) {
    fullscreenEnterIcon.classList.add("hidden");
    fullscreenExitIcon.classList.remove("hidden");
    editorContainer.style.display = "none";
    canvasContainer.classList.remove("landscape:w-1/2", "portrait:h-1/2");
    canvasContainer.classList.add("w-full", "h-full");
  } else {
    fullscreenEnterIcon.classList.remove("hidden");
    fullscreenExitIcon.classList.add("hidden");
    editorContainer.style.display = "";
    canvasContainer.classList.remove("w-full", "h-full");
    canvasContainer.classList.add("landscape:w-1/2", "portrait:h-1/2");
  }

  setTimeout(resizeCanvas, 50);
}

fullscreenBtn.onclick = toggleFullscreen;
document.addEventListener("fullscreenchange", updateFullscreenUI);
document.addEventListener("webkitfullscreenchange", updateFullscreenUI);
document.addEventListener("mozfullscreenchange", updateFullscreenUI);
document.addEventListener("MSFullscreenChange", updateFullscreenUI);

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    compileShader(editor.getValue());
  }
  if (e.key === "f" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    if (document.activeElement !== editor.getInputField()) {
      e.preventDefault();
      toggleFullscreen();
    }
  }
});
window.addEventListener("resize", resizeCanvas);

async function loadBasicShader() {
  try {
    const response = await fetch("./shaders/raymarch_basic.wgsl");
    if (response.ok) {
      fallbackShader = await response.text();
      editor.setValue(fallbackShader);
    } else {
      console.warn(
        "raymarch_basic.wgsl not found, using built-in fallback shader"
      );
    }
  } catch (err) {
    console.warn(
      "Error loading raymarch_basic.wgsl, using fallback shader",
      err
    );
  }
}

const main = async () => {
  await loadBasicShader();
  resizeCanvas();
  if (await initWebGPU()) render();
};
main();
