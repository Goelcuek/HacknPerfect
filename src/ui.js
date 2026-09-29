// DOM HUD, touch-control visuals, menus, loot card and minimap.

import { SKILLS, MAX_SKILL_LEVEL, skillDef } from './skills.js';
import { CLASSES, CLASS_ORDER } from './classes.js';
import { formatStats, SLOTS, SLOT_ICON } from './items.js';
import { TILE } from './dungeon.js';
import { sfx, setMuted, isMuted } from './audio.js';
import { partyColor } from './utils.js';

const $ = (id) => document.getElementById(id);
const PC_KEYS = ['Q', 'E', 'R', 'C'];
const DIR_ARROWS = ['↑', '→', '↓', '←'];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class UI {
  constructor() {
    this.hud = $('hud');
    this.toastEl = $('toast');
    this.toastTimer = 0;
    this.mm = $('minimap');
    this.mmCtx = this.mm.getContext('2d');
    this.mmTimer = 0;
    this.itemShown = null;
    this.isTouch = false;

    const bar = $('skillbar');
    this.pcSkills = [0, 1, 2, 3].map((i) => {
      const el = document.createElement('div');
      el.className = 'skillslot empty';
      el.innerHTML = `<span class="ico"></span><div class="cd"></div><div class="cdnum"></div><div class="pips"></div><kbd>${PC_KEYS[i]}</kbd>`;
      bar.appendChild(el);
      return { el, ico: el.querySelector('.ico'), cd: el.querySelector('.cd'), num: el.querySelector('.cdnum'), pips: el.querySelector('.pips') };
    });
    // movement next to the skills: dash (with its charges) and jump (with air jumps)
    const sep = document.createElement('div');
    sep.className = 'barsep';
    bar.appendChild(sep);
    const move = (cls, glyph, key) => {
      const el = document.createElement('div');
      el.className = `skillslot move ${cls}`;
      el.innerHTML = `<span class="ico">${glyph}</span><div class="charges"></div><kbd>${key}</kbd>`;
      bar.appendChild(el);
      return el.querySelector('.charges');
    };
    this.pcDashCharges = move('dash', '»', 'Shift');
    this.pcJumpCharges = move('jump', '▲', 'Space');
    this.touchSkills = [...document.querySelectorAll('.tskill')].map((el) => {
      el.innerHTML = `<div class="cd"></div><span class="ico"></span><div class="cdnum"></div>`;
      el.classList.add('empty');
      return { el, ico: el.querySelector('.ico'), cd: el.querySelector('.cd'), num: el.querySelector('.cdnum') };
    });
    this.joyBase = $('joyBase');
    this.joyKnob = $('joyKnob');
    this.touchDashCharges = document.querySelector('#dashBtn .charges');
  }

  setTouch(on) {
    this.isTouch = on;
    document.body.classList.toggle('touch', on);
  }

  show(id) {
    $(id).classList.remove('hidden');
  }
  hide(id) {
    $(id).classList.add('hidden');
  }

  hideScreens() {
    for (const id of ['title', 'mp', 'classSelect', 'skillPick', 'pause', 'death']) this.hide(id);
  }

  showTitle(best) {
    this.hud.classList.add('hidden');
    this.hideScreens();
    this.show('title');
    document.body.classList.remove('playing');
    const cls = best && best.cls && CLASSES[best.cls] ? ` as ${CLASSES[best.cls].name}` : '';
    $('bestText').textContent = best && best.floor ? `Best: floor ${best.floor}${cls} · ${best.kills} kills` : '';
    // a saved run: offer to pick it back up
    const save = this.savedRun;
    $('continueBtn').classList.toggle('hidden', !save);
    $('playBtn').textContent = save ? '▶ New run' : '▶ Play';
    if (save) $('continueInfo').textContent = `${CLASSES[save.cls]?.icon || ''} ${CLASSES[save.cls]?.name || ''} · floor ${save.floor} · ${save.p?.gold || 0} gold`;
  }

  showHUD() {
    this.hideScreens();
    this.hud.classList.remove('hidden');
    document.body.classList.add('playing');
  }

  // --------------------------------------------------------- class select
  showClassSelect(selected, onSelect, onStart, onBack) {
    this.hideScreens();
    this.hud.classList.add('hidden');
    this.show('classSelect');
    const list = $('classList');
    const render = (sel) => {
      list.innerHTML = '';
      for (const id of CLASS_ORDER) {
        const c = CLASSES[id];
        const el = document.createElement('button');
        el.className = 'classcard' + (id === sel ? ' sel' : '');
        el.id = `class-${id}`;
        const bars = Object.entries(c.ratings)
          .map(([k, v]) => `<div class="rating"><span>${k}</span><i style="--v:${v}"></i></div>`)
          .join('');
        el.innerHTML = `<div class="cc-head"><span class="cc-icon">${c.icon}</span><span><b>${c.name}</b><small>${c.role}</small></span></div><div class="ratings">${bars}</div>`;
        el.onclick = () => {
          sfx.ui();
          render(id);
          onSelect(id);
        };
        list.appendChild(el);
      }
      const c = CLASSES[sel];
      $('classDesc').innerHTML = `<b>${c.name}</b> — ${esc(c.desc)}<br><span class="muted">Skills: ${c.skills.map((s) => `${SKILLS[s].icon} ${SKILLS[s].name}`).join(' · ')}</span>`;
    };
    render(selected);
    $('startRunBtn').onclick = onStart;
    $('classBackBtn').onclick = onBack;
  }

  // ---------------------------------------------------- skill / reward pick
  showSkillPick(o) {
    this.show('skillPick');
    this.toastEl.classList.remove('show');
    $('spTitle').textContent = o.first ? 'Choose your first skill' : `Floor ${o.floor} cleared`;
    $('spSub').textContent = o.first
      ? `You'll gain a new skill or level one up after every floor. Up to 4 skills, one per swipe direction.`
      : o.offers.length
        ? 'Learn a new skill or empower one you know'
        : 'Every skill is mastered. Spend your gold at the shrine.';
    const wrap = $('spChoices');
    wrap.innerHTML = '';
    wrap.classList.toggle('many', o.offers.length > 3);
    for (const off of o.offers) {
      const d = off.def;
      const el = document.createElement('button');
      const isEvo = off.kind === 'evo';
      el.className = 'upcard skill' + (isEvo ? ' evo' : '');
      el.id = `offer-${off.id}`;
      const badge = off.kind === 'new' ? '<span class="badge new">NEW</span>' : isEvo ? '<span class="badge evo">✦ EVOLUTION</span>' : `<span class="badge">Lv ${off.from} → ${off.to}</span>`;
      const bind = this.isTouch ? `Swipe ${DIR_ARROWS[off.slot]}` : `Key ${PC_KEYS[off.slot]}`;
      const pips = isEvo ? `<span class="evofrom">${off.base.icon} ${off.base.name} ➜</span>` : Array.from({ length: MAX_SKILL_LEVEL }, (_, i) => `<i class="${i < off.to ? 'on' : ''}"></i>`).join('');
      el.innerHTML = `${badge}<div class="icon">${d.icon}</div><div class="name">${d.name}</div><div class="lvpips">${pips}</div><div class="desc">${esc(d.desc(off.to))}</div><div class="bind">${bind} · ${d.cd(off.to).toFixed(1)}s cooldown</div>`;
      el.onclick = () => {
        sfx.ui();
        o.onPick(off);
      };
      wrap.appendChild(el);
    }
    // current loadout
    const p = o.player;
    $('spLoadout').innerHTML = p.skills
      .map((s, i) => {
        const bind = this.isTouch ? DIR_ARROWS[i] : PC_KEYS[i];
        if (!s) return `<div class="loadslot empty"><kbd>${bind}</kbd><span>empty</span></div>`;
        const d = skillDef(s.id, s.level);
        return `<div class="loadslot${d.evolved ? ' evo' : ''}"><kbd>${bind}</kbd><span>${d.icon} ${d.name}</span><small>${d.evolved ? 'EVO' : `Lv ${s.level}`}</small></div>`;
      })
      .join('');

    const shrine = $('spShrine');
    shrine.classList.toggle('hidden', o.first);
    if (!o.first) {
      $('spGold').textContent = `💰 ${o.gold}`;
      const bl = $('spBlessings');
      bl.innerHTML = '';
      for (const entry of o.shrine) {
        const b = entry.b;
        const el = document.createElement('button');
        el.className = 'blessing' + (entry.sold ? ' sold' : '');
        el.disabled = entry.sold || o.gold < o.blessingCost;
        el.innerHTML = `<span class="bicon">${b.icon}</span><span><b>${b.name}</b><small>${b.desc}</small></span><span class="price">${entry.sold ? 'Bought' : `${o.blessingCost}g`}</span>`;
        el.onclick = () => o.onBuy(entry);
        bl.appendChild(el);
      }
      const heal = $('healBtn');
      heal.textContent = o.hpFull ? 'Health full' : `❤ Full heal (${o.healCost}g)`;
      heal.disabled = o.hpFull || o.gold < o.healCost;
      heal.onclick = o.onHeal;
      const rr = $('rerollBtn');
      rr.textContent = `🎲 Reroll skills (${o.rerollCost}g)`;
      rr.disabled = o.gold < o.rerollCost || !o.offers.length;
      rr.onclick = o.onReroll;
    }
    const cont = $('spContinue');
    cont.classList.toggle('hidden', !o.onSkip);
    cont.onclick = o.onSkip;
  }

  hideSkillPick() {
    this.hide('skillPick');
  }

  // Update skill slot icons after learning / levelling.
  refreshSkills(p) {
    for (let i = 0; i < 4; i++) {
      const s = p.skills[i];
      const pc = this.pcSkills[i];
      const ts = this.touchSkills[i];
      pc.el.classList.toggle('empty', !s);
      ts.el.classList.toggle('empty', !s);
      const d = s ? skillDef(s.id, s.level) : null;
      pc.ico.textContent = d ? d.icon : '';
      ts.ico.textContent = d ? d.icon : '';
      pc.el.title = d ? `${d.name} (${d.evolved ? 'Evolved' : `Lv ${s.level}`}) — ${d.desc(s.level)}` : 'Empty slot';
      pc.pips.innerHTML = s ? (d.evolved ? '<b>✦</b>' : '<i></i>'.repeat(s.level)) : '';
      pc.el.classList.toggle('evo', !!(d && d.evolved));
      ts.el.classList.toggle('evo', !!(d && d.evolved));
    }
  }

  skillFlash(i) {
    for (const el of [this.pcSkills[i].el, this.touchSkills[i].el]) {
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    }
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
    $('shieldFill').style.width = `${Math.min(100, (100 * p.shield) / f.maxHp)}%`;
    $('hpText').textContent = `${Math.ceil(Math.max(0, p.hp))} / ${f.maxHp}`;
    $('floorText').textContent = `Floor ${game.floor}`;
    $('goldText').textContent = `💰 ${p.gold}`;
    $('enemyText').textContent = game.floorCleared ? '✦ Portal open' : `👹 ${game.enemies.filter((e) => !e.disguised).length}`;
    // combo counter
    const combo = game.comboT > 0 ? game.combo : 0;
    const cEl = $('combo');
    if (combo !== this.lastCombo) {
      this.lastCombo = combo;
      cEl.classList.toggle('show', combo >= 5);
      if (combo >= 5) {
        const bonus = Math.round(game.comboBonus() * 100);
        cEl.innerHTML = `<b>${combo}</b><span>HITS${bonus ? ` · +${bonus}% dmg` : ''}</span>`;
        cEl.classList.remove('pop');
        void cEl.offsetWidth;
        cEl.classList.add('pop');
      }
    }
    if (combo >= 5) cEl.style.setProperty('--left', Math.max(0, game.comboT / 2.5));
    const buffs = Object.entries(p.buffs);
    const bEl = $('buffs');
    const bKey = buffs.map(([id, b]) => id + Math.ceil(b.t)).join();
    if (bKey !== this.lastBuffKey) {
      this.lastBuffKey = bKey;
      bEl.innerHTML = buffs.map(([id, b]) => `<span class="buff" style="--c:#${b.color.toString(16).padStart(6, '0')}">${{ warcry: '📯', focus: '🦅', berserk: '😡' }[id] || '💨'} ${Math.ceil(b.t)}s</span>`).join('');
    }

    const pips = (el, max, have) => {
      if (el.childElementCount !== max) el.innerHTML = '<i></i>'.repeat(max);
      for (let i = 0; i < max; i++) el.children[i].classList.toggle('empty', i >= have);
    };
    const dashEl = input.isTouch ? this.touchDashCharges : this.pcDashCharges;
    pips(dashEl, p.mods.dashCharges, p.dashCharges);
    if (!input.isTouch) pips(this.pcJumpCharges, 1 + p.mods.airJumps, p.grounded ? 1 + p.mods.airJumps : p.airJumpsLeft);

    for (let i = 0; i < 4; i++) {
      const k = p.skills[i] ? p.cooldowns[i] / p.skillCooldown(i) : 0;
      const pc = this.pcSkills[i];
      pc.cd.style.height = `${k * 100}%`;
      pc.num.textContent = p.cooldowns[i] > 0 ? Math.ceil(p.cooldowns[i]) : '';
      const ts = this.touchSkills[i];
      // radial sweep on the round touch buttons
      ts.cd.style.background = k > 0 ? `conic-gradient(rgba(0,0,0,0.72) ${Math.round(k * 360)}deg, rgba(0,0,0,0) 0)` : 'none';
      ts.num.textContent = p.cooldowns[i] > 0.05 ? Math.ceil(p.cooldowns[i]) : '';
      ts.el.classList.toggle('ready', !!p.skills[i] && k <= 0);
      ts.el.classList.toggle('sel', input.attackSwipeDir === i);
    }

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
    const view = 34;
    const s = W / view;
    const ptx = p.x / 2;
    const ptz = p.z / 2;
    const x0 = Math.floor(ptx - view / 2);
    const z0 = Math.floor(ptz - view / 2);
    ctx.save();
    ctx.translate(W / 2, W / 2);
    // camera forward is up, camera right is right
    ctx.rotate(Math.PI + game.cam.yaw);
    ctx.translate(-W / 2, -W / 2);
    for (let z = z0 - 8; z < z0 + view + 8; z++)
      for (let x = x0 - 8; x < x0 + view + 8; x++) {
        if (x < 0 || z < 0 || x >= dg.w || z >= dg.h) continue;
        if (!dg.seen[z * dg.w + x]) continue;
        const t = dg.get(x, z);
        if (t === TILE.WALL) continue;
        const i = z * dg.w + x;
        // raised floor reads lighter, stairs warm
        ctx.fillStyle = dg.stair[i] ? 'rgba(225,200,140,0.8)' : t === TILE.FLOOR ? (dg.elev[i] > 2 ? 'rgba(215,225,250,0.8)' : dg.elev[i] > 0 ? 'rgba(195,205,235,0.68)' : 'rgba(170,180,210,0.55)') : t === TILE.BLOCK ? 'rgba(160,120,80,0.8)' : 'rgba(90,90,110,0.9)';
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
    // party members on this floor (pinned to the edge when out of range)
    const yaw = game.cam.yaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const half = W / 2 - 8;
    for (const r of game.net?.remotes?.values() || []) {
      if (r.floor !== game.floor || r.inMenu) continue;
      const dx = ((r.x - p.x) / 2) * s;
      const dz = ((r.z - p.z) / 2) * s;
      let sx = -dx * fz + dz * fx;
      let sy = -(dx * fx + dz * fz);
      const m = Math.max(Math.abs(sx), Math.abs(sy));
      if (m > half) {
        sx *= half / m;
        sy *= half / m;
      }
      this.mmArrow(W / 2 + sx, W / 2 + sy, yaw - r.heading, r.dead ? '#777' : partyColor(r.id), 6);
    }
    this.mmArrow(W / 2, W / 2, yaw - p.heading, '#7fe0ff', 7);
  }

  mmArrow(x, y, rot, color, size) {
    const ctx = this.mmCtx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.72, size * 0.72);
    ctx.lineTo(0, size * 0.35);
    ctx.lineTo(-size * 0.72, size * 0.72);
    ctx.closePath();
    ctx.stroke();
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
    const looks = item.slot === 'weapon' ? 'changes your weapon' : item.slot === 'armor' ? 'changes your outfit' : 'adds an amulet';
    $('itemHeader').innerHTML = `<span style="color:${item.rarity.color}">${SLOT_ICON[item.slot]} ${esc(item.name)}</span><small>${item.rarity.name} ${item.slot} · floor ${item.level}${equipped ? ` · vs ${esc(equipped.name)}` : ' · slot empty'} · ${looks}</small>`;
    $('itemCompare').innerHTML = formatStats(item, equipped || { stats: {} })
      .map((l) => `<div><span>${l.label}</span><span class="${l.cls}">${l.value}</span></div>`)
      .join('');
  }

  showPause(game) {
    this.show('pause');
    // multiplayer runs aren't saved; in solo, closing the game resumes later anyway
    $('saveQuitBtn').classList.toggle('hidden', !!game.net.mode);
    $('quitBtn').textContent = game.net.mode ? 'Leave game' : 'Abandon run';
    const p = game.player;
    $('gear').innerHTML = SLOTS.map((slot) => {
      const it = p.equipment[slot];
      if (!it) return `<div class="gearslot"><b>${SLOT_ICON[slot]} Empty ${slot}</b></div>`;
      const lines = formatStats(it)
        .map((l) => `<div><span>${l.label}</span><span>${l.value}</span></div>`)
        .join('');
      return `<div class="gearslot" style="border-color:${it.rarity.color}"><b style="color:${it.rarity.color}">${SLOT_ICON[slot]} ${esc(it.name)}</b>${lines}</div>`;
    }).join('');
    $('pauseSkills').innerHTML = p.skills
      .map((s, i) => {
        const bind = this.isTouch ? DIR_ARROWS[i] : PC_KEYS[i];
        if (!s) return `<div class="loadslot empty"><kbd>${bind}</kbd><span>empty</span></div>`;
        const d = skillDef(s.id, s.level);
        return `<div class="loadslot${d.evolved ? ' evo' : ''}" title="${esc(d.desc(s.level))}"><kbd>${bind}</kbd><span>${d.icon} ${d.name}</span><small>${d.evolved ? 'EVO' : `Lv ${s.level}`}</small></div>`;
      })
      .join('');
    const f = p.final;
    const rows = [
      ['Class', p.cls.name],
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
    ];
    $('statList').innerHTML = rows.map(([a, b]) => `<div><span>${a}</span><span>${b}</span></div>`).join('');
    $('muteBtn').textContent = `Sound: ${isMuted() ? 'off' : 'on'}`;
  }

  setQualityLabel(q) {
    const label = `Graphics: ${q[0].toUpperCase()}${q.slice(1)}`;
    $('qualityBtn').textContent = label;
    $('qualityBtn2').textContent = label;
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
    $('deathMp').classList.toggle('hidden', !s.mp);
    $('deathMp').textContent = s.mp || '';
    $('deathStats').innerHTML = `The ${s.cls} reached <b>floor ${s.floor}</b><br>Slain <b>${s.kills}</b> monsters · Gathered <b>${s.gold}</b> gold<br>Time <b>${mins}:${secs}</b><br>${s.newBest ? '<b style="color:#ffcf5a">★ New best! ★</b>' : `Best: floor ${s.best.floor}`}`;
  }

  // ----------------------------------------------------------- multiplayer
  // view: 'choose' | 'host' | 'join'
  showMultiplayer(view, o = {}) {
    this.hud.classList.add('hidden');
    this.hideScreens();
    this.show('mp');
    for (const [id, v] of [['mpChoose', 'choose'], ['mpHost', 'host'], ['mpJoin', 'join']]) $(id).classList.toggle('hidden', view !== v);
    if (view === 'host') {
      $('mpPin').textContent = o.pin ? o.pin.replace(/(\d{3})(\d{3})/, '$1 $2') : '······';
      $('mpHostGo').disabled = !o.pin;
    }
    if (view === 'join') {
      this.setPin('');
      setTimeout(() => !this.isTouch && $('pinInput').focus(), 50);
    }
    this.mpStatus(o.status || '');
  }

  mpStatus(msg, bad = false) {
    for (const id of ['mpHostStatus', 'mpJoinStatus']) {
      $(id).textContent = msg;
      $(id).classList.toggle('bad', bad);
    }
  }

  setPin(v) {
    this.pin = v.replace(/\D/g, '').slice(0, 6);
    $('pinInput').value = this.pin;
    [...$('pinBoxes').children].forEach((el, i) => {
      el.textContent = this.pin[i] || '';
      el.classList.toggle('on', i === this.pin.length);
    });
    $('mpJoinGo').disabled = this.pin.length !== 6;
  }

  bindMultiplayer(h) {
    $('mpBtn').onclick = h.open;
    $('mpBackBtn').onclick = h.back;
    $('mpHostBtn').onclick = h.host;
    $('mpJoinBtn').onclick = () => this.showMultiplayer('join');
    $('mpHostGo').onclick = h.hostGo;
    $('mpHostCancel').onclick = h.cancel;
    $('mpJoinCancel').onclick = h.cancel;
    $('mpJoinGo').onclick = () => this.pin.length === 6 && h.join(this.pin);
    $('pinInput').oninput = (e) => this.setPin(e.target.value);
    $('pinInput').onkeydown = (e) => {
      if (e.key === 'Enter' && this.pin.length === 6) h.join(this.pin);
      e.stopPropagation();
    };
    const pad = $('pinPad');
    pad.innerHTML = '';
    for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK']) {
      const b = document.createElement('button');
      b.textContent = k;
      b.className = k === 'OK' ? 'ok' : '';
      b.onclick = () => {
        if (k === '⌫') this.setPin(this.pin.slice(0, -1));
        else if (k === 'OK') this.pin.length === 6 && h.join(this.pin);
        else this.setPin(this.pin + k);
      };
      pad.appendChild(b);
    }
    this.pin = '';
  }

  // Party list in the HUD (null hides it).
  setParty(p) {
    const el = $('party');
    if (!p) {
      el.classList.add('hidden');
      $('pauseMp').classList.add('hidden');
      this.partyKey = null;
      return;
    }
    const key = JSON.stringify(p);
    if (key === this.partyKey) return;
    this.partyKey = key;
    el.classList.remove('hidden');
    el.innerHTML =
      `<div class="pin">${p.host ? 'Hosting' : 'Joined'} · PIN <b>${esc(p.pin || '')}</b></div>` +
      p.list
        .map(
          (m) =>
            `<div class="member${m.dead ? ' down' : ''}${m.away ? ' away' : ''}"><span><i class="pdot" style="background:${m.color}"></i>${CLASSES[m.cls]?.icon || ''} ${esc(m.name)}${m.dead ? ' ✖' : m.away ? ' …' : ''}</span><div class="mbar"><i style="width:${Math.round(Math.max(0, Math.min(1, m.hp)) * 100)}%"></i></div></div>`,
        )
        .join('');
    const pm = $('pauseMp');
    pm.classList.toggle('hidden', false);
    pm.textContent = `Multiplayer · PIN ${p.pin} · ${p.list.length} player${p.list.length > 1 ? 's' : ''} · the dungeon keeps going while you're in menus`;
  }

  bindMenus(handlers) {
    $('playBtn').onclick = handlers.play;
    $('againBtn').onclick = handlers.again;
    $('titleBtn').onclick = handlers.title;
    $('resumeBtn').onclick = handlers.resume;
    $('quitBtn').onclick = handlers.quit;
    $('saveQuitBtn').onclick = handlers.saveQuit;
    $('continueBtn').onclick = handlers.resume_run;
    $('muteBtn').onclick = () => {
      setMuted(!isMuted());
      $('muteBtn').textContent = `Sound: ${isMuted() ? 'off' : 'on'}`;
    };
    $('equipBtn').onclick = handlers.equip;
    $('salvageBtn').onclick = handlers.salvage;
    $('pauseBtn').onclick = handlers.pause;
    $('qualityBtn').onclick = handlers.quality;
    $('qualityBtn2').onclick = handlers.quality;
  }
}
