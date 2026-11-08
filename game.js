// Wardens of Thornhold — authoritative game engine (server only)
const W = require('./shared');
const { NODES, CARDS, PATH, ZONES, ZONE_ORDER, EVENTS, HOUSES } = W;

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function expand(obj) { const out = []; for (const k in obj) for (let i = 0; i < (obj[k].n || obj[k]); i++) out.push(k); return out; }

function createGame(players) {
  // players: [{id, name, role:'shadow'|'house', house}]
  const houses = players.filter(p => p.role === 'house');
  const shadow = players.find(p => p.role === 'shadow');
  if (!shadow || houses.length < 1 || houses.length > 4) throw new Error('Need 1 Hollow player and 1–4 Wardens');
  const st = {
    phase: 'play', winner: null, uid: 1, turnNo: 0,
    seats: [], order: [], turnIdx: 0,
    house: {}, shadowPawns: [], shields: {}, tokens: {}, hiddenOpen: false,
    acqDeck: [], row: [], adv: [], libDeck: [], libRow: [], locDeck: [],
    shadowAcq: [], events: {}, marker: 0, progress: { white: false, orange: false, red: false },
    target: null, need: 0, darkLocs: shuffle(W.DARK_LOCS.slice()),
    markers: [], sigils: 4, lens: null, final: false, turn: null, prompts: [], log: []
  };
  const inst = key => ({ uid: st.uid++, key });

  houses.forEach(p => {
    const seat = st.seats.length;
    st.seats.push({ id: p.id, name: p.name, role: 'house', house: p.house, hand: [], deck: shuffle(W.HOUSE_STARTER.map(inst)), discard: [],
      valor: 0, tome: null, scrolls: 0, scrollsEarned: 0, locs: [], sigil: false, shields: 0, token: null, skip: false });
    st.house[seat] = [0, 1, 2].map(() => ({ node: 'hall', stunned: false }));
    st.order.push(seat);
  });
  const sSeat = st.seats.length;
  st.seats.push({ id: shadow.id, name: shadow.name, role: 'shadow', hand: [], deck: shuffle(W.SHADOW_STARTER.map(inst)), discard: [], skip: false });
  st.order.push(sSeat);
  st.shadowSeat = sSeat;

  const nPawns = 3 + houses.length;
  for (let i = 0; i < nPawns; i++) st.shadowPawns.push({ node: i < 4 ? W.DEPLOY[i] : null, stunned: false });

  const shieldTypes = shuffle(['lens', 'lens', 'lens', 'sigil', 'sigil', 'sigil']);
  W.SHIELD_NODES.forEach((n, i) => (st.shields[n] = shieldTypes[i]));
  for (const k in NODES) if (NODES[k].token) st.tokens[NODES[k].token] = k;

  st.acqDeck = shuffle(expand(W.HOUSE_ACQUIRE).map(inst));
  st.row = [st.acqDeck.pop(), st.acqDeck.pop()];
  st.adv = [st.acqDeck.pop(), st.acqDeck.pop()];
  st.libDeck = shuffle(expand(W.TOMES));
  st.libRow = [st.libDeck.pop(), st.libDeck.pop()];
  st.locDeck = shuffle(W.HOUSE_LOCS.slice());
  st.shadowAcq = shuffle(expand(W.SHADOW_ACQUIRE).map(inst));
  ZONE_ORDER.forEach(z => (st.events[z] = shuffle(Object.keys(EVENTS).filter(k => EVENTS[k].zone === z))));

  st.seats.forEach((p, i) => {
    draw(st, i, 5);
    if (p.role === 'house') p.locs = [st.locDeck.pop(), st.locDeck.pop(), st.locDeck.pop()];
  });
  log(st, 'The siege of Thornhold begins. Wardens move first.');
  startTurn(st);
  return st;
}

// ---------- helpers ----------
function log(st, msg) { st.log.push(msg); if (st.log.length > 80) st.log.shift(); }
function nm(st, seat) { const p = st.seats[seat]; return p.role === 'house' ? `${p.name} (${HOUSES[p.house].name})` : `${p.name} (Hollow)`; }
function houseSeats(st) { return st.seats.map((p, i) => i).filter(i => st.seats[i].role === 'house'); }
function zoneIdx(st) { return ZONE_ORDER.indexOf(PATH[st.marker].zone); }

function draw(st, seat, n) {
  const p = st.seats[seat]; let got = 0;
  for (let i = 0; i < n; i++) {
    if (!p.deck.length) { if (!p.discard.length) break; p.deck = shuffle(p.discard); p.discard = []; }
    p.hand.push(p.deck.pop()); got++;
  }
  return got;
}
function discardRandom(st, seat, n) {
  const p = st.seats[seat];
  for (let i = 0; i < n && p.hand.length; i++) p.discard.push(p.hand.splice(Math.floor(Math.random() * p.hand.length), 1)[0]);
}
function returnToken(st, seat) {
  const p = st.seats[seat];
  if (p.token) { st.tokens[p.token.disc] = p.token.home; p.token = null; }
}
function standUp(st, seat) {
  if (st.seats[seat].role === 'house') st.house[seat].forEach(pw => (pw.stunned = false));
  else st.shadowPawns.forEach(pw => (pw.stunned = false));
}
function refill(st, rowName, i) { st[rowName][i] = st.acqDeck.length ? st.acqDeck.pop() : null; }
function prompt(st, p) { st.prompts.push(p); }

function reactCard(st, seat, type) {
  const p = st.seats[seat];
  const i = p.hand.findIndex(c => CARDS[c.key].react === type);
  if (i < 0) return false;
  const c = p.hand.splice(i, 1)[0]; p.discard.push(c);
  log(st, `${nm(st, seat)} reveals ${CARDS[c.key].name} and cancels it!`);
  return true;
}

// ---------- valor / hidden hall / lens ----------
function updateHidden(st) {
  const open = houseSeats(st).some(s => st.seats[s].valor >= 4);
  if (open !== st.hiddenOpen) log(st, open ? 'The Hidden Hall reveals itself!' : 'The Hidden Hall fades from the castle.');
  st.hiddenOpen = open;
}
function changeValor(st, seat, d) {
  const p = st.seats[seat];
  const before = p.valor;
  p.valor = Math.max(0, Math.min(6, p.valor + d));
  if (p.valor === before) return;
  if (d > 0) {
    const others = houseSeats(st).filter(s => s !== seat);
    if (p.valor === 6) {
      const top = others.find(s => st.seats[s].valor === 6);
      if (top !== undefined && st.lens === top) { st.seats[top].valor = 5; draw(st, top, 1); log(st, `${nm(st, top)} hands over the Seeker Lens and drops back.`); }
      if (st.lens !== seat) { st.lens = seat; log(st, `${nm(st, seat)} gains the Seeker Lens.`); }
    } else if (p.valor >= 4 && others.every(s => st.seats[s].valor < p.valor) && st.lens !== seat) {
      st.lens = seat; log(st, `${nm(st, seat)} gains the Seeker Lens.`);
    }
  }
  updateHidden(st);
}

// ---------- scrolls & shields ----------
function checkScroll(st, seat) {
  const p = st.seats[seat];
  if (p.locs.length < 2) return;
  const here = p.locs.filter(l => st.house[seat].some(pw => pw.node === l));
  if (here.length < 2) return;
  const used = here.slice(0, 2);
  p.locs = p.locs.filter(l => !used.includes(l));
  used.forEach(l => st.locDeck.unshift(l));
  p.scrolls++; p.scrollsEarned++;
  log(st, `${nm(st, seat)} reveals ${used.map(l => NODES[l].name).join(' & ')} and earns a Scroll.`);
  if (p.scrollsEarned === 1) { while (p.locs.length < 3 && st.locDeck.length) p.locs.push(st.locDeck.pop()); }
  else { p.locs.forEach(l => st.locDeck.unshift(l)); p.locs = []; }
}
function tryShield(st, seat, node) {
  const type = st.shields[node]; const p = st.seats[seat];
  if (!type || !p.tome || p.scrolls < 1) return;
  if (type === 'lens' && st.lens !== seat) return;
  if (type === 'sigil' && !p.sigil) return;
  st.libDeck.unshift(p.tome); p.tome = null; p.scrolls--;
  if (type === 'lens') {
    p.valor = Math.max(0, p.valor - 3); st.lens = null;
    const cand = houseSeats(st).filter(s => st.seats[s].valor >= 4).sort((a, b) => st.seats[b].valor - st.seats[a].valor);
    if (cand.length) st.lens = cand[0];
    updateHidden(st);
  } else { p.sigil = false; st.sigils++; }
  delete st.shields[node]; p.shields++;
  log(st, `🛡 ${nm(st, seat)} raises a Ward Shield at ${NODES[node].name}! (${p.shields}/2)`);
  if (p.shields >= 2) endGame(st, { side: 'house', seat, text: `${nm(st, seat)} raised 2 Ward Shields. Thornhold holds!` });
}

// ---------- shadow path ----------
function takeToken(st, zone) {
  st.progress[zone] = true;
  log(st, `The Hollow claims the ${ZONES[zone].token} token.`);
  if (zone === 'red') {
    st.need = PATH[st.marker].need || 1;
    st.target = st.darkLocs.pop();
    log(st, `☠ The Hollow reveals its target: ${NODES[st.target].name}. It needs ${st.need} pawn(s) there to win.`);
    checkShadowWin(st);
  }
}
function advanceMarker(st) {
  if (st.phase !== 'play' || st.marker >= PATH.length - 1) return;
  st.marker++;
  const sp = PATH[st.marker];
  log(st, `The Shadow Path advances to space ${st.marker + 1} (${ZONES[sp.zone].name}).`);
  if (sp.final) {
    ZONE_ORDER.forEach(z => { if (!st.progress[z]) takeToken(st, z); });
    if (!st.target) { st.need = 1; st.target = st.darkLocs.pop(); log(st, `☠ Target revealed: ${NODES[st.target].name}.`); }
    st.need = Math.min(st.need, 1);
    st.final = true;
    st.seats.forEach((p, i) => { while (p.hand.length < 5 && draw(st, i, 1)); });
    log(st, '🌑 Final night: everyone has drawn up to 5. No more Replenish. Play out your last cards!');
    checkShadowWin(st);
    return;
  }
  if (sp.event) resolveEvent(st, sp);
}
function resolveEvent(st, sp) {
  const deck = st.events[sp.zone];
  const key = deck.length ? deck.pop() : null;
  if (!key) return;
  const ev = EVENTS[key];
  log(st, `⚡ Event: ${ev.name} — ${ev.houseText}`);
  houseEvent(st, ev.house);
  if (st.progress[sp.zone]) darkEvent(st, ev.dark);
  else if (sp.last) takeToken(st, sp.zone);
  else prompt(st, { seat: st.shadowSeat, kind: 'eventChoice', ctx: { key, zone: sp.zone },
    text: `${ev.name}: take the ${ZONES[sp.zone].token} token, or the event reward?`,
    options: [{ value: 'token', label: `Take ${ZONES[sp.zone].token} token` }, { value: 'benefit', label: ev.darkText }] });
}
function houseEvent(st, code) {
  const hs = houseSeats(st);
  const outside = pw => pw.node && !NODES[pw.node].castle;
  const each = fn => hs.forEach(s => { if (['disc1', 'disc2', 'loseToken', 'valor1', 'valor2', 'hand2', 'combo', 'refresh', 'siege'].includes(code) && reactCard(st, s, 'target')) return; fn(s); });
  switch (code) {
    case 'draw1': hs.forEach(s => draw(st, s, 1)); break;
    case 'disc1': each(s => discardRandom(st, s, 1)); break;
    case 'disc2': each(s => discardRandom(st, s, 2)); break;
    case 'stunOut1': hs.forEach(s => { const pw = st.house[s].find(p => outside(p) && !p.stunned && !NODES[p.node].prot); if (pw) pw.stunned = true; }); break;
    case 'stunOutAll': hs.forEach(s => st.house[s].forEach(p => { if (outside(p) && !NODES[p.node].prot) p.stunned = true; })); break;
    case 'loseToken': each(s => returnToken(st, s)); break;
    case 'standAll': hs.forEach(s => standUp(st, s)); break;
    case 'valor1': each(s => changeValor(st, s, -1)); break;
    case 'valor2': each(s => changeValor(st, s, -2)); break;
    case 'refresh': each(s => discardRandom(st, s, 1));
      [...st.row, ...st.adv].forEach(c => c && st.acqDeck.unshift(c)); st.row = [st.acqDeck.pop(), st.acqDeck.pop()]; st.adv = [st.acqDeck.pop(), st.acqDeck.pop()]; break;
    case 'siege': each(s => discardRandom(st, s, 2)); hs.forEach(s => st.house[s].forEach(p => { if (outside(p) && !NODES[p.node].prot) p.stunned = true; })); break;
    case 'stunUnprot': hs.forEach(s => st.house[s].forEach(p => { if (p.node && !NODES[p.node].prot) p.stunned = true; })); break;
    case 'hand2': each(s => discardRandom(st, s, Math.max(0, st.seats[s].hand.length - 2))); break;
    case 'combo': each(s => { discardRandom(st, s, 1); returnToken(st, s); changeValor(st, s, -1); }); break;
  }
}
function darkEvent(st, code) {
  const s = st.shadowSeat;
  switch (code) {
    case 'draw1': draw(st, s, 1); break;
    case 'draw2': draw(st, s, 2); break;
    case 'deploy1': promptDeploy(st, 1); break;
    case 'deploy2': promptDeploy(st, 2); break;
    case 'acq': if (st.shadowAcq.length) st.seats[s].hand.push(st.shadowAcq.pop()); break;
    case 'standDraw1': standUp(st, s); draw(st, s, 1); break;
    case 'deployDraw': draw(st, s, 1); promptDeploy(st, 1); break;
    case 'deployStand': standUp(st, s); promptDeploy(st, 1); break;
  }
  log(st, `The Hollow takes the event reward.`);
}
function freeDeploys(st) { return W.DEPLOY.filter(n => !st.shadowPawns.some(p => p.node === n)); }
function promptDeploy(st, n) {
  if (!st.shadowPawns.some(p => p.node === null) || !freeDeploys(st).length) return;
  prompt(st, { seat: st.shadowSeat, kind: 'deploy', ctx: { left: n }, text: 'Deploy a Hollow pawn for free:',
    options: freeDeploys(st).map(n => ({ value: n, label: NODES[n].name })).concat([{ value: 'skip', label: 'Skip' }]) });
}

// ---------- landing ----------
function pushAway(st, sp) {
  const from = sp.node;
  const opts = W.ADJ[from].map(e => e.to).filter(n => !NODES[n].prot && !NODES[n].hidden && !st.shadowPawns.some(p => p !== sp && p.node === n));
  const calm = opts.filter(n => !houseSeats(st).some(s => st.house[s].some(p => p.node === n)));
  const pick = (calm.length ? calm : opts)[0];
  if (pick) sp.node = pick;
}
function houseLand(st, seat, pi) {
  const p = st.seats[seat]; const pw = st.house[seat][pi]; const node = pw.node; const N = NODES[node];
  const foe = st.shadowPawns.find(s => s.node === node);
  if (foe) {
    pw.stunned = true; foe.stunned = true; pushAway(st, foe);
    log(st, `💥 ${nm(st, seat)} clashes with a Hollow pawn at ${N.name}. Both are stunned and the Hollow pawn is pushed to ${NODES[foe.node].name}.`);
    return;
  }
  if (N.hidden && !p.sigil && st.sigils > 0) { p.sigil = true; st.sigils--; log(st, `${nm(st, seat)} trains in the Hidden Hall and earns a Circle Sigil.`); }
  if (N.token && st.tokens[N.token] === node && !p.token) {
    p.token = { disc: N.token, home: node, got: st.turnNo }; st.tokens[N.token] = 'held';
    log(st, `${nm(st, seat)} takes the ${W.DISC[N.token].name} token.`);
  }
  if (N.valor) changeValor(st, seat, 1);
  if (N.bonus === 'draw') { draw(st, seat, 1); log(st, `${nm(st, seat)} draws a bonus card.`); }
  if (N.bonus === 'again') { st.turn.main++; log(st, `${nm(st, seat)} gains an extra main action.`); }
  if (N.bonus === 'acquire') prompt(st, { seat, kind: 'bonusAcquire', text: 'Bonus: take a spell card (it goes on top of your deck).', options: acquireOptions(st, false).concat([{ value: 'skip', label: 'Skip' }]) });
  if (N.library && !p.tome && st.libRow.some(Boolean)) {
    prompt(st, { seat, kind: 'tome', ctx: { node }, text: 'The Library: choose a Tome (its effect happens now).',
      options: st.libRow.map((t, i) => t && ({ value: i, label: `${W.TOMES[t].name}: ${W.TOMES[t].text}` })).filter(Boolean) });
  }
  tryShield(st, seat, node);
  checkScroll(st, seat);
}
function acquireOptions(st, includeAdv) {
  const o = [];
  st.row.forEach((c, i) => c && o.push({ value: 'row' + i, label: CARDS[c.key].name, card: c.key }));
  if (st.acqDeck.length) o.push({ value: 'deck', label: 'Top of the Spell deck (hidden)' });
  if (includeAdv) st.adv.forEach((c, i) => c && o.push({ value: 'adv' + i, label: CARDS[c.key].name + ' (advanced)', card: c.key }));
  return o;
}
function takeAcquire(st, src) {
  let c = null;
  if (src === 'deck') c = st.acqDeck.pop();
  else { const row = src.startsWith('adv') ? 'adv' : 'row'; const i = +src.slice(3); c = st[row][i]; if (c) refill(st, row, i); }
  return c;
}
function shadowLand(st, si) {
  const sp = st.shadowPawns[si]; const node = sp.node;
  const victims = [];
  houseSeats(st).forEach(s => st.house[s].forEach((pw, pi) => { if (pw.node === node) victims.push({ s, pi }); }));
  if (victims.length === 1) bump(st, victims[0].s, victims[0].pi, si);
  else if (victims.length > 1) prompt(st, { seat: st.shadowSeat, kind: 'bumpWho', ctx: { si }, text: `Choose which Warden pawn to bump at ${NODES[node].name}:`,
    options: victims.map(v => ({ value: v.s + ':' + v.pi, label: nm(st, v.s) })) });
  checkShadowWin(st);
}
function bump(st, s, pi, si) {
  const sp = st.shadowPawns[si]; const pw = st.house[s][pi];
  if (reactCard(st, s, 'bump')) { sp.stunned = true; pushAway(st, sp); return; }
  log(st, `👻 The Hollow bumps ${nm(st, s)} at ${NODES[pw.node].name} back to the Great Hall.`);
  pw.node = 'hall'; pw.stunned = false; sp.node = null; sp.stunned = false;
  if (!st.markers.includes(s)) st.markers.push(s);
  if (houseSeats(st).every(h => st.markers.includes(h))) {
    st.markers = []; log(st, 'The Hollow holds every house marker — the Shadow Path advances!'); advanceMarker(st);
  }
  if (!st.turn.bumpDraw && st.shadowAcq.length) {
    st.turn.bumpDraw = true;
    const two = [st.shadowAcq.pop(), st.shadowAcq.pop()].filter(Boolean);
    prompt(st, { seat: st.shadowSeat, kind: 'bumpPick', ctx: { two }, text: 'Bump reward: put one spell on top of your deck.',
      options: two.map((c, i) => ({ value: i, label: `${CARDS[c.key].name}: ${CARDS[c.key].text}` })) });
  }
}
function checkShadowWin(st) {
  if (st.phase !== 'play' || !st.target || !ZONE_ORDER.every(z => st.progress[z])) return;
  const n = st.shadowPawns.filter(p => p.node === st.target).length;
  if (n >= st.need) endGame(st, { side: 'shadow', text: `The Hollow gathered ${n} pawn(s) at ${NODES[st.target].name}. Thornhold falls!` });
}
function endGame(st, w) { if (st.phase === 'over') return; st.phase = 'over'; st.winner = w; st.prompts = []; log(st, '🏁 ' + w.text); }

// ---------- turns ----------
function startTurn(st) {
  for (let guard = 0; guard < 12 && st.phase === 'play'; guard++) {
    if (st.final && st.seats.every(p => !p.hand.length)) return endGame(st, { side: 'draw', text: 'All cards are spent. The night ends in a stalemate — a draw.' });
    const seat = st.order[st.turnIdx];
    const p = st.seats[seat];
    st.turnNo++;
    st.turn = { seat, main: 1, took: false, card: null, bumpDraw: false, tokenUsed: false };
    if (p.skip) { p.skip = false; log(st, `${nm(st, seat)} is confounded and skips this turn.`); }
    else if (st.final && !p.hand.length) log(st, `${nm(st, seat)} has no cards left and passes.`);
    else return;
    st.turnIdx = (st.turnIdx + 1) % st.order.length;
  }
}
function err(m) { return { ok: false, err: m }; }

function act(st, seat, a) {
  if (st.phase !== 'play') return err('The game is over.');
  if (a.type === 'answer') return answer(st, seat, a.value);
  if (st.prompts.length) return err('Waiting for a choice to be made.');
  if (st.turn.seat !== seat) return err("It's not your turn.");
  const p = st.seats[seat];
  const res = (() => {
    switch (a.type) {
      case 'play': return play(st, seat, a);
      case 'move': return move(st, seat, a);
      case 'learn': return learn(st, seat, a);
      case 'replenish': return replenish(st, seat, a);
      case 'end':
        if (!st.turn.took && !(st.final && !p.hand.length)) return err('Take a main action first (play a card, learn or replenish).');
        st.turn.card = null;
        st.turnIdx = (st.turnIdx + 1) % st.order.length;
        startTurn(st);
        return { ok: true };
      default: return err('Unknown action');
    }
  })();
  return res || { ok: true };
}

function play(st, seat, a) {
  const p = st.seats[seat]; const t = st.turn;
  const inst = p.hand[a.idx]; if (!inst) return err('No such card.');
  const c = CARDS[inst.key];
  if (a.viaToken) {
    if (p.role !== 'house' || !p.token) return err('You have no Discipline token.');
    if (p.token.got === st.turnNo) return err('A token can be used from your next turn.');
    if (t.tokenUsed) return err('Token already used this turn.');
    if (c.disc !== p.token.disc) return err(`Token only works with ${W.DISC[p.token.disc].name} cards.`);
    returnToken(st, seat); t.tokenUsed = true;
  } else {
    if (t.main <= 0) return err('No main actions left this turn.');
    t.main--; t.took = true;
  }
  p.hand.splice(a.idx, 1); p.discard.push(inst);
  t.card = { key: inst.key, values: c.mv.slice(), used: [], moved: [] };
  log(st, `${nm(st, seat)} plays ${c.name}${a.viaToken ? ' (with a token)' : ''}.`);
  if (p.role === 'house') {
    if (c.draw) draw(st, seat, c.draw);
    if (c.again) t.main++;
    if (c.valor) changeValor(st, seat, c.valor);
    if (c.standUp) standUp(st, seat);
    if (c.stun || c.banish) {
      const r = c.stun || c.banish;
      const opts = [];
      st.shadowPawns.forEach((sp, i) => { if (sp.node && st.house[seat].some(pw => W.distance(pw.node, sp.node, st.hiddenOpen) <= r)) opts.push({ value: i, label: `Hollow pawn at ${NODES[sp.node].name}${sp.stunned ? ' (stunned)' : ''}` }); });
      if (opts.length) prompt(st, { seat, kind: c.stun ? 'houseStun' : 'banish', text: c.stun ? 'Stun which Hollow pawn?' : 'Banish which Hollow pawn?', options: opts.concat([{ value: 'skip', label: 'Skip' }]) });
    }
  } else if (c.eff) {
    if (ZONE_ORDER.indexOf(c.zone) > zoneIdx(st)) { log(st, `(${c.name}'s effect is still locked until ${ZONES[c.zone].name}.)`); return; }
    shadowEffect(st, c.eff);
  }
}
function shadowEffect(st, eff) {
  const s = st.shadowSeat; const hs = houseSeats(st);
  const targetOpts = hs.map(h => ({ value: h, label: nm(st, h) + ` — ${st.seats[h].hand.length} cards` }));
  switch (eff) {
    case 'draw1': draw(st, s, 1); break;
    case 'draw2': draw(st, s, 2); break;
    case 'deploy': promptDeploy(st, 1); break;
    case 'discard1': case 'discard2': case 'skip': case 'steal':
      prompt(st, { seat: s, kind: 'target', ctx: { eff }, text: 'Choose a Warden to target:', options: targetOpts }); break;
    case 'stun1': case 'stun2': {
      const r = eff === 'stun1' ? 1 : 2; const opts = [];
      hs.forEach(h => st.house[h].forEach((pw, pi) => {
        if (!pw.stunned && !NODES[pw.node].prot && st.shadowPawns.some(sp => sp.node && W.distance(sp.node, pw.node, st.hiddenOpen) <= r)) opts.push({ value: h + ':' + pi, label: `${nm(st, h)} at ${NODES[pw.node].name}` });
      }));
      if (opts.length) prompt(st, { seat: s, kind: 'darkStun', text: 'Stun which Warden pawn?', options: opts.concat([{ value: 'skip', label: 'Skip' }]) });
      break;
    }
    case 'terror':
      hs.forEach(h => {
        const hits = st.house[h].filter(pw => !NODES[pw.node].prot && st.shadowPawns.some(sp => sp.node && W.distance(sp.node, pw.node, st.hiddenOpen) <= 1));
        if (hits.length && !reactCard(st, h, 'target')) hits.forEach(pw => (pw.stunned = true));
      });
      log(st, 'Terror sweeps the castle!'); break;
  }
}

function move(st, seat, a) {
  const p = st.seats[seat]; const t = st.turn; const card = t.card;
  if (!card) return err('Play a card first.');
  const c = CARDS[card.key];
  const isHouse = p.role === 'house';
  const pw = isHouse ? st.house[seat][a.pawn] : st.shadowPawns[a.pawn];
  if (!pw) return err('No such pawn.');
  if (pw.stunned) return err('That pawn is stunned.');
  if (card.moved.includes(a.pawn)) return err('That pawn already moved with this card.');
  let path = a.path;
  if (a.use === 'direct') {
    if (!c.direct || card.used.includes('direct')) return err('This card has no direct move.');
    if (NODES[pw.node].hidden && !st.hiddenOpen) return err('That pawn is trapped in the Hidden Hall.');
    pw.node = c.direct; card.used.push('direct'); card.moved.push(a.pawn);
    log(st, `${nm(st, seat)} moves straight to ${NODES[c.direct].name}.`);
    houseLand(st, seat, a.pawn); return;
  }
  let budget;
  if (a.use === 'both') { if (card.values.length !== 2 || card.used.length) return err('Both values are no longer free.'); budget = card.values[0] + card.values[1]; }
  else { const i = +a.use; if (card.values[i] === undefined || card.used.includes(i)) return err('That movement value is used.'); budget = card.values[i]; }
  let extra = 0;
  if (!isHouse && pw.node === null) {
    if (!Array.isArray(path) || path[0] !== 'pool' || !W.DEPLOY.includes(path[1])) return err('Deploy onto a deployment space first.');
    if (st.shadowPawns.some(sp => sp.node === path[1])) return err('That deployment space is occupied.');
    extra = 1; path = path.slice(1);
    if (path.length === 1) { if (extra > budget) return err('Not enough movement.'); }
  } else if (!Array.isArray(path) || path.length < 2 || path[0] !== pw.node) return err('Path must start at the pawn.');
  const opts = { side: isHouse ? 'house' : 'shadow', pass: c.pass || [], fly: !!c.fly, secret: !!c.secret, hiddenOpen: st.hiddenOpen };
  const cost = path.length === 1 ? 0 : W.pathCost(path, opts);
  if (cost < 0) return err("That route isn't allowed.");
  const end = path[path.length - 1];
  if (isHouse && c.outside && !NODES[end].castle) budget += c.outside;
  if (cost + extra > budget) return err('Not enough movement for that route.');
  pw.node = end;
  if (a.use === 'both') card.used.push(0, 1); else card.used.push(+a.use);
  card.moved.push(a.pawn);
  log(st, `${nm(st, seat)} moves a pawn to ${NODES[end].name}.`);
  if (isHouse) houseLand(st, seat, a.pawn); else shadowLand(st, a.pawn);
}

function learn(st, seat, a) {
  const p = st.seats[seat]; const t = st.turn;
  if (p.role !== 'house') return err('Only Wardens can Learn.');
  if (t.main <= 0) return err('No main actions left.');
  if (!st.house[seat].some(pw => !NODES[pw.node].prot)) return err('You need a pawn outside a protected space to Learn.');
  const need = String(a.src).startsWith('adv') ? 2 : 1;
  const d = [...new Set(a.discards || [])].filter(i => p.hand[i]);
  if (d.length !== need) return err(`Discard exactly ${need} card(s).`);
  const ok = acquireOptions(st, true).some(o => o.value === a.src);
  if (!ok) return err('That card is not available.');
  d.sort((x, y) => y - x).forEach(i => p.discard.push(p.hand.splice(i, 1)[0]));
  const c = takeAcquire(st, a.src);
  if (c) p.deck.push(c);
  t.main--; t.took = true;
  log(st, `${nm(st, seat)} learns ${a.src === 'deck' ? 'a hidden spell' : CARDS[c.key].name} (on top of their deck).`);
  if (need === 2) changeValor(st, seat, 1);
}

function replenish(st, seat, a) {
  const p = st.seats[seat]; const t = st.turn;
  if (st.final) return err('No Replenish during the final night.');
  if (t.main <= 0) return err('No main actions left.');
  if (p.role === 'house') {
    const d = [...new Set(a.discards || [])].filter(i => p.hand[i]).sort((x, y) => y - x);
    d.forEach(i => p.discard.push(p.hand.splice(i, 1)[0]));
    draw(st, seat, Math.max(0, Math.min(5, 5 - p.hand.length)));
    standUp(st, seat);
    t.main--; t.took = true;
    log(st, `${nm(st, seat)} replenishes. The darkness grows…`);
    advanceMarker(st);
  } else {
    standUp(st, seat);
    draw(st, seat, Math.max(0, 5 - p.hand.length));
    t.main--; t.took = true;
    log(st, 'The Hollow replenishes its hand.');
  }
}

function answer(st, seat, value) {
  const pr = st.prompts[0];
  if (!pr) return err('Nothing to answer.');
  if (pr.seat !== seat) return err('Waiting for another player.');
  const valid = pr.options.some(o => String(o.value) === String(value));
  if (!valid) return err('Invalid choice.');
  st.prompts.shift();
  const p = st.seats[seat];
  switch (pr.kind) {
    case 'tome': {
      const i = +value; const t = st.libRow[i]; if (!t) break;
      p.tome = t; st.libRow[i] = st.libDeck.length ? st.libDeck.pop() : null;
      log(st, `${nm(st, seat)} takes the ${W.TOMES[t].name}.`);
      if (t === 'swiftness') draw(st, seat, 2);
      if (t === 'valor') changeValor(st, seat, 1);
      if (t === 'learning' && st.acqDeck.length) p.hand.push(st.acqDeck.pop());
      if (t === 'mending') { standUp(st, seat); draw(st, seat, 1); }
      tryShield(st, seat, pr.ctx.node);
      break;
    }
    case 'bonusAcquire':
      if (value !== 'skip') { const c = takeAcquire(st, value); if (c) { p.deck.push(c); log(st, `${nm(st, seat)} takes a bonus spell.`); } }
      break;
    case 'houseStun':
      if (value !== 'skip') { st.shadowPawns[+value].stunned = true; log(st, `${nm(st, seat)} stuns a Hollow pawn.`); }
      break;
    case 'banish':
      if (value !== 'skip') { const sp = st.shadowPawns[+value]; sp.node = null; sp.stunned = false; log(st, `${nm(st, seat)} banishes a Hollow pawn to the pool.`); }
      break;
    case 'target': {
      const h = +value;
      if (reactCard(st, h, 'target')) break;
      const eff = pr.ctx.eff;
      if (eff === 'discard1') discardRandom(st, h, 1);
      if (eff === 'discard2') discardRandom(st, h, 2);
      if (eff === 'skip') st.seats[h].skip = true;
      if (eff === 'steal') { returnToken(st, h); changeValor(st, h, -1); }
      log(st, `The Hollow targets ${nm(st, h)}.`);
      break;
    }
    case 'darkStun':
      if (value !== 'skip') { const [h, pi] = String(value).split(':').map(Number); if (!reactCard(st, h, 'target')) { st.house[h][pi].stunned = true; log(st, `The Hollow stuns ${nm(st, h)}'s pawn.`); } }
      break;
    case 'deploy':
      if (value !== 'skip') {
        const si = st.shadowPawns.findIndex(sp => sp.node === null);
        if (si >= 0 && freeDeploys(st).includes(value)) {
          st.shadowPawns[si].node = value; st.shadowPawns[si].stunned = false;
          log(st, `A Hollow pawn appears at ${NODES[value].name}.`);
          shadowLand(st, si);
        }
        if (pr.ctx.left > 1) promptDeploy(st, pr.ctx.left - 1);
      }
      break;
    case 'bumpWho': { const [h, pi] = String(value).split(':').map(Number); bump(st, h, pi, pr.ctx.si); break; }
    case 'bumpPick': {
      const keep = pr.ctx.two[+value]; const other = pr.ctx.two.find((c, i) => i !== +value);
      p.deck.push(keep); if (other) st.shadowAcq.unshift(other);
      break;
    }
    case 'eventChoice':
      if (value === 'token') takeToken(st, pr.ctx.zone); else darkEvent(st, EVENTS[pr.ctx.key].dark);
      break;
  }
  return { ok: true };
}

// What each player is allowed to see
function view(st, seat) {
  const me = st.seats[seat];
  const pub = s => ({
    name: s.name, role: s.role, house: s.house, handCount: s.hand.length, deckCount: s.deck.length, discardCount: s.discard.length,
    valor: s.valor, tome: s.tome, scrolls: s.scrolls, sigil: s.sigil, shields: s.shields, token: s.token ? s.token.disc : null,
    tokenReady: s.token ? s.token.got !== st.turnNo : false, locCount: s.locs ? s.locs.length : 0, skip: s.skip
  });
  return {
    you: seat, phase: st.phase, winner: st.winner,
    seats: st.seats.map(pub), order: st.order, shadowSeat: st.shadowSeat,
    hand: me ? me.hand.map(c => c.key) : [], locs: me && me.locs ? me.locs : [],
    house: st.house, shadowPawns: st.shadowPawns, shields: st.shields, tokens: st.tokens, hiddenOpen: st.hiddenOpen,
    row: st.row.map(c => c && c.key), adv: st.adv.map(c => c && c.key), acqCount: st.acqDeck.length,
    libRow: st.libRow, marker: st.marker, progress: st.progress, target: st.target, need: st.need,
    markers: st.markers, sigils: st.sigils, lens: st.lens, final: st.final,
    turn: st.turn && { seat: st.turn.seat, main: st.turn.main, took: st.turn.took, tokenUsed: st.turn.tokenUsed, card: st.turn.card },
    prompt: st.prompts[0] ? { seat: st.prompts[0].seat, text: st.prompts[0].text, options: st.prompts[0].seat === seat ? st.prompts[0].options : [] } : null,
    log: st.log.slice(-40)
  };
}

module.exports = { createGame, act, view };
