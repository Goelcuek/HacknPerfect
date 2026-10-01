// DOM HUD, touch-control visuals, menus, loot card and minimap.

import { SKILLS, MAX_SKILL_LEVEL, skillDef } from './skills.js';
import { CLASSES, CLASS_ORDER } from './classes.js';
import { formatStats, SLOTS, SLOT_ICON } from './items.js';
import { legendLines } from './legend.js';
import { TILE } from './dungeon.js';
import { sfx, setMuted, isMuted } from './audio.js';
import { partyColor, fmtNum } from './utils.js';
import { loadMeta, FORGE, forgeLevel, buyForge } from './meta.js';
import { modsLabel } from './endless.js';

const $ = (id) => document.getElementById(id);
const PC_KEYS = ['Q', 'E', 'R', 'C'];
const DIR_ARROWS = ['↑', '→', '↓', '←'];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// The unique powers and set bonuses of an item, for the loot card and pause screen.
function legendHtml(it, equipment) {
  return legendLines(it, equipment)
    .map((l) =>
      l.kind === 'unique'
        ? `<p class="legend uq"><b>✦ ${esc(l.name)}</b> ${esc(l.desc)}</p>`
        : `<p class="legend st" style="--c:${l.color}"><b>${esc(l.name)}</b><span class="${l.n >= 2 ? 'on' : ''}">(2) ${esc(l.two)}</span><span class="${l.n >= 3 ? 'on' : ''}">(3) ${esc(l.three)}</span></p>`,
    )
    .join('');
}

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
    // write-if-changed DOM helpers for the per-frame HUD
    this.setText = (el, v) => {
      if (el._t === v) return;
      el._t = v;
      el.textContent = v;
    };
    this.setStyle = (el, k, v) => {
      const c = el._s || (el._s = {});
      if (c[k] === v) return;
      c[k] = v;
      if (k.startsWith('--')) el.style.setProperty(k, v);
      else el.style[k] = v;
    };
    this.setClass = (el, cls, on) => {
      const k = '_c' + cls;
      if (el[k] === on) return;
      el[k] = on;
      el.classList.toggle(cls, on);
    };

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
    for (const id of ['title', 'mp', 'classSelect', 'skillPick', 'pause', 'death', 'eventScreen', 'victory', 'forge']) this.hide(id);
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
    const meta = loadMeta();
    $('forgeInfo').textContent = `${fmtNum(meta.shards)} shards${meta.wins ? ` · ${meta.wins} victor${meta.wins > 1 ? 'ies' : 'y'}` : ''}`;
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

  // Below 35% health: a red vignette and heartbeat that quicken and deepen toward
  // zero, and a glowing health bar. Off outside the dungeon and once fallen.
  lowHealth(game, dt) {
    const p = game.player;
    const on = p && !p.dead && (game.state === 'play' || game.state === 'pause');
    const frac = on ? Math.max(0, p.hp) / p.final.maxHp : 1;
    const level = Math.min(1, Math.max(0, (0.35 - frac) / 0.3));
    const el = $('lowHp');
    if (level <= 0) {
      if (this.lowShown) {
        this.lowShown = false;
        el.style.opacity = '0';
        $('stats').querySelector('.bar.hp').classList.remove('low');
      }
      this.beatT = 0;
      return;
    }
    if (!this.lowShown) {
      this.lowShown = true;
      $('stats').querySelector('.bar.hp').classList.add('low');
    }
    const period = 1 / (1 + level * 1.3); // 60 → 138 bpm
    if (game.state === 'play') {
      this.beatT = (this.beatT || 0) - dt;
      if (this.beatT <= 0) {
        this.beatT += period;
        if (this.beatT < 0) this.beatT = period;
        this.beatAt = performance.now();
        sfx.heartbeat(0.5 + level * 0.5);
      }
    }
    // each beat swells the vignette, then it eases back toward a resting glow
    const since = (performance.now() - (this.beatAt || 0)) / 1000;
    const swell = Math.max(0, 1 - since / (period * 0.7));
    el.style.opacity = (0.3 + level * 0.4 + swell * (0.15 + level * 0.15)).toFixed(3);
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
    // the HUD only touches the DOM when a value changes: every write costs a style
    // recalculation (and text writes a layout), which adds up at 60 fps on phones
    const text = this.setText;
    const css = this.setStyle;
    css($('hpFill'), 'width', `${((100 * Math.max(0, p.hp)) / f.maxHp).toFixed(1)}%`);
    css($('shieldFill'), 'width', `${Math.min(100, (100 * p.shield) / f.maxHp).toFixed(1)}%`);
    text($('hpText'), `${Math.ceil(Math.max(0, p.hp))} / ${f.maxHp}`);
    text($('floorText'), game.floor > 20 ? `Floor ${game.floor} ∞` : `Floor ${game.floor}/20`);
    text($('goldText'), `💰 ${fmtNum(p.gold)}`);
    text($('shardText'), `💠 ${fmtNum(game.runShards || 0)}`);
    this.setClass($('pingWrap'), 'hidden', !game.net.live);
    const wr = p.pw.buffText();
    text($('modsText'), (game.floor > 20 ? `∞ ${modsLabel(game.floor)}` : '') + (game.pact ? ` ${game.pact.icon} ${game.pact.name}` : '') + (wr ? ` ${wr}` : ''));
    text($('enemyText'), game.floorCleared ? '✦ Portal open' : `👹 ${game.enemies.filter((e) => !e.disguised).length}`);
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
    if (combo >= 5) css(cEl, '--left', Math.max(0, game.comboT / 2.5).toFixed(2));
    const buffs = Object.entries(p.buffs);
    const bEl = $('buffs');
    const bKey = buffs.map(([id, b]) => id + Math.ceil(b.t)).join();
    if (bKey !== this.lastBuffKey) {
      this.lastBuffKey = bKey;
      bEl.innerHTML = buffs.map(([id, b]) => `<span class="buff" style="--c:#${b.color.toString(16).padStart(6, '0')}">${{ warcry: '📯', focus: '🦅', berserk: '😡' }[id] || '💨'} ${Math.ceil(b.t)}s</span>`).join('');
    }

    const pips = (el, max, have) => {
      const key = max * 16 + have;
      if (el._pips === key) return;
      el._pips = key;
      if (el.childElementCount !== max) el.innerHTML = '<i></i>'.repeat(max);
      for (let i = 0; i < max; i++) el.children[i].classList.toggle('empty', i >= have);
    };
    const dashEl = input.isTouch ? this.touchDashCharges : this.pcDashCharges;
    pips(dashEl, p.mods.dashCharges, p.dashCharges);
    if (!input.isTouch) pips(this.pcJumpCharges, 1 + p.mods.airJumps, p.grounded ? 1 + p.mods.airJumps : p.airJumpsLeft);

    // only the visible set of skill buttons (touch ring or desktop bar)
    for (let i = 0; i < 4; i++) {
      const k = p.skills[i] ? p.cooldowns[i] / p.skillCooldown(i) : 0;
      if (!input.isTouch) {
        const pc = this.pcSkills[i];
        css(pc.cd, 'height', `${Math.round(k * 100)}%`);
        text(pc.num, p.cooldowns[i] > 0 ? String(Math.ceil(p.cooldowns[i])) : '');
        continue;
      }
      const ts = this.touchSkills[i];
      // radial sweep on the round touch buttons (in 4 degree steps)
      css(ts.cd, 'background', k > 0 ? `conic-gradient(rgba(0,0,0,0.72) ${Math.round(k * 90) * 4}deg, rgba(0,0,0,0) 0)` : 'none');
      text(ts.num, p.cooldowns[i] > 0.05 ? String(Math.ceil(p.cooldowns[i])) : '');
      this.setClass(ts.el, 'ready', !!p.skills[i] && k <= 0);
      this.setClass(ts.el, 'sel', input.attackSwipeDir === i);
    }

    if (input.isTouch && input.joy) {
      css(this.joyBase, 'display', 'block');
      css(this.joyBase, 'left', `${input.joy.ox}px`);
      css(this.joyBase, 'top', `${input.joy.oy}px`);
      let dx = input.joy.x - input.joy.ox;
      let dy = input.joy.y - input.joy.oy;
      const m = Math.hypot(dx, dy);
      if (m > 55) {
        dx = (dx / m) * 55;
        dy = (dy / m) * 55;
      }
      css(this.joyKnob, 'transform', `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`);
    } else css(this.joyBase, 'display', 'none');
    this.setClass($('attackBtn'), 'active', !!input.attackTouch);

    const b = game.boss;
    if (b && b.alive && b.aggro) {
      this.show('bossbar');
      text($('bossName'), b.displayName || b.def.name);
      css($('bossFill'), 'width', `${((100 * b.hp) / b.maxHp).toFixed(1)}%`);
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
    // merchants and altars, and the party's pings (pulsing)
    for (const ev of game.events || []) if (!ev.used && seenAt(ev.x, ev.z)) dot(ev.x, ev.z, ev.kind === 'merchant' ? '#ffd34d' : ev.kind === 'altar' ? '#ff3040' : '#6ad8ff', 3.5);
    for (const q of game.pings || []) if (q.t > 0) dot(q.x, q.z, q.color, 3 + Math.abs(Math.sin(q.t * 6)) * 3);
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
  setItemCard(item, equipped, equipment = null) {
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
    $('itemCompare').innerHTML =
      formatStats(item, equipped || { stats: {} })
        .map((l) => `<div><span>${l.label}</span><span class="${l.cls}">${l.value}</span></div>`)
        .join('') + legendHtml(item, equipment);
  }

  // Merchant / altar / trial shrine within reach: what it is and F to use it.
  setEventCard(e) {
    const key = e ? `${e.kind}${e.i}` : '';
    if (key === this.eventShown) return;
    this.eventShown = key;
    const card = $('eventcard');
    if (!e) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');
    const t = {
      merchant: ['💰 Wandering Merchant', 'Rare wares, a healing elixir and a mystery cache', 'Trade'],
      altar: ['🩸 Cursed Altar', 'Strike a bargain for this floor: power at a price', 'Pray'],
      trial: ['⚔ Trial Shrine', 'Survive three waves of monsters for a treasure', 'Begin trial'],
    }[e.kind];
    $('eventHeader').textContent = t[0];
    $('eventInfo').textContent = t[1];
    $('eventUseBtn').innerHTML = `${t[2]} <kbd class="pc">F</kbd>`;
  }

  // A panel of rows, each with a button: the merchant's stock, the altar's pacts.
  showEventScreen(o, onClose) {
    this.show('eventScreen');
    $('evTitle').textContent = o.title;
    $('evSub').textContent = o.sub || '';
    $('evClose').textContent = o.closeLabel || 'Leave';
    $('evClose').onclick = () => {
      sfx.ui();
      onClose();
    };
    const wrap = $('evRows');
    wrap.innerHTML = '';
    for (const r of o.rows || []) {
      const row = document.createElement('div');
      row.className = 'evrow';
      row.innerHTML = `<div class="evlabel">${r.html}</div>`;
      const b = document.createElement('button');
      b.textContent = r.btn;
      b.disabled = !!r.disabled;
      b.onclick = () => r.onClick && r.onClick();
      row.appendChild(b);
      wrap.appendChild(row);
    }
  }

  hideEventScreen() {
    this.hide('eventScreen');
  }

  showVictory(s, onEndless, onRetire) {
    this.hud.classList.add('hidden');
    this.show('victory');
    const mins = Math.floor(s.time / 60);
    const secs = Math.floor(s.time % 60)
      .toString()
      .padStart(2, '0');
    $('victoryStats').innerHTML = `The ${s.cls} slew <b>${s.kills}</b> monsters in <b>${mins}:${secs}</b><br><span style="color:#9fe8ff">${fmtNum(s.shards)} soul shards this run</span><br><small class="muted">Below lies the endless: every floor adds a curse, and the loot grows wilder.</small>`;
    $('vEndless').onclick = () => {
      sfx.ui();
      onEndless();
    };
    $('vRetire').onclick = () => {
      sfx.ui();
      onRetire();
    };
  }

  hideVictory() {
    this.hide('victory');
    this.hud.classList.remove('hidden');
  }

  // The Soul Forge: permanent upgrades bought with soul shards.
  showForge(onBack) {
    this.hideScreens();
    this.show('forge');
    const render = () => {
      const m = loadMeta();
      $('forgeSub').innerHTML = `<b style="color:#9fe8ff">${fmtNum(m.shards)} 💠 soul shards</b> · earned from elites, den lords, kings and every floor, kept when you fall${m.deepest ? ` · deepest floor ${m.deepest}` : ''}`;
      const wrap = $('forgeRows');
      wrap.innerHTML = '';
      for (const f of FORGE) {
        const l = forgeLevel(m, f.id);
        const max = l >= f.max;
        const row = document.createElement('div');
        row.className = 'evrow';
        row.innerHTML = `<div class="evlabel"><b>${f.icon} ${f.name}</b> <span class="muted">${l}/${f.max}</span><small>${max ? f.desc(l) : `${l ? `${f.desc(l)} → ` : ''}${f.desc(l + 1)}`}</small></div>`;
        const b = document.createElement('button');
        b.textContent = max ? 'Maxed' : `${f.cost(l)} 💠`;
        b.disabled = max || m.shards < f.cost(l);
        b.onclick = () => {
          if (buyForge(loadMeta(), f.id)) {
            sfx.heal();
            render();
          }
        };
        row.appendChild(b);
        wrap.appendChild(row);
      }
    };
    render();
    $('forgeClose').onclick = () => {
      sfx.ui();
      onBack();
    };
  }

  // Standing in an open portal asks before going down; `info` is null to hide it.
  setPortalCard(info) {
    const key = info ? `${info.floor}|${info.chests}|${info.items}` : '';
    if (key === this.portalShown) return;
    this.portalShown = key;
    const card = $('portalcard');
    if (!info) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');
    $('portalHeader').textContent = `✦ Descend to floor ${info.floor}?`;
    const left = [];
    if (info.chests) left.push(`${info.chests} chest${info.chests > 1 ? 's' : ''} unopened`);
    if (info.items) left.push(`${info.items} item${info.items > 1 ? 's' : ''} on the ground`);
    $('portalInfo').innerHTML = left.length ? `<span class="warn">Left behind: ${left.join(' · ')}</span>` : 'Nothing left behind.';
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
      return `<div class="gearslot" style="border-color:${it.rarity.color}"><b style="color:${it.rarity.color}">${SLOT_ICON[slot]} ${esc(it.name)}</b>${lines}${legendHtml(it, p.equipment)}</div>`;
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

  setMusicLabel(on) {
    for (const id of ['musicBtn', 'musicBtn2']) $(id).textContent = `Music: ${on ? 'on' : 'off'}`;
  }

  setFpsLabel(on) {
    for (const id of ['fpsBtn', 'fpsBtn2']) $(id).textContent = `FPS: ${on ? 'on' : 'off'}`;
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
    $('deathTitle').textContent = s.retired ? '★ Victorious ★' : s.won ? 'Fallen in the endless depths' : 'You have fallen';
    $('deathTitle').className = s.retired ? 'gold' : 'red';
    const sh = s.shards ? `<br><span style="color:#9fe8ff">+${fmtNum(s.shards.earned)} soul shards</span> · ${fmtNum(s.shards.total)} to spend at the Soul Forge` : '';
    $('deathStats').innerHTML = `The ${s.cls} reached <b>floor ${s.floor}</b><br>Slain <b>${s.kills}</b> monsters · Gathered <b>${s.gold}</b> gold<br>Time <b>${mins}:${secs}</b><br>${s.newBest ? '<b style="color:#ffcf5a">★ New best! ★</b>' : `Best: floor ${s.best.floor}`}${sh}`;
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
    $('portalGoBtn').onclick = handlers.portalGo;
    $('eventUseBtn').onclick = handlers.useEvent;
    $('pingBtn').onclick = () => $('pingMenu').classList.toggle('hidden');
    for (const b of document.querySelectorAll('#pingMenu button'))
      b.onclick = () => {
        $('pingMenu').classList.add('hidden');
        handlers.ping(b.dataset.ping);
      };
    $('forgeBtn').onclick = handlers.forge;
    $('portalStayBtn').onclick = handlers.portalStay;
    $('pauseBtn').onclick = handlers.pause;
    $('qualityBtn').onclick = handlers.quality;
    $('qualityBtn2').onclick = handlers.quality;
    $('fpsBtn').onclick = handlers.fps;
    $('fpsBtn2').onclick = handlers.fps;
    $('musicBtn').onclick = handlers.music;
    $('musicBtn2').onclick = handlers.music;
  }
}
