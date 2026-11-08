// Wardens of Thornhold — animated tutorial ("video" player built from SVG animation)
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const HC = { ember: '#e2603f', tide: '#4f8fe0', gale: '#3fb6a0', thorn: '#d9b440' };

  // ---------- player state ----------
  let root, svg, capEl, barEl, playBtn, voiceBtn, dotsEl, titleEl;
  let scene = 0, steps = [], fired = 0, elapsed = 0, dur = 1, playing = true, anims = [], last = 0, raf = 0, holdUntil = 0;
  let timers = [];
  const later = (fn, ms) => timers.push({ at: elapsed + (ms || 0), fn });
  let voice = (() => { try { return localStorage.getItem('wt_voice') === '1'; } catch (e) { return false; } })();

  // ---------- drawing helpers ----------
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    (parent || svg).appendChild(e);
    return e;
  }
  function obj(x, y, html, parent) {
    const g = el('g', {}, parent);
    g.style.transform = `translate(${x}px, ${y}px)`;
    g._x = x; g._y = y;
    g.innerHTML = html;
    return g;
  }
  function anim(e, frames, ms, opts) {
    const a = e.animate(frames, Object.assign({ duration: ms, fill: 'forwards', easing: 'ease-in-out' }, opts || {}));
    if (!playing) a.pause();
    anims.push(a);
    return a;
  }
  const tr = (x, y, s) => `translate(${x}px, ${y}px)${s !== undefined ? ` scale(${s})` : ''}`;
  function pop(g, delay) {
    g.style.opacity = 0;
    anim(g, [{ opacity: 0, transform: tr(g._x, g._y, 0.2) }, { opacity: 1, transform: tr(g._x, g._y, 1.15), offset: .7 }, { opacity: 1, transform: tr(g._x, g._y, 1) }], 450, { delay: delay || 0, easing: 'ease-out' });
  }
  function fade(g, to, ms) { anim(g, [{ opacity: getComputedStyle(g).opacity }, { opacity: to }], ms || 400); }
  function moveTo(g, pts, ms, arc) {
    const frames = [{ transform: tr(g._x, g._y) }];
    pts.forEach(([x, y], i) => {
      if (arc) frames.push({ transform: tr((g._x + x) / 2, Math.min(g._y, y) - arc), offset: (i + .5) / pts.length });
      frames.push({ transform: tr(x, y), offset: (i + 1) / pts.length });
    });
    anim(g, frames, ms || 400 * pts.length);
    const l = pts[pts.length - 1]; g._x = l[0]; g._y = l[1];
  }
  function pulse(g, times) {
    anim(g, [{ transform: tr(g._x, g._y, 1) }, { transform: tr(g._x, g._y, 1.25) }, { transform: tr(g._x, g._y, 1) }], 700, { iterations: times || 3 });
  }
  function shakeEl(g) {
    anim(g, [0, -6, 6, -4, 4, 0].map(d => ({ transform: tr(g._x + d, g._y) })), 450);
  }
  function burst(x, y, color) {
    const g = obj(x, y, `<circle r="10" fill="none" stroke="${color || '#ffd36b'}" stroke-width="4"/>` +
      Array.from({ length: 8 }, (_, i) => { const a = i * 45 * Math.PI / 180; return `<line x1="${Math.cos(a) * 9}" y1="${Math.sin(a) * 9}" x2="${Math.cos(a) * 22}" y2="${Math.sin(a) * 22}" stroke="${color || '#ffd36b'}" stroke-width="3" stroke-linecap="round"/>`; }).join(''));
    anim(g, [{ opacity: 1, transform: tr(x, y, .3) }, { opacity: 0, transform: tr(x, y, 2.2) }], 800, { easing: 'ease-out' });
  }
  function defs() {
    el('defs', {}).innerHTML = Object.entries(HC).map(([k, c]) => `<radialGradient id="tH_${k}" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="${c}"/><stop offset="1" stop-color="#1a1410"/></radialGradient>`).join('') +
      `<radialGradient id="tNode" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fff8e6"/><stop offset=".6" stop-color="#e6d3a6"/><stop offset="1" stop-color="#b49660"/></radialGradient>
       <radialGradient id="tHollow" cx="50%" cy="25%" r="80%"><stop offset="0" stop-color="#e2c6ff"/><stop offset=".4" stop-color="#8a3fc4"/><stop offset="1" stop-color="#1c0830"/></radialGradient>
       <radialGradient id="tAura"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
       <radialGradient id="tBg" cx="50%" cy="40%" r="80%"><stop offset="0" stop-color="#34573f"/><stop offset="1" stop-color="#16261b"/></radialGradient>`;
  }
  function bg(castle) {
    el('rect', { x: 0, y: 0, width: 400, height: 260, fill: 'url(#tBg)' });
    if (castle) el('rect', { x: castle[0], y: castle[1], width: castle[2], height: castle[3], rx: 14, fill: '#474c64', stroke: '#2f3346', 'stroke-width': 4 });
  }
  function node(x, y, label, o = {}) {
    const g = obj(x, y, `${o.prot ? '<circle r="24" fill="none" stroke="#5b8fd9" stroke-width="5"/>' : ''}${o.loc ? '<circle r="25" fill="none" stroke="#d9a441" stroke-width="3" stroke-dasharray="5 4"/>' : ''}
      <circle r="18" fill="${o.fill || 'url(#tNode)'}" stroke="#8a6a2c" stroke-width="2.5"/>
      <text font-size="15" text-anchor="middle" dominant-baseline="central">${o.icon || ''}</text>
      <text y="33" font-size="11" text-anchor="middle" fill="#f4ecd8" stroke="#1b2030" stroke-width="3" paint-order="stroke" font-family="Alegreya Sans, sans-serif">${label}</text>`);
    return g;
  }
  function edge(a, b, o = {}) {
    const l = el('line', { x1: a._x, y1: a._y, x2: b._x, y2: b._y, stroke: o.color || '#d8c9a2', 'stroke-width': o.w || 4, 'stroke-dasharray': o.dash || '2 7', 'stroke-linecap': 'round', opacity: .85 });
    svg.insertBefore(l, svg.querySelector('.layer') || null);
    if (o.obs) return obj((a._x + b._x) / 2, (a._y + b._y) / 2, `<circle r="11" fill="#1b2133" stroke="${o.obsColor || '#e2b04a'}" stroke-width="2"/><text font-size="11" text-anchor="middle" dominant-baseline="central">${o.obs}</text>`);
    return l;
  }
  function warden(house, x, y, dx = 0, dy = 0) {
    const g = obj(x + dx, y + dy, `<circle r="15" fill="${HC[house]}" opacity=".35"/><circle r="10" fill="url(#tH_${house})" stroke="#fff3d0" stroke-width="2"/><text class="z" y="-15" font-size="11" text-anchor="middle" opacity="0">💫</text>`);
    g._dx = dx; g._dy = dy; return g;
  }
  function wraith(x, y, dx = 0, dy = 0) {
    const g = obj(x + dx, y + dy, `<ellipse rx="16" ry="14" fill="#a64dff" opacity=".35"/><path d="M0 -14 C8 -14 9 -5 9 2 L12 13 L6 9 L0 13 L-6 9 L-12 13 L-9 2 C-9 -5 -8 -14 0 -14Z" fill="url(#tHollow)" stroke="#1a0626" stroke-width="1.5"/><circle cx="-3" cy="-5" r="1.6" fill="#ffe24d"/><circle cx="3" cy="-5" r="1.6" fill="#ffe24d"/><text class="z" y="-18" font-size="11" text-anchor="middle" opacity="0">💫</text>`);
    g._dx = dx; g._dy = dy; return g;
  }
  const at = (p, n) => [n._x + (p._dx || 0), n._y + (p._dy || 0)];
  const walk = (p, nodes, ms) => moveTo(p, nodes.map(n => at(p, n)), ms);
  function stun(p, on) { const z = p.querySelector('.z'); anim(z, [{ opacity: on ? 0 : 1 }, { opacity: on ? 1 : 0 }], 300); anim(p.children[1], [{ opacity: 1 }, { opacity: on ? .5 : 1 }], 300); }
  function card(x, y, name, mv, color) {
    return obj(x, y, `<rect x="-36" y="-26" width="72" height="52" rx="7" fill="#efe0bd" stroke="#7a5a28" stroke-width="1.5"/>
      <rect x="-36" y="-26" width="72" height="16" rx="7" fill="${color || '#d9a441'}"/><rect x="-36" y="-16" width="72" height="6" fill="${color || '#d9a441'}"/>
      <text x="-31" y="-14" font-size="9" fill="#fff" font-family="IM Fell English, serif">${name}</text>
      <circle cx="22" cy="8" r="11" fill="#d9a441" stroke="#fff3d0" stroke-width="1.5"/><text x="22" y="9" font-size="${String(mv).length > 2 ? 7 : 10}" font-weight="700" text-anchor="middle" dominant-baseline="central" fill="#2a1a05">${mv}</text>`);
  }
  function icon(x, y, e, size) { return obj(x, y, `<text font-size="${size || 18}" text-anchor="middle" dominant-baseline="central">${e}</text>`); }
  function label(x, y, t, size, color) { return obj(x, y, `<text font-size="${size || 13}" text-anchor="middle" fill="${color || '#f4ecd8'}" stroke="#1b2030" stroke-width="3" paint-order="stroke" font-family="Alegreya Sans, sans-serif" font-weight="700">${t}</text>`); }
  function glow(n, color) {
    const g = obj(n._x, n._y, `<circle r="24" fill="${color}" opacity=".25" stroke="${color}" stroke-width="3"/>`);
    svg.insertBefore(g, n);
    anim(g, [{ opacity: .3 }, { opacity: 1 }, { opacity: .3 }], 900, { iterations: Infinity });
    return g;
  }

  // ---------- scenes ----------
  // Each scene draws its board and returns timed steps: [ms, caption|null, action]
  const SCENES = [
    { title: 'Two sides', build() {
      bg([120, 40, 160, 150]);
      label(200, 110, '🏰 Thornhold', 18);
      const ws = ['ember', 'tide', 'gale'].map((h, i) => warden(h, 50, 70 + i * 50));
      const hs = [0, 1, 2].map(i => wraith(350, 70 + i * 50));
      return [
        [0, 'Up to 4 friends play Wardens defending the academy. One player is the Hollow, trying to take it.', () => { ws.forEach((w, i) => pop(w, i * 150)); hs.forEach((w, i) => pop(w, 400 + i * 150)); }],
        [3200, 'Wardens race each other: the first to raise 2 Ward Shields wins.', () => { [0, 1].forEach(i => pop(icon(30 + i * 40, 40, '🛡', 24), i * 300)); }],
        [6400, 'The Hollow claims 3 Shadow tokens, then gathers its pawns in a secret target room.', () => {
          ['🪨', '🐉', '💀'].forEach((e, i) => pop(icon(310 + i * 30, 220, e, 20), i * 250));
          const t = obj(200, 150, '<circle r="22" fill="none" stroke="#d65a5a" stroke-width="4"/><text font-size="14" text-anchor="middle" dominant-baseline="central">☠</text>');
          pop(t, 900); later(() => pulse(t, 4), 1400);
        }],
        [10000, null, () => {}]
      ];
    } },
    { title: 'Your turn: play a card', build() {
      bg();
      const n = [node(50, 90, 'Great Hall', { prot: true, icon: '🏰' }), node(130, 60, 'Stair'), node(210, 90, 'Gallery'), node(290, 60, 'Tower', { icon: '⭐' }), node(130, 150, 'Library', { icon: '📖' }), node(210, 170, 'Kitchens')];
      edge(n[0], n[1]); edge(n[1], n[2]); edge(n[2], n[3]); edge(n[0], n[4]); edge(n[4], n[5]); edge(n[2], n[5]);
      const p = warden('ember', 50, 90, 14, 12), q = warden('ember', 50, 90, -14, 12);
      let c;
      return [
        [0, 'On your turn you take one main action. Most often: play a card from your hand.', () => { c = card(340, 210, 'Quickstep', 3); anim(c, [{ transform: tr(340, 300) }, { transform: tr(340, 210) }], 600); }],
        [3200, 'The big number is how far one of your pawns can move.', () => { pulse(c, 3); [[n[1], 1], [n[2], 2], [n[3], 3], [n[4], 1], [n[5], 2]].forEach(([m, k], i) => { glow(m, '#7dffa6'); pop(label(m._x + 18, m._y - 16, k, 11, '#c9ffd9'), i * 120); }); }],
        [6600, 'Tap your pawn, then tap a glowing space to move there.', () => {
          const f = icon(120, 200, '👆', 24); moveTo(f, [[p._x, p._y + 14]], 700);
          later(() => { moveTo(f, [[n[3]._x, n[3]._y + 14]], 900); walk(p, [n[1], n[2], n[3]], 1200); }, 900);
          later(() => fade(f, 0), 2300);
        }],
        [10200, 'Double values like 2+2 move two different pawns 2 spaces each, or one pawn 4.', () => {
          fade(c, 0, 300); const c2 = card(340, 210, 'Twin Strides', '2+2', '#d65a5a'); pop(c2);
          later(() => { walk(q, [n[4], n[5]], 900); }, 600);
        }],
        [13800, null, () => {}]
      ];
    } },
    { title: 'Obstacles and fly points', build() {
      bg([20, 20, 230, 220]);
      const a = node(70, 70, 'Charms'), b = node(190, 70, 'Library', { icon: '📖' }), c = node(70, 190, 'Tower', { icon: '🪶' }), d = node(330, 190, 'Pitch', { icon: '🪶' }), e = node(190, 190, 'Infirmary', { prot: true });
      const lock = edge(a, b, { obs: '🔒' }); edge(a, c); edge(c, e); edge(b, e);
      const p = warden('tide', 70, 70, 0, 14), r = warden('gale', 70, 190, 0, 14), h = wraith(330, 70);
      let crd;
      return [
        [0, 'Obstacles block Wardens: 🔒 locked doors, ✴ wards, ≈ water and ▲ rubble.', () => { moveTo(p, [[115, 84]], 500); later(() => { moveTo(p, [[70, 84]], 350); shakeEl(lock); burst(lock._x, lock._y, '#d65a5a'); }, 520); }],
        [3600, 'Cards like Unlatch let you pass a matching obstacle.', () => { crd = card(330, 220, 'Unlatch', 3, '#5b8fd9'); pop(crd); later(() => { walk(p, [b], 900); burst(lock._x, lock._y, '#7dffa6'); }, 700); }],
        [7000, 'With a flying card, hop between any two 🪶 fly points for free.', () => { fade(crd, 0); pop(card(330, 120, 'Old Broom', 2, '#8f7ad6')); later(() => moveTo(r, [at(r, d)], 1300, 90), 600); }],
        [10600, 'Hollow pawns ignore obstacles, but can never enter protected rooms (blue ring).', () => { moveTo(h, [[b._x + 16, b._y], [e._x + 8, e._y - 30]], 1400); later(() => { shakeEl(h); burst(e._x, e._y - 18, '#5b8fd9'); }, 1450); }],
        [14600, null, () => {}]
      ];
    } },
    { title: 'Collect the three items', build() {
      bg();
      const hall = node(50, 120, 'Great Hall', { prot: true }), lib = node(140, 60, 'Library', { icon: '📖' }), l1 = node(140, 180, 'Glasshouses', { loc: true }), l2 = node(240, 120, 'Crypt', { loc: true }), hid = node(250, 40, 'Hidden Hall', { fill: '#c5b6e0', icon: '🚪' });
      edge(hall, lib); edge(hall, l1); edge(lib, l2); edge(l1, l2); hid.style.opacity = 0;
      const slots = obj(345, 120, `<rect x="-38" y="-80" width="76" height="160" rx="10" fill="#2a3246" stroke="#4a5573"/><text y="-62" font-size="10" text-anchor="middle" fill="#a9a28f">Your items</text>${[-35, 5, 45].map(y => `<rect x="-20" y="${y - 18}" width="40" height="36" rx="8" fill="#1e2433" stroke="#4a5573"/>`).join('')}`);
      const p = warden('thorn', 50, 120, 0, 14), q = warden('thorn', 50, 120, 14, -4), r = warden('thorn', 50, 120, -14, -4);
      const track = obj(140, 240, [0, 1, 2, 3, 4, 5, 6].map(i => `<rect x="${i * 24 - 84}" y="-9" width="20" height="18" rx="4" fill="${i >= 4 ? '#4b4230' : '#353e56'}"/><text x="${i * 24 - 74}" y="1" font-size="9" fill="#ece3cf" text-anchor="middle" dominant-baseline="central">${i + 1}</text>`).join(''));
      const vm = obj(56, 228, '<circle r="5" fill="#d9b440" stroke="#111"/>');
      const fly = (e, y) => { const g = icon(140, 60, e, 20); moveTo(g, [[345, y]], 900, 40); };
      return [
        [0, 'A Shield needs three items. First, a Tome: visit the Library and pick one.', () => { walk(p, [lib], 800); later(() => fly('📖', 85), 900); }],
        [3800, 'Second, a Scroll: get pawns onto 2 of your 3 secret locations (gold rings).', () => { walk(q, [l1], 800); later(() => walk(r, [lib, l2], 1000), 500); later(() => { burst(l1._x, l1._y); burst(l2._x, l2._y); const g = icon(240, 120, '📜', 20); moveTo(g, [[345, 125]], 900, 30); }, 1700); }],
        [8000, 'Third, the Seeker Lens: be alone at the top of the Valor track on space 5 or higher…', () => { moveTo(vm, [[80, 228], [104, 228], [128, 228], [152, 228]], 1600); later(() => { const g = icon(152, 210, '🔍', 20); moveTo(g, [[345, 165]], 900, 40); }, 1700); }],
        [12000, '…or a Circle Sigil from the Hidden Hall, which appears once anyone reaches Valor 5.', () => { anim(hid, [{ opacity: 0 }, { opacity: 1 }], 800); burst(250, 40, '#c79bff'); later(() => { walk(p, [hid], 700); }, 800); later(() => pop(icon(370, 140, '⭕', 14)), 1600); }],
        [16000, null, () => {}]
      ];
    } },
    { title: 'Raise a Shield', build() {
      bg();
      const a = node(70, 130, 'Relic Vault'), s = node(200, 130, 'Clock Tower', { icon: '🛡🔍' });
      edge(a, s);
      const items = ['📖', '📜', '🔍'].map((e, i) => icon(330, 70 + i * 40, e, 22));
      const panel = label(330, 220, '🛡 0 / 2', 16);
      const p = warden('ember', 70, 130, 0, 14);
      return [
        [0, 'Move onto a Shield space that shows the key you hold: 🔍 Lens or ⭕ Sigil.', () => { glow(s, '#ffd36b'); later(() => walk(p, [s], 900), 800); }],
        [3200, 'Your Tome, Scroll and key are traded in…', () => { items.forEach((g, i) => later(() => moveTo(g, [[200, 130]], 700, 30), i * 250)); later(() => items.forEach(g => fade(g, 0, 200)), 1300); }],
        [5600, '…and you raise a Ward Shield!', () => {
          const pil = obj(200, 130, '<rect x="-16" y="-130" width="32" height="140" fill="url(#tAura)"/>');
          anim(pil, [{ opacity: 0 }, { opacity: .9 }, { opacity: 0 }], 1600); burst(200, 130); burst(200, 130, '#fff');
          later(() => { panel.querySelector('text').textContent = '🛡 1 / 2'; pulse(panel, 2); }, 800);
        }],
        [9000, 'Raise a second Shield and you win the game instantly.', () => { later(() => { panel.querySelector('text').textContent = '🛡 2 / 2 — Victory!'; pulse(panel, 3); for (let i = 0; i < 14; i++) later(() => burst(40 + Math.random() * 320, 30 + Math.random() * 160, ['#d9a441', '#e2603f', '#4f8fe0', '#fff'][i % 4]), i * 120); }, 500); }],
        [12800, null, () => {}]
      ];
    } },
    { title: 'The Hollow strikes', build() {
      bg();
      const hall = node(60, 200, 'Great Hall', { prot: true, icon: '🏰' }), a = node(170, 90, 'Gallery'), b = node(290, 90, 'Study'), c = node(290, 200, 'Crypt');
      edge(hall, a); edge(a, b); edge(b, c); edge(a, c);
      const w = warden('tide', 170, 90, 0, 14), h = wraith(290, 90, 0, 0), w2 = warden('gale', 290, 200, -14, 10), h2 = wraith(170, 160);
      const mark = obj(170, 104, '<rect x="-12" y="-8" width="24" height="16" rx="4" fill="#4f8fe0" stroke="#fff"/>'); mark.style.opacity = 0;
      return [
        [0, 'When a Hollow pawn lands on your pawn, it bumps you back to the Great Hall.', () => { moveTo(h, [at(h, a)], 800); later(() => { burst(170, 90, '#b56bff'); moveTo(w, [at(w, hall)], 900, 40); anim(h, [{ opacity: 1 }, { opacity: 0 }], 600); }, 850); }],
        [4200, "The Hollow takes your house marker. With every Warden's marker, the night moves forward.", () => { mark._x = 60; mark._y = 214; mark.style.transform = tr(60, 214); anim(mark, [{ opacity: 0 }, { opacity: 1 }], 300); moveTo(mark, [[350, 30]], 1200, 40); }],
        [8000, 'If you land on a Hollow pawn, you clash: both are stunned and it is pushed away.', () => { moveTo(h2, [[230, 200]], 600); later(() => { walk(w2, [c], 10); }, 0); later(() => { moveTo(w2, [[200, 210]], 700); }, 700); later(() => { burst(220, 205); stun(w2, true); stun(h2, true); moveTo(h2, [[300, 230]], 500); }, 1450); }],
        [12000, 'Stunned pawns cannot move until you Replenish.', () => { pulse(w2, 2); }],
        [14800, null, () => {}]
      ];
    } },
    { title: 'The Shadow Path', build() {
      bg();
      const zc = i => (i < 6 ? '#cfc8b8' : i < 11 ? '#e0893a' : '#c23b3b');
      const ev = [2, 4, 7, 9, 12, 14];
      obj(200, 60, Array.from({ length: 16 }, (_, i) => `<rect x="${i * 22 - 176}" y="-11" width="19" height="22" rx="4" fill="${zc(i)}"/><text x="${i * 22 - 166.5}" y="1" font-size="10" text-anchor="middle" dominant-baseline="central">${i === 15 ? '☠' : ev.includes(i) ? '⚡' : ''}</text>`).join(''));
      const m = obj(33.5, 60, '<rect x="-11" y="-14" width="22" height="28" rx="5" fill="none" stroke="#fff" stroke-width="3"/>');
      const sky = el('rect', { x: 0, y: 0, width: 400, height: 260, fill: '#3a0006', opacity: 0 });
      const hand = [0, 1, 2, 3, 4].map(i => card(110 + i * 45, 180, ['Swift', 'Lumen', 'Dispel', 'Key', 'Ward'][i], [4, 2, 3, 4, 2][i]));
      hand.forEach(c => (c.style.opacity = 0));
      const cell = i => 33.5 + i * 22;
      return [
        [0, 'Replenish refills your hand to 5 cards and stands your pawns back up…', () => { hand.forEach((c, i) => later(() => pop(c), i * 120)); }],
        [3200, '…but each Replenish moves the Shadow Path one step closer to night.', () => { moveTo(m, [[cell(1), 60], [cell(2), 60]], 1000); later(() => burst(cell(2), 60, '#fff'), 1000); }],
        [6000, 'Event spaces (⚡) hurt the Wardens. The Hollow gains a reward, or claims that zone’s token.', () => {
          hand.forEach(c => fade(c, 0, 300));
          const e = obj(200, 170, '<rect x="-90" y="-45" width="180" height="90" rx="12" fill="#2a2240" stroke="#e0893a" stroke-width="3"/><text y="-14" font-size="16" text-anchor="middle" fill="#f6ecd8" font-family="IM Fell English, serif">Ambush</text><text y="10" font-size="10" text-anchor="middle" fill="#cfc8b8">Warden pawns outside are stunned</text><text y="28" font-size="10" text-anchor="middle" fill="#cfc8b8">or: take the 🐉 token</text>');
          pop(e); moveTo(m, [[cell(7), 60]], 1000); later(() => fade(e, 0), 3000);
        }],
        [9800, 'With all 3 tokens the Hollow reveals its target. Early it needs 3 pawns there, later 2, at the very end just 1.', () => {
          moveTo(m, [[cell(12), 60]], 900);
          ['3', '2', '1'].forEach((n, i) => { const g = label(cell([12, 14, 15][i]), 100, n + ' ☠', 14, '#ffb0b0'); pop(g, 900 + i * 700); });
          later(() => moveTo(m, [[cell(14), 60]], 600), 1700); later(() => moveTo(m, [[cell(15), 60]], 600), 2400);
        }],
        [14400, 'The last space starts the final night: no more Replenish. Play out your last cards!', () => { anim(sky, [{ opacity: 0 }, { opacity: .45 }], 1200); }],
        [17800, null, () => {}]
      ];
    } },
    { title: 'Learn, tokens and reactions', build() {
      bg();
      const deck = obj(320, 70, '<rect x="-24" y="-32" width="48" height="64" rx="7" fill="#2a3246" stroke="#d9a441" stroke-width="2"/><text y="44" font-size="10" text-anchor="middle" fill="#a9a28f">your deck</text>');
      const old = card(80, 70, 'Quickstep', 3); const nw = card(200, 70, 'Master Key', 4, '#8f7ad6');
      const room = node(90, 190, 'Charms Room', { icon: '✨' }), from = node(200, 190, 'Library');
      edge(from, room);
      const p = warden('gale', 200, 190, 0, 14);
      return [
        [0, 'Learn: discard 1 card to take a new spell. It goes on top of your deck. Advanced spells cost 2 cards and give +1 Valor.', () => { moveTo(old, [[80, 140]], 600); fade(old, 0, 600); later(() => { moveTo(nw, [[320, 70]], 900, 30); }, 700); }],
        [5200, 'Discipline tokens: end on a classroom to grab its token. Next turn, spend it to play an extra card of that type.', () => { walk(p, [room], 800); later(() => { const t = icon(90, 190, '✨', 20); moveTo(t, [[40, 120]], 800, 20); later(() => { pop(card(120, 120, 'Insight ✨', 2)); burst(40, 120); }, 1300); }, 900); }],
        [10200, 'Aegis Ward and Counterspell protect you automatically while they sit in your hand.', () => { const c = card(300, 190, 'Aegis ⚡', 2, '#5b8fd9'); pop(c); const h = wraith(380, 190); moveTo(h, [[300, 160]], 700); later(() => { burst(300, 170, '#5b8fd9'); moveTo(h, [[380, 230]], 500); stun(h, true); pulse(c, 2); }, 750); }],
        [14400, null, () => {}]
      ];
    } },
    { title: 'Ready to play', build() {
      bg([90, 30, 220, 120]);
      const code = 'ABCD'.split('').map((l, i) => label(140 + i * 40, 100, l, 30));
      code.forEach(c => (c.style.opacity = 0));
      const bots = ['🤖 Easy', '🤖 Medium', '🤖 Hard'].map((b, i) => label(80 + i * 120, 200, b, 14, ['#9fd8a8', '#ffd36b', '#ff9a9a'][i]));
      bots.forEach(c => (c.style.opacity = 0));
      return [
        [0, 'Create a room and share the 4-letter code with friends…', () => code.forEach((c, i) => pop(c, i * 200))],
        [3400, '…or tap Play vs bots. Easy, Medium and Hard bots can fill any seat.', () => bots.forEach((c, i) => pop(c, i * 250))],
        [6800, 'Tap the ? button in a game any time for the full rules. Good luck, Warden!', () => { for (let i = 0; i < 10; i++) later(() => burst(40 + Math.random() * 320, 30 + Math.random() * 200, ['#d9a441', '#e2603f', '#4f8fe0', '#c79bff'][i % 4]), i * 150); }],
        [10400, null, () => {}]
      ];
    } }
  ];

  // ---------- player ----------
  function say(text) {
    if (!voice || !('speechSynthesis' in window) || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[^\p{L}\p{N}\p{P}\s]/gu, ''));
    u.rate = 1.05; u.lang = 'en-GB';
    speechSynthesis.speak(u);
  }
  function load(i) {
    scene = (i + SCENES.length) % SCENES.length;
    anims.forEach(a => { try { a.cancel(); } catch (e) {} }); anims = [];
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    timers = []; svg.innerHTML = ''; defs();
    steps = SCENES[scene].build();
    dur = steps[steps.length - 1][0]; fired = 0; elapsed = 0; holdUntil = 0; timers = [];
    titleEl.textContent = `${scene + 1} / ${SCENES.length} · ${SCENES[scene].title}`;
    dotsEl.innerHTML = SCENES.map((s, k) => `<button class="${k === scene ? 'on' : ''}" data-k="${k}" aria-label="Scene ${k + 1}: ${s.title}"></button>`).join('');
    dotsEl.querySelectorAll('button').forEach(b => (b.onclick = () => load(+b.dataset.k)));
    capEl.textContent = '';
  }
  function frame(t) {
    const dt = Math.min(100, t - last); last = t;
    if (playing) {
      const next = steps[fired];
      const speaking = voice && 'speechSynthesis' in window && speechSynthesis.speaking;
      if (!(speaking && next && elapsed + dt >= next[0])) elapsed += dt; // wait for narration before the next caption
      while (fired < steps.length && elapsed >= steps[fired][0]) {
        const [, cap, fn] = steps[fired++];
        if (cap) { capEl.textContent = cap; say(cap); }
        try { fn(); } catch (e) { console.error(e); }
      }
      const due = timers.filter(x => x.at <= elapsed); timers = timers.filter(x => x.at > elapsed);
      due.forEach(x => { try { x.fn(); } catch (e) { console.error(e); } });
      barEl.style.width = Math.min(100, (elapsed / dur) * 100) + '%';
      if (elapsed >= dur && !(voice && 'speechSynthesis' in window && speechSynthesis.speaking)) {
        if (scene < SCENES.length - 1) load(scene + 1); else { playing = false; playBtn.textContent = '↻ Replay'; }
      }
    }
    raf = requestAnimationFrame(frame);
  }
  function setPlaying(p) {
    playing = p;
    playBtn.textContent = p ? '⏸ Pause' : '▶ Play';
    anims.forEach(a => { try { p ? a.play() : a.pause(); } catch (e) {} });
    if ('speechSynthesis' in window) { if (p) speechSynthesis.resume(); else speechSynthesis.pause(); }
  }
  function open(start) {
    if (!root) {
      root = document.createElement('div');
      root.className = 'tut';
      root.innerHTML = `<div class="tutframe" role="dialog" aria-label="How to play tutorial">
        <div class="tuthead"><span class="tuttitle"></span><button class="icon" data-x aria-label="Close tutorial">✕</button></div>
        <svg class="tutsvg" viewBox="0 0 400 260"></svg>
        <div class="tutbar"><i></i></div>
        <p class="tutcap" aria-live="polite"></p>
        <div class="tutctl"><button data-p aria-label="Previous scene">⏮</button><button data-play class="primary">⏸ Pause</button><button data-n aria-label="Next scene">⏭</button><button data-v>🔈 Voice</button></div>
        <div class="tutdots"></div></div>`;
      document.body.appendChild(root);
      svg = root.querySelector('svg'); capEl = root.querySelector('.tutcap'); barEl = root.querySelector('.tutbar i');
      playBtn = root.querySelector('[data-play]'); voiceBtn = root.querySelector('[data-v]'); dotsEl = root.querySelector('.tutdots'); titleEl = root.querySelector('.tuttitle');
      root.querySelector('[data-x]').onclick = close;
      root.querySelector('[data-p]').onclick = () => { load(scene - 1); setPlaying(true); };
      root.querySelector('[data-n]').onclick = () => { load(scene + 1); setPlaying(true); };
      playBtn.onclick = () => { if (!playing && scene === SCENES.length - 1 && elapsed >= dur) { load(0); } setPlaying(!playing); };
      voiceBtn.onclick = () => { voice = !voice; try { localStorage.setItem('wt_voice', voice ? '1' : '0'); } catch (e) {} voiceBtn.classList.toggle('on', voice); if (voice) say(capEl.textContent); else if ('speechSynthesis' in window) speechSynthesis.cancel(); };
      root.addEventListener('click', e => { if (e.target === root) close(); });
      if (!('speechSynthesis' in window)) voiceBtn.classList.add('hidden');
    }
    voiceBtn.classList.toggle('on', voice);
    root.classList.remove('hidden');
    load(start || 0); setPlaying(true);
    last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
  }
  function close() {
    root.classList.add('hidden'); cancelAnimationFrame(raf);
    anims.forEach(a => { try { a.cancel(); } catch (e) {} }); anims = [];
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }
  window.TUTORIAL = { open, close };
})();
