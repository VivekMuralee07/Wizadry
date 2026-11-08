// Wardens of Thornhold — client
const W = window.WARDENS;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

let pid = store.get('wt_pid');
if (!pid) { pid = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('wt_pid', pid); }
$('#name').value = store.get('wt_name') || '';

const socket = io();
let lobby = null, S = null, lastTurnSeat = null;
const ui = { pawn: null, combine: false, direct: false, card: null, zoom: 1, modal: null, learn: null, rep: null };

// ---------- connection ----------
socket.on('connect', () => {
  const code = store.get('wt_room');
  if (code) socket.emit('join', { code, name: store.get('wt_name') || 'Warden', pid }, r => { if (r && r.err) { store.del('wt_room'); show('home'); } });
});
socket.on('lobby', l => { lobby = l; store.set('wt_room', l.code); if (!l.started) { S = null; boardBuilt = false; prevLog = null; wonShown = false; } render(); });
socket.on('state', s => {
  const myTurnNow = s.turn && s.turn.seat === s.you;
  if (myTurnNow && lastTurnSeat !== s.you) { sfx('turn'); if (navigator.vibrate) navigator.vibrate(60); }
  lastTurnSeat = s.turn ? s.turn.seat : null;
  if (S && S.turn && s.turn && (S.turn.seat !== s.turn.seat || !s.turn.card || (S.turn.card && s.turn.card && S.turn.card.used.length !== s.turn.card.used.length))) { ui.pawn = null; ui.direct = false; }
  if (S && s.turn && (!S.turn || !s.turn.card || !S.turn.card || S.turn.card.key !== s.turn.card.key)) ui.combine = false;
  S = s; render(); processLog(s.log);
  if (s.phase === 'over' && !wonShown) {
    wonShown = true; const w = s.winner;
    const good = (w.side === 'house' && w.seat === s.you) || (w.side === 'shadow' && s.seats[s.you].role === 'shadow');
    sfx(good ? 'win' : w.side === 'draw' ? 'reveal' : 'lose');
    embers(w.side === 'shadow' ? ['#a64dff', '#5b1a8a', '#ff4d6d'] : ['#d9a441', '#fff3c4', '#e2603f', '#4f8fe0']);
  }
});
let wonShown = false;

function act(a) {
  socket.emit('act', a, r => { if (r && !r.ok) toast(r.err); });
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), 2600);
}
let actx = null;
function beep() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'triangle'; o.frequency.value = 660; g.gain.value = .08;
    o.connect(g); g.connect(actx.destination); o.start();
    o.frequency.setValueAtTime(880, actx.currentTime + .12);
    g.gain.exponentialRampToValueAtTime(.0001, actx.currentTime + .35); o.stop(actx.currentTime + .36);
  } catch (e) {}
  if (navigator.vibrate) navigator.vibrate(60);
}

// ---------- home / room ----------
function myName() { const n = $('#name').value.trim() || 'Warden'; store.set('wt_name', n); return n; }
$('#createBtn').onclick = () => socket.emit('create', { name: myName(), pid });
$('#quickBtn').onclick = () => socket.emit('create', { name: myName(), pid, quick: true });
$('#muteBtn').onclick = () => { muted = !muted; store.set('wt_mute', muted ? '1' : '0'); $('#muteBtn').textContent = muted ? '🔇' : '🔊'; };
$('#joinBtn').onclick = () => {
  const code = $('#codeIn').value.trim().toUpperCase();
  if (code.length !== 4) return toast('Room codes have 4 letters.');
  socket.emit('join', { code, name: myName(), pid }, r => r && r.err && toast(r.err));
};
$('#startBtn').onclick = () => socket.emit('start', r => r && r.err && toast(r.err));
$('#leaveBtn').onclick = () => { socket.emit('leave'); store.del('wt_room'); lobby = null; S = null; show('home'); };
$('#shareBtn').onclick = async () => {
  const text = `Join my Wardens of Thornhold game! Room code: ${lobby.code}`;
  const url = location.origin;
  if (navigator.share) { try { await navigator.share({ title: 'Wardens of Thornhold', text, url }); } catch (e) {} }
  else { try { await navigator.clipboard.writeText(text + ' ' + url); toast('Invite copied.'); } catch (e) { toast(text); } }
};
document.addEventListener('click', e => {
  const o = e.target.closest('[data-open]');
  if (o) openModal(o.dataset.open);
});
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal' && ui.modal !== 'prompt') closeModal(); });

function show(id) { ['home', 'room', 'game'].forEach(s => $('#' + s).classList.toggle('hidden', s !== id)); }

function renderRoom() {
  show('room');
  $('#roomCode').textContent = lobby.code;
  const me = lobby.players.find(p => p.id === pid);
  const chips = [{ role: 'shadow', label: 'The Hollow', color: 'var(--hollow)' }]
    .concat(Object.keys(W.HOUSES).map(h => ({ role: 'house', house: h, label: W.HOUSES[h].name + ' Warden', color: W.HOUSES[h].color })));
  $('#roleChips').innerHTML = chips.map(c => {
    const holder = lobby.players.find(p => p.role === c.role && (c.role === 'shadow' || p.house === c.house));
    const on = me && holder && holder.id === me.id;
    return `<button class="chip ${on ? 'on' : ''} ${holder && !on && c.role === 'house' ? 'taken' : ''}" style="background:${c.color};color:#111" data-role="${c.role}" data-house="${c.house || ''}">${esc(c.label)}${holder && !on ? ' · ' + esc(holder.name) : ''}</button>`;
  }).join('');
  $('#roleChips').querySelectorAll('button').forEach(b => b.onclick = () => socket.emit('role', { role: b.dataset.role, house: b.dataset.house }));
  $('#pcount').textContent = `(${lobby.players.length}/5)`;
  const host = lobby.host === pid;
  $('#plist').innerHTML = lobby.players.map(p => `<li>${p.role === 'shadow' ? '<span class="diamond"></span>' : `<span class="dot" style="background:${W.HOUSES[p.house].color}"></span>`}
    <span style="flex:1">${p.bot ? '🤖 ' : ''}${esc(p.name)}${p.id === lobby.host ? ' <span class="muted small">(host)</span>' : ''}<br><span class="muted small">${p.role === 'shadow' ? 'Hollow' : W.HOUSES[p.house].name + ' Warden'}${p.online ? '' : ' · offline'}</span></span>
    ${p.bot && host ? `<select class="lvl" data-lvl="${p.id}" aria-label="Bot difficulty">${['easy', 'medium', 'hard'].map(l => `<option value="${l}" ${p.bot === l ? 'selected' : ''}>${l[0].toUpperCase() + l.slice(1)}</option>`).join('')}</select><button class="small" data-rm="${p.id}" aria-label="Remove bot">✕</button>` : ''}</li>`).join('');
  $('#plist').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => socket.emit('removeBot', { id: b.dataset.rm }));
  $('#plist').querySelectorAll('[data-lvl]').forEach(b => b.onchange = () => socket.emit('botLevel', { id: b.dataset.lvl, level: b.value }));
  $('#botBox').classList.toggle('hidden', !host || lobby.players.length >= 5);
  const hasShadow = lobby.players.some(p => p.role === 'shadow');
  const houses = lobby.players.filter(p => p.role === 'house').length;
  const ready = hasShadow && houses >= 1;
  const isHost = lobby.host === pid;
  $('#startBtn').classList.toggle('hidden', !isHost);
  $('#startBtn').disabled = !ready;
  $('#startHint').textContent = !ready ? 'You need one Hollow player and at least one Warden. Share the code with friends.' :
    isHost ? 'Everyone ready? Start when your friends have joined.' : 'Waiting for the host to start.';
}

// ---------- main render ----------
function render() {
  if (!lobby) return show('home');
  if (!lobby.started || !S) return renderRoom();
  show('game');
  $('#gCode').textContent = lobby.code;
  renderTurnLine(); renderBoard(); renderBanner(); renderCardPanel(); renderHand(); renderActions(); renderMine(); renderTracks(); renderPlayers();
  if (S.phase === 'over') { if (ui.modal !== 'log' && ui.modal !== 'rules') openModal('win'); }
  else if (S.prompt && S.prompt.seat === S.you) openModal('prompt');
  else if (ui.modal === 'prompt' || ui.modal === 'win') closeModal();
  else if (ui.modal === 'log') openModal('log');
}

const me = () => S.seats[S.you];
const myTurn = () => S.phase === 'play' && S.turn && S.turn.seat === S.you && !S.prompt;
function seatName(i) { const p = S.seats[i]; return p.role === 'house' ? `${p.name} (${W.HOUSES[p.house].name})` : `${p.name} (Hollow)`; }
function seatColor(i) { const p = S.seats[i]; return p.role === 'house' ? W.HOUSES[p.house].color : 'var(--hollow)'; }

function renderTurnLine() {
  const t = S.turn; if (!t) return;
  $('#turnLine').innerHTML = S.phase === 'over' ? 'Game over' :
    `<span class="dot" style="display:inline-block;vertical-align:middle;background:${seatColor(t.seat)}"></span> ${t.seat === S.you ? 'Your turn' : esc(seatName(t.seat)) + "'s turn"}${S.final ? ' · final night' : ''}`;
}

function renderBanner() {
  const b = $('#banner'); b.className = 'banner';
  if (S.phase === 'over') { b.textContent = S.winner.text; return; }
  if (S.prompt && S.prompt.seat !== S.you) { b.classList.add('wait'); b.textContent = `Waiting for ${seatName(S.prompt.seat)} to choose…`; return; }
  if (!myTurn()) { b.classList.add('wait'); b.textContent = `${seatName(S.turn.seat)} is taking their turn.`; return; }
  b.classList.add('mine');
  const t = S.turn;
  if (t.card) b.textContent = 'Move your pawns, play another card if you have an action left, or end your turn.';
  else if (t.main > 0) b.textContent = me().role === 'house' ? 'Your turn: play a card, Learn, or Replenish.' : 'Your turn: play a card or Replenish.';
  else b.textContent = 'No main actions left. End your turn when ready.';
}

// ---------- movement helpers ----------
function moveState() {
  const t = S.turn; if (!t || !t.card) return null;
  const c = W.CARDS[t.card.key];
  const free = c.mv.map((v, i) => i).filter(i => !t.card.used.includes(i));
  const direct = !!c.direct && !t.card.used.includes('direct');
  if (!free.length) return { c, none: true, direct };
  let use = free[0], budget = c.mv[use];
  if (c.mv.length === 2 && free.length === 2 && ui.combine) { use = 'both'; budget = c.mv[0] + c.mv[1]; }
  return { c, use, budget, direct, free };
}
function reachFor(ref) {
  const ms = moveState(); if (!ms || ms.none) return {};
  const isH = me().role === 'house';
  const opts = { side: isH ? 'house' : 'shadow', pass: ms.c.pass || [], fly: !!ms.c.fly, secret: !!ms.c.secret, hiddenOpen: S.hiddenOpen };
  const out = {};
  if (ref === 'pool') {
    const free = W.DEPLOY.filter(n => !S.shadowPawns.some(p => p.node === n));
    free.forEach(d => {
      if (ms.budget < 1) return;
      if (!out[d] || out[d].cost > 1) out[d] = { cost: 1, path: ['pool', d] };
      const r = W.reachable(d, opts, ms.budget - 1);
      for (const k in r) { const c = r[k].cost + 1; if (!out[k] || out[k].cost > c) out[k] = { cost: c, path: ['pool'].concat(r[k].path) }; }
    });
    return out;
  }
  const pw = isH ? S.house[S.you][ref] : S.shadowPawns[ref];
  const extra = isH && ms.c.outside ? ms.c.outside : 0;
  const r = W.reachable(pw.node, opts, ms.budget + extra);
  for (const k in r) if (r[k].cost <= ms.budget || !W.NODES[k].castle) out[k] = r[k];
  return out;
}
function canMovePawn(i) {
  const t = S.turn; if (!myTurn() || !t.card) return false;
  if (t.card.moved.includes(i)) return false;
  const isH = me().role === 'house';
  const pw = isH ? S.house[S.you][i] : S.shadowPawns[i];
  return pw && !pw.stunned && (pw.node || !isH);
}

// ---------- board ----------
const HOUSE_GLYPH = { ember: '🔥', tide: '🌊', gale: '🌪', thorn: '🌹' };
const NS = 'http://www.w3.org/2000/svg';
let boardBuilt = false, decor = '';
function seeded(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
function buildDecor() {
  const N = W.NODES; const r = seeded(7); let s = '';
  const clear = (x, y) => !(x > 185 && x < 905 && y > 30 && y < 615) && Object.values(N).every(n => Math.hypot(n.x - x, n.y - y) > 62) &&
    ((x - 130) ** 2 / 125 ** 2 + (y - 805) ** 2 / 100 ** 2) > 1;
  let trees = 0, tries = 0;
  while (trees < 70 && tries++ < 4000) {
    const x = r() * 1000, y = 560 + r() * 440;
    const x2 = r() < .35 ? r() * 190 : x, y2 = r() < .35 ? r() * 600 : y;
    const X = r() < .5 ? x : x2, Y = r() < .5 ? y : y2;
    if (!clear(X, Y)) continue;
    const h = 22 + r() * 18, g = r() < .5 ? '#1d3d27' : '#244a2f';
    s += `<path d="M${X} ${Y - h} L${X + h * .55} ${Y + 4} L${X - h * .55} ${Y + 4}Z" fill="${g}"/><path d="M${X} ${Y - h * .65} L${X + h * .45} ${Y + 12} L${X - h * .45} ${Y + 12}Z" fill="${g}" opacity=".85"/>`;
    trees++;
  }
  for (let i = 0; i < 40; i++) { const x = r() * 1000, y = 620 + r() * 380; if (clear(x, y)) s += `<circle cx="${x}" cy="${y}" r="${1 + r() * 2}" fill="#9fc58a" opacity=".25"/>`; }
  return s;
}
function buildBoard() {
  const svg = $('#board');
  const hg = Object.entries(W.HOUSES).map(([k, h]) => `<radialGradient id="gH_${k}" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".35" stop-color="${h.color}"/><stop offset="1" stop-color="#1a1410"/></radialGradient>`).join('');
  svg.innerHTML = `<defs>
    <radialGradient id="gGround" cx="50%" cy="60%" r="75%"><stop offset="0" stop-color="#3f6e48"/><stop offset=".7" stop-color="#26462f"/><stop offset="1" stop-color="#14261a"/></radialGradient>
    <pattern id="pStone" width="48" height="24" patternUnits="userSpaceOnUse"><rect width="48" height="24" fill="#555b73"/><path d="M0 0H48M0 12H48M0 24H48M12 0V12M36 0V12M0 12V24M24 12V24" stroke="#3e4358" stroke-width="2"/></pattern>
    <linearGradient id="gFloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4e5470"/><stop offset="1" stop-color="#3a3f55"/></linearGradient>
    <linearGradient id="gWater" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a8ab8"/><stop offset="1" stop-color="#173350"/></linearGradient>
    <radialGradient id="gMoon"><stop offset="0" stop-color="#fffbe8" stop-opacity=".9"/><stop offset=".25" stop-color="#fff2c4" stop-opacity=".35"/><stop offset="1" stop-color="#fff2c4" stop-opacity="0"/></radialGradient>
    <radialGradient id="gNode" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fff8e6"/><stop offset=".6" stop-color="#e6d3a6"/><stop offset="1" stop-color="#b49660"/></radialGradient>
    <radialGradient id="gNodeOut" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#f2f6dc"/><stop offset=".6" stop-color="#c6d2a2"/><stop offset="1" stop-color="#8a9a66"/></radialGradient>
    <radialGradient id="gNodeHid" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#f3eaff"/><stop offset="1" stop-color="#8e6cc4"/></radialGradient>
    <radialGradient id="gHollow" cx="50%" cy="25%" r="80%"><stop offset="0" stop-color="#e2c6ff"/><stop offset=".4" stop-color="#8a3fc4"/><stop offset="1" stop-color="#1c0830"/></radialGradient>
    <radialGradient id="gFog"><stop offset="0" stop-color="#cfd6e6" stop-opacity=".55"/><stop offset="1" stop-color="#cfd6e6" stop-opacity="0"/></radialGradient>
    <radialGradient id="gAura"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    ${hg}
    <filter id="fShadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="4" stdDeviation="3" flood-color="#000" flood-opacity=".55"/></filter>
    <filter id="fGlow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <g id="mapLayer"></g>
  <g id="fogLayer" pointer-events="none">
    <rect id="skyTint" x="0" y="0" width="1000" height="1000" fill="#000" opacity="0"/>
    <ellipse class="fog f1" cx="300" cy="700" rx="420" ry="160" fill="url(#gFog)"/>
    <ellipse class="fog f2" cx="760" cy="420" rx="380" ry="150" fill="url(#gFog)"/>
    <ellipse class="fog f3" cx="500" cy="900" rx="460" ry="130" fill="url(#gFog)"/>
  </g>
  <g id="pawnLayer"></g>
  <g id="fxLayer" pointer-events="none"></g>`;
  decor = buildDecor();
  boardBuilt = true;
}

function renderBoard() {
  if (!boardBuilt) buildBoard();
  const N = W.NODES;
  let s = `<rect x="0" y="0" width="1000" height="1000" fill="url(#gGround)"/>
    <circle cx="950" cy="50" r="170" fill="url(#gMoon)"/><circle cx="950" cy="50" r="26" fill="#fff8de"/>
    <ellipse cx="130" cy="805" rx="128" ry="102" fill="#10273a" opacity=".6"/>
    <ellipse cx="130" cy="805" rx="120" ry="95" fill="url(#gWater)"/>
    <path d="M60 790 q30 -8 60 0 M95 830 q30 -8 60 0 M70 760 q20 -6 40 0" stroke="#bfe0ff" stroke-width="3" fill="none" opacity=".35" class="shimmer"/>
    <path d="M760 720 Q880 760 940 860 T1000 990" stroke="#10273a" stroke-width="34" fill="none" opacity=".6"/>
    <path d="M760 720 Q880 760 940 860 T1000 990" stroke="url(#gWater)" stroke-width="24" fill="none"/>
    ${decor}
    <rect x="206" y="55" width="690" height="555" rx="30" fill="#000" opacity=".45"/>
    <rect x="200" y="45" width="690" height="555" rx="30" fill="url(#pStone)"/>
    <rect x="218" y="63" width="654" height="519" rx="20" fill="url(#gFloor)" opacity=".92"/>`;
  for (let x = 236; x < 860; x += 34) s += `<rect x="${x}" y="33" width="18" height="16" fill="#555b73" stroke="#3e4358" stroke-width="2"/>`;
  [[205, 50], [885, 50], [205, 595], [885, 595]].forEach(([x, y]) => (s += `<circle cx="${x}" cy="${y}" r="30" fill="url(#pStone)" stroke="#2f3346" stroke-width="4"/><path d="M${x - 24} ${y - 8} L${x} ${y - 52} L${x + 24} ${y - 8}Z" fill="#5a2c3a" stroke="#2f1820" stroke-width="3"/>`));
  [[575, 612], [665, 612], [790, 612]].forEach(([x, y]) => (s += `<g class="torch"><circle cx="${x}" cy="${y - 6}" r="16" fill="#ffb347" opacity=".25"/><path d="M${x} ${y - 18} q8 10 0 16 q-8 -6 0 -16Z" fill="#ffcf5a"/><rect x="${x - 2}" y="${y - 2}" width="4" height="12" fill="#3a2a1a"/></g>`));

  W.EDGES.forEach(([a, b]) => {
    const A = N[a], B = N[b]; const hid = a === 'hidden' || b === 'hidden';
    if (hid && !S.hiddenOpen) return;
    s += `<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" class="road ${hid ? 'hid' : ''}"/><line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" class="edge ${hid ? 'hid' : ''}"/>`;
  });
  W.SECRETS.forEach(([a, b, col]) => {
    const A = N[a], B = N[b]; const mx = (A.x + B.x) / 2 + (B.y - A.y) * .18, my = (A.y + B.y) / 2 - (B.x - A.x) * .18;
    s += `<path d="M${A.x} ${A.y} Q${mx} ${my} ${B.x} ${B.y}" class="secret" stroke="${col}"/>`;
  });
  W.EDGES.forEach(([a, b, o]) => {
    if (!o) return; const A = N[a], B = N[b]; const x = (A.x + B.x) / 2, y = (A.y + B.y) / 2;
    s += `<g class="obs obs-${o}"><circle cx="${x}" cy="${y}" r="16"/><text x="${x}" y="${y}">${W.OBS[o].icon}</text></g>`;
  });

  let reach = {};
  if (myTurn() && ui.pawn !== null && S.turn.card) reach = reachFor(ui.pawn);
  const myLocs = S.locs || [];
  for (const k in N) {
    const n = N[k];
    const hidClosed = n.hidden && !S.hiddenOpen;
    const cls = ['node', n.castle ? '' : 'outside', n.prot ? 'prot' : '', n.hidden ? 'hid' : '', hidClosed ? 'closed' : '', reach[k] ? 'reach' : '', myLocs.includes(k) ? 'myloc' : '', S.target === k ? 'target' : '', S.shields[k] ? 'shieldy' : ''].join(' ');
    const icons = [];
    if (n.library) icons.push('📖');
    if (n.fly) icons.push('🪶');
    if (n.valor) icons.push('⭐');
    if (n.bonus === 'draw') icons.push('🃏');
    if (n.bonus === 'again') icons.push('🔁');
    if (n.bonus === 'acquire') icons.push('✚');
    if (n.deploy) icons.push('◆');
    if (n.token && S.tokens[n.token] === k) icons.push(W.DISC[n.token].icon);
    if (n.hidden) icons.push('🚪');
    if (n.start) icons.push('🏰');
    const fill = n.hidden ? 'url(#gNodeHid)' : n.castle ? 'url(#gNode)' : 'url(#gNodeOut)';
    const above = ['hidden', 'study', 'tower', 'clock'].includes(k);
    s += `<g class="${cls}" data-node="${k}">
      ${S.shields[k] ? `<circle class="aura" cx="${n.x}" cy="${n.y}" r="52" fill="url(#gAura)"/>` : ''}
      <circle class="ring3" cx="${n.x}" cy="${n.y}" r="46"/>
      <circle class="ring2" cx="${n.x}" cy="${n.y}" r="40"/>
      <circle class="ring" cx="${n.x}" cy="${n.y}" r="36"/>
      <circle class="base" cx="${n.x}" cy="${n.y}" r="31" fill="${fill}" filter="url(#fShadow)"/>
      <circle cx="${n.x}" cy="${n.y}" r="25" fill="none" stroke="#7a5a28" stroke-opacity=".45" stroke-width="2"/>
      <text class="ico" x="${n.x}" y="${n.y}">${icons.slice(0, 2).join('')}</text>
      ${S.shields[k] ? `<g transform="translate(${n.x - 40} ${n.y - 44})"><path d="M14 0 L28 5 L26 20 L14 30 L2 20 L0 5Z" fill="#d9a441" stroke="#5a3d10" stroke-width="2"/><text x="14" y="16" font-size="13" text-anchor="middle" dominant-baseline="central">${S.shields[k] === 'lens' ? '🔍' : '⭕'}</text></g>` : ''}
      <text class="lbl" x="${n.x}" y="${above ? n.y - 52 : n.y + 56}">${esc(n.name)}</text>
      ${reach[k] ? `<circle cx="${n.x + 30}" cy="${n.y - 30}" r="14" fill="#1f6b3a" stroke="#c9ffd9" stroke-width="2"/><text class="cost" x="${n.x + 30}" y="${n.y - 30}">${reach[k].cost}</text>` : ''}
    </g>`;
  }
  $('#mapLayer').innerHTML = s;

  // atmosphere deepens along the Shadow Path
  const zone = W.PATH[S.marker].zone;
  const tint = { white: ['#0a1030', .12], orange: ['#3a1a00', .22], red: ['#3a0006', .32] }[zone];
  const sky = $('#skyTint'); sky.setAttribute('fill', tint[0]); sky.setAttribute('opacity', tint[1] + S.marker * 0.006);
  document.querySelectorAll('#fogLayer .fog').forEach(f => (f.style.opacity = 0.25 + S.marker * 0.03));
  const fogCol = { white: '#cfd6e6', orange: '#c99a72', red: '#7a2a3c' }[zone];
  document.querySelectorAll('#gFog stop').forEach(st => st.setAttribute('stop-color', fogCol));
  document.body.dataset.zone = zone;
  renderPawns();
}

function pawnSlots() {
  const at = {};
  Object.keys(S.house).forEach(seat => S.house[seat].forEach((pw, i) => { if (pw.node) (at[pw.node] = at[pw.node] || []).push({ key: `h${seat}_${i}`, kind: 'h', seat: +seat, i, pw }); }));
  S.shadowPawns.forEach((pw, i) => { if (pw.node) (at[pw.node] = at[pw.node] || []).push({ key: `s${i}`, kind: 's', i, pw }); });
  const pos = {};
  for (const k in at) {
    const n = W.NODES[k], list = at[k];
    list.forEach((p, j) => {
      if (list.length === 1) { pos[p.key] = { ...p, x: n.x + 24, y: n.y + 22 }; return; }
      const ang = (-160 + j * (320 / list.length)) * Math.PI / 180;
      pos[p.key] = { ...p, x: n.x + Math.cos(ang) * 42, y: n.y + Math.sin(ang) * 42 };
    });
  }
  return pos;
}
function renderPawns() {
  const layer = $('#pawnLayer'); const pos = pawnSlots();
  const all = [];
  Object.keys(S.house).forEach(seat => S.house[seat].forEach((pw, i) => all.push(`h${seat}_${i}`)));
  S.shadowPawns.forEach((pw, i) => all.push(`s${i}`));
  all.forEach(key => {
    let g = layer.querySelector(`[data-key="${key}"]`);
    const isH = key[0] === 'h';
    if (!g) {
      g = document.createElementNS(NS, 'g'); g.setAttribute('data-key', key); g.setAttribute('class', 'pw');
      if (isH) {
        const seat = +key.slice(1).split('_')[0]; const h = S.seats[seat].house;
        g.innerHTML = `<circle class="paura" r="26" fill="${W.HOUSES[h].color}" opacity=".35"/><circle class="pbody" r="17" fill="url(#gH_${h})" stroke="#fff3d0" stroke-width="3" filter="url(#fShadow)"/><text class="pglyph" y="1">${HOUSE_GLYPH[h]}</text><text class="pstun" y="-24">💫</text>`;
      } else {
        g.innerHTML = `<ellipse class="paura" rx="28" ry="24" fill="#a64dff" opacity=".35"/><path class="pbody" d="M0 -24 C14 -24 16 -8 16 4 L21 22 L10 15 L0 23 L-10 15 L-21 22 L-16 4 C-16 -8 -14 -24 0 -24Z" fill="url(#gHollow)" stroke="#1a0626" stroke-width="2.5" filter="url(#fShadow)"/><circle cx="-5" cy="-9" r="2.6" fill="#ffe24d"/><circle cx="5" cy="-9" r="2.6" fill="#ffe24d"/><text class="pstun" y="-30">💫</text>`;
      }
      layer.appendChild(g);
    }
    const p = pos[key];
    const pw = isH ? S.house[key.slice(1).split('_')[0]][+key.split('_')[1]] : S.shadowPawns[+key.slice(1)];
    if (!p) { g.classList.add('gone'); g.removeAttribute('data-pawn'); return; }
    g.classList.remove('gone');
    const mine = isH ? p.seat === S.you : me().role === 'shadow';
    const ref = p.i;
    g.style.transform = `translate(${p.x}px, ${p.y}px)`;
    g.classList.toggle('stun', !!pw.stunned);
    g.classList.toggle('mine', mine && myTurn());
    g.classList.toggle('sel', mine && ui.pawn === ref);
    if (mine) g.setAttribute('data-pawn', ref); else g.removeAttribute('data-pawn');
  });
}

// ---------- effects ----------
let prevLog = null;
function nodeIn(line) {
  const names = Object.keys(W.NODES).sort((a, b) => W.NODES[b].name.length - W.NODES[a].name.length);
  const i = line.lastIndexOf(' at ');
  const tail = i >= 0 ? line.slice(i) : line;
  return names.find(k => tail.includes(W.NODES[k].name)) || names.find(k => line.includes(W.NODES[k].name));
}
function fxAt(node, kind) {
  const n = W.NODES[node]; if (!n) return;
  const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'fx fx-' + kind);
  g.style.transform = `translate(${n.x}px, ${n.y}px)`;
  if (kind === 'clash') g.innerHTML = `<circle r="20" class="burst"/>` + Array.from({ length: 10 }, (_, i) => { const a = i * 36 * Math.PI / 180; return `<line x1="${Math.cos(a) * 18}" y1="${Math.sin(a) * 18}" x2="${Math.cos(a) * 48}" y2="${Math.sin(a) * 48}" class="spark"/>`; }).join('');
  if (kind === 'bump') g.innerHTML = `<circle r="24" class="wisp"/><circle r="12" class="wisp w2"/>`;
  if (kind === 'shield') g.innerHTML = `<rect x="-26" y="-420" width="52" height="440" class="pillar"/><circle r="40" class="burst gold"/>`;
  if (kind === 'reveal') g.innerHTML = `<circle r="30" class="burst violet"/>`;
  if (kind === 'step') g.innerHTML = `<circle r="12" class="ripple"/>`;
  $('#fxLayer').appendChild(g);
  setTimeout(() => g.remove(), 1800);
}
function splash(title, body, zone) {
  const el = $('#splash');
  el.innerHTML = `<div class="splashcard z-${zone || 'white'}"><div class="sz">${zone ? W.ZONES[zone].name : ''}</div><h2>${esc(title)}</h2>${body}</div>`;
  el.classList.remove('hidden'); el.classList.remove('out'); void el.offsetWidth; el.classList.add('in');
  clearTimeout(splash.h); splash.h = setTimeout(() => { el.classList.add('out'); setTimeout(() => el.classList.add('hidden'), 450); }, 2600);
}
function processLog(log) {
  if (prevLog === null) { prevLog = log.slice(); return; }
  const last = prevLog[prevLog.length - 1];
  let start = last ? log.lastIndexOf(last) + 1 : 0;
  if (start === 0 && last) start = Math.max(0, log.length - 6);
  const fresh = log.slice(start);
  prevLog = log.slice();
  let moved = false;
  fresh.forEach(line => {
    if (line.startsWith('💥')) { const n = nodeIn(line); fxAt(n, 'clash'); sfx('clash'); shake(); }
    else if (line.startsWith('👻')) { const n = nodeIn(line); fxAt(n, 'bump'); fxAt('hall', 'bump'); sfx('bump'); }
    else if (line.startsWith('🛡')) { const n = nodeIn(line); fxAt(n, 'shield'); sfx('shield'); }
    else if (line.startsWith('⚡ Event:')) {
      const name = line.slice(9).split(' — ')[0]; const ev = Object.values(W.EVENTS).find(e => e.name === name);
      if (ev) { splash(ev.name, `<p><b>Wardens:</b> ${esc(ev.houseText)}</p><p><b>Hollow may gain:</b> ${esc(ev.darkText)}</p>`, ev.zone); sfx('event'); }
    }
    else if (line.includes('reveals itself')) { fxAt('hidden', 'reveal'); sfx('reveal'); }
    else if (line.startsWith('☠')) { splash('The Hollow strikes', `<p>${esc(line.slice(2))}</p>`, 'red'); sfx('event'); }
    else if (line.includes('moves') || line.includes('appears at')) { const n = nodeIn(line); if (n) fxAt(n, 'step'); moved = true; }
    else if (line.startsWith('🌑')) { splash('The final night', '<p>Everyone draws up to 5. No more Replenish.</p>', 'red'); sfx('event'); }
  });
  if (moved) sfx('move');
}
function shake() {
  const b = $('#boardWrap'); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
}

// ---------- sound ----------
let muted = store.get('wt_mute') === '1';
function tone(f, t0, dur, type = 'sine', vol = .1, f2) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, actx.currentTime + t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, actx.currentTime + t0 + dur);
  g.gain.setValueAtTime(vol, actx.currentTime + t0); g.gain.exponentialRampToValueAtTime(.0001, actx.currentTime + t0 + dur);
  o.connect(g); g.connect(actx.destination); o.start(actx.currentTime + t0); o.stop(actx.currentTime + t0 + dur + .02);
}
function noise(t0, dur, vol) {
  const len = actx.sampleRate * dur, buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = actx.createBufferSource(), g = actx.createGain(); g.gain.value = vol; src.buffer = buf; src.connect(g); g.connect(actx.destination); src.start(actx.currentTime + t0);
}
function sfx(kind) {
  if (muted) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (kind === 'move') { tone(320, 0, .12, 'triangle', .06, 520); }
    if (kind === 'turn') { tone(660, 0, .18, 'triangle', .08); tone(880, .12, .3, 'triangle', .07); }
    if (kind === 'clash') { noise(0, .25, .25); tone(140, 0, .3, 'sawtooth', .08, 60); }
    if (kind === 'bump') { tone(500, 0, .5, 'sine', .09, 90); noise(0, .4, .08); }
    if (kind === 'event') { tone(98, 0, 1.6, 'sine', .18); tone(196, 0, 1.2, 'sine', .07); tone(147, .05, 1.4, 'triangle', .05); }
    if (kind === 'shield') { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * .09, .5, 'triangle', .08)); }
    if (kind === 'reveal') { tone(392, 0, .6, 'sine', .07, 784); }
    if (kind === 'win') { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * .14, .7, 'triangle', .09)); }
    if (kind === 'lose') { [392, 349, 311, 262].forEach((f, i) => tone(f, i * .22, .8, 'sine', .09)); }
  } catch (e) {}
}

// ---------- celebration ----------
function embers(colors) {
  const c = $('#confetti'); const x = c.getContext('2d');
  c.width = innerWidth; c.height = innerHeight; c.classList.remove('hidden');
  const ps = Array.from({ length: 140 }, () => ({ x: Math.random() * c.width, y: c.height + Math.random() * 200, vx: (Math.random() - .5) * 1.5, vy: -2 - Math.random() * 4, r: 2 + Math.random() * 4, col: colors[Math.floor(Math.random() * colors.length)], life: 1 }));
  const t0 = performance.now();
  (function frame(t) {
    x.clearRect(0, 0, c.width, c.height);
    ps.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += .015; p.life -= .004; x.globalAlpha = Math.max(0, p.life); x.fillStyle = p.col; x.beginPath(); x.arc(p.x, p.y, p.r, 0, 7); x.fill(); });
    if (t - t0 < 4500) requestAnimationFrame(frame); else { x.clearRect(0, 0, c.width, c.height); c.classList.add('hidden'); }
  })(t0);
}

$('#board').addEventListener('click', e => {
  if (!S) return;
  const pawnEl = e.target.closest('[data-pawn]');
  if (pawnEl) {
    const i = +pawnEl.dataset.pawn;
    if (ui.direct && canMovePawn(i)) { act({ type: 'move', pawn: i, use: 'direct' }); ui.direct = false; return; }
    if (canMovePawn(i)) { ui.pawn = ui.pawn === i ? null : i; renderBoard(); renderCardPanel(); }
    else if (myTurn() && S.turn.card) toast('That pawn can’t move right now.');
    return;
  }
  const nodeEl = e.target.closest('[data-node]');
  if (!nodeEl) return;
  const k = nodeEl.dataset.node;
  showNodeInfo(k);
  if (myTurn() && ui.pawn !== null && S.turn.card) {
    const r = reachFor(ui.pawn)[k];
    if (r) {
      const ms = moveState();
      act({ type: 'move', pawn: ui.pawn === 'pool' ? S.shadowPawns.findIndex(p => p.node === null) : ui.pawn, path: r.path, use: ms.use });
      ui.pawn = null;
    }
  }
});
function showNodeInfo(k) {
  const n = W.NODES[k]; const f = [];
  f.push(n.castle ? 'inside the castle' : 'castle grounds');
  if (n.prot) f.push('protected (Hollow can’t enter)');
  if (n.start) f.push('Warden start');
  if (n.hidden) f.push(S.hiddenOpen ? 'open: enter for a Circle Sigil' : 'closed until a Warden reaches Valor 5');
  if (n.library) f.push('take a Tome');
  if (n.fly) f.push('fly point');
  if (n.valor) f.push('+1 Valor');
  if (n.bonus === 'draw') f.push('draw a card');
  if (n.bonus === 'again') f.push('extra main action');
  if (n.bonus === 'acquire') f.push('take a Spell card');
  if (n.deploy) f.push('Hollow deployment');
  if (n.token) f.push(`${W.DISC[n.token].name} token${S.tokens[n.token] === k ? '' : ' (taken)'}`);
  if (S.shields[k]) f.push(`Shield needs Tome + Scroll + ${S.shields[k] === 'lens' ? 'Seeker Lens' : 'Circle Sigil'}`);
  if (W.DARK_LOCS.includes(k)) f.push('possible Hollow target');
  $('#nodeInfo').textContent = `${n.name}: ${f.join(', ')}.`;
}
$('#zoomBtn').onclick = () => {
  ui.zoom = ui.zoom === 1 ? 1.6 : ui.zoom === 1.6 ? 2.3 : 1;
  $('#board').style.width = (ui.zoom * 100) + '%';
  $('#zoomBtn').textContent = `Zoom ${ui.zoom}×`;
};

// ---------- card panel / hand / actions ----------
function mvText(c) { return c.mv.length ? (c.mv.length === 2 ? `Move ${c.mv[0]}+${c.mv[1]}` : `Move ${c.mv[0]}`) : 'Special move'; }
function cardHtml(key, extra = '') {
  const c = W.CARDS[key];
  const mv = c.mv.length ? c.mv.join('+') : '➜';
  const tag = c.disc ? `${W.DISC[c.disc].icon} ${W.DISC[c.disc].name}` : c.zone ? `<span class="gem" style="background:${W.ZONES[c.zone].color}"></span>${W.ZONES[c.zone].name} effect` : 'Hollow';
  return `<div class="chead"><div class="nm">${esc(c.name)}</div><div class="medal" title="${mvText(c)}">${mv}</div></div>
    <div class="art">${c.disc ? W.DISC[c.disc].icon : '👁'}${c.fly ? '🪶' : ''}${c.react ? '⚡' : ''}</div>
    <div class="tx">${esc(c.text)}</div><div class="dsc">${tag}</div>${extra}`;
}
function renderCardPanel() {
  const el = $('#cardPanel'); el.innerHTML = '';
  if (!myTurn() || !S.turn.card) return;
  const ms = moveState(); const c = ms.c;
  let h = `<div class="cardpanel"><div><b>${esc(c.name)}</b> <span class="muted">— ${mvText(c)}</span></div>`;
  if (ms.none && !ms.direct) h += `<div class="muted">This card’s movement is used up.</div>`;
  if (!ms.none) {
    if (c.mv.length === 2 && ms.free.length === 2) h += `<div class="row"><button class="small toggle ${ui.combine ? '' : 'on'}" data-comb="0">Split: 2 pawns × ${c.mv[0]}</button><button class="small toggle ${ui.combine ? 'on' : ''}" data-comb="1">Combine: 1 pawn × ${c.mv[0] + c.mv[1]}</button></div>`;
    h += `<div class="muted small">Movement left: ${ms.budget}${c.outside ? ` (+${c.outside} if ending outside)` : ''}. ${ui.pawn === null ? 'Tap one of your pawns' : 'Tap a glowing space'}${c.pass ? ` · passes ${c.pass.map(o => W.OBS[o].icon).join(' ')}` : ''}${c.secret ? ' · secret passages' : ''}.</div>`;
    if (me().role === 'shadow' && S.shadowPawns.some(p => p.node === null)) h += `<button class="small ${ui.pawn === 'pool' ? 'toggle on' : ''}" data-pool>Bring a pawn from the pool (costs 1)</button>`;
  }
  if (ms.direct) h += `<button class="small ${ui.direct ? 'toggle on' : ''}" data-direct>Move a pawn straight to the ${W.NODES[c.direct].name}</button>${ui.direct ? '<div class="muted small">Now tap one of your pawns.</div>' : ''}`;
  h += '</div>';
  el.innerHTML = h;
  el.querySelectorAll('[data-comb]').forEach(b => b.onclick = () => { ui.combine = b.dataset.comb === '1'; ui.pawn = null; render(); });
  const pool = el.querySelector('[data-pool]'); if (pool) pool.onclick = () => { ui.pawn = ui.pawn === 'pool' ? null : 'pool'; render(); };
  const dir = el.querySelector('[data-direct]'); if (dir) dir.onclick = () => { ui.direct = !ui.direct; ui.pawn = null; render(); };
}
function renderHand() {
  const el = $('#hand'); const p = me();
  if (!S.hand.length) { el.innerHTML = `<p class="muted">No cards in hand.${!S.final ? ' Replenish to draw back up to 5.' : ''}</p>`; return; }
  const canPlay = myTurn() && S.turn.main > 0;
  const tokOk = myTurn() && p.role === 'house' && p.token && p.tokenReady && !S.turn.tokenUsed;
  el.innerHTML = S.hand.map((k, i) => {
    const c = W.CARDS[k]; const sel = ui.card === i;
    let btns = '';
    if (sel && myTurn()) {
      btns = `<div class="row">${canPlay ? `<button data-play="${i}">Play</button>` : ''}${tokOk && c.disc === p.token ? `<button data-tok="${i}">Play with token</button>` : ''}</div>`;
      if (!canPlay && !(tokOk && c.disc === p.token)) btns = '<div class="small">No action left to play this.</div>';
    }
    return `<div class="card ${c.side === 'shadow' ? 'shadow' : ''} ${sel ? 'sel' : ''}" data-card="${i}" data-disc="${c.disc || 'hollow'}">${cardHtml(k, btns)}</div>`;
  }).join('');
  el.querySelectorAll('[data-card]').forEach(d => d.onclick = e => {
    if (e.target.closest('button')) return;
    const i = +d.dataset.card; ui.card = ui.card === i ? null : i; renderHand();
  });
  el.querySelectorAll('[data-play]').forEach(b => b.onclick = () => { act({ type: 'play', idx: +b.dataset.play }); ui.card = null; ui.pawn = null; });
  el.querySelectorAll('[data-tok]').forEach(b => b.onclick = () => { act({ type: 'play', idx: +b.dataset.tok, viaToken: true }); ui.card = null; ui.pawn = null; });
}
function renderActions() {
  const el = $('#actions');
  if (!myTurn()) { el.innerHTML = ''; return; }
  const p = me(); const t = S.turn;
  let h = `<span class="muted small" style="flex-basis:100%">Main actions left: ${t.main}</span>`;
  if (p.role === 'house') h += `<button id="aLearn" ${t.main > 0 && S.hand.length ? '' : 'disabled'}>Learn</button>`;
  h += `<button id="aRep" ${t.main > 0 && !S.final ? '' : 'disabled'}>Replenish</button>`;
  h += `<button id="aEnd" class="primary" ${t.took || (S.final && !S.hand.length) ? '' : 'disabled'}>End turn</button>`;
  el.innerHTML = h;
  const L = $('#aLearn'); if (L) L.onclick = () => { ui.learn = { src: null, d: [] }; openModal('learn'); };
  $('#aRep').onclick = () => { if (p.role === 'house') { ui.rep = []; openModal('rep'); } else act({ type: 'replenish' }); };
  $('#aEnd').onclick = () => { act({ type: 'end' }); ui.pawn = null; ui.card = null; };
}
function itemsHtml(i) {
  const p = S.seats[i];
  if (p.role !== 'house') return '';
  return `${p.tome ? '📖' : ''}${'📜'.repeat(p.scrolls)}${S.lens === i ? '🔍' : ''}${p.sigil ? '⭕' : ''}${p.token ? W.DISC[p.token].icon : ''} 🛡${p.shields}/2`;
}
function renderMine() {
  const p = me(); const el = $('#mine');
  if (p.role === 'house') {
    const need = [];
    need.push(p.tome ? `📖 Tome: ${W.TOMES[p.tome].name}` : '📖 No Tome yet — visit the Library');
    need.push(p.scrolls ? `📜 Scrolls: ${p.scrolls}` : '📜 No Scroll yet — reach 2 of your locations');
    need.push(S.lens === S.you ? '🔍 You hold the Seeker Lens' : p.sigil ? '⭕ You hold a Circle Sigil' : '🔍/⭕ Need the Lens (Valor 5+, highest) or a Sigil (Hidden Hall)');
    el.innerHTML = `<h3 style="margin-top:0">Your secrets &amp; items</h3>
      <div class="small">Location cards: ${S.locs.length ? S.locs.map(l => `<b>${esc(W.NODES[l].name)}</b>`).join(', ') : 'none left'} <span class="muted">(gold dashed rings on the map)</span></div>
      <ul class="small" style="margin:.4em 0;padding-left:1.1em">${need.map(n => `<li>${n}</li>`).join('')}</ul>
      <div class="small">Shields: ${p.shields}/2 · Valor: ${p.valor + 1}/7 · Deck ${p.deckCount} · Discard ${p.discardCount}${p.token ? ` · Token: ${W.DISC[p.token].icon} ${W.DISC[p.token].name}${p.tokenReady ? '' : ' (usable next turn)'}` : ''}</div>`;
  } else {
    const pool = S.shadowPawns.filter(x => !x.node).length;
    el.innerHTML = `<h3 style="margin-top:0">Your Hollow forces</h3>
      <div class="small">Pawns on the board: ${S.shadowPawns.length - pool} · in pool: ${pool} · Deck ${p.deckCount} · Discard ${p.discardCount}</div>
      <div class="small">House markers held: ${S.markers.length ? S.markers.map(seatName).map(esc).join(', ') : 'none'} (collect all to advance the path)</div>
      <div class="small">${S.target ? `Target: <b>${esc(W.NODES[S.target].name)}</b> — get ${S.need} pawn(s) there at once.` : 'Claim all 3 Shadow tokens to reveal your target room.'}</div>`;
  }
}
function renderTracks() {
  let h = '<h3 style="margin-top:0">Shadow Path</h3><div class="track path">';
  W.PATH.forEach((sp, i) => {
    h += `<div class="cell ${i === S.marker ? 'here' : ''}" style="background:${W.ZONES[sp.zone].color}" title="${W.ZONES[sp.zone].name}">${i === S.marker ? '☾' : sp.final ? '☠' : sp.event ? '⚡' : ''}</div>`;
  });
  h += '</div><div class="small">' + W.ZONE_ORDER.map(z => `${W.ZONES[z].token}: ${S.progress[z] ? '<b>claimed</b>' : 'free'}`).join(' · ') + '</div>';
  h += `<div class="small">${S.target ? `☠ Hollow target: <b>${esc(W.NODES[S.target].name)}</b> (needs ${S.need})` : ''}</div>`;
  h += '<h3>Valor track</h3><div class="track valor">';
  for (let v = 0; v < 7; v++) {
    const here = S.order.filter(i => S.seats[i].role === 'house' && S.seats[i].valor === v);
    h += `<div class="cell ${v >= 4 ? 'five' : ''}"><div class="dots">${v + 1}${here.map(i => `<i style="background:${seatColor(i)}"></i>`).join('')}</div></div>`;
  }
  h += `</div><div class="small">🔍 Seeker Lens: ${S.lens !== null && S.lens !== undefined ? esc(seatName(S.lens)) : 'unclaimed'} · Hidden Hall ${S.hiddenOpen ? '<b>open</b>' : 'closed'} · ⭕ Sigils left: ${S.sigils}</div>`;
  $('#tracks').innerHTML = h;
}
function renderPlayers() {
  $('#players').innerHTML = '<h3 style="margin-top:0">Players</h3>' + S.order.map(i => {
    const p = S.seats[i];
    const online = lobby.players.find(x => x.name === p.name);
    return `<div class="pl ${S.turn && S.turn.seat === i ? 'turn' : ''}">
      ${p.role === 'shadow' ? '<span class="diamond"></span>' : `<span class="dot" style="background:${seatColor(i)}"></span>`}
      <span class="who">${S.bots && S.bots[i] ? `🤖 ` : ''}${esc(p.name)}${i === S.you ? ' (you)' : ''}${S.bots && S.bots[i] ? ` <span class="muted small">${S.bots[i]}</span>` : ''}${p.skip ? ' · skips next' : ''}${S.markers.includes(i) ? ' · marker taken' : ''}${online && !online.online ? ' · offline' : ''}</span>
      <span class="items">${itemsHtml(i)}</span><span class="muted small">🂠${p.handCount}</span></div>`;
  }).join('');
}

// ---------- modals ----------
function openModal(kind) {
  ui.modal = kind;
  const sh = $('#sheet'); let h = '';
  if (kind === 'rules') h = $('#rulesTpl').innerHTML + '<button class="primary" data-close>Close</button>';
  if (kind === 'log') h = `<h2>Game log</h2><ul class="log">${(S ? S.log : []).map(l => `<li>${esc(l)}</li>`).join('')}</ul><button data-close>Close</button>`;
  if (kind === 'prompt') {
    const pr = S.prompt;
    h = `<h2>Your choice</h2><p>${esc(pr.text)}</p><div class="opts">${pr.options.map((o, i) => `<button data-ans="${i}">${esc(o.label)}</button>`).join('')}</div>`;
  }
  if (kind === 'win') {
    const w = S.winner; const youWon = (w.side === 'house' && w.seat === S.you) || (w.side === 'shadow' && me().role === 'shadow');
    h = `<div class="win"><h2>${w.side === 'draw' ? 'A draw' : youWon ? 'You win!' : w.side === 'shadow' ? 'The Hollow wins' : 'A Warden wins'}</h2><p>${esc(w.text)}</p>
      ${lobby.host === pid ? '<button class="primary" id="rematch">Back to the lobby</button>' : '<p class="muted">The host can take everyone back to the lobby.</p>'}
      <button data-open="log">See the log</button> <button id="quit" class="link">Leave room</button></div>`;
  }
  if (kind === 'learn') {
    const L = ui.learn;
    const opts = [];
    S.row.forEach((k, i) => k && opts.push({ src: 'row' + i, key: k, tag: 'Spell row · discard 1' }));
    S.adv.forEach((k, i) => k && opts.push({ src: 'adv' + i, key: k, tag: 'Advanced · discard 2, +1 Valor' }));
    const need = L.src && L.src.startsWith('adv') ? 2 : 1;
    h = `<h2>Learn</h2><p class="small muted">Pick a card, then choose ${L.src ? need : '1 or 2'} card(s) from your hand to discard. The new card goes on top of your deck.</p>
      <div class="pick">${opts.map(o => `<div class="card ${L.src === o.src ? 'sel' : ''}" data-src="${o.src}" data-disc="${W.CARDS[o.key].disc}">${cardHtml(o.key, `<div class="small"><b>${o.tag}</b></div>`)}</div>`).join('')}
      ${S.acqCount ? `<div class="card ${L.src === 'deck' ? 'sel' : ''}" data-src="deck"><div class="nm">Hidden card</div><div class="tx">Top card of the Spell deck (${S.acqCount} left). Discard 1.</div></div>` : ''}</div>
      <h3>Discard from your hand</h3><div class="pick">${S.hand.map((k, i) => `<div class="card ${L.d.includes(i) ? 'sel' : ''}" data-d="${i}" data-disc="${W.CARDS[k].disc}">${cardHtml(k)}</div>`).join('')}</div>
      <div class="row"><button class="primary" id="doLearn" ${L.src && L.d.length === need ? '' : 'disabled'}>Learn</button><button data-close>Cancel</button></div>`;
  }
  if (kind === 'rep') {
    h = `<h2>Replenish</h2><p class="small">Choose cards to discard (optional), then draw back up to 5 and stand up your pawns. <b>The Shadow Path will advance one space.</b></p>
      <div class="pick">${S.hand.map((k, i) => `<div class="card ${ui.rep.includes(i) ? 'sel' : ''}" data-r="${i}" data-disc="${W.CARDS[k].disc}">${cardHtml(k)}</div>`).join('')}</div>
      <div class="row"><button class="primary" id="doRep">Replenish${ui.rep.length ? ` (discard ${ui.rep.length})` : ''}</button><button data-close>Cancel</button></div>`;
  }
  sh.innerHTML = h;
  $('#modal').classList.remove('hidden');
  sh.querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
  sh.querySelectorAll('[data-ans]').forEach(b => b.onclick = () => { act({ type: 'answer', value: S.prompt.options[+b.dataset.ans].value }); });
  sh.querySelectorAll('[data-src]').forEach(d => d.onclick = () => { ui.learn.src = d.dataset.src; ui.learn.d = ui.learn.d.slice(0, ui.learn.src.startsWith('adv') ? 2 : 1); openModal('learn'); });
  sh.querySelectorAll('[data-d]').forEach(d => d.onclick = () => {
    const i = +d.dataset.d; const L = ui.learn; const need = L.src && L.src.startsWith('adv') ? 2 : 1;
    if (L.d.includes(i)) L.d = L.d.filter(x => x !== i); else { L.d.push(i); if (L.d.length > need) L.d.shift(); }
    openModal('learn');
  });
  const dl = $('#doLearn'); if (dl) dl.onclick = () => { act({ type: 'learn', src: ui.learn.src, discards: ui.learn.d }); closeModal(); };
  sh.querySelectorAll('[data-r]').forEach(d => d.onclick = () => { const i = +d.dataset.r; ui.rep = ui.rep.includes(i) ? ui.rep.filter(x => x !== i) : ui.rep.concat(i); openModal('rep'); });
  const dr = $('#doRep'); if (dr) dr.onclick = () => { act({ type: 'replenish', discards: ui.rep }); closeModal(); };
  const rm = $('#rematch'); if (rm) rm.onclick = () => { socket.emit('rematch'); closeModal(); };
  const q = $('#quit'); if (q) q.onclick = () => { closeModal(); socket.emit('leave'); store.del('wt_room'); lobby = null; S = null; show('home'); };
}
function closeModal() { ui.modal = null; $('#modal').classList.add('hidden'); $('#sheet').innerHTML = ''; }

$('#muteBtn').textContent = muted ? '🔇' : '🔊';
document.querySelectorAll('[data-addbot]').forEach(b => b.onclick = () => socket.emit('addBot', { level: b.dataset.addbot, side: $('#botSide').value }));
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
show('home');
