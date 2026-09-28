// Loads the rigged character models, the shared animation library and the prop/gear
// libraries (KayKit packs by Kay Lousberg, CC0 — optimised by tools/, see README).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BASE = './assets/models/';
export const CHARACTERS = ['Knight', 'Barbarian', 'Mage', 'Rogue', 'Rogue_Hooded', 'Skeleton_Minion', 'Skeleton_Warrior', 'Skeleton_Rogue', 'Skeleton_Mage'];

const lib = { chars: {}, clips: {}, gear: {}, props: {}, ready: false };
export const Assets = lib;

function prepMaterial(m) {
  if (!m || m.userData.prepped) return m;
  m.userData.prepped = true;
  if (m.map) {
    m.map.anisotropy = 4;
    m.map.generateMipmaps = true;
  }
  m.roughness = Math.min(0.85, m.roughness ?? 0.8);
  m.metalness = 0;
  return m;
}

function index(root) {
  const out = {};
  for (const c of root.children) out[c.name] = c;
  return out;
}

export async function loadAssets(onProgress = () => {}) {
  if (lib.ready) return lib;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const files = ['anims', 'gear', 'props', ...CHARACTERS];
  let done = 0;
  const load = (name) =>
    loader.loadAsync(BASE + name + '.glb').then((g) => {
      onProgress(++done / files.length, name);
      return [name, g];
    });
  const results = await Promise.all(files.map(load));
  for (const [name, g] of results) {
    g.scene.traverse((o) => {
      if (o.isMesh) {
        prepMaterial(o.material);
        o.castShadow = true;
        o.frustumCulled = !o.isSkinnedMesh;
      }
    });
    if (name === 'anims') for (const c of g.animations) lib.clips[c.name] = c;
    else if (name === 'gear') lib.gear = index(g.scene);
    else if (name === 'props') lib.props = index(g.scene);
    else lib.chars[name] = g.scene;
  }
  lib.ready = true;
  return lib;
}

// A fresh, independently animatable copy of a character.
export function cloneCharacter(name) {
  const src = lib.chars[name];
  const root = cloneSkinned(src);
  const bones = {};
  const parts = {};
  const shared = new Map(); // one material clone per source material, per instance
  root.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh) {
      parts[o.name] = o;
      if (!shared.has(o.material)) shared.set(o.material, o.material.clone());
      o.material = shared.get(o.material);
    }
  });
  return { root, bones, parts };
}

export function gearModel(name) {
  const src = lib.gear[name];
  if (!src) return null;
  const g = src.clone(true);
  g.traverse((o) => {
    if (o.isMesh) o.material = o.material.clone();
  });
  return g;
}

// Shared (not cloned) materials: props are static and batched.
export function propModel(name) {
  const src = lib.props[name];
  return src ? src.clone(true) : null;
}

function toFloat(attr) {
  if (attr.array instanceof Float32Array && !attr.isInterleavedBufferAttribute) return attr.clone();
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++) for (let k = 0; k < attr.itemSize; k++) out[i * attr.itemSize + k] = attr.getComponent(i, k);
  return new THREE.BufferAttribute(out, attr.itemSize);
}

export function floatGeometry(src) {
  const g = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'uv']) if (src.attributes[k]) g.setAttribute(k, toFloat(src.attributes[k]));
  if (src.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array), 1));
  return g;
}

// Merged geometry per material for a prop, in the prop's local space, for instancing.
const propGeoCache = {};
export function propGeometry(name) {
  if (propGeoCache[name]) return propGeoCache[name];
  const src = lib.props[name];
  if (!src) return null;
  src.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(src.matrixWorld).invert();
  const parts = [];
  src.traverse((o) => {
    if (!o.isMesh) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const g = floatGeometry(o.geometry).applyMatrix4(m);
    parts.push({ geometry: g, material: o.material, name: o.name });
  });
  return (propGeoCache[name] = parts);
}

export function clip(name) {
  return lib.clips[name];
}

// Bake a character's visible parts (skinned body pieces plus rigid attachments such
// as hats or held weapons) into one SkinnedMesh per material: one draw call instead
// of ten. Vertices are stored in skin space (bindMatrix = identity), rigid pieces are
// weighted fully to the bone they hang from.
export function mergeCharacter(root, keepHidden = false) {
  root.updateMatrixWorld(true);
  let skeleton = null;
  const pieces = [];
  root.traverse((o) => {
    if (!o.isMesh || (!keepHidden && !isVisible(o, root))) return;
    if (o.isSkinnedMesh && !skeleton) skeleton = o.skeleton;
    pieces.push(o);
  });
  if (!skeleton || !pieces.length) return null;
  const boneIndex = new Map(skeleton.bones.map((b, i) => [b.name, i]));
  const byMat = new Map();
  const m4 = new THREE.Matrix4();
  for (const o of pieces) {
    const g = floatGeometry(o.geometry);
    const n = g.attributes.position.count;
    let si;
    let sw;
    if (o.isSkinnedMesh) {
      // remap this mesh's joint indices onto the shared skeleton by bone name
      const src = o.geometry.attributes;
      si = new Uint16Array(n * 4);
      sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++)
        for (let k = 0; k < 4; k++) {
          const b = o.skeleton.bones[src.skinIndex.getComponent(i, k)];
          si[i * 4 + k] = boneIndex.get(b.name) ?? 0;
          sw[i * 4 + k] = src.skinWeight.getComponent(i, k);
        }
      g.applyMatrix4(o.bindMatrix);
      // each part may carry its own inverse bind matrices (quantisation folds a
      // per-mesh transform into them): re-express the part in the shared skeleton's
      const b0 = o.skeleton.bones[0];
      const j = boneIndex.get(b0.name);
      m4.copy(skeleton.boneInverses[j]).invert().multiply(o.skeleton.boneInverses[0]);
      g.applyMatrix4(m4);
    } else {
      // rigid piece: find the bone it hangs from, express it in that bone's bind space
      let b = o.parent;
      while (b && !b.isBone) b = b.parent;
      if (!b || !boneIndex.has(b.name)) continue;
      const bi = boneIndex.get(b.name);
      // local transform from the bone down to the mesh
      m4.copy(b.matrixWorld).invert().multiply(o.matrixWorld);
      g.applyMatrix4(m4);
      g.applyMatrix4(new THREE.Matrix4().copy(skeleton.boneInverses[bi]).invert());
      si = new Uint16Array(n * 4);
      sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        si[i * 4] = bi;
        sw[i * 4] = 1;
      }
    }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    const key = o.material;
    if (!byMat.has(key)) byMat.set(key, []);
    byMat.get(key).push(g);
  }
  const out = [];
  for (const [material, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    const mesh = new THREE.SkinnedMesh(merged, material);
    mesh.bind(skeleton, new THREE.Matrix4());
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    out.push(mesh);
  }
  for (const o of pieces) o.parent?.remove(o);
  for (const m of out) root.add(m);
  return out;
}

function isVisible(o, root) {
  for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return false;
  return true;
}

// Re-parent a prop's lid under a hinge pivot at (0, y, z) of its parent, so rotating
// the pivot around X swings the lid open (negative = open).
export function hingeLid(prop, lidName, y, z) {
  const lid = prop.getObjectByName(lidName);
  if (!lid) return null;
  const parent = lid.parent;
  const pivot = new THREE.Group();
  pivot.position.set(0, y, z);
  parent.add(pivot);
  lid.position.sub(pivot.position);
  pivot.add(lid);
  return pivot;
}
