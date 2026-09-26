# Hack n Perfect

A 3D hack-n-slash roguelike that runs in the browser on **phones and PCs**. Fight down through
procedurally generated dungeons, collect loot, pick upgrades between floors, and take on a boss
every 5 floors.

Built with plain ES modules and [three.js](https://threejs.org) (vendored in `vendor/`), so there
is no build step.

## Play locally

```sh
npm start          # or: node serve.mjs 8080
```

Then open <http://localhost:8080>. To try it on a phone, open `http://<your-computer-ip>:8080` on
the same Wi-Fi network.

Any static file host works (GitHub Pages, Netlify, itch.io…). A GitHub Pages workflow is included
in `.github/workflows/pages.yml`. Turn it on under **Settings → Pages → Source: GitHub Actions**
and it deploys on every push to `main`.

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

### Skills (swipe directions)

- ↑ **Leap Slam**: jump onto the nearest enemy and smash the ground. Used in mid-air, you plunge straight down.
- → **Fire Bolt**: a homing fireball that explodes and sets enemies on fire.
- ↓ **Whirlwind**: spin and hit everything around you while you keep moving.
- ← **Frost Nova**: damage and freeze every enemy nearby.

## Gameplay

- **Clear the floor.** The portal opens once every monster on the floor is dead. The minimap marks
  enemies (red), elites (gold), chests and loot.
- **Loot.** Enemies, chests and pots drop gold, health potions and gear (weapon / armor / charm) in
  five rarities. Stand near an item to compare it with what you're wearing, then equip or salvage it.
- **Upgrades.** Each portal offers a choice of 3 blessings: stat boosts, extra dash charges, triple
  jump, split fire bolts, fire-trail dashes, stomp shockwaves, thorns, execute and more. Spend gold
  to fully heal or reroll the choices.
- **Enemies.** Goblins (melee), skeleton archers (ranged), ogres (ground slam: **jump over the
  shockwave**), wisps (fast and erratic), gold-ringed elites, and the **Dungeon Warden** boss
  every 5th floor.
- **Death is permanent.** Your best floor is saved in the browser.

## Code layout

| File              | Purpose                                                         |
| ----------------- | --------------------------------------------------------------- |
| `src/main.js`     | Renderer setup, main loop, menu wiring                          |
| `src/game.js`     | World state: combat, projectiles, loot, portal, camera          |
| `src/player.js`   | Player movement, combo, skills, stats                           |
| `src/enemies.js`  | Enemy archetypes, AI state machine, boss patterns               |
| `src/dungeon.js`  | Procedural rooms + corridors, collision, flow-field pathfinding |
| `src/items.js`    | Item generation, rarities, affixes, upgrade definitions         |
| `src/input.js`    | Keyboard / mouse / touch (joystick, swipe-to-skill)             |
| `src/ui.js`       | HUD, minimap, loot card, menus                                  |
| `src/effects.js`  | Particles, slashes, rings, damage numbers, screen shake         |
| `src/audio.js`    | Synthesized WebAudio sound effects                              |
