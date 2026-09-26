// DOM HUD, touch-control visuals, menus, loot card and minimap.

import { SKILLS } from './player.js';
import { formatStats, SLOTS, SLOT_ICON, STAT_LABELS } from './items.js';
import { TILE } from './dungeon.js';
import { sfx, setMuted, isMuted } from './audio.js';

const $ = (id) => document.getElementById(id);
const PC_KEYS = ['Q', 'E', 'R', 'C'];
const DIR_ARROWS = ['↑', '→', '↓', '←'];

export class UI {
  constructor() {
    this.hud = $('hud');
    this.toastEl = $('toast');
    this.toastTimer = 0;
    this.mm = $('minimap');
    this.mmCtx = this.mm.getContext('2d');
    this.mmTimer = 0;
    this.itemShown = null;

    // desktop skill bar
    const bar = $('skillbar');
    this.pcSkills = SKILLS.map((s, i) => {
      const el = document.createElement('div');
      el.className = 'skillslot';
      el.title = `${s.name} — ${s.desc}`;
      el.innerHTML = `<span>${s.icon}</span><div class="cd"></div><div class="cdnum"></div><kbd>${PC_KEYS[i]}</kbd>`;
      bar.appendChild(el);
      return { el, cd: el.querySelector('.cd'), num: el.querySelector('.cdnum') };
    });
    // touch skills around the attack button
    this.touchSkills = [...document.querySelectorAll('.tskill')].map((el) => {
      const i = +el.dataset.dir;
      el.innerHTML = `<span>${SKILLS[i].icon}</span><div class="cd"></div>`;
      return { el, cd: el.querySelector('.cd') };
    });
    this.joyBase = $('joyBase');
    this.joyKnob = $('joyKnob');
    this.dashPips = $('dashPips');
  }

  setTouch(on) {
    document.body.classList.toggle('touch', on);
  }

  show(id) {
    $(id).classList.remove('hidden');
  }
  hide(id) {
    $(id).classList.add('hidden');
  }

  showTitle(best) {
    this.hud.classList.add('hidden');
    for (const id of ['upgrade', 'pause', 'death']) this.hide(id);
    this.show('title');
    document.body.classList.remove('playing');
    $('bestText').textContent = best && best.floor ? `Best: floor ${best.floor} · ${best.kills} kills` : '';
  }

  showHUD() {
    this.hide('title');
    this.hide('death');
    this.hud.classList.remove('hidden');
    document.body.classList.add('playing');
  }

  toast(text, secs = 2, color = null) {
    this.toastEl.textContent = text;
    this.toastEl.style.color = color || '';
    this.toastEl.classList.add('show');
    this.toastTimer = secs;
  }

  flashDamage() {
    const f = $('damageFlash');
    f.style.transition = 'none';
    f.style.opacity = '1';
    requestAnimationFrame(() => {
      f.style.transition = 'opacity 0.4s';
      f.style.opacity = '0';
    });
  }

  // ------------------------------------------------------------ per frame
  update(dt, game, input) {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
    const p = game.player;
    if (!p) return;
    const f = p.final;
    $('hpFill').style.width = `${(100 * Math.max(0, p.hp)) / f.maxHp}%`;
    $('hpText').textContent = `${Math.ceil(Math.max(0, p.hp))} / ${f.maxHp}`;
    $('floorText').textContent = `Floor ${game.floor}`;
    $('goldText').textContent = `💰 ${p.gold}`;
    $('enemyText').textContent = game.floorCleared ? '✦ Portal open' : `👹 ${game.enemies.length}`;

    // dash pips
    const max = p.mods.dashCharges;
    if (this.dashPips.childElementCount !== max) this.dashPips.innerHTML = '<i></i>'.repeat(max);
    [...this.dashPips.children].forEach((el, i) => el.classList.toggle('empty', i >= p.dashCharges));

    // skill cooldowns
    for (let i = 0; i < 4; i++) {
      const total = SKILLS[i].cd * (1 - f.cdr);
      const k = p.cooldowns[i] / total;
      const pc = this.pcSkills[i];
      pc.cd.style.height = `${k * 100}%`;
      pc.num.textContent = p.cooldowns[i] > 0 ? Math.ceil(p.cooldowns[i]) : '';
      const ts = this.touchSkills[i];
      ts.cd.style.height = `${k * 100}%`;
      ts.el.classList.toggle('ready', k <= 0);
      ts.el.classList.toggle('sel', input.attackSwipeDir === i);
    }

    // joystick visual
    if (input.isTouch && input.joy) {
      this.joyBase.style.display = 'block';
      this.joyBase.style.left = `${input.joy.ox}px`;
      this.joyBase.style.top = `${input.joy.oy}px`;
      let dx = input.joy.x - input.joy.ox;
      let dy = input.joy.y - input.joy.oy;
      const m = Math.hypot(dx, dy);
      if (m > 55) {
        dx = (dx / m) * 55;
        dy = (dy / m) * 55;
      }
      this.joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    } else this.joyBase.style.display = 'none';
    $('attackBtn').classList.toggle('active', !!input.attackTouch);

    // boss bar
    const b = game.boss;
    if (b && b.alive && b.aggro) {
      this.show('bossbar');
      $('bossFill').style.width = `${(100 * b.hp) / b.maxHp}%`;
    } else this.hide('bossbar');

    this.mmTimer -= dt;
    if (this.mmTimer <= 0) {
      this.mmTimer = 0.1;
      this.drawMinimap(game);
    }
  }

  // --------------------------------------------------------------- minimap
  drawMinimap(game) {
    const dg = game.dungeon;
    const p = game.player;
    const ctx = this.mmCtx;
    const W = this.mm.width;
    ctx.clearRect(0, 0, W, W);
    const view = 34; // tiles across
    const s = W / view;
    const ptx = p.x / 2;
    const ptz = p.z / 2;
    const x0 = Math.floor(ptx - view / 2);
    const z0 = Math.floor(ptz - view / 2);
    // map is drawn so that "up" on the minimap is the camera's forward direction
    ctx.save();
    ctx.translate(W / 2, W / 2);
    ctx.rotate(Math.PI + game.cam.yaw);
    ctx.scale(-1, 1);
    ctx.translate(-W / 2, -W / 2);
    for (let z = z0 - 8; z < z0 + view + 8; z++)
      for (let x = x0 - 8; x < x0 + view + 8; x++) {
        if (x < 0 || z < 0 || x >= dg.w || z >= dg.h) continue;
        if (!dg.seen[z * dg.w + x]) continue;
        const t = dg.get(x, z);
        if (t === TILE.WALL) continue;
        ctx.fillStyle = t === TILE.FLOOR ? 'rgba(170,180,210,0.55)' : t === TILE.BLOCK ? 'rgba(160,120,80,0.8)' : 'rgba(90,90,110,0.9)';
        ctx.fillRect((x - ptx) * s + W / 2, (z - ptz) * s + W / 2, s + 0.5, s + 0.5);
      }
    const dot = (wx, wz, color, r) => {
      const x = (wx / 2 - ptx) * s + W / 2;
      const y = (wz / 2 - ptz) * s + W / 2;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    const seenAt = (wx, wz) => dg.seen[Math.floor(wz / 2) * dg.w + Math.floor(wx / 2)];
    for (const c of game.chests) if (!c.open && seenAt(c.x, c.z)) dot(c.x, c.z, '#ffd34d', 3);
    for (const pk of game.pickups) if (pk.kind === 'item') dot(pk.x, pk.z, pk.item.rarity.color, 2.5);
    for (const e of game.enemies) if (e.aggro || seenAt(e.x, e.z)) dot(e.x, e.z, e.def.boss ? '#c04dff' : e.elite ? '#ffc94a' : '#ff4a4a', e.def.boss ? 5 : 2.5);
    const pt = game.portal;
    if (seenAt(pt.x, pt.z) || game.floorCleared) dot(pt.x, pt.z, pt.active ? '#b18cff' : '#666', 5);
    ctx.restore();
    // player arrow (always pointing up = camera forward)
    ctx.save();
    ctx.translate(W / 2, W / 2);
    ctx.rotate(game.cam.yaw - p.heading);
    ctx.fillStyle = '#7fe0ff';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------------------- item card
  setItemCard(item, equipped) {
    if (item === this.itemShown && equipped === this.itemEquipped) return;
    this.itemShown = item;
    this.itemEquipped = equipped;
    const card = $('itemcard');
    if (!item) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');
    card.style.borderColor = item.rarity.color;
    $('itemHeader').innerHTML = `<span style="color:${item.rarity.color}">${SLOT_ICON[item.slot]} ${item.name}</span><small>${item.rarity.name} ${item.slot} · floor ${item.level}${equipped ? ` · vs ${equipped.name}` : ' · slot empty'}</small>`;
    $('itemCompare').innerHTML = formatStats(item, equipped || { stats: {} })
      .map((l) => `<div><span>${l.label}</span><span class="${l.cls}">${l.value}</span></div>`)
      .join('');
  }

  // ---------------------------------------------------------------- menus
  showUpgrade(opts) {
    this.show('upgrade');
    $('upTitle').textContent = `Floor ${opts.floor} cleared`;
    const wrap = $('upChoices');
    wrap.innerHTML = '';
    for (const u of opts.choices) {
      const el = document.createElement('div');
      el.className = 'upcard';
      el.innerHTML = `<div class="icon">${u.icon}</div><div class="name">${u.name}</div><div class="desc">${u.desc}</div>`;
      el.addEventListener('click', () => {
        sfx.ui();
        opts.onPick(u);
      });
      wrap.appendChild(el);
    }
    $('upGold').textContent = `💰 ${opts.gold}`;
    const heal = $('healBtn');
    heal.textContent = opts.hpFull ? 'Health full' : `❤ Full heal (${opts.healCost}g)`;
    heal.disabled = opts.hpFull || opts.gold < opts.healCost;
    heal.onclick = opts.onHeal;
    const rr = $('rerollBtn');
    rr.textContent = `🎲 Reroll (${opts.rerollCost}g)`;
    rr.disabled = opts.gold < opts.rerollCost;
    rr.onclick = opts.onReroll;
  }

  hideUpgrade() {
    this.hide('upgrade');
  }

  showPause(game) {
    this.show('pause');
    const p = game.player;
    $('gear').innerHTML = SLOTS.map((slot) => {
      const it = p.equipment[slot];
      if (!it) return `<div class="gearslot"><b>${SLOT_ICON[slot]} Empty ${slot}</b></div>`;
      const lines = formatStats(it)
        .map((l) => `<div><span>${l.label}</span><span>${l.value}</span></div>`)
        .join('');
      return `<div class="gearslot" style="border-color:${it.rarity.color}"><b style="color:${it.rarity.color}">${SLOT_ICON[slot]} ${it.name}</b>${lines}</div>`;
    }).join('');
    const f = p.final;
    const rows = [
      ['Max Health', f.maxHp],
      ['Damage', Math.round(f.damage)],
      ['Armor', `${Math.round(f.armor)} (-${Math.round((1 - f.dmgTaken) * 100)}%)`],
      ['Attack Speed', `${Math.round(f.atkSpeed * 100)}%`],
      ['Crit', `${Math.round(f.crit * 100)}% × ${f.critMult.toFixed(2)}`],
      ['Life Steal', `${(f.lifesteal * 100).toFixed(1)}%`],
      ['Move Speed', `${Math.round((f.moveSpeed / 7.5) * 100)}%`],
      ['Cooldowns', `-${Math.round(f.cdr * 100)}%`],
      ['Skill Damage', `${Math.round(f.skillMult * 100)}%`],
      ['Gold Find', `${Math.round(f.goldMult * 100)}%`],
      ['Kills', p.kills],
      ['Floor', game.floor],
    ];
    $('statList').innerHTML = rows.map(([a, b]) => `<div><span>${a}</span><span>${b}</span></div>`).join('');
    $('muteBtn').textContent = `Sound: ${isMuted() ? 'off' : 'on'}`;
    void STAT_LABELS;
  }

  hidePause() {
    this.hide('pause');
  }

  showDeath(s) {
    this.hud.classList.add('hidden');
    this.show('death');
    const mins = Math.floor(s.time / 60);
    const secs = Math.floor(s.time % 60)
      .toString()
      .padStart(2, '0');
    $('deathStats').innerHTML = `Reached <b>floor ${s.floor}</b><br>Slain <b>${s.kills}</b> monsters · Gathered <b>${s.gold}</b> gold<br>Time <b>${mins}:${secs}</b><br>${s.newBest ? '<b style="color:#ffcf5a">★ New best! ★</b>' : `Best: floor ${s.best.floor}`}`;
  }

  bindMenus(handlers) {
    $('playBtn').onclick = handlers.play;
    $('againBtn').onclick = handlers.play;
    $('titleBtn').onclick = handlers.title;
    $('resumeBtn').onclick = handlers.resume;
    $('quitBtn').onclick = handlers.quit;
    $('muteBtn').onclick = () => {
      setMuted(!isMuted());
      $('muteBtn').textContent = `Sound: ${isMuted() ? 'off' : 'on'}`;
    };
    $('equipBtn').onclick = handlers.equip;
    $('salvageBtn').onclick = handlers.salvage;
    $('pauseBtn').onclick = handlers.pause;
  }
}

export { DIR_ARROWS };
