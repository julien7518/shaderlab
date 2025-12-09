# ShaderLab: Interactive WebGPU Ray Marching Scene Editor 🚀

![ShaderLab Demo](assets/preview.png)

## Live Demo

Explore the live editor deployed on Vercel :  
👉 **[ShaderLab Live](https://webgpu-shaderlab.vercel.app)**

## Overview

**ShaderLab** is an interactive 3D scene editor powered by **WebGPU**.  
It allows you to create, edit, and manipulate ray-marched 3D primitives in real time, with an intuitive UI panel and a fully functional **3D transformation gizmo**.

No shader recompilation required — everything updates live.

## Features

### ✅ Already Implemented

- [x] **Real-time shader-based rendering** of 3D primitives
- [x] **Interactive scene editor** (sliders, color pickers, dynamic object list)
- [x] **Add, remove, and select objects**
- [x] **Click-to-select system via ID-based picking**
- [x] **3D translation gizmo** (X, Y, Z axes) with drag-based movement
- [x] **Live updates** to the scene without reloading or recompiling the shader
- [x] **Multiple primitive types** (spheres, boxes, etc.)

### 🔧 Planned Features

- [ ] **Black screen during picking render pass** (to avoid visible flicker when clicking)
- [ ] **Lock camera while dragging the gizmo**
- [ ] **Fix auto-rotate jitter / prevent camera jump**
- [ ] **Object transparency when selected**
- [ ] **Selectable gizmo even through overlapping objects**
- [ ] **Reimplement CSG operations** with a fixed UI selector (removed due to selection bugs during union operations: see commit [`29391d3`](https://github.com/julien7518/shaderlab/commit/29391d31964c865d3a0f602944fdf18ed7e9880a#diff-827a0f5887aad57d93e84d7c7f28a5426a9c66de00b772b390d42dced0740362) )
- [ ] **Resizable right-side editor panel**

## Tech Stack

- **WebGPU** for GPU-accelerated rendering
- **WGSL** for ray marching shaders
- **JavaScript** for scene management & UI logic
- **HTML/CSS + Tailwind** for layout and styling

## Local Development

### Prerequisites

- A browser with **WebGPU support** (Chrome, Edge, Firefox Nightly…)
- Python 3 (or any static server)

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/shaderlab.git
   cd shaderlab
   ```
2. Start a local server:
   ```bash
   python -m http.server
   ```
3. Open your browser and navigate to `http://localhost:8000`

## Contributing

Feature requests, issues and pull requests are always welcome!
Feel free to contribute improvements, especially on UI/UX or planned features.

## License

This project is licensed under the [MIT License](LICENSE).
