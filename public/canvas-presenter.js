import * as THREE from 'three';
import { createIllustratedPresenter } from './illustrated-presenter.js?v=36';
import {createMouthTexture} from './mouth-texture.js?v=36';
import {createBlinkTexture,blinkAt} from './blink-texture.js?v=36';

/**
 * CPU-skinned, original-pixel Vlampie for Canvas2D. No WebGL/context is created.
 * x is the image centre; y is the planted-foot baseline; height is the rest
 * visible height (source rows 9–1510). Caller owns time/age in seconds/ms.
 *
 * createCanvasPresenter(image, { canvasFactory, segmentsX: 24, segmentsY: 36 })
 * draw(ctx, { x, y, height }, state, deltaSeconds)
 * `paused` or `stopped` holds the exact current pose. Omit state to redraw it.
 * canvasFactory(width, height) must return an ordinary Canvas2D-capable canvas.
 */
export function createCanvasPresenter(image, options = {}) {
  const canvasFactory = options.canvasFactory || defaultCanvasFactory;
  const texture = new THREE.Texture(image);
  const actor = createIllustratedPresenter(texture, {
    segmentsX: 40, segmentsY: 60, flameFlicker: false,
  });
  const sourceWidth = actor.metrics.sourceWidth;
  const sourceHeight = actor.metrics.sourceHeight;
  const speechTexture=options.mouthImage?createMouthTexture(image,options.mouthImage,canvasFactory):null;
  const blinkTexture=options.blinkImage?createBlinkTexture(image,options.blinkImage,canvasFactory):null;
  const sx = Math.max(12, Math.floor(options.segmentsX || 24));
  const sy = Math.max(18, Math.floor(options.segmentsY || 36));
  const originalGeometry = actor.mesh.geometry;
  const geometry = sampleGeometry(originalGeometry, sx, sy, actor.metrics);
  actor.mesh.geometry = geometry;
  actor.triangleCount = sx * sy * 2;
  actor.rigProfile = 'original-art-canvas2d';

  // A single pixel read at construction. Conservative triangle occupancy skips
  // transparent work without discarding fine flame tips or the feathered edge.
  const sampler = canvasFactory(sourceWidth, sourceHeight);
  const readCtx = sampler.getContext('2d', { willReadFrequently: true });
  readCtx.drawImage(image, 0, 0, sourceWidth, sourceHeight);
  let alpha = null;
  try { alpha = readCtx.getImageData(0, 0, sourceWidth, sourceHeight).data; }
  catch { /* A tainted remote image is still drawable; simply keep all tiles. */ }

  const triangles = [];
  const index = geometry.index.array;
  const uv = geometry.attributes.uv;
  const position = geometry.attributes.position;
  const liveVertices = new Set();
  const sourceX = new Float32Array(position.count);
  const sourceY = new Float32Array(position.count);
  for (let i = 0; i < position.count; i++) {
    sourceX[i] = uv.getX(i) * sourceWidth;
    sourceY[i] = (1 - uv.getY(i)) * sourceHeight;
  }
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i], b = index[i + 1], c = index[i + 2];
    const x0 = sourceX[a], y0 = sourceY[a];
    const ux = sourceX[b] - x0, uy = sourceY[b] - y0;
    const vx = sourceX[c] - x0, vy = sourceY[c] - y0;
    const denominator = ux * vy - uy * vx;
    const minX = Math.min(x0, sourceX[b], sourceX[c]);
    const minY = Math.min(y0, sourceY[b], sourceY[c]);
    const maxX = Math.max(x0, sourceX[b], sourceX[c]);
    const maxY = Math.max(y0, sourceY[b], sourceY[c]);
    if (alpha && !hasAlpha(alpha, sourceWidth, sourceHeight,
      minX, minY, maxX, maxY, x0, y0, ux, uy, vx, vy, denominator)) continue;
    // Cropping is crucial: each drawImage samples ~50×50 source pixels, not
    // a transformed 1024×1536 image. Padding supports the expanded shared edge.
    const cropX = Math.max(0, Math.floor(minX) - 4);
    const cropY = Math.max(0, Math.floor(minY) - 4);
    const cropW = Math.min(sourceWidth, Math.ceil(maxX) + 4) - cropX;
    const cropH = Math.min(sourceHeight, Math.ceil(maxY) + 4) - cropY;
    triangles.push({ a, b, c, x0, y0, ux, uy, vx, vy,
      inverse: 1 / denominator, cropX, cropY, cropW, cropH, depth: 0 });
    liveVertices.add(a); liveVertices.add(b); liveVertices.add(c);
  }
  // Release the readback canvas: the immutable input remains the texture.
  sampler.width = sampler.height = 1;
  const activeVertices = Uint16Array.from(liveVertices);
  const deformed = new Float32Array(position.count * 3);
  const projected = new Float32Array(position.count * 2);
  const point = new THREE.Vector3();
  const outline = new Float64Array(6);
  let dirty = true;
  let disposed = false;
  const overlap = Math.max(0, options.seamOverlap ?? 0.58);
  const stats = {
    segmentsX: sx, segmentsY: sy,
    totalTriangles: index.length / 3,
    drawnTriangles: triangles.length,
    activeVertices: activeVertices.length,
    alphaCulling: !!alpha,
  };

  function update(delta, state = {}) {
    if (disposed || state.paused || state.stopped) return;
    actor.update(delta, state);
    dirty = true;
  }

  function deform() {
    for (const i of activeVertices) {
      actor.mesh.getVertexPosition(i, point);
      deformed[i * 3] = point.x;
      deformed[i * 3 + 1] = point.y;
      deformed[i * 3 + 2] = point.z;
    }
    // Far-to-near ordering retains the small original sleeve/head depth offsets.
    for (const t of triangles)
      t.depth = deformed[t.a * 3 + 2] + deformed[t.b * 3 + 2] + deformed[t.c * 3 + 2];
    triangles.sort((a, b) => a.depth - b.depth);
    dirty = false;
  }

  function draw(ctx, { x, y, height }, state, delta = 1 / 30) {
    if (disposed || !(height > 0)) return stats;
    if(state!==undefined){speechTexture?.update(state.mouth,delta,!!state.speaking&&!state.stopped);if(!state.stopped)blinkTexture?.update(state.blink??blinkAt(state.time||0,state.idle));}
    if (state !== undefined) update(delta, state);
    if (dirty) deform();
    const scale = height / actor.height;
    for (const i of activeVertices) {
      projected[i * 2] = x + deformed[i * 3] * scale;
      projected[i * 2 + 1] = y - deformed[i * 3 + 1] * scale;
    }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    for (const t of triangles) {
      const ax = projected[t.a * 2], ay = projected[t.a * 2 + 1];
      const bx = projected[t.b * 2], by = projected[t.b * 2 + 1];
      const cx = projected[t.c * 2], cy = projected[t.c * 2 + 1];
      const dux = bx - ax, duy = by - ay, dvx = cx - ax, dvy = cy - ay;
      const area = dux * dvy - duy * dvx;
      if (Math.abs(area) < 0.001) continue;
      const a = (dux * t.vy - dvx * t.uy) * t.inverse;
      const b = (duy * t.vy - dvy * t.uy) * t.inverse;
      const c = (dvx * t.ux - dux * t.vx) * t.inverse;
      const d = (dvy * t.ux - duy * t.vx) * t.inverse;
      const e = ax - a * t.x0 - c * t.y0;
      const f = ay - b * t.x0 - d * t.y0;
      expandTriangle(outline, ax, ay, bx, by, cx, cy, overlap, area);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(outline[0], outline[1]);
      ctx.lineTo(outline[2], outline[3]);
      ctx.lineTo(outline[4], outline[5]);
      ctx.closePath();
      ctx.clip();
      ctx.transform(a, b, c, d, e, f);
      ctx.drawImage(image, t.cropX, t.cropY, t.cropW, t.cropH,
        t.cropX, t.cropY, t.cropW, t.cropH);
      if(speechTexture?.opening>0){
        const [mx,my,mw,mh]=speechTexture.rect;
        if(t.cropX<mx+mw&&t.cropX+t.cropW>mx&&t.cropY<my+mh&&t.cropY+t.cropH>my)speechTexture.draw(ctx);
      }
      if(blinkTexture?.opening>0){const [ex,ey,ew,eh]=blinkTexture.rect;if(t.cropX<ex+ew&&t.cropX+t.cropW>ex&&t.cropY<ey+eh&&t.cropY+t.cropH>ey)blinkTexture.draw(ctx);}
      ctx.restore();
    }
    ctx.restore();
    return stats;
  }

  function resetPose() { actor.resetPose(); dirty = true; }
  function dispose() {
    if (disposed) return;
    disposed = true;
    geometry.dispose();
    actor.dispose();
    texture.dispose();
  }

  return { actor, draw, update, resetPose, dispose, stats, mouthTexture:speechTexture,blinkTexture,
    // Call after manually editing actor.bones; normal draw/update handles this.
    invalidate: () => { dirty = true; },
  };
}

function defaultCanvasFactory(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = globalThis.document?.createElement('canvas');
  if (!canvas) throw new Error('Provide canvasFactory(width, height) outside a browser.');
  canvas.width = width; canvas.height = height;
  return canvas;
}

function sampleGeometry(original, segmentsX, segmentsY, metrics) {
  const oldX = 40, oldY = 60;
  const oldPosition = original.attributes.position;
  const oldIndices = original.attributes.skinIndex;
  const oldWeights = original.attributes.skinWeight;
  const positions = [], uvs = [], indices = [], skinIndices = [], skinWeights = [];
  for (let row = 0; row <= segmentsY; row++) {
    for (let col = 0; col <= segmentsX; col++) {
      const gx = col / segmentsX * oldX, gy = row / segmentsY * oldY;
      const ix = Math.min(oldX - 1, Math.floor(gx));
      const iy = Math.min(oldY - 1, Math.floor(gy));
      const fx = gx - ix, fy = gy - iy;
      const corners = [iy * (oldX + 1) + ix, iy * (oldX + 1) + ix + 1,
        (iy + 1) * (oldX + 1) + ix, (iy + 1) * (oldX + 1) + ix + 1];
      const blend = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
      const weights = new Map();
      let z = 0;
      for (let q = 0; q < 4; q++) {
        const i = corners[q];
        z += oldPosition.getZ(i) * blend[q];
        for (let n = 0; n < 4; n++) {
          const bone = oldIndices.array[i * 4 + n];
          const weight = oldWeights.array[i * 4 + n] * blend[q];
          weights.set(bone, (weights.get(bone) || 0) + weight);
        }
      }
      const chosen = [...weights].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = chosen.reduce((total, entry) => total + entry[1], 0);
      while (chosen.length < 4) chosen.push([0, 0]);
      for (const [bone, weight] of chosen) {
        skinIndices.push(bone); skinWeights.push(weight / sum);
      }
      const px = col / segmentsX * metrics.sourceWidth;
      const py = row / segmentsY * metrics.sourceHeight;
      positions.push((px - metrics.centerX) / metrics.pixelsPerUnit,
        (metrics.visibleBottom - py) / metrics.pixelsPerUnit, z);
      uvs.push(col / segmentsX, 1 - row / segmentsY);
      if (col < segmentsX && row < segmentsY) {
        const a = row * (segmentsX + 1) + col, b = a + 1;
        const c = a + segmentsX + 1, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  geometry.setIndex(indices);
  return geometry;
}

function hasAlpha(pixels, width, height, minX, minY, maxX, maxY,
  x0, y0, ux, uy, vx, vy, denominator) {
  const left = Math.max(0, Math.floor(minX) - 2);
  const top = Math.max(0, Math.floor(minY) - 2);
  const right = Math.min(width - 1, Math.ceil(maxX) + 2);
  const bottom = Math.min(height - 1, Math.ceil(maxY) + 2);
  const margin = 2.5 / Math.min(maxX - minX, maxY - minY);
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (!pixels[(y * width + x) * 4 + 3]) continue;
      const dx = x + 0.5 - x0, dy = y + 0.5 - y0;
      const u = (dx * vy - dy * vx) / denominator;
      const v = (ux * dy - uy * dx) / denominator;
      if (u >= -margin && v >= -margin && u + v <= 1 + margin) return true;
    }
  }
  return false;
}

function expandTriangle(out, ax, ay, bx, by, cx, cy, padding, area) {
  // Offset the shared clip edges by a fraction of a destination pixel. Merely
  // scaling around the centroid leaves long diagonal anti-alias seams.
  const sign = area > 0 ? 1 : -1;
  const ab = Math.hypot(bx - ax, by - ay);
  const bc = Math.hypot(cx - bx, cy - by);
  const ca = Math.hypot(ax - cx, ay - cy);
  const n0x = sign * (by - ay) / ab, n0y = sign * (ax - bx) / ab;
  const n1x = sign * (cy - by) / bc, n1y = sign * (bx - cx) / bc;
  const n2x = sign * (ay - cy) / ca, n2y = sign * (cx - ax) / ca;
  const p0 = padding / Math.max(0.12, 1 + n2x * n0x + n2y * n0y);
  const p1 = padding / Math.max(0.12, 1 + n0x * n1x + n0y * n1y);
  const p2 = padding / Math.max(0.12, 1 + n1x * n2x + n1y * n2y);
  out[0] = ax + (n2x + n0x) * p0; out[1] = ay + (n2y + n0y) * p0;
  out[2] = bx + (n0x + n1x) * p1; out[3] = by + (n0y + n1y) * p1;
  out[4] = cx + (n1x + n2x) * p2; out[5] = cy + (n1y + n2y) * p2;
}
