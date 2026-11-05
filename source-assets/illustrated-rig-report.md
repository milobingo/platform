# Vlampie original-art illustrated rig v10

## Deliverable

`illustrated-presenter.js` is a reusable Three.js ES module. It exports `createIllustratedPresenter(texture, options)`, `illustratedGestureDuration`, and `illustratedRigMetrics`.

The only visible character artwork is the supplied, unmodified transparent PNG, `Vlampie met vlammen op beide handen(1).png` (1024 × 1536 RGBA). The mesh samples that original texture throughout. There are no newly drawn eyes, mouth, flames, clothing, replacement body parts, SVGs, canvases, or generated pixels.

The result is a smoothly deforming, front-facing 2D illustration located in a 3D scene. It is **not a true 3D reconstruction** and cannot supply an authentic side profile or back view.

## Coordinates and UVs

- Image origin is upper left; x increases rightward, y downward.
- World coordinate conversion: `xWorld = (xPixel - 512) * 2.7 / 1501`; `yWorld = (1510 - yPixel) * 2.7 / 1501`.
- UV conversion: `u = xPixel / 1024`; `v = 1 - yPixel / 1536`. Use a standard `THREE.TextureLoader` texture with its default `flipY = true`.
- Effective visible alpha bounds are approximately `(87, 9)–(937, 1510)`. Very faint outer source pixels are clipped by `alphaTest = 0.06`.
- Visible rest height is 2.7 world units; feet are at y≈0. Native visible width is approximately 1.529. The source aspect is preserved; no horizontal stretch was introduced to force a 1.7 width.
- The full grid includes transparent image margins. Do **not** renormalize from `Box3.setFromObject` or the mesh geometry bounds; that would treat transparent pixels as visible body geometry.
- Geometry has 96 × 144 quad cells, 14,065 vertices, 27,648 triangles, and one original-art material/draw mesh.

## Rig

Anatomical right corresponds to screen left. All coordinates below are source pixels.

| Bone/attachment | Screen left | Screen right |
|---|---:|---:|
| Shoulder / upper-arm pivot | (352, 548) | (672, 548) |
| Elbow / forearm pivot | (294, 689) | (730, 689) |
| Wrist / hand attachment | (208, 827) | (816, 827) |
| Hip / upper leg | (451, 900) | (573, 900) |
| Knee | (388, 1170) | (636, 1170) |
| Ankle / foot | (350, 1376) | (674, 1376) |

Central pivots are hips/spine `(512, 886)` and head/neck `(512, 460)`.

Continuous skin weights, limited to four bones per vertex, keep the mesh connected. Shoulder weights are confined to lateral sleeves, ending at the sleeve-to-torso seam. Lapels, bow tie, ears, face, and hair cannot receive arm weights. Elbow blending follows the diagonal limb axis over about 71 source pixels. The face/hair region remains rigid under a small head rotation; only the neck transitions into the torso. Legs have smooth hip/knee/ankle weights but stay still during the provided presenting motions.

The original flame tips extend above the wrists. They follow the forearm rather than a horizontal wrist cut, preventing detached flames. Very small wrist rotations are limited to the lower hand region. Geometry has 0–0.021 world units of local depth separation to avoid coincident self-overlap.

## Animation state

`update(deltaSeconds, state)` accepts:

| State | Meaning |
|---|---|
| `motion` | `idle`, `wave`, `welcome`, `cheer`, `think`, `bow` |
| `age` | Elapsed current gesture time in **milliseconds** |
| `energy` | 0–100; default 65 |
| `idle` | Whether idle breathing/sway is enabled |
| `time` | Caller-owned continuous time in **seconds** |
| `speaking` | Adds restrained head movement; does not modify the source mouth |
| `stopped` | Freezes the current pose, including flicker |
| `immediate` | Optional QA/reset flag to apply the target directly |

Pose transitions use exponential, delta-based interpolation from the actual current pose, including interruptions. Gesture envelopes enter and leave smoothly. Poses are deliberately modest: a low greeting wave, open-armed welcome/cheer, thoughtful head tilt, and shallow bow. A single front-view source cannot reliably produce a high overhead wave or a hand touching the chin without major distortion or invented surfaces.

The optional original-flame brightness modulation is shader-based, localized by original UV location and warm pixel color. Pass `{ flameFlicker: false }` to disable it. It does not create new flame pixels.

## Integration

```js
import * as THREE from 'three';
import { createIllustratedPresenter } from './illustrated-presenter.js';

const texture = await new THREE.TextureLoader().loadAsync('/original-vlampie.png');
const actor = createIllustratedPresenter(texture);
scene.add(actor.root);
actor.root.position.set(0, 0, -0.35); // Actual desired world placement.

function frame(delta, state) {
  actor.setFacing(camera);
  actor.update(delta, state);
  renderer.render(scene, camera);
}
```

`setFacing(camera)` rotates the illustration around world Y to face the camera, handling a translated or rotated parent. Feet remain vertical. The camera can view a 3D studio naturally while the character retains its authored front view.

The mesh uses `MeshBasicMaterial`, original sRGB colors, `toneMapped: false`, `transparent: false`, `alphaTest: 0.06`, `depthTest: true`, and `depthWrite: true`. `alphaToCoverage` improves edges when the renderer has MSAA. There is no forced render order, overlay layer, or always-on-top behavior. A desk placed closer to the camera therefore occludes the character through the normal depth buffer. Keep desk materials depth-writing as usual, and place the actor physically behind the desk rather than lowering its render order.

Public references include `root`, `avatar`/`billboard`, `mesh`, `skins`, `bones`, `rest`, `skeleton`, `material`, `map`, `update`, `setFacing`, `resetPose`, `dispose`, `getPose`, `height`, and `metrics`. The module has no GLTF clips: `actions` is empty, `mixer` is null, and `setClip` is a compatibility no-op. Caller code must not unconditionally invoke `mixer.update`.

`attachToHead(object, pixelX=512, pixelY=343, depth=0.035)` can attach a separately supplied original-art face patch or accessory. It is parented to the head and positioned in source-image coordinates. Build its plane dimensions using `pixelDimension * 2.7 / 1501`; this helper does not invent a patch or alter the original face.

Call `actor.dispose()` when replacing it. The module clones texture configuration while sharing its image source, so disposal does not dispose the caller's original texture.

## Verification

`export-poses.mjs` uses Three.js CPU skinning to export the actual deformed geometry for all seven rest/gesture states. `render-qa.py` renders those vertices through standalone EGL/OpenGL against the exact original PNG. The Python workflow renders geometry; it does not raster-edit character artwork.

- 14,065 vertices and 27,648 triangles.
- Maximum skin-weight sum error: 4.10 × 10⁻⁸.
- No non-finite pose coordinates.
- Stopped pose remains unchanged.
- Zero-delta gesture interruption does not snap the pose.
- A translated/rotated parent still yields a facing dot product of 1.0 against the horizontal camera direction.
- Rest, wave, cheer, and bow renders were visually inspected; artwork identity, clothing continuity, flame integrity, and planted feet remain intact.
- `qa-depth-occlusion.png` renders a foreground desk **before** the character, then submits the character. The desk remains visible over the lower body, demonstrating depth occlusion independent of draw submission order.

The included QA renderer validates mesh deformation and depth behavior. The Three.js browser shader, including optional flame flicker and MSAA edge behavior, should be checked once in the integrating application. The original source contains faint colored fringe pixels and a white sole fringe; no unrequested retouching was done.
