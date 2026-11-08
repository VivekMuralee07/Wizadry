// Wardens of Thornhold — multiplayer server (Render web service)
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const G = require('./game');
const B = require('./bots');
const W = require('./shared');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Files are flat at the repo root; only serve the public ones.
const PUBLIC = ['index.html', 'app.js', 'style.css', 'shared.js', 'manifest.json', 'sw.js', 'icon-192.png', 'icon-512.png'];
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
PUBLIC.forEach(f => app.get('/' + f, (req, res) => res.sendFile(path.join(__dirname, f))));
// Android app links: works whether assetlinks.json is at the repo root or inside a .well-known folder
const fs = require('fs');
function findAssetLinks() {
  for (const f of [path.join(__dirname, 'assetlinks.json'), path.join(__dirname, '.well-known', 'assetlinks.json')]) if (fs.existsSync(f)) return f;
  return null;
}
app.get('/.well-known/assetlinks.json', (req, res) => {
  const f = findAssetLinks();
  if (!f) return res.status(404).json({ error: 'assetlinks.json not found in the repo' });
  res.type('application/json').sendFile(f);
});
// Open /twa-check on your phone to see exactly what Android will read
app.get('/twa-check', (req, res) => {
  const f = findAssetLinks(); let body = '';
  if (!f) body = '<p style="color:#f77">No assetlinks.json found. Upload it to the root of the main branch.</p>';
  else {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      body = '<p style="color:#7f7">Found and valid JSON.</p>' + j.map(x => `<p><b>Package:</b> ${x.target.package_name}<br><b>Fingerprints:</b><br>${(x.target.sha256_cert_fingerprints || []).join('<br>')}</p>`).join('');
    } catch (e) { body = '<p style="color:#f77">The file exists but is not valid JSON: ' + e.message + '</p>'; }
  }
  const site = 'https://' + req.get('host');
  res.send(`<body style="font-family:sans-serif;background:#1e2433;color:#eee;padding:1rem;line-height:1.5"><h2>App link check</h2>${body}
    <p>Google's own check (should list your package):<br><a style="color:#d9a441;word-break:break-all" href="https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=${site}&relation=delegate_permission/common.handle_all_urls">${site} verification</a></p></body>`);
});
app.get('/healthz', (req, res) => res.send('ok'));

const rooms = {}; // code -> room
const HOUSE_KEYS = Object.keys(W.HOUSES);

function code() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c; do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms[c]);
  return c;
}
function lobbyView(room) {
  return { code: room.code, host: room.host, started: !!room.game,
    players: room.players.map(p => ({ id: p.id, name: p.name, role: p.role, house: p.house, online: p.online || !!p.bot, bot: p.bot || null })) };
}
function broadcast(room) {
  room.touched = Date.now();
  for (const p of room.players) {
    if (!p.socket) continue;
    const s = io.sockets.sockets.get(p.socket);
    if (!s) continue;
    s.emit('lobby', lobbyView(room));
    if (room.game) {
      const seat = room.game.seats.findIndex(x => x.id === p.id);
      const v = G.view(room.game, seat);
      v.bots = room.game.seats.map(x => { const q = room.players.find(y => y.id === x.id); return q && q.bot ? q.bot : null; });
      s.emit('state', v);
    }
  }
  pumpBots(room);
}

// ---------- bots ----------
const LEVEL_NAME = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
function addBot(room, level, wantShadow) {
  if (room.players.length >= 5) return;
  const shadowFree = !room.players.some(p => p.role === 'shadow');
  const role = shadowFree && (wantShadow || !room.players.some(p => p.role === 'house') || wantShadow === undefined) ? 'shadow' : 'house';
  const house = role === 'house' ? freeHouse(room) : null;
  if (role === 'house' && !house) return;
  const n = room.players.filter(p => p.bot).length + 1;
  room.players.push({ id: 'bot-' + Math.random().toString(36).slice(2, 9), name: `${LEVEL_NAME[level]} Bot ${n}`, role, house, bot: level, online: true });
}
function pumpBots(room) {
  const st = room.game;
  if (room.botTimer || !st || st.phase !== 'play') return;
  const seat = st.prompts.length ? st.prompts[0].seat : st.turn.seat;
  const pl = room.players.find(p => p.id === st.seats[seat].id);
  if (!pl) return;
  const away = !pl.bot && !pl.online && pl.offlineAt && Date.now() - pl.offlineAt > 45000; // stand-in for a dropped player
  if (!pl.bot && !away) return;
  const level = pl.bot || 'medium';
  const delay = st.prompts.length ? 750 : st.turn.card ? 700 : 1000;
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    if (room.game !== st || st.phase !== 'play') return;
    let a = null;
    try { a = B.decide(st, seat, level); } catch (e) { console.error('bot error', e); }
    let r = a ? G.act(st, seat, a) : { ok: false };
    if (!r.ok) {
      const pr = st.prompts[0];
      if (pr && pr.seat === seat) r = G.act(st, seat, { type: 'answer', value: pr.options[0].value });
      if (!r.ok) r = G.act(st, seat, { type: 'end' });
      if (!r.ok) r = G.act(st, seat, { type: 'replenish', discards: [] });
      if (!r.ok && st.seats[seat].hand.length) r = G.act(st, seat, { type: 'play', idx: 0 });
    }
    room.botActs = room.botTurn === st.turnNo ? room.botActs + 1 : 1;
    room.botTurn = st.turnNo;
    if (room.botActs > 30) G.act(st, seat, { type: 'end' });
    broadcast(room);
  }, delay);
}
function freeHouse(room) { return HOUSE_KEYS.find(h => !room.players.some(p => p.role === 'house' && p.house === h)); }

io.on('connection', socket => {
  let room = null, me = null;

  function attach(r, p) { room = r; me = p; p.socket = socket.id; p.online = true; socket.join(r.code); broadcast(r); }

  socket.on('create', ({ name, pid, quick }) => {
    const r = { code: code(), host: pid, players: [], game: null, touched: Date.now() };
    rooms[r.code] = r;
    const p = { id: pid, name: String(name || 'Warden').slice(0, 16), role: quick ? 'house' : 'shadow', house: quick ? 'ember' : null };
    r.players.push(p);
    if (quick) addBot(r, 'medium', true);
    attach(r, p);
  });

  socket.on('addBot', ({ level, side }) => {
    if (!room || room.game || !me || room.host !== me.id || !LEVEL_NAME[level]) return;
    addBot(room, level, side === 'shadow' ? true : side === 'house' ? false : undefined);
    broadcast(room);
  });
  socket.on('removeBot', ({ id }) => {
    if (!room || room.game || !me || room.host !== me.id) return;
    room.players = room.players.filter(p => !(p.bot && p.id === id));
    broadcast(room);
  });
  socket.on('botLevel', ({ id, level }) => {
    if (!room || room.game || !me || room.host !== me.id || !LEVEL_NAME[level]) return;
    const b = room.players.find(p => p.bot && p.id === id);
    if (b) { b.bot = level; b.name = b.name.replace(/^(Easy|Medium|Hard)/, LEVEL_NAME[level]); }
    broadcast(room);
  });

  socket.on('join', ({ code, name, pid }, cb) => {
    const r = rooms[String(code || '').toUpperCase()];
    if (!r) return cb && cb({ err: 'No room with that code.' });
    let p = r.players.find(x => x.id === pid);
    if (p && p.tookOver) { p.bot = null; p.tookOver = false; }
    if (!p) {
      if (r.game) return cb && cb({ err: 'That game has already started.' });
      if (r.players.length >= 5) return cb && cb({ err: 'Room is full (5 players).' });
      const h = freeHouse(r);
      p = { id: pid, name: String(name || 'Warden').slice(0, 16), role: r.players.some(x => x.role === 'shadow') ? 'house' : 'shadow', house: null };
      if (p.role === 'house') p.house = h;
      r.players.push(p);
    }
    cb && cb({ ok: true });
    attach(r, p);
  });

  socket.on('role', ({ role, house }) => {
    if (!room || room.game || !me) return;
    if (role === 'shadow') {
      const cur = room.players.find(p => p.role === 'shadow');
      if (cur && cur !== me) { cur.role = 'house'; cur.house = me.house || freeHouse(room); }
      me.role = 'shadow'; me.house = null;
    } else if (role === 'house' && HOUSE_KEYS.includes(house)) {
      const taken = room.players.find(p => p !== me && p.role === 'house' && p.house === house);
      if (taken && !taken.bot) return;
      if (taken) { taken.role = me.role; taken.house = me.role === 'house' ? me.house : null; }
      me.role = 'house'; me.house = house;
    }
    broadcast(room);
  });

  socket.on('start', (cb) => {
    if (!room || !me || room.host !== me.id) return;
    try {
      room.game = G.createGame(room.players.map(p => ({ id: p.id, name: p.name, role: p.role, house: p.house })));
      broadcast(room);
    } catch (e) { cb && cb({ err: e.message }); }
  });

  socket.on('act', (action, cb) => {
    if (!room || !room.game || !me || me.bot) return;
    const seat = room.game.seats.findIndex(x => x.id === me.id);
    const r = G.act(room.game, seat, action || {});
    if (cb) cb(r);
    if (r.ok) broadcast(room);
  });

  socket.on('rematch', () => {
    if (!room || !me || room.host !== me.id || !room.game || room.game.phase !== 'over') return;
    room.game = null; broadcast(room);
  });

  socket.on('leave', () => {
    if (!room || !me) return;
    if (!room.game) room.players = room.players.filter(p => p !== me);
    else { me.online = false; if (room.game.phase === 'play') { me.bot = 'medium'; me.tookOver = true; } }
    me.socket = null;
    const humans = room.players.filter(p => !p.bot);
    if (room.host === me.id && humans.length) room.host = humans[0].id;
    if (!humans.length) { clearTimeout(room.botTimer); delete rooms[room.code]; socket.leave(room.code); room = null; me = null; return; }
    socket.leave(room.code);
    const r = room; room = null; me = null;
    if (!r.players.length) delete rooms[r.code]; else broadcast(r);
  });

  socket.on('disconnect', () => { if (me && room) { me.online = false; me.offlineAt = Date.now(); me.socket = null; broadcast(room); } });
});

// Let bots stand in for players who dropped mid-turn
setInterval(() => { for (const c in rooms) pumpBots(rooms[c]); }, 10000);

// Clean up rooms idle for 6 hours
setInterval(() => { const now = Date.now(); for (const c in rooms) if (now - rooms[c].touched > 6 * 3600e3) delete rooms[c]; }, 600e3);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Wardens of Thornhold on port ' + PORT));
