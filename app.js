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
socket.on('lobby', l => { lobby = l; store.set('wt_room', l.code); if (!l.started) S = null; render(); });
socket.on('state', s => {
  const myTurnNow = s.turn && s.turn.seat === s.you;
  if (myTurnNow && lastTurnSeat !== s.you) beep();
  lastTurnSeat = s.turn ? s.turn.seat : null;
  if (S && S.turn && s.turn && (S.turn.seat !== s.turn.seat || !s.turn.card || (S.turn.card && s.turn.card && S.turn.card.used.length !== s.turn.card.used.length))) { ui.pawn = null; ui.direct = false; }
  if (S && s.turn && (!S.turn || !s.turn.card || !S.turn.card || S.turn.card.key !== s.turn.card.key)) ui.combine = false;
  S = s; render();
});

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
  $('#plist').innerHTML = lobby.players.map(p => `<li>${p.role === 'shadow' ? '<span class="diamond"></span>' : `<span class="dot" style="background:${W.HOUSES[p.house].color}"></span>`}
    <span style="flex:1">${esc(p.name)}${p.id === lobby.host ? ' <span class="muted small">(host)</span>' : ''}</span>
    <span class="muted small">${p.role === 'shadow' ? 'Hollow' : W.HOUSES[p.house].name}${p.online ? '' : ' · offline'}</span></li>`).join('');
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
function renderBoard() {
  const N = W.NODES; const svg = $('#board');
  let s = `<rect x="0" y="0" width="1000" height="1000" class="grounds"/>
    <ellipse cx="130" cy="805" rx="120" ry="95" class="lakefill"/>
    <path d="M760 720 Q880 760 940 860" stroke="var(--water)" stroke-width="26" fill="none" opacity=".8"/>
    <rect x="200" y="45" width="690" height="555" rx="30" class="castle"/>`;
  W.EDGES.forEach(([a, b, o]) => {
    const A = N[a], B = N[b]; const hid = a === 'hidden' || b === 'hidden';
    if (hid && !S.hiddenOpen) return;
    s += `<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" class="edge ${hid ? 'hid' : ''}"/>`;
  });
  W.SECRETS.forEach(([a, b, col]) => {
    const A = N[a], B = N[b]; const mx = (A.x + B.x) / 2 + (B.y - A.y) * .18, my = (A.y + B.y) / 2 - (B.x - A.x) * .18;
    s += `<path d="M${A.x} ${A.y} Q${mx} ${my} ${B.x} ${B.y}" class="secret" stroke="${col}"/>`;
  });
  W.EDGES.forEach(([a, b, o]) => {
    if (!o) return; const A = N[a], B = N[b];
    s += `<g class="obs"><circle cx="${(A.x + B.x) / 2}" cy="${(A.y + B.y) / 2}" r="14"/><text x="${(A.x + B.x) / 2}" y="${(A.y + B.y) / 2}">${W.OBS[o].icon}</text></g>`;
  });

  // reachable
  let reach = {};
  if (myTurn() && ui.pawn !== null && S.turn.card) reach = reachFor(ui.pawn);
  const myLocs = S.locs || [];

  for (const k in N) {
    const n = N[k];
    const hidClosed = n.hidden && !S.hiddenOpen;
    const cls = ['node', n.castle ? '' : 'outside', n.prot ? 'prot' : '', n.hidden ? 'hid' : '', hidClosed ? 'closed' : '', reach[k] ? 'reach' : '', myLocs.includes(k) ? 'myloc' : '', S.target === k ? 'target' : ''].join(' ');
    const icons = [];
    if (n.library) icons.push('📖');
    if (n.fly) icons.push('🪶');
    if (n.valor) icons.push('⭐');
    if (n.bonus === 'draw') icons.push('🃏');
    if (n.bonus === 'again') icons.push('🔁');
    if (n.bonus === 'acquire') icons.push('✚');
    if (n.deploy) icons.push('◆');
    if (n.token && S.tokens[n.token] === k) icons.push(W.DISC[n.token].icon);
    if (S.shields[k]) icons.push(S.shields[k] === 'lens' ? '🛡🔍' : '🛡⭕');
    const above = ['hidden', 'study', 'tower', 'clock'].includes(k);
    s += `<g class="${cls}" data-node="${k}">
      <circle class="ring3" cx="${n.x}" cy="${n.y}" r="44"/>
      <circle class="ring2" cx="${n.x}" cy="${n.y}" r="38"/>
      <circle class="ring" cx="${n.x}" cy="${n.y}" r="34"/>
      <circle class="base" cx="${n.x}" cy="${n.y}" r="30"/>
      <text class="ico" x="${n.x}" y="${n.y}">${icons.slice(0, 2).join('')}</text>
      <text class="lbl" x="${n.x}" y="${above ? n.y - 50 : n.y + 54}">${esc(n.name)}</text>
      ${reach[k] ? `<text class="cost" x="${n.x + 30}" y="${n.y - 26}">${reach[k].cost}</text>` : ''}
    </g>`;
  }

  // pawns
  const at = {};
  Object.keys(S.house).forEach(seat => S.house[seat].forEach((pw, i) => { (at[pw.node] = at[pw.node] || []).push({ kind: 'h', seat: +seat, i, pw }); }));
  S.shadowPawns.forEach((pw, i) => { if (pw.node) (at[pw.node] = at[pw.node] || []).push({ kind: 's', i, pw }); });
  for (const k in at) {
    const n = N[k]; const list = at[k];
    list.forEach((p, j) => {
      const ang = (-150 + j * (300 / Math.max(1, list.length - 1 || 1))) * Math.PI / 180;
      const r = list.length === 1 ? 0 : 40;
      const x = n.x + (list.length === 1 ? 26 : Math.cos(ang) * r), y = n.y + (list.length === 1 ? 26 : Math.sin(ang) * r);
      const mine = (p.kind === 'h' && p.seat === S.you) || (p.kind === 's' && me().role === 'shadow');
      const ref = p.kind === 'h' ? p.i : p.i;
      const sel = mine && ui.pawn === ref;
      const cls = `pawn ${p.pw.stunned ? 'stun' : ''} ${sel ? 'sel' : ''} ${mine ? 'mine' : ''}`;
      const data = mine ? `data-pawn="${ref}"` : '';
      if (p.kind === 'h') s += `<circle ${data} class="${cls}" cx="${x}" cy="${y}" r="15" fill="${W.HOUSES[S.seats[p.seat].house].color}"/>`;
      else s += `<rect ${data} class="${cls}" x="${x - 13}" y="${y - 13}" width="26" height="26" fill="var(--hollow)" transform="rotate(45 ${x} ${y})"/>`;
      if (p.pw.stunned) s += `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="16" pointer-events="none">💫</text>`;
    });
  }
  svg.innerHTML = s;
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
  const zone = c.zone ? ` · ${W.ZONES[c.zone].name}` : '';
  return `<div class="nm">${esc(c.name)}</div><div class="mv">${mvText(c)}${c.fly ? ' · 🪶' : ''}</div>
    <div class="tx">${esc(c.text)}</div><div class="dsc">${c.disc ? W.DISC[c.disc].icon + ' ' + W.DISC[c.disc].name : 'Hollow' + zone}</div>${extra}`;
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
    return `<div class="card ${c.side === 'shadow' ? 'shadow' : ''} ${sel ? 'sel' : ''}" data-card="${i}" style="${c.disc ? '' : ''}">${cardHtml(k, btns)}</div>`;
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
      <span class="who">${esc(p.name)}${i === S.you ? ' (you)' : ''}${p.skip ? ' · skips next' : ''}${S.markers.includes(i) ? ' · marker taken' : ''}${online && !online.online ? ' · offline' : ''}</span>
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
      <div class="pick">${opts.map(o => `<div class="card ${L.src === o.src ? 'sel' : ''}" data-src="${o.src}">${cardHtml(o.key, `<div class="small"><b>${o.tag}</b></div>`)}</div>`).join('')}
      ${S.acqCount ? `<div class="card ${L.src === 'deck' ? 'sel' : ''}" data-src="deck"><div class="nm">Hidden card</div><div class="tx">Top card of the Spell deck (${S.acqCount} left). Discard 1.</div></div>` : ''}</div>
      <h3>Discard from your hand</h3><div class="pick">${S.hand.map((k, i) => `<div class="card ${L.d.includes(i) ? 'sel' : ''}" data-d="${i}">${cardHtml(k)}</div>`).join('')}</div>
      <div class="row"><button class="primary" id="doLearn" ${L.src && L.d.length === need ? '' : 'disabled'}>Learn</button><button data-close>Cancel</button></div>`;
  }
  if (kind === 'rep') {
    h = `<h2>Replenish</h2><p class="small">Choose cards to discard (optional), then draw back up to 5 and stand up your pawns. <b>The Shadow Path will advance one space.</b></p>
      <div class="pick">${S.hand.map((k, i) => `<div class="card ${ui.rep.includes(i) ? 'sel' : ''}" data-r="${i}">${cardHtml(k)}</div>`).join('')}</div>
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

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
show('home');
