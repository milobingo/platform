import * as THREE from 'three';

/**
 * Vlampie illustrated presenter, source-art preserving cutout rig.
 * The supplied 1024 × 1536 RGBA image is the only visible character artwork.
 * World units: feet y=0; visible top y=2.7; source aspect ratio is preserved.
 * This is a front-facing illustration in a real depth-tested 3D scene.
 */
export const illustratedGestureDuration = Object.freeze({
  idle: Infinity, wave: 4400, welcome: 3600, cheer: 5000, think: 4100, bow: 3600, look: 3200, point: 3800,
});

export const illustratedRigMetrics = Object.freeze({
  sourceWidth: 1024, sourceHeight: 1536,
  visibleTop: 9, visibleBottom: 1510, centerX: 512,
  height: 2.7, restingVisibleWidth: 1.529,
  pixelsPerUnit: 1501 / 2.7,
});

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const ramp = (a, b, x) => smooth((x - a) / (b - a));
const M = illustratedRigMetrics;
const unit = 1 / M.pixelsPerUnit;
const imagePoint = (x, y, z = 0) => new THREE.Vector3((x - M.centerX) * unit, (M.visibleBottom - y) * unit, z);
const seam = [[505, 344], [578, 349], [653, 362], [674, 365], [725, 354], [800, 312], [900, 279], [1040, 260]];

function sleeveBoundary(y) {
  if (y <= seam[0][0]) return seam[0][1];
  for (let i = 1; i < seam.length; i++) if (y <= seam[i][0]) {
    const [y0, x0] = seam[i - 1], [y1, x1] = seam[i];
    return lerp(x0, x1, (y - y0) / (y1 - y0));
  }
  return seam[seam.length - 1][1];
}

/**
 * @param {THREE.Texture} texture Texture loaded from the original transparent PNG.
 * @param {object} options Optional {flameFlicker, segmentsX, segmentsY}.
 * @returns {{root:THREE.Group,update:Function,setFacing:Function}}
 */
export function createIllustratedPresenter(texture, options = {}) {
  if (!texture?.isTexture) throw new TypeError('createIllustratedPresenter requires a THREE.Texture.');
  const root = new THREE.Group();
  root.name = 'VlampieIllustratedPresenter';
  const billboard = new THREE.Group();
  billboard.name = 'IllustrationFacing';
  root.add(billboard);

  // Clone texture settings, sharing the original immutable source pixels.
  const map = texture.clone();
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;

  const bones = {}, boneList = [], boneIndex = {}, rest = new Map();
  function bone(name, parent, x, y, z = 0) {
    const b = new THREE.Bone();
    b.name = name;
    b.userData.sourcePixel = { x, y, z };
    const p = imagePoint(x, y, z);
    if (parent) p.sub(imagePoint(parent.userData.sourcePixel.x, parent.userData.sourcePixel.y, parent.userData.sourcePixel.z));
    b.position.copy(p);
    if (parent) parent.add(b);
    boneIndex[name] = boneList.length;
    boneList.push(b);
    bones[name] = b;
    rest.set(b, { position: b.position.clone(), quaternion: b.quaternion.clone(), scale: b.scale.clone() });
    return b;
  }

  const hips = bone('Hips', null, 512, 886);
  const spine = bone('Spine', hips, 512, 886);
  const head = bone('Head', spine, 512, 460);
  // Anatomical right is screen left, as in the source image.
  const rightArm = bone('RightArm', spine, 352, 548);
  const rightForeArm = bone('RightForeArm', rightArm, 294, 689);
  const rightHand = bone('RightHand', rightForeArm, 208, 827);
  const leftArm = bone('LeftArm', spine, 672, 548);
  const leftForeArm = bone('LeftForeArm', leftArm, 730, 689);
  const leftHand = bone('LeftHand', leftForeArm, 816, 827);
  const rightUpLeg = bone('RightUpLeg', hips, 451, 900);
  const rightLeg = bone('RightLeg', rightUpLeg, 388, 1170);
  bone('RightFoot', rightLeg, 350, 1376);
  const leftUpLeg = bone('LeftUpLeg', hips, 573, 900);
  const leftLeg = bone('LeftLeg', leftUpLeg, 636, 1170);
  bone('LeftFoot', leftLeg, 674, 1376);
  bones.Neck = head;
  bones.Spine1 = spine;
  bones.Spine2 = spine;
  bones.RightShoulder = rightArm;
  bones.LeftShoulder = leftArm;

  const segmentsX = Math.max(40, Math.floor(options.segmentsX ?? 96));
  const segmentsY = Math.max(60, Math.floor(options.segmentsY ?? 144));
  const positions = [], uvs = [], skinIndices = [], skinWeights = [], indices = [];

  function weightsAt(x, y) {
    const weights = new Map();
    const add = (name, value) => {
      if (value > 0.000001) weights.set(boneIndex[name], (weights.get(boneIndex[name]) || 0) + value);
    };
    const screenLeft = x < 512;
    const mirroredX = screenLeft ? x : 1024 - x;
    const arm = screenLeft ? 'Right' : 'Left';
    // Lateral half of the shoulder transition ends at the jacket seam.
    // No arm weight reaches the lapels, neck, ears, or hair.
    const lateral = 1 - ramp(sleeveBoundary(y) - 32, sleeveBoundary(y), mirroredX);
    const armWeight = ramp(502, 572, y) * (1 - ramp(1026, 1050, y)) * lateral;
    if (armWeight > 0) {
      // Projection through shoulder/elbow: spatial, not a horizontal elbow cut.
      // The flame above the wrist consequently follows the whole lower arm.
      const along = ((mirroredX - 352) * -58 + (y - 548) * 141) / Math.hypot(58, 141);
      const fore = ramp(117, 188, along);
      // Hands are real attachment bones; preserve whole flames on forearm to avoid
      // bending their narrow tips. Tiny hand movements only affect the fingers.
      const hand = ramp(850, 900, y) * ramp(0, 1, fore);
      add(`${arm}Arm`, armWeight * (1 - fore));
      add(`${arm}ForeArm`, armWeight * fore * (1 - hand));
      add(`${arm}Hand`, armWeight * fore * hand);
    }
    const central = 1 - armWeight;
    const legs = ramp(847, 964, y);
    const headWeight = 1 - ramp(452, 493, y);
    add('Head', central * (1 - legs) * headWeight);
    add('Spine', central * (1 - legs) * (1 - headWeight));
    if (legs > 0) {
      // The leg split falls in the transparent crotch/leg gap below the pelvis.
      const right = 1 - ramp(495, 529, x);
      const knee = ramp(1116, 1225, y);
      const ankle = ramp(1328, 1397, y);
      for (const [prefix, side] of [['Right', right], ['Left', 1 - right]]) {
        add(`${prefix}UpLeg`, central * legs * side * (1 - knee));
        add(`${prefix}Leg`, central * legs * side * knee * (1 - ankle));
        add(`${prefix}Foot`, central * legs * side * knee * ankle);
      }
    }
    const sorted = [...weights].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = sorted.reduce((total, item) => total + item[1], 0);
    while (sorted.length < 4) sorted.push([0, 0]);
    return { weights: sorted.map(([index, weight]) => [index, weight / sum]), armWeight, headWeight, legs };
  }

  for (let row = 0; row <= segmentsY; row++) {
    const y = row / segmentsY * M.sourceHeight;
    for (let col = 0; col <= segmentsX; col++) {
      const x = col / segmentsX * M.sourceWidth;
      const data = weightsAt(x, y);
      // Millimetric depth separates self-overlap while retaining the silhouette.
      const z = .012 * (1 - data.legs) + .009 * data.armWeight + .005 * data.headWeight;
      const p = imagePoint(x, y, z);
      positions.push(p.x, p.y, p.z);
      uvs.push(x / M.sourceWidth, 1 - y / M.sourceHeight);
      for (const [index, weight] of data.weights) { skinIndices.push(index); skinWeights.push(weight); }
      if (row < segmentsY && col < segmentsX) {
        const a = row * (segmentsX + 1) + col, b = a + 1, c = a + segmentsX + 1, d = c + 1;
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
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshBasicMaterial({
    name: 'Original Vlampie Artwork', map,
    color: 0xffffff, toneMapped: false,
    side: THREE.DoubleSide,
    // Opaque alpha-tested surfaces participate in normal depth ordering.
    // No renderOrder override: a desk in front really hides the lower body.
    transparent: false, alphaTest: .06,
    alphaToCoverage: true, depthWrite: true, depthTest: true,
  });
  const flamePulse = { value: 0 };
  if (options.flameFlicker !== false) {
    material.onBeforeCompile = shader => {
      shader.uniforms.illustratedFlamePulse = flamePulse;
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float illustratedFlamePulse;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        #ifdef USE_MAP
          float sideFlame = 1.0 - smoothstep(0.25, 0.30, min(vMapUv.x, 1.0 - vMapUv.x));
          float flameHeight = smoothstep(0.32, 0.37, vMapUv.y) * (1.0 - smoothstep(0.54, 0.57, vMapUv.y));
          float warmPixel = smoothstep(0.10, 0.35, diffuseColor.r - diffuseColor.b);
          diffuseColor.rgb *= 1.0 + illustratedFlamePulse * sideFlame * flameHeight * warmPixel;
        #endif`);
    };
    material.customProgramCacheKey = () => 'vlampie-illustrated-flame-v10';
  }
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = 'OriginalArtworkContinuousSkin';
  mesh.add(hips);
  billboard.add(mesh);
  const skeleton = new THREE.Skeleton(boneList);
  mesh.bind(skeleton);
  // The rest bounds exclude moved limbs; do not cull from that stale sphere.
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  root.userData.characterKind = 'source-art-2d-puppet';
  root.userData.frontFacingOnly = true;

  let initialized = false;
  const angle = { bodyZ: 0, bodyX: 0, headZ: 0, headX: 0, rightUpper: 0, rightLower: 0, rightWrist: 0, leftUpper: 0, leftLower: 0, leftWrist: 0, breath: 0 };
  const restQuaternions = new Map(boneList.map(b => [b, b.quaternion.clone()]));

  function resetPose() {
    for (const [b, r] of rest) { b.position.copy(r.position); b.quaternion.copy(r.quaternion); b.scale.copy(r.scale); }
    for (const key of Object.keys(angle)) angle[key] = 0;
    flamePulse.value = 0;
    initialized = false;
    root.updateMatrixWorld(true);
    skeleton.update();
  }

  function update(delta, { motion = 'idle', age = 0, energy = 65, idle = true, time = 0, speaking = false, stopped = false, immediate = false, lookAt = 'camera' } = {}) {
    if (stopped) return;
    const e = .65 + clamp(Number(energy) || 0, 0, 100) * .005;
    const duration = illustratedGestureDuration[motion] ?? 4000;
    const envelope = motion === 'idle' ? 0 : smooth(age / 760) * smooth((duration - age) / 850);
    const blend = envelope * (.77 + clamp(energy, 0, 100) * .0021);
    const t = Number.isFinite(time) ? time : 0;
    const target = {
      bodyZ: idle ? Math.sin(t * .73) * .006 * e : 0,
      bodyX: 0,
      headZ: idle ? Math.sin(t * .57 + .4) * .010 * e : 0,
      headX: speaking ? Math.sin(t * 5.0) * .010 : 0,
      rightUpper: idle ? Math.sin(t * 1.1) * .008 * e : 0,
      rightLower: idle ? Math.sin(t * 1.1 + .7) * .010 * e : 0,
      rightWrist: 0,
      leftUpper: idle ? -Math.sin(t * 1.1 + .4) * .008 * e : 0,
      leftLower: idle ? -Math.sin(t * 1.1 + 1.1) * .010 * e : 0,
      leftWrist: 0,
      breath: idle ? (Math.sin(t * 1.65) + 1) * .0018 * e : 0,
    };
    if (motion === 'wave') {
      target.rightUpper -= .145 * blend;
      target.rightLower -= (.44 + Math.sin(age * .0072) * .105) * blend;
      target.rightWrist -= Math.sin(age * .0072) * .023 * blend;
      target.headZ += .018 * blend;
    } else if (motion === 'welcome') {
      target.rightUpper -= .17 * blend; target.leftUpper += .17 * blend;
      target.rightLower -= .15 * blend; target.leftLower += .15 * blend;
      target.headZ += Math.sin(age * .0012) * .012 * blend;
    } else if (motion === 'cheer') {
      const bounce = Math.sin(age * .0048) * .045;
      target.rightUpper -= (.20 + bounce) * blend; target.leftUpper += (.20 - bounce) * blend;
      target.rightLower -= .40 * blend; target.leftLower += .40 * blend;
      target.bodyZ += Math.sin(age * .0048) * .012 * blend;
      target.headZ -= Math.sin(age * .0048) * .014 * blend;
    } else if (motion === 'think') {
      target.headZ -= .072 * blend;
      target.headX += .025 * blend;
      target.leftUpper += .055 * blend;
      target.leftLower -= .10 * blend;
    } else if (motion === 'look') {
      target.headZ -= .050 * blend;target.headX += .025 * blend;target.leftUpper += .05 * blend;
    } else if (motion === 'point') {
      target.leftUpper += .23 * blend;target.leftLower += .26 * blend;target.leftWrist += .03 * blend;target.headZ -= .024 * blend;
    } else if (motion === 'bow') {
      target.bodyX += .20 * blend;
      target.headX += .085 * blend;
      target.rightUpper += .025 * blend; target.leftUpper -= .025 * blend;
    }
    if(lookAt==='machine')target.headZ-=.026;
    if(lookAt==='board')target.headX+=.030;
    if (speaking) target.headZ += Math.sin(t * 3.3) * .004;
    // Exponential interpolation uses the actual previous pose, so interruptions
    // blend cleanly. Both time and age remain caller-owned for pause/resume.
    const factor = !initialized || immediate ? 1 : 1 - Math.exp(-Math.min(Math.max(delta || 0, 0), .1) / .115);
    for (const key of Object.keys(angle)) angle[key] = lerp(angle[key], target[key], factor);
    for (const [b, q] of restQuaternions) b.quaternion.copy(q);
    spine.rotation.set(angle.bodyX, 0, angle.bodyZ);
    spine.scale.y = 1 + angle.breath;
    head.rotation.set(angle.headX, 0, angle.headZ);
    rightArm.rotation.z = angle.rightUpper;
    rightForeArm.rotation.z = angle.rightLower;
    rightHand.rotation.z = angle.rightWrist;
    leftArm.rotation.z = angle.leftUpper;
    leftForeArm.rotation.z = angle.leftLower;
    leftHand.rotation.z = angle.leftWrist;
    // Feet and all leg bones stay planted. The grid is smoothly bound for future
    // walking work, but this single front view cannot supply hidden leg surfaces.
    flamePulse.value = options.flameFlicker === false ? 0 : .025 + .018 * Math.sin(t * 7.1) + .010 * Math.sin(t * 13.3 + .8);
    initialized = true;
    root.updateMatrixWorld(true);
    skeleton.update();
  }

  const cameraPosition = new THREE.Vector3(), origin = new THREE.Vector3();
  const parentQuaternion = new THREE.Quaternion(), facing = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  function setFacing(camera) {
    if (!camera?.isCamera) return;
    root.updateWorldMatrix(true, false);
    camera.getWorldPosition(cameraPosition);
    root.getWorldPosition(origin);
    const dx = cameraPosition.x - origin.x, dz = cameraPosition.z - origin.z;
    if (dx * dx + dz * dz < 1e-10) return;
    facing.setFromAxisAngle(up, Math.atan2(dx, dz));
    root.getWorldQuaternion(parentQuaternion);
    billboard.quaternion.copy(parentQuaternion.invert().multiply(facing));
    billboard.updateMatrixWorld(true);
  }

  /** Attach an externally supplied original-art face patch without guessing its pixels. */
  function attachToHead(object, pixelX = 512, pixelY = 343, depth = .035) {
    const p = imagePoint(pixelX, pixelY, depth).sub(imagePoint(512, 460));
    head.add(object);
    object.position.copy(p);
    return object;
  }

  function dispose() {
    geometry.dispose(); material.dispose(); map.dispose(); skeleton.dispose();
    root.removeFromParent();
  }

  resetPose();
  return {
    root, avatar: billboard, billboard, mesh, skins: [mesh], bones, rest,
    skeleton, material, map, update, setFacing, resetPose, attachToHead, dispose,
    actions: {}, mixer: null, rigProfile: 'original-art-continuous-2d',
    setClip: () => {}, triangleCount: indices.length / 3,
    height: M.height, metrics: M,
    getPose: () => ({ ...angle }),
  };
}
