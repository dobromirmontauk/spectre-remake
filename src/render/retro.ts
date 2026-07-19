// Low-res pixelation mode: renders at a reduced drawing-buffer resolution
// (WebGLRenderer.setSize with updateStyle=false keeps the <canvas> CSS box
// at full size while shrinking its internal framebuffer) and lets the
// browser's own image-rendering:pixelated upscale do the blocky magnification
// — no second canvas/renderer/render-target needed.

import * as THREE from 'three';
import { PIXELATE, PIXELATE_SCALE } from '../config/constants.ts';

export function applyPixelatedSize(renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number): void {
  canvas.style.imageRendering = PIXELATE ? 'pixelated' : 'auto';
  const w = PIXELATE ? Math.max(1, Math.round(cssWidth / PIXELATE_SCALE)) : cssWidth;
  const h = PIXELATE ? Math.max(1, Math.round(cssHeight / PIXELATE_SCALE)) : cssHeight;
  renderer.setSize(w, h, false);
}
