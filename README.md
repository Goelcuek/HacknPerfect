# Hack n Perfect

A 3D hack-n-slash roguelike that runs in the browser on **phones and PCs**. Fight down through
20 procedurally generated floors to the Hollow God, collect loot, pick upgrades between floors,
then keep going into the endless depths. Soul shards earned along the way buy permanent upgrades.

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

### PvP arena

When hosting, pick **⚔ PvP arena** instead of **🤝 Co-op dungeon** (under the PIN). Everyone
then fights everyone in one big arena room with a central dais, a balcony, corner perches,
pillars and cover:

- **Fair start:** every hero gets plain epic gear for their class and their first four skills at
  level 3. Soul Forge upgrades don't apply.
- **Deathmatch:** your attacks, skills and projectiles all hit the other players, and auto-aim
  targets them. Player-on-player damage is scaled to 35% so fights last a few exchanges; armour
  still counts and dashing still dodges. Unique powers that react to hits (Thornmail, Glacial
  Bulwark) work against players too.
- **Respawn:** a slain hero comes back after 3 seconds at the spawn spot farthest from everyone
  else, with full health and 2 seconds of protection.
- **Rounds:** first to **10 kills** wins. The scoreboard sits at the top of the screen, and a kill
  feed names who slew whom. A new round starts 7 seconds after a win.
- **Joining:** friends can join a running arena at any time, and barrels hold potions mid-fight.

Co-op rules:

- **Loot is per player:** every kill, chest, barrel, goblin and trial drops loot for each player
  separately, so nobody can grab everything; merchants, altars and freed prisoners are per player
  too.
- **Pings:** `G` marks what you're looking at (an enemy means **Attack!**, an item **Loot!**,
  otherwise **Here!**), `H` calls for **Help!**. On phones, tap 📍 under the minimap. Everyone sees a
  coloured marker in the world and on the minimap, plus a toast with your name.
- **More monsters, more loot:** +40% monsters per extra player (each with +40% health per extra
  player), a higher item and potion drop chance per extra player, and one extra item per chest.
- **See each other:** party members show on the minimap as coloured arrows (pinned to the edge
  when out of range), matching the colours in the party list and on their name tags.
- **Revive:** a downed player gets back up after a teammate stands next to them for 2.5 seconds.
  The run ends only when everyone is down.
- **Portal:** anyone who steps into the open portal and confirms takes the whole party to the next
  floor (everyone gets their own reward screen).
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
the orientation, so turn off the portrait lock and hold the phone sideways. (The game sizes itself
from the screen in this mode, because after a rotation iOS reports a viewport that's short by the
status bar's height, which used to leave a black strip along the bottom.)

## Classes

| Class     | Weapon          | Style                                                                 |
| --------- | --------------- | --------------------------------------------------------------------- |
| Knight    | Sword + shield  | Tough melee tank: 3-hit combo ending in a spinning slash              |
| Barbarian | Great axe       | Slow, sweeping two-handed blows, life steal, chains and war totems    |
| Ranger    | Crossbow        | Ranged and mobile: fast auto-aimed bolts that pierce, big 3rd shot    |
| Mage      | Staff           | Caster: homing arcane missiles that splash, huge area spells          |
| Rogue     | Twin daggers    | Fast crits: 4-hit dual-wield flurry and two dash charges              |

Pick a class on the character screen; the hero stands in the dungeon behind the menu so you can
see them before you start.

The classes are balanced with a bot that plays each one through the same fights (floor 1 with one
skill, floor 4 with two, floor 8 with four skills and epic gear, plus a single-target duel) and
measures damage per second and damage taken: every class clears about as fast early on, the two
casters lead at clearing crowds late, the Knight trades damage for toughness. Ranged heroes that
back away from a pack still shoot it: with nothing ahead, shots go to the nearest enemy.

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
| Equip loot / use | `F`                      | **Equip** on the loot card, **Trade** / **Pray** / **Begin** on event cards |
| Ping (co-op)  | `G` (smart ping), `H` (help) | 📍 under the minimap                    |
| Pause         | `Esc` / `P`                 | ❚❚ button                                |
| Music on/off  | `M`                         | **Music** in the pause menu              |

## Gameplay

- **20 floors, then the endless.** Every 5th floor is a throne: **The Bone King** (5), the
  burning **Infernal Colossus** (10), the frozen **Archlich Vael** (15) and **The Hollow God**
  (20). Kings rain meteors, and the Hollow God calls echoes of the den lords at two-thirds and
  one-third health. Killing the Hollow God wins the run: retire victorious or walk on into the
  **endless depths**. From floor 21 every floor adds a stacking curse, the same for everyone:
  Fortified, Bloodlust, Haste, Volatile (monsters explode), Elite Surge, Vampiric, Swarm, Arcane
  Storm (lightning hunts you) and Thick Skin. Monster health grows 16% and damage 9% per endless
  floor on top of that, while loot keeps pace and soul shards count double. The HUD shows the
  floor (`7/20`, then `23 ∞`) and the active curses.
- **Scaling.** Monsters get much tougher with depth, elites gain more affixes (up to four), and
  den lords past floor 8 (and every king) come with elite affixes of their own. New elite affixes:
  **Giant** (huge and tough) and **Splitting** (bursts into two). Gear power grows with the floor
  and keeps compounding past 20; damage numbers switch to `12.3k` / `4.5M`.
- **Legendary, Mythic and Primal loot.** Above Legendary there are **Mythic** (floor 8+, red) and
  **Primal** (floor 15+, cyan) items. Legendaries often, Mythics always and Primals twice over
  carry a **unique power** that changes how you play, and you can see it on your hero:
  - **Weapons:** Hellbrand (hits ignite; ember trail), Worldsplitter (a door-sized blade: +40%
    damage, +50% reach, every 3rd hit splits the earth), Stormcaller (chain lightning),
    Bloodthirster (kills heal), Winter's Bite (chill and freeze), Headsman's End (executes under
    20%) and Edge of Midas (triple gold, crits spray coins).
  - **Armour:** Infernal Plate (you burn and scorch everything near you), Glacial Bulwark (frost
    nova when hit), Thornmail (reflects 250%), Phoenix Mantle (rise from death once a floor),
    Titan's Shell (you grow 35% bigger, +60% health, landings quake) and Shadowshroud (dashing
    makes you shadow; the next hit deals triple damage).
  - **Charms:** Ring of Blades (orbiting blades), Heart of the Comet (meteor every 5 s), Dragon
    Hoard (gold heals), Chrono Sigil (skills sometimes come straight back), Wrath of Ages
    (stacking damage per kill) and Soul Lantern (kills release homing souls).
  Unique weapons are oversized and burn, crackle or drip with their element; unique and set armour
  makes the whole hero glow and shed flames, frost, shadow or thorns. Other players see it too.
- **Sets.** Green set pieces (epic and up, floor 3+) belong to one of five sets, each with a weapon,
  armour and charm. Two pieces give a bonus, three give a power: **Inferno Lord's** (ignite, then a
  burning aura and fire dashes), **Frost Tyrant's** (chill, then a frost nova every 6 s), **Storm
  Sovereign's** (attack speed, then lightning on crits), **Bonelord's** (health and life steal,
  then corpses explode) and **Giant-King's** (an enormous weapon, then you grow 40% and every blow
  quakes the ground). The loot card shows the unique power, the set bonuses and how many pieces
  you wear.
- **Floor events** (from floor 2, not on throne floors), marked on the minimap:
  - **Wandering merchant:** a showpiece (unique or set piece), two good items, an elixir and a
    mystery cache.
  - **Cursed altar:** pick one of two pacts for the floor, for example Blood (+60% damage, −35%
    health), Greed (triple gold and double loot, but you deal less damage), Haste, Glass or War (a
    legendary item now, and an elite warband with it).
  - **Treasure Goblin:** flees and escapes through a rift after 22 s; catch it for a pile of gold
    and a legendary item.
  - **Trial Shrine:** survive three waves for a treasure chest.
  - **Prisoner's cage:** break it and the freed hero fights at your side until the floor ends.
- **Soul Forge.** Soul shards come from elites, den lords, kings, goblins, trials, every cleared
  floor and victory, and you keep them when you die. Spend them on the title screen: Vigor, Might,
  Bulwark, Fleetfoot, Fortune, Treasure Hunter (rarer loot), Starting Purse, Armory (start with a
  rare or epic weapon), Second Wind (survive one killing blow per run) and Soul Siphon (more
  shards).
- **Low health warning.** Below 35% health the screen edges glow red, a heartbeat starts and the
  health bar pulses. Both beat faster and deeper as health runs out.
- **Slay the den's lord.** Every floor has a boss den, the big room farthest along, where the
  portal waits. Its lord guards it: the **Skeleton Warlord** (slams and charges), **The Lich**
  (orb volleys and hexes that erupt under you), the **Death Knight** (shielded, charges), **The
  Butcher** (relentless charges) or the **Shade Matriarch** (blinks behind you). Below half health
  they learn more tricks (summoning, novas). Killing the lord opens the portal and leaves a rich
  chest; the rest of the floor is optional. Stepping into the open portal asks before you go
  (**Enter** / `F`, or **Not yet**) and lists any unopened chests and items still on the ground,
  so you can't fall in before looting the room. Every 5th floor is a king's throne (above). The
  minimap marks enemies (red), elites (gold), bosses (purple), chests and loot; up on the map is
  the way the camera faces.
- **Every floor is a different place.** Forgotten Crypt, Flooded Catacombs, Ember Halls, Bone
  Ossuary, Fungal Grotto, Frozen Vault, Blood Temple, Void Sanctum, Sunken Library and Gilded
  Treasury, one per floor, each with its own palette, fog, light, candles and torches, wall details,
  furniture and the monsters it favours. Corridors are 6 m wide.
- **Loot shows on your hero.** Weapons, armor and charms drop in seven rarities (plus set pieces) with random affixes.
  Better weapons swap to bigger models (a two-handed greatsword for knights) and glow with their
  rarity; armor swaps the knight's shield, adds helmets, hats, spellbooks and capes dyed in the
  armor's rarity colour; epic+ charms orbit a gem around you and legendary armor crowns you with a
  halo. Legendary weapons shed sparks.
- **Combos.** Hits within 2.5s chain into a combo; every 10 hits adds 2.5% damage (up to +25%).
- **Chests, barrels and crates.** Chests open when you walk up to them; barrels and crates burst
  into gold and potions when hit. From floor 2 some chests are **Mimics** that lunge when you get
  close (they drop great loot).
- **Platforms and stairs.** Most rooms have raised floor, one jump (1.2 m) or a double jump
  (2.4 m) high, reached by flights of stairs: balconies running along a whole wall, a dais in the
  middle of big rooms (stairs on all four sides), and platforms tucked into corners. Skeleton archers and mages like to
  shoot from up there; melee skeletons have to take the stairs, and nothing climbs a ledge but
  you. Shots aim up or down at their target, melee and ground attacks only reach the level they
  land on, and shockwaves don't travel up or down a ledge. Getting knocked off a platform drops
  you (or a skeleton) to the floor below. The minimap shows raised floor lighter and stairs gold.
- **Spike traps.** Floor tiles rattle, then fire spikes. They hurt enemies too.
- **Shrine.** Between floors, spend gold on stat blessings (damage, attack speed, extra dash
  charge, triple jump, blazing dash, thorns…), a full heal, or a reroll of the skill choices.
- **Enemies.** An undead warband: Skeleton Minions (melee), Skeleton Rogues (crossbows), Skeleton
  Warriors (axe slam: **jump over the shockwave**), Skeleton Mages (orb volleys, and they **raise
  fallen skeletons** or claw new ones out of the floor) and wisps, joined deeper down by **Bone
  Bombers** (a barrel on their back: they stop, flash and explode, skeletons included), **Fallen
  Knights** (their shield blocks 60% from the front: flank them or catch them mid-swing), **Fallen
  Barbarians** (charge in a straight line from range), **Cultist Warlocks** (hex the ground under
  you; move!) and **Shades** (vanish and stab you from behind). Some skeletons lie in wait as bone
  piles and rise when you come close. Enemies can be burned, poisoned, bled, slowed, frozen,
  stunned or dazed.
- **Elites** carry one or two affixes, shown in their name tag: Swift, Vampiric (heals when it hits
  you), Explosive (detonates after death), Shielded (a bubble soaks damage), Frenzied (attacks
  faster) and Arcane (sprays orbs).
- **Runs are saved.** A solo run saves itself every couple of seconds and whenever you leave the
  app or close the tab. The title screen then offers **Continue**: same floor and layout, the
  monsters you killed stay dead, opened chests stay open, and you stand where you left off with
  your gear, skills, blessings, gold and health (closing on a reward screen reopens it).
  **Save & quit** is in the pause menu; **Abandon run** throws the save away.
- **Death is permanent.** Dying ends the run and deletes its save. Your best floor and your soul
  shards are kept.

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

Every setting also lowers its render resolution automatically (in 0.25 steps) when frames
start missing their slot, so a slow device drops a little sharpness instead of frame rate. The
High shadows are snapped to whole shadow-map texels, so their edges don't crawl while you walk.

Performance notes:

- **60 fps cap with even pacing.** The game measures the screen's refresh rate and draws on
  every Nth refresh: 60 fps on 60/120/240 Hz screens, an even 45/72/55 fps on 90/144/165 Hz
  ones (60 fps there would mean alternating short and long frames, which looks like stutter).
- **FPS meter.** *FPS: on* on the title screen or in the pause menu (or `?fps` in the URL) shows
  the frame rate, the worst frame and hitches of the last 2 s, a frame-time graph, the screen's
  refresh rate and the current resolution scale.
- **Dynamic resolution** reacts to missed frames (more than 1 in 12), not just a low average,
  and can go down to 0.75× on every setting.
- **No first-hit hitch.** Shaders compile, and Metal/Vulkan build their pipelines, the first time
  a material is drawn. On each floor load the game keeps one hidden mesh per material setup that
  effects, projectiles, zones, loot and enemy health bars use, compiles them all and draws them
  once into a single pixel, so the first hit, kill or skill of a run doesn't freeze a frame.
- **Draw less.** The camera stops at the fog (50 m), and level detail is merged in 16 m chunks
  so off-screen parts are skipped: about half the draw calls and a third fewer triangles.
  Medium uses 2 real torch lights (High 4, Low 1); every torch still glows.
- **Think less.** Monsters out of sight and far from every player update at 20 Hz, and the HUD
  only touches the page when a value changes. Particles and damage numbers are recycled instead
  of created per hit (less garbage collection, so fewer hitches).

## Soundtrack

An original score in the spirit of the old RuneScape tunes: harp arpeggios, flute, oboe and
brass melodies over string or choir pads, pizzicato bass and timpani, in a hall reverb. Nothing
is recorded. Every track is synthesized live with WebAudio from a short recipe (key, mode,
tempo, chord progression, instruments, drum pattern), and a seeded melody writer composes each
tune as a 16-bar AABA loop. That keeps the download at zero bytes.

- **Title theme:** a calm F-major harp-and-flute piece.
- **One tune per floor setting,** each in its own key, mode and tempo. For example:
  - Forgotten Crypt: D Dorian with an oboe.
  - Flooded Catacombs: a slow flute over a choir.
  - Ember Halls: Phrygian brass with tribal drums.
  - Fungal Grotto: a Lydian glockenspiel.
  - Blood Temple: Phrygian dominant with heavy timpani.
  - Gilded Treasury: a festive Mixolydian march.
- **Boss music:** a den boss waking up switches to a driving harmonic-minor battle theme. The
  Bone King's throne on every fifth floor has its own theme.
- **Jingles:** a short fanfare plays when a floor's portal opens and a harp lament when you fall.
  The pause menu turns the music down.
- **On/off:** *Music: on/off* on the title screen or in the pause menu (or `M`) is separate from
  *Sound* (effects). Both choices are remembered.

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
| `src/music.js`    | Synthesized soundtrack: instruments, melody writer, scheduler   |
| `src/legend.js`   | Unique powers, sets, gear looks and the powers runtime (procs)  |
| `src/gameplay.js` | Run features: soul forge, events, trials, allies, victory, pings |
| `src/events.js`   | Merchant, cursed altar, trial shrine, freed-prisoner allies     |
| `src/endless.js`  | Endless-depths curses (stacking floor modifiers)                |
| `src/meta.js`     | Soul Forge: shards and permanent upgrades (localStorage)        |
| `src/pvp.js`      | PvP arena: rival targets, hits between players, respawns, score |
| `assets/models/`  | Optimised KayKit characters, animation library, gear and props  |
| `tools/build-assets.mjs` | Rebuilds `assets/models/` from the KayKit packs          |

## Credits

Characters, animations, weapons and dungeon props: **KayKit** Adventurers, Skeletons, Dungeon
Remastered and Halloween Bits packs by [Kay Lousberg](https://kaylousberg.com), CC0 (see
`assets/LICENSE-KayKit.txt`). Rendering: [three.js](https://threejs.org) (MIT). Networking:
[PeerJS](https://peerjs.com) (MIT).
