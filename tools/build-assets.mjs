// Rebuilds assets/models/*.glb from the KayKit packs (CC0, Kay Lousberg).
//
//   git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 <kaykit>/…
//   (also KayKit-Character-Pack-Skeletons-1.0, KayKit-Dungeon-Remastered-1.0, KayKit-Halloween-Bits-1.0)
//   npm i @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer
//   KAYKIT=<kaykit> node tools/build-assets.mjs assets/models
//
// Output: one shared animation library (the skeletons' clip set; every character
// uses the same 41-bone rig), mesh-only characters, and merged gear/prop libraries,
// all quantized and meshopt-compressed.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, resample, meshopt, weld, quantize } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import fs from 'fs';

const SRC = process.env.KAYKIT || '../assets';
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const ADV = `${SRC}/KayKit-Character-Pack-Adventures-1.0/addons/kaykit_character_pack_adventures`;
const SKL = `${SRC}/KayKit-Character-Pack-Skeletons-1.0/addons/kaykit_character_pack_skeletons`;
const DUN = `${SRC}/KayKit-Dungeon-Remastered-1.0/addons/kaykit_dungeon_remastered/Assets/gltf`;
const HAL = `${SRC}/KayKit-Halloween-Bits-1.0/addons/kaykit_halloween_bits/Assets/gltf`;

const DROP = /^(Sit_|Lie_|T-Pose|Unarmed_Pose|Death_.*_Pose|Skeleton_Inactive|Skeletons_Inactive|Interact|PickUp|Use_Item|Cheer)/;

function killAnim(a) {
  for (const c of a.listChannels()) c.dispose();
  for (const sm of a.listSamplers()) sm.dispose();
  a.dispose();
}
function cleanSamplers(a) {
  const used = new Set(a.listChannels().map((c) => c.getSampler()));
  for (const sm of a.listSamplers()) if (!used.has(sm)) sm.dispose();
}
async function write(doc, name, opts = {}) {
  await doc.transform(prune(), dedup(), ...(opts.anim ? [resample({ tolerance: 1e-4 })] : [weld()]), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const p = `${OUT}/${name}.glb`;
  await io.write(p, doc);
  return fs.statSync(p).size;
}

// ---- shared animation library (from a skeleton, which has the superset of clips)
{
  const doc = await io.read(`${SKL}/Characters/gltf/Skeleton_Warrior.glb`);
  const root = doc.getRoot();
  for (const a of root.listAnimations()) {
    if (DROP.test(a.getName())) { killAnim(a); continue; }
    for (const ch of a.listChannels()) {
      const node = ch.getTargetNode(); const path = ch.getTargetPath(); const s = ch.getSampler();
      const out = s.getOutput().getArray(); const n = s.getOutput().getElementSize();
      const rest = path === 'rotation' ? node.getRotation() : path === 'scale' ? node.getScale() : node.getTranslation();
      let still = true;
      for (let i = 0; i < out.length && still; i += n) for (let k = 0; k < n; k++) if (Math.abs(out[i + k] - rest[k]) > 1e-4) { still = false; break; }
      // IK / control helpers don't deform anything
      if (still || /IK|control-/.test(node.getName())) { ch.dispose(); }
    }
    cleanSamplers(a);
  }
  for (const m of root.listMeshes()) m.dispose();
  for (const s of root.listSkins()) s.dispose();
  for (const t of root.listTextures()) t.dispose();
  for (const m of root.listMaterials()) m.dispose();
  console.log('anims', root.listAnimations().length, await write(doc, 'anims', { anim: true }));
}

// ---- characters, without animations
const chars = { Knight: `${ADV}/Characters/gltf/Knight.glb`, Barbarian: `${ADV}/Characters/gltf/Barbarian.glb`, Mage: `${ADV}/Characters/gltf/Mage.glb`, Rogue: `${ADV}/Characters/gltf/Rogue.glb`, Rogue_Hooded: `${ADV}/Characters/gltf/Rogue_Hooded.glb`,
  Skeleton_Minion: `${SKL}/Characters/gltf/Skeleton_Minion.glb`, Skeleton_Warrior: `${SKL}/Characters/gltf/Skeleton_Warrior.glb`, Skeleton_Rogue: `${SKL}/Characters/gltf/Skeleton_Rogue.glb`, Skeleton_Mage: `${SKL}/Characters/gltf/Skeleton_Mage.glb` };
for (const [name, f] of Object.entries(chars)) {
  const doc = await io.read(f);
  for (const a of doc.getRoot().listAnimations()) killAnim(a);
  console.log(name, await write(doc, name));
}

// ---- static props / weapons merged into one library file each
async function library(name, list) {
  const lib = new (await import('@gltf-transform/core')).Document();
  const { mergeDocuments } = await import('@gltf-transform/functions');
  lib.createBuffer();
  const scene = lib.createScene('lib');
  for (const [dir, file] of list) {
    const d = await io.read(`${dir}/${file}`);
    const before = new Set(lib.getRoot().listScenes());
    mergeDocuments(lib, d);
    for (const sc of lib.getRoot().listScenes()) {
      if (before.has(sc) || sc === scene) continue;
      const holder = lib.createNode(file.replace(/\.gltf(\.glb)?$|\.glb$/, ''));
      for (const c of sc.listChildren()) holder.addChild(c);
      scene.addChild(holder);
      sc.dispose();
    }
  }
  // one buffer
  const bufs = lib.getRoot().listBuffers(); for (const b of bufs.slice(1)) { for (const a of lib.getRoot().listAccessors()) if (a.getBuffer() === b) a.setBuffer(bufs[0]); b.dispose(); }
  lib.getRoot().setDefaultScene(scene);
  console.log(name, list.length, await write(lib, name));
}
const gear = ['sword_1handed', 'sword_2handed', 'sword_2handed_color', 'axe_1handed', 'axe_2handed', 'dagger', 'staff', 'wand', 'spellbook_open', 'crossbow_1handed', 'crossbow_2handed', 'arrow', 'quiver', 'shield_round', 'shield_round_color', 'shield_square', 'shield_square_color', 'shield_badge', 'shield_badge_color', 'shield_spikes', 'shield_spikes_color', 'shield_round_barbarian', 'smokebomb', 'mug_full'].map(n => [`${ADV}/Assets/gltf`, n + '.gltf']);
const sgear = ['Skeleton_Blade', 'Skeleton_Axe', 'Skeleton_Crossbow', 'Skeleton_Staff', 'Skeleton_Shield_Large_A', 'Skeleton_Shield_Large_B', 'Skeleton_Shield_Small_A', 'Skeleton_Shield_Small_B', 'Skeleton_Arrow', 'Skeleton_Arrow_Broken'].map(n => [`${SKL}/Assets/gltf`, n + '.gltf']);
await library('gear', [...gear, ...sgear]);
const dprops = process.argv.length > 3 ? process.argv.slice(3) : fs.readFileSync(new URL('./props.txt', import.meta.url), 'utf8').trim().split(/\s+/);
await library('props', dprops.map((n) => n.startsWith('hal:') ? [HAL, n.slice(4) + '.gltf'] : [DUN, n + (fs.existsSync(`${DUN}/${n}.glb`) ? '.glb' : '.gltf.glb')]));
