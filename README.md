# Hack n Perfect

A 3D hack-n-slash roguelike that runs in the browser on **phones and PCs**. Fight down through
procedurally generated dungeons, collect loot, pick upgrades between floors, and take on a boss
every 5 floors.

Built with plain ES modules and [three.js](https://threejs.org) (vendored in `vendor/`, including
the bloom, glTF and geometry-merging addons), so there is no build step. Heroes, monsters, weapons
and dungeon props are rigged and animated models from the CC0 [KayKit](https://kaylousberg.com)
packs by Kay Lousberg (see [Credits](#credits)).

## Play locally

```sh
npm start          # or: node serve.mjs 8080
```

Then open <http://localhost:8080>. To try it on a phone, open `http://<your-computer-ip>:8080` on
the same Wi-Fi network.

Any static file host works (GitHub Pages, Netlify, itch.io…). A GitHub Pages workflow is included
in `.github/workflows/pages.yml`. Turn it on under **Settings → Pages → Source: GitHub Actions**
and it deploys on every push to `main`.

## Multiplayer (co-op, up to 4 players)

1. **Host:** on the title screen choose **Multiplayer → Host a game**. You get a 6-digit **PIN**.
   Share it, then choose your hero and enter the dungeon.
2. **Friends:** **Multiplayer → Join a game**, type the PIN, pick a hero. They drop in next to the
   host on the host's current floor (with one skill pick per floor they missed), and can join at
   any time during the run.

How it works: players connect directly to each other with WebRTC ([PeerJS](https://peerjs.com)).
The free PeerJS cloud server is only used to find the host by its PIN; if a network blocks direct
connections, PeerJS's TURN servers relay the traffic. The host's game is the authority for the
dungeon, the monsters, the portal and floor changes; every player moves and fights with their own
hero locally (so controls feel instant) and sends hits to the host. Skills, projectiles, ground
effects and animations are mirrored on everyone's screen.

Co-op rules:

- **Loot is per player:** every kill, chest and barrel drops loot for each player separately.
- **More monsters, more loot:** +40% monsters per extra player (each with +40% health per extra
  player), a higher item and potion drop chance per extra player, and one extra item per chest.
- **See each other:** party members show on the minimap as coloured arrows (pinned to the edge
  when out of range), matching the colours in the party list and on their name tags.
- **Revive:** a downed player gets back up after a teammate stands next to them for 2.5 seconds.
  The run ends only when everyone is down.
- **Portal:** anyone stepping into the open portal takes the whole party to the next floor
  (everyone gets their own reward screen).
- **No pause:** the dungeon keeps running while you are in a menu (you can't be hit meanwhile).

Notes: the host should keep the game in the foreground (browsers throttle background tabs, which
freezes the world for everyone). To use your own signalling server instead of the PeerJS cloud,
run `npx peer --port 9000` and open the game with `?signal=your-server:9000` (add `&secure=1`
for HTTPS).

## Android APK

`android/` is a small native app that runs the game full-screen in a WebView, locked to
landscape, with the game files bundled inside (it plays offline). The **Build Android APK**
workflow (`.github/workflows/android.yml`) builds it on every push and publishes
`HacknPerfect.apk` as the **apk-latest** release. Open that release on your phone, download the
APK and install it (allow installs from your browser when Android asks). The back button
pauses/resumes a run and closes the app from the menus.

Builds are signed with the bundled `android/sideload.keystore`, so each new APK installs over the
previous one. To use a private key instead, add the repo secrets `KEYSTORE_BASE64`,
`KEYSTORE_PASSWORD`, `KEY_ALIAS` and `KEY_PASSWORD` (a new key means uninstalling the old APK once).

To build locally (needs JDK 17 and the Android SDK):

```sh
android/sync-web.sh                         # copy the game into the APK assets
cd android && ./gradlew assembleRelease     # → app/build/outputs/apk/release/app-release.apk
```

## iPhone / iPad

Apple only allows native apps from the App Store (or signed with a developer account), so the
simplest way on iOS is the web version installed as an app: open the GitHub Pages link in
**Safari**, tap **Share → Add to Home Screen**. It gets the game's icon and runs full screen
without Safari's bars, and multiplayer and run saving work the same. iOS doesn't let web apps lock
the orientation, so turn off the portrait lock and hold the phone sideways.

## Classes

| Class     | Weapon          | Style                                                                 |
| --------- | --------------- | --------------------------------------------------------------------- |
| Knight    | Sword + shield  | Tough melee tank: 3-hit combo ending in a spinning slash              |
| Barbarian | Great axe       | Slow, sweeping two-handed blows, life steal, chains and war totems    |
| Ranger    | Crossbow        | Ranged and mobile: auto-aimed bolts, every 3rd shot pierces           |
| Mage      | Staff           | Caster: homing arcane missiles, stronger and faster-recharging skills |
| Rogue     | Twin daggers    | Fast crits: 4-hit dual-wield flurry and two dash charges              |

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
| Barbarian | Cleave, Axe Throw (returns to you), Earthshaker, Berserk, Chain Hook, War Totem   |
| Ranger | Multishot, Arrow Rain, Piercing Shot, Evasive Vault, Blast Trap, Hunter's Focus      |
| Mage   | Fire Bolt, Frost Nova, Chain Lightning, Meteor, Blink, Arcane Orb                    |
| Rogue  | Shadow Step, Fan of Knives, Venom Cloud, Blade Flurry, Smoke Bomb, Assassinate       |

Skills fill the swipe directions in order: first ↑ (`Q`), then → (`E`), ↓ (`R`), ← (`C`).

### Evolutions

Once a skill reaches level 5, later rewards can offer its **evolution** (gold ✦ cards). An evolved
skill is far stronger and gains new effects:

| Class  | Evolutions                                                                                                  |
| ------ | ----------------------------------------------------------------------------------------------------------- |
| Knight | Cataclysm, Blade Tempest, Juggernaut, Avatar of War, Divine Bulwark, World Splitter                         |
| Barbarian | Executioner, Twin Tempest, Tectonic Fury, Blood God, Maelstrom, Ancestral Spirits                        |
| Ranger | Storm of Arrows, Arrow Monsoon, Dragon Lance, Phantom Vault, Minefield, Eagle Eye                           |
| Mage   | Inferno Barrage, Absolute Zero, Thunder God, Armageddon, Rift Walk, Singularity                             |
| Rogue  | Death's Dance, Blade Storm, Plague, Thousand Cuts, Shadow Realm, Reaper                                     |

Examples: Cataclysm adds aftershock quake rings and burning ground; Thunder God calls lightning
from the sky; Singularity drags enemies into the orb; Arrow Monsoon follows you around; Reaper
chains dashes between targets.

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

- **Clear the floor.** The portal opens once every awake monster on the floor is dead. The minimap
  marks enemies (red), elites (gold), chests and loot; up on the map is the way the camera faces.
- **Loot shows on your hero.** Weapons, armor and charms drop in five rarities with random affixes.
  Better weapons swap to bigger models (a two-handed greatsword for knights) and glow with their
  rarity; armor swaps the knight's shield, adds helmets, hats, spellbooks and capes dyed in the
  armor's rarity colour; epic+ charms orbit a gem around you and legendary armor crowns you with a
  halo. Legendary weapons shed sparks.
- **Combos.** Hits within 2.5s chain into a combo; every 10 hits adds 2.5% damage (up to +25%).
- **Chests, barrels and crates.** Chests open when you walk up to them; barrels and crates burst
  into gold and potions when hit. From floor 2 some chests are **Mimics** that lunge when you get
  close (they drop great loot).
- **Spike traps.** Floor tiles rattle, then fire spikes. They hurt enemies too.
- **Shrine.** Between floors, spend gold on stat blessings (damage, attack speed, extra dash
  charge, triple jump, blazing dash, thorns…), a full heal, or a reroll of the skill choices.
- **Enemies.** An undead warband: Skeleton Minions (melee), Skeleton Rogues (crossbows), Skeleton
  Warriors (axe slam: **jump over the shockwave**), Skeleton Mages (orb volleys, and they **raise
  fallen skeletons** or claw new ones out of the floor), wisps, and **The Bone King** every 5th
  floor. Some skeletons lie in wait as bone piles and rise when you come close. Enemies can be
  burned, poisoned, bled, slowed, frozen, stunned or dazed.
- **Elites** carry one or two affixes, shown in their name tag: Swift, Vampiric (heals when it hits
  you), Explosive (detonates after death), Shielded (a bubble soaks damage), Frenzied (attacks
  faster) and Arcane (sprays orbs).
- **Runs are saved.** A solo run saves itself every couple of seconds and whenever you leave the
  app or close the tab. The title screen then offers **Continue**: same floor and layout, the
  monsters you killed stay dead, opened chests stay open, and you stand where you left off with
  your gear, skills, blessings, gold and health (closing on a reward screen reopens it).
  **Save & quit** is in the pause menu; **Abandon run** throws the save away.
- **Death is permanent.** Dying ends the run and deletes its save. Your best floor is kept.

## Graphics

Heroes and monsters are rigged KayKit models sharing one 41-bone skeleton, driven by a shared
library of 72 animation clips (`src/animator.js`): speed-matched idle / walk / run blends,
combat idles, jumps and landings, dodges, hit reactions, deaths, spellcasting, and weapon strikes
timed so each clip's impact frame lands exactly when the damage does. While running, attacks play
on the upper body only so the legs keep moving. On top of the clips sit procedural layers: head
tracking, leaning into turns and acceleration, flips, squash on landing. Each monster's parts and
weapons are baked into a single skinned mesh (one draw call).

Stone, brick, wood and rug textures with normal maps are generated on startup, and each floor is
dressed with themed detail, mixing KayKit props (tables, barrels, kegs, coffins, graves, shrines,
treasure, beds, bones, candles) with procedural ones — plinths,
cornices, pilasters and door columns, banners, bookshelves, skull niches, chains, cobwebs, moss and
vines, lava cracks, crystals, statues, sarcophagi, altars, braziers, forges, barrels and crates,
flickering torch and candle flames, drifting dust/spores/embers and light shafts.

Walls are built stone by stone: uneven capstones, jutting blocks, corner quoins, timber framing,
with world-space texturing, baked ambient occlusion where walls meet the floor, soot above torches
and grime. The procedural jointed rig (`src/rig.js`) is still used for effects and the wisp.

Use **Graphics** on the title or pause screen to switch quality:

| Setting | Effects                                  | Default on     |
| ------- | ---------------------------------------- | -------------- |
| Low     | No bloom or shadows, less clutter        |                |
| Medium  | Bloom, 4x MSAA, ambient particles        | Phones/tablets |
| High    | Bloom, 4x MSAA, shadows, full detail     | Desktop        |

## Code layout

| File              | Purpose                                                         |
| ----------------- | --------------------------------------------------------------- |
| `src/main.js`     | Renderer setup, main loop, menu flow                            |
| `src/game.js`     | World state: combat, projectiles, zones, loot, portal, camera, run flow |
| `src/classes.js`  | Class definitions: stats, weapon, skill pool                    |
| `src/skills.js`   | The 30 class skills, their per-level scaling and evolutions     |
| `src/player.js`   | Player movement, basic attacks, skills, buffs, animation layer  |
| `src/assets.js`   | Loads the KayKit models/animations; cloning, merging, lid hinges |
| `src/animator.js` | Layered clip blending: locomotion base + full/upper-body overlays |
| `src/model.js`    | A rigged character instance: pivot, flashes, tints, weapon tips |
| `src/hero.js`     | Picks each class's model and dresses it from equipment          |
| `src/gear.js`     | Loot drop models (and procedural fallback weapons)              |
| `src/enemies.js`  | Skeleton warband + mimic + wisp: animation, affixes, AI, boss   |
| `src/rig.js`      | Geometry/material helpers and the procedural rig                |
| `src/dungeon.js`  | Procedural rooms + corridors, prop placement, collision, pathfinding |
| `src/decor.js`    | Environment dressing: walls, props, clutter, fire, glow, particles |
| `src/textures.js` | Procedural albedo / normal / roughness textures                 |
| `src/tiles.js`    | Tile constants and dungeon themes                               |
| `src/items.js`    | Item generation, rarities, affixes, shrine blessings            |
| `src/input.js`    | Keyboard / mouse / touch (joystick, swipe-to-skill)             |
| `src/ui.js`       | HUD, minimap, loot card, class select, skill picks, menus       |
| `src/save.js`     | Mid-run save / resume (localStorage)                            |
| `src/net.js`      | Multiplayer: PIN hosting/joining, protocol, enemy sync, revive  |
| `src/remote.js`   | Other players' heroes, interpolated and animated from the network |
| `src/effects.js`  | Particles, slashes, rings, lightning, meteors, damage numbers   |
| `src/audio.js`    | Synthesized WebAudio sound effects                              |
| `assets/models/`  | Optimised KayKit characters, animation library, gear and props  |
| `tools/build-assets.mjs` | Rebuilds `assets/models/` from the KayKit packs          |

## Credits

Characters, animations, weapons and dungeon props: **KayKit** Adventurers, Skeletons, Dungeon
Remastered and Halloween Bits packs by [Kay Lousberg](https://kaylousberg.com), CC0 (see
`assets/LICENSE-KayKit.txt`). Rendering: [three.js](https://threejs.org) (MIT). Networking:
[PeerJS](https://peerjs.com) (MIT).
