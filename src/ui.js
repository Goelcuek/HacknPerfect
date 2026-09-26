// DOM HUD, touch-control visuals, menus, loot card and minimap.

import { SKILLS, MAX_SKILL_LEVEL } from './skills.js';
import { CLASSES, CLASS_ORDER } from './classes.js';
import { formatStats, SLOTS, SLOT_ICON } from './items.js';
import { TILE } from './dungeon.js';
import { sfx, setMuted, isMuted } from './audio.js';

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
    this.touchSkills = [...document.querySelectorAll('.tskill')].map((el) => {
      el.innerHTML = `<span class="ico"></span><div class="cd"></div>`;
      el.classList.add('empty');
      return { el, ico: el.querySelector('.ico'), cd: el.querySelector('.cd') };
    });
    this.joyBase = $('joyBase');
    this.joyKnob = $('joyKnob');
    this.dashPips = $('dashPips');
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
    for (const id of ['title', 'classSelect', 'skillPick', 'pause', 'death']) this.hide(id);
  }

  showTitle(best) {
    this.hud.classList.add('hidden');
    this.hideScreens();
    this.show('title');
    document.body.classList.remove('playing');
    const cls = best && best.cls && CLASSES[best.cls] ? ` as ${CLASSES[best.cls].name}` : '';
    $('bestText').textContent = best && best.floor ? `Best: floor ${best.floor}${cls} · ${best.kills} kills` : '';
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
      el.className = 'upcard skill';
      el.id = `offer-${off.id}`;
      const badge = off.kind === 'new' ? '<span class="badge new">NEW</span>' : `<span class="badge">Lv ${off.from} → ${off.to}</span>`;
      const bind = this.isTouch ? `Swipe ${DIR_ARROWS[off.slot]}` : `Key ${PC_KEYS[off.slot]}`;
      const pips = Array.from({ length: MAX_SKILL_LEVEL }, (_, i) => `<i class="${i < off.to ? 'on' : ''}"></i>`).join('');
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
        return `<div class="loadslot"><kbd>${bind}</kbd><span>${SKILLS[s.id].icon} ${SKILLS[s.id].name}</span><small>Lv ${s.level}</small></div>`;
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
      pc.ico.textContent = s ? SKILLS[s.id].icon : '';
      ts.ico.textContent = s ? SKILLS[s.id].icon : '';
      pc.el.title = s ? `${SKILLS[s.id].name} (Lv ${s.level}) — ${SKILLS[s.id].desc(s.level)}` : 'Empty slot';
      pc.pips.innerHTML = s ? '<i></i>'.repeat(s.level) : '';
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
    $('enemyText').textContent = game.floorCleared ? '✦ Portal open' : `👹 ${game.enemies.length}`;
    const buffs = Object.entries(p.buffs);
    const bEl = $('buffs');
    const bKey = buffs.map(([id, b]) => id + Math.ceil(b.t)).join();
    if (bKey !== this.lastBuffKey) {
      this.lastBuffKey = bKey;
      bEl.innerHTML = buffs.map(([id, b]) => `<span class="buff" style="--c:#${b.color.toString(16).padStart(6, '0')}">${id === 'warcry' ? '📯' : id === 'focus' ? '🦅' : '💨'} ${Math.ceil(b.t)}s</span>`).join('');
    }

    const max = p.mods.dashCharges;
    if (this.dashPips.childElementCount !== max) this.dashPips.innerHTML = '<i></i>'.repeat(max);
    [...this.dashPips.children].forEach((el, i) => el.classList.toggle('empty', i >= p.dashCharges));

    for (let i = 0; i < 4; i++) {
      const k = p.skills[i] ? p.cooldowns[i] / p.skillCooldown(i) : 0;
      const pc = this.pcSkills[i];
      pc.cd.style.height = `${k * 100}%`;
      pc.num.textContent = p.cooldowns[i] > 0 ? Math.ceil(p.cooldowns[i]) : '';
      const ts = this.touchSkills[i];
      ts.cd.style.height = `${k * 100}%`;
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
    const looks = item.slot === 'weapon' ? 'changes your weapon' : item.slot === 'armor' ? 'changes your outfit' : 'adds an amulet';
    $('itemHeader').innerHTML = `<span style="color:${item.rarity.color}">${SLOT_ICON[item.slot]} ${esc(item.name)}</span><small>${item.rarity.name} ${item.slot} · floor ${item.level}${equipped ? ` · vs ${esc(equipped.name)}` : ' · slot empty'} · ${looks}</small>`;
    $('itemCompare').innerHTML = formatStats(item, equipped || { stats: {} })
      .map((l) => `<div><span>${l.label}</span><span class="${l.cls}">${l.value}</span></div>`)
      .join('');
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
      return `<div class="gearslot" style="border-color:${it.rarity.color}"><b style="color:${it.rarity.color}">${SLOT_ICON[slot]} ${esc(it.name)}</b>${lines}</div>`;
    }).join('');
    $('pauseSkills').innerHTML = p.skills
      .map((s, i) => {
        const bind = this.isTouch ? DIR_ARROWS[i] : PC_KEYS[i];
        if (!s) return `<div class="loadslot empty"><kbd>${bind}</kbd><span>empty</span></div>`;
        const d = SKILLS[s.id];
        return `<div class="loadslot" title="${esc(d.desc(s.level))}"><kbd>${bind}</kbd><span>${d.icon} ${d.name}</span><small>Lv ${s.level}</small></div>`;
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
    $('deathStats').innerHTML = `The ${s.cls} reached <b>floor ${s.floor}</b><br>Slain <b>${s.kills}</b> monsters · Gathered <b>${s.gold}</b> gold<br>Time <b>${mins}:${secs}</b><br>${s.newBest ? '<b style="color:#ffcf5a">★ New best! ★</b>' : `Best: floor ${s.best.floor}`}`;
  }

  bindMenus(handlers) {
    $('playBtn').onclick = handlers.play;
    $('againBtn').onclick = handlers.again;
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
    $('qualityBtn').onclick = handlers.quality;
    $('qualityBtn2').onclick = handlers.quality;
  }
}
