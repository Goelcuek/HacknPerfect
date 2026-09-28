// Hero looks: which rigged model each class uses, which accessories it shows for the
// equipped gear (weapons and shields swap with rarity, capes take the armour's colour,
// helmets/hats come with better armour), plus glow, halo and charm extras.

import * as THREE from 'three';
import { CharacterModel } from './model.js';
import { G, mat } from './rig.js';

export const HERO_LOOKS = {
  knight: {
    model: 'Knight',
    gear: ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', '1H_Sword', '2H_Sword', 'Knight_Helmet', 'Knight_Cape'],
    cape: 'Knight_Cape',
    run: 'Running_A',
  },
  barbarian: {
    model: 'Barbarian',
    gear: ['1H_Axe_Offhand', 'Barbarian_Round_Shield', '1H_Axe', '2H_Axe', 'Mug', 'Barbarian_Hat', 'Barbarian_Cape'],
    cape: 'Barbarian_Cape',
    run: 'Running_B',
  },
  mage: {
    model: 'Mage',
    gear: ['Spellbook', 'Spellbook_open', '1H_Wand', '2H_Staff', 'Mage_Hat', 'Mage_Cape'],
    cape: 'Mage_Cape',
    run: 'Running_A',
  },
  rogue: {
    model: 'Rogue',
    gear: ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable', 'Rogue_Cape'],
    cape: 'Rogue_Cape',
    run: 'Running_A',
  },
  ranger: {
    model: 'Rogue_Hooded',
    gear: ['Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable', 'Rogue_Cape'],
    cape: 'Rogue_Cape',
    run: 'Running_A',
  },
};

const HERO_SCALE = 0.8;

export function buildHero(clsId) {
  const look = HERO_LOOKS[clsId];
  const model = new CharacterModel(look.model, { scale: HERO_SCALE });
  model.cfg = look;
  model.clsId = clsId;
  model.extras = new THREE.Group();
  model.group.add(model.extras);
  return model;
}

const GLOW = [0, 0.05, 0.1, 0.18, 0.3];

function clearExtras(model) {
  for (const o of model.addons || []) {
    o.parent?.remove(o);
    o.traverse?.((c) => {
      if (c.isMesh) c.material.dispose?.();
    });
  }
  model.addons = [];
  model.orbit = null;
}

export function dressHero(model, equipment) {
  const { cfg: look, clsId } = model;
  clearExtras(model);
  const w = equipment.weapon;
  const wt = w ? w.rarity.tier : 0;
  const armor = equipment.armor;
  const at = armor ? armor.rarity.tier : -1;
  const show = [];
  let tips = [];

  if (clsId === 'knight') {
    const sword = wt >= 2 ? '2H_Sword' : '1H_Sword';
    show.push(sword, ['Round_Shield', 'Round_Shield', 'Rectangle_Shield', 'Badge_Shield', 'Spike_Shield', 'Spike_Shield'][at + 1], look.cape);
    if (at >= 1) show.push('Knight_Helmet');
    tips = [sword];
  } else if (clsId === 'barbarian') {
    show.push('2H_Axe', look.cape);
    if (at >= 1) show.push('Barbarian_Hat');
    tips = ['2H_Axe'];
  } else if (clsId === 'mage') {
    show.push('2H_Staff', 'Mage_Hat');
    if (at >= 1) show.push(look.cape);
    if (at >= 2) show.push('Spellbook_open');
    tips = ['2H_Staff'];
  } else if (clsId === 'rogue') {
    show.push('Knife', 'Knife_Offhand');
    if (at >= 1) show.push(look.cape);
    tips = ['Knife', 'Knife_Offhand'];
  } else {
    show.push('2H_Crossbow');
    if (at >= 1) show.push(look.cape);
    if (at >= 3) show.push('Knife');
  }
  model.only(look.gear, show);
  model.setTips(tips);

  // weapon glows with its rarity
  for (const n of look.gear) if (!/Cape|Hat|Helmet|Shield/.test(n)) model.glow(n, w ? w.rarity.hex : 0, w ? GLOW[wt] : 0);
  // cape (and shield, for knights) take the armour's colour from magic up
  if (at >= 1) model.tint(look.cape, armor.rarity.hex, at >= 3 ? 0.18 : 0);
  else model.tint(look.cape, null);
  if (clsId === 'knight') for (const s of ['Rectangle_Shield', 'Badge_Shield', 'Spike_Shield']) model.glow(s, at >= 2 ? armor.rarity.hex : 0, at >= 2 ? GLOW[at] * 0.35 : 0);

  // legendary armour: a halo over the head
  if (at >= 4 && model.bones.head) {
    const halo = new THREE.Mesh(G.torus(0.42, 0.035, Math.PI * 2, 6, 32), mat(armor.rarity.hex, { emissive: armor.rarity.hex, ei: 2.2 }));
    halo.rotation.x = Math.PI / 2 - 0.15;
    halo.position.set(0, 1.55, -0.05);
    model.bones.head.add(halo);
    model.addons.push(halo);
  }

  // charm: a glowing gem orbiting the hero for epic and better
  const c = equipment.charm;
  if (c && c.rarity.tier >= 3) {
    const orb = new THREE.Mesh(G.octa(0.08), mat(c.rarity.hex, { emissive: c.rarity.hex, ei: 1.6 }));
    orb.scale.set(1, 1.4, 1);
    model.extras.add(orb);
    model.addons.push(orb);
    model.orbit = orb;
  }
}
