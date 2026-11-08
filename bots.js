// Wardens of Thornhold — bots (easy / medium / hard)
// Bots pick one action at a time. Medium and hard simulate candidate actions on a copy of the
// game and score the result; hard searches deeper (combined moves, two-step card plans, token plays).
const W = require('./shared');
const G = require('./game');
const { NODES, CARDS } = W;

const clone = st => structuredClone(st);
let deadline = Infinity; // hard bots stop looking deeper after ~0.8s
const late = () => Date.now() > deadline;
const KEYS = Object.keys(NODES);
const DIST = { open: {}, closed: {} };
for (const a of KEYS) { DIST.open[a] = {}; DIST.closed[a] = {}; for (const b of KEYS) { DIST.open[a][b] = W.distance(a, b, true); DIST.closed[a][b] = W.distance(a, b, false); } }
const dist = (st, a, b) => (a && b ? (st.hiddenOpen ? DIST.open : DIST.closed)[a][b] : 20);
const houseSeats = st => st.seats.map((p, i) => i).filter(i => st.seats[i].role === 'house');
const rnd = a => a[Math.floor(Math.random() * a.length)];

function cardValue(key) {
  const c = CARDS[key];
  let v = c.mv.reduce((a, b) => a + b, 0);
  if (c.mv.length === 2) v += 1;
  if (c.pass) v += c.pass.length * 0.8;
  if (c.fly) v += 1.2; if (c.secret) v += 1;
  if (c.draw) v += c.draw * 1.4; if (c.again) v += 2.5; if (c.valor) v += 2;
  if (c.stun) v += 1.5; if (c.banish) v += 3; if (c.react) v += 1.5; if (c.standUp) v += 0.8;
  if (c.outside) v += 1; if (c.direct) v += 3; if (c.eff) v += 1.5;
  return v;
}

// ---------- evaluation ----------
function wardenProgress(st, seat) {
  const p = st.seats[seat]; const pawns = st.house[seat];
  const needS = 2 - p.shields;
  let s = p.shields * 1000 + (p.tome ? 160 : 0) + Math.min(p.scrolls, needS) * 160 + p.valor * 18 + (p.token ? 12 : 0);
  const haveKey = st.lens === seat || p.sigil;
  if (st.lens === seat) s += 150; if (p.sigil) s += 150;
  s += p.locs.filter(l => pawns.some(pw => pw.node === l)).length * 45;
  s += Math.min(p.hand.length, 6) * 5;
  const free = pawns.filter(pw => !pw.stunned);
  const near = node => Math.min(...(free.length ? free : pawns).map(pw => dist(st, pw.node, node)));
  const goals = [];
  if (!p.tome) goals.push(['library', 1]);
  if (p.scrolls < needS && p.locs.length) p.locs.forEach(l => goals.push([l, 0.7]));
  if (!haveKey) {
    if (st.hiddenOpen && st.sigils > 0) goals.push(['hidden', 1.1]);
    else if (p.valor < 6) ['tower', 'gallery', 'bridge'].forEach(n => goals.push([n, 0.35]));
  }
  for (const n in st.shields) {
    const t = st.shields[n];
    const keyOk = (t === 'lens' && st.lens === seat) || (t === 'sigil' && p.sigil);
    if (keyOk) goals.push([n, p.tome && p.scrolls ? 3 : 0.6]);
  }
  goals.sort((a, b) => b[1] - a[1]);
  goals.slice(0, 4).forEach(([n, w]) => (s -= near(n) * 9 * w));
  pawns.forEach(pw => {
    if (pw.stunned) s -= 14;
    if (NODES[pw.node].prot) return;
    const d = Math.min(20, ...st.shadowPawns.filter(sp => sp.node && !sp.stunned).map(sp => dist(st, sp.node, pw.node)));
    if (d <= 1) s -= 22; else if (d === 2) s -= 9;
  });
  return s;
}
function shadowScore(st) {
  const tokens = ['white', 'orange', 'red'].filter(z => st.progress[z]).length;
  let s = tokens * 260 + st.marker * 30 + st.markers.length * 35;
  const onBoard = st.shadowPawns.filter(p => p.node);
  s += onBoard.length * 18 - st.shadowPawns.filter(p => p.stunned).length * 16;
  s += Math.min(st.seats[st.shadowSeat].hand.length, 6) * 5;
  if (st.target) {
    const ds = st.shadowPawns.map(p => (p.node ? dist(st, p.node, st.target) : 4)).sort((a, b) => a - b);
    s += ds.filter(d => d === 0).length * 450;
    s -= ds.slice(0, st.need).reduce((a, b) => a + b, 0) * 55;
  } else {
    const keySpots = ['library', ...Object.keys(st.shields)];
    keySpots.forEach(n => { s -= Math.min(6, ...onBoard.map(p => dist(st, p.node, n))) * 4; });
  }
  const hs = houseSeats(st);
  const prog = hs.map(h => wardenProgress(st, h));
  // Block the spaces each Warden needs next (a Hollow pawn on a space stops Tomes and Shields there)
  const lead0 = Math.max(...prog);
  hs.forEach((h, k) => {
    const w = 0.5 + (prog[k] >= lead0 ? 0.8 : 0);
    const q = st.seats[h]; const need = [];
    if (!q.tome) need.push('library');
    for (const n in st.shields) { const t = st.shields[n]; if ((t === 'lens' && st.lens === h) || (t === 'sigil' && q.sigil)) need.push(n); }
    need.forEach(n => {
      if (onBoard.some(p => p.node === n)) s += 70 * w;
      else s -= Math.min(4, ...onBoard.map(p => dist(st, p.node, n))) * 6 * w;
    });
    st.house[h].forEach(pw => { if (!NODES[pw.node].prot && onBoard.some(p => !p.stunned && dist(st, p.node, pw.node) <= 1)) s += 10 * w; });
  });
  const lead = Math.max(...prog);
  s -= lead * 0.9 + (prog.reduce((a, b) => a + b, 0) / prog.length) * 0.3;
  return s;
}
function evaluate(st, seat) {
  const p = st.seats[seat];
  if (st.phase === 'over') {
    const w = st.winner;
    if (w.side === 'draw') return 0;
    if (p.role === 'shadow') return w.side === 'shadow' ? 1e6 : -1e6;
    return w.side === 'house' && w.seat === seat ? 1e6 : -1e6;
  }
  if (p.role === 'shadow') return shadowScore(st);
  const others = houseSeats(st).filter(h => h !== seat).map(h => wardenProgress(st, h));
  const tokens = ['white', 'orange', 'red'].filter(z => st.progress[z]).length;
  return wardenProgress(st, seat) - (others.length ? Math.max(...others) * 0.3 : 0) - st.marker * 22 - tokens * 60;
}

// Resolve pending choices inside a simulation so moves can continue
function settle(st) {
  for (let i = 0; i < 8 && st.prompts.length && st.phase === 'play'; i++) {
    const pr = st.prompts[0];
    const o = pr.options.find(x => x.value !== 'skip') || pr.options[0];
    G.act(st, pr.seat, { type: 'answer', value: o.value });
  }
}
function sim(st, seat, action) {
  const c = clone(st);
  const r = G.act(c, seat, action);
  if (!r.ok) return null;
  settle(c);
  return c;
}

// ---------- move enumeration ----------
function moveActions(st, seat, allowBoth) {
  const t = st.turn; if (!t || !t.card) return [];
  const c = CARDS[t.card.key]; const p = st.seats[seat]; const isH = p.role === 'house';
  const pawns = isH ? st.house[seat] : st.shadowPawns;
  const uses = [];
  const free = c.mv.map((v, i) => i).filter(i => !t.card.used.includes(i));
  free.forEach(i => uses.push([i, c.mv[i]]));
  if (allowBoth && c.mv.length === 2 && free.length === 2) uses.push(['both', c.mv[0] + c.mv[1]]);
  const out = [];
  if (c.direct && !t.card.used.includes('direct')) pawns.forEach((pw, i) => { if (!pw.stunned && !t.card.moved.includes(i)) out.push({ type: 'move', pawn: i, use: 'direct' }); });
  const opts = { side: isH ? 'house' : 'shadow', pass: c.pass || [], fly: !!c.fly, secret: !!c.secret, hiddenOpen: st.hiddenOpen };
  let poolDone = false;
  for (const [use, budget] of uses) {
    pawns.forEach((pw, i) => {
      if (pw.stunned || t.card.moved.includes(i)) return;
      if (!isH && pw.node === null) {
        if (poolDone) return; poolDone = true;
        W.DEPLOY.filter(d => !st.shadowPawns.some(s => s.node === d)).forEach(d => {
          if (budget < 1) return;
          out.push({ type: 'move', pawn: i, use, path: ['pool', d] });
          const r = W.reachable(d, opts, budget - 1);
          for (const k in r) out.push({ type: 'move', pawn: i, use, path: ['pool'].concat(r[k].path) });
        });
        return;
      }
      if (!pw.node) return;
      const extra = isH && c.outside ? c.outside : 0;
      const r = W.reachable(pw.node, opts, budget + extra);
      for (const k in r) if (r[k].cost <= budget || !NODES[k].castle) out.push({ type: 'move', pawn: i, use, path: r[k].path });
    });
  }
  return out;
}

function bestMove(st, seat, level, noise) {
  const acts = moveActions(st, seat, level === 'hard');
  if (!acts.length) return null;
  if (level === 'easy') return Math.random() < 0.85 ? rnd(acts) : null;
  const base = evaluate(st, seat);
  let best = null, bs = base + 1; // only move if it is at least as good as standing still
  for (const a of acts) {
    const c = sim(st, seat, a); if (!c) continue;
    let s = evaluate(c, seat) + (noise ? (Math.random() - 0.5) * noise : 0);
    if (level === 'hard' && !late() && c.turn && c.turn.seat === seat && c.turn.card && c.phase === 'play') {
      // look one move further for multi-move cards
      const more = moveActions(c, seat, false).slice(0, 60);
      let m2 = s;
      for (const b of more) { const d = sim(c, seat, b); if (d) m2 = Math.max(m2, evaluate(d, seat)); }
      s = Math.max(s, m2 - 1);
    }
    if (s > bs) { bs = s; best = a; }
  }
  return best;
}

// Score a state after taking a main action, letting the bot finish its movement greedily
function rollout(c, seat, depth) {
  for (let i = 0; i < depth && c.phase === 'play' && c.turn && c.turn.seat === seat && c.turn.card; i++) {
    const m = bestMove(c, seat, 'medium', 0);
    if (!m) break;
    const n = sim(c, seat, m); if (!n) break; c = n;
  }
  return evaluate(c, seat);
}

function mainCandidates(st, seat, level) {
  const p = st.seats[seat]; const t = st.turn; const out = [];
  const seen = new Set();
  p.hand.forEach((h, i) => {
    if (t.main > 0 && !seen.has(h.key)) { seen.add(h.key); out.push({ type: 'play', idx: i }); }
    if (p.role === 'house' && p.token && p.token.got !== st.turnNo && !t.tokenUsed && CARDS[h.key].disc === p.token.disc && level !== 'easy') out.push({ type: 'play', idx: i, viaToken: true });
  });
  if (t.main > 0 && !st.final) out.push({ type: 'replenish', discards: [] });
  if (t.main > 0 && p.role === 'house' && p.hand.length >= 1) {
    const order = p.hand.map((h, i) => [i, cardValue(h.key)]).sort((a, b) => a[1] - b[1]);
    ['row0', 'row1', 'deck'].forEach(src => out.push({ type: 'learn', src, discards: [order[0][0]] }));
    if (p.hand.length >= 2) ['adv0', 'adv1'].forEach(src => out.push({ type: 'learn', src, discards: [order[0][0], order[1][0]] }));
  }
  return out;
}

function bestMain(st, seat, level) {
  const p = st.seats[seat]; const t = st.turn;
  const cands = mainCandidates(st, seat, level);
  if (level === 'easy') {
    const plays = cands.filter(a => a.type === 'play' && !a.viaToken);
    if (t.main > 0 && p.hand.length <= 1 && !st.final) return { type: 'replenish', discards: [] };
    if (plays.length && Math.random() < 0.8) return rnd(plays);
    return rnd(cands) || { type: 'end' };
  }
  const noise = level === 'medium' ? 40 : 0;
  const depth = level === 'hard' && !late() ? 2 : 1;
  let best = null, bs = -Infinity;
  for (const a of cands) {
    const c = sim(st, seat, a); if (!c) continue;
    let s = rollout(c, seat, depth);
    if (a.type === 'learn') {
      const key = a.src === 'deck' ? null : (a.src.startsWith('adv') ? st.adv[+a.src[3]] : st.row[+a.src[3]]);
      const gain = key ? cardValue(key.key) : 4.5;
      const lost = a.discards.reduce((x, i) => x + cardValue(p.hand[i].key), 0);
      s += (gain - lost * 0.6) * 9 + (level === 'hard' ? 6 : 0);
    }
    if (a.type === 'replenish') {
      if (p.hand.length <= 1) s += 70;
      if (p.role === 'shadow' && st.shadowPawns.filter(x => x.stunned).length >= 2) s += 40;
    }
    if (a.viaToken) s += 5;
    s += (Math.random() - 0.5) * noise;
    if (s > bs) { bs = s; best = a; }
  }
  return best || { type: 'end' };
}

function pickOption(st, seat, level, pr) {
  if (level === 'easy') return rnd(pr.options).value;
  let best = pr.options[0].value, bs = -Infinity;
  for (const o of pr.options) {
    const c = clone(st);
    if (!G.act(c, seat, { type: 'answer', value: o.value }).ok) continue;
    settle(c);
    const s = evaluate(c, seat) + (level === 'medium' ? (Math.random() - 0.5) * 30 : 0);
    if (s > bs) { bs = s; best = o.value; }
  }
  return best;
}

// Next action for a bot, or null if it isn't the bot's move
function decide(st, seat, level) {
  deadline = Date.now() + 800;
  if (st.phase !== 'play') return null;
  const pr = st.prompts[0];
  if (pr) return pr.seat === seat ? { type: 'answer', value: pickOption(st, seat, level, pr) } : null;
  if (!st.turn || st.turn.seat !== seat) return null;
  const t = st.turn; const p = st.seats[seat];
  if (t.card) {
    const m = bestMove(st, seat, level, level === 'medium' ? 25 : 0);
    if (m) return m;
  }
  if (t.main > 0) return bestMain(st, seat, level);
  if (level !== 'easy' && p.role === 'house' && p.token && p.token.got !== st.turnNo && !t.tokenUsed) {
    const i = p.hand.findIndex(h => CARDS[h.key].disc === p.token.disc);
    if (i >= 0) {
      const c = sim(st, seat, { type: 'play', idx: i, viaToken: true });
      if (c && rollout(c, seat, 2) > evaluate(st, seat) + 5) return { type: 'play', idx: i, viaToken: true };
    }
  }
  return { type: 'end' };
}

module.exports = { decide };
