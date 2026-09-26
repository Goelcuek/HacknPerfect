# Hack n Perfect

A 3D hack-n-slash roguelike that runs in the browser on **phones and PCs**. Fight down through
procedurally generated dungeons, collect loot, pick upgrades between floors, and take on a boss
every 5 floors.

Built with plain ES modules and [three.js](https://threejs.org) (vendored in `vendor/`, including
the bloom and geometry-merging addons), so there is no build step.

## Play locally

```sh
npm start          # or: node serve.mjs 8080
```

Then open <http://localhost:8080>. To try it on a phone, open `http://<your-computer-ip>:8080` on
the same Wi-Fi network.

Any static file host works (GitHub Pages, Netlify, itch.io…). A GitHub Pages workflow is included
in `.github/workflows/pages.yml`. Turn it on under **Settings → Pages → Source: GitHub Actions**
and it deploys on every push to `main`.

## Classes

| Class  | Weapon          | Style                                                             |
| ------ | --------------- | ----------------------------------------------------------------- |
| Knight | Sword + shield  | Tough melee bruiser: 3-hit combo ending in a spinning slash        |
| Ranger | Bow             | Ranged and mobile: auto-aimed arrows, every 3rd shot pierces       |
| Mage   | Staff           | Caster: homing arcane missiles, stronger and faster-recharging skills |
| Rogue  | Twin daggers    | Fast crits: 4-hit stab flurry and two dash charges                 |

Pick a class on the character screen; the hero stands in the dungeon behind the menu so you can
see them before you start.

## Skills

Every run starts with **no skills**. Before floor 1 you choose one from your class's pool of six.
After each floor you pick one reward: **learn a new skill** (while one of the 4 swipe directions
is free) or **level up a skill you own** (up to level 5; levels add damage, radius, projectiles,
duration or extra effects).

| Class  | Skill pool                                                                           |
| ------ | ------------------------------------------------------------------------------------ |
| Knight | Leap Slam, Whirlwind, Shield Charge, War Cry, Holy Aegis, Earthsplitter              |
| Ranger | Multishot, Arrow Rain, Piercing Shot, Evasive Vault, Blast Trap, Hunter's Focus      |
| Mage   | Fire Bolt, Frost Nova, Chain Lightning, Meteor, Blink, Arcane Orb                    |
| Rogue  | Shadow Step, Fan of Knives, Venom Cloud, Blade Flurry, Smoke Bomb, Assassinate       |

Skills fill the swipe directions in order: first ↑ (`Q`), then → (`E`), ↓ (`R`), ← (`C`).

## Controls

| Action        | PC                          | Mobile                                   |
| ------------- | --------------------------- | ---------------------------------------- |
| Move          | `WASD` / arrows             | Drag anywhere on the left side           |
| Camera        | Mouse (click to lock)       | Drag on the right side                   |
| Jump / double | `Space` (press again in air) | **JUMP** button                          |
| Dash          | `Shift`                     | **DASH** button                          |
| Attack combo  | Left click / `J` (hold to chain) | Tap / hold **⚔**                     |
| Skills        | `Q` `E` `R` `C` (or `1`–`4`) | **Swipe from ⚔** ↑ → ↓ ← (or tap the icon) |
| Equip loot    | `F`                         | **Equip** on the loot card               |
| Pause         | `Esc` / `P`                 | ❚❚ button                                |

## Gameplay

- **Clear the floor.** The portal opens once every monster on the floor is dead. The minimap marks
  enemies (red), elites (gold), chests and loot.
- **Loot shows on your hero.** Weapons, armor and charms drop in five rarities with random affixes.
  Weapons change shape by variant and gain gold trim, glowing fullers and gems at higher rarities;
  armor adds helmets/hoods/hats, pauldrons, bracers, greaves and capes by tier and tints your
  outfit; charms add an amulet, and epic+ charms orbit a gem around you. Legendary weapons shed sparks.
- **Shrine.** Between floors, spend gold on stat blessings (damage, attack speed, extra dash
  charge, triple jump, blazing dash, thorns…), a full heal, or a reroll of the skill choices.
- **Enemies.** Goblins (melee), skeleton archers (ranged), ogres (ground slam: **jump over the
  shockwave**), wisps (fast and erratic), gold-ringed elites, and the **Dungeon Warden** boss
  every 5th floor. Enemies can be burned, poisoned, slowed, frozen, stunned or dazed.
- **Death is permanent.** Your best floor is saved in the browser.

## Graphics

Everything is procedural (no image or model files): stone, brick, wood and rug textures with
normal maps are generated on startup, and each floor is dressed with themed detail — plinths,
cornices, pilasters and door columns, banners, bookshelves, skull niches, chains, cobwebs, moss and
vines, lava cracks, crystals, statues, sarcophagi, altars, braziers, forges, barrels and crates,
flickering torch and candle flames, drifting dust/spores/embers and light shafts.

Characters use a jointed rig driven by damped springs: stride-matched walk/run cycles, weight
shift, breathing, blinking, head tracking, lean into turns and acceleration, landing squash,
idle fidgets per class, cape physics and weapon swing trails.

Use **Graphics** on the title or pause screen to switch quality:

| Setting | Effects                                  | Default on     |
| ------- | ---------------------------------------- | -------------- |
| Low     | No bloom or shadows, less clutter        |                |
| Medium  | Bloom, ambient particles                 | Phones/tablets |
| High    | Bloom, real-time shadows, full detail    | Desktop        |

## Code layout

| File              | Purpose                                                         |
| ----------------- | --------------------------------------------------------------- |
| `src/main.js`     | Renderer setup, main loop, menu flow                            |
| `src/game.js`     | World state: combat, projectiles, zones, loot, portal, camera, run flow |
| `src/classes.js`  | Class definitions: stats, palette, weapon, skill pool           |
| `src/skills.js`   | The 24 class skills and their per-level scaling                 |
| `src/player.js`   | Player movement, basic attacks, skills, buffs, pose animation   |
| `src/rig.js`      | Jointed humanoid rig, geometry/material helpers, pose blending  |
| `src/hero.js`     | Builds each class's hero and dresses it from equipment          |
| `src/gear.js`     | Weapon models (sword, bow, staff, daggers) and loot drop models |
| `src/enemies.js`  | Enemy models, animation, status effects, AI, boss patterns      |
| `src/dungeon.js`  | Procedural rooms + corridors, prop placement, collision, pathfinding |
| `src/decor.js`    | Environment dressing: walls, props, clutter, fire, glow, particles |
| `src/textures.js` | Procedural albedo / normal / roughness textures                 |
| `src/tiles.js`    | Tile constants and dungeon themes                               |
| `src/items.js`    | Item generation, rarities, affixes, shrine blessings            |
| `src/input.js`    | Keyboard / mouse / touch (joystick, swipe-to-skill)             |
| `src/ui.js`       | HUD, minimap, loot card, class select, skill picks, menus       |
| `src/effects.js`  | Particles, slashes, rings, lightning, meteors, damage numbers   |
| `src/audio.js`    | Synthesized WebAudio sound effects                              |
