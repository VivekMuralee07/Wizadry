// Wardens of Thornhold — multiplayer server (Render web service)
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const G = require('./game');
const W = require('./shared');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Files are flat at the repo root; only serve the public ones.
const PUBLIC = ['index.html', 'app.js', 'style.css', 'shared.js', 'manifest.json', 'sw.js', 'icon-192.png', 'icon-512.png'];
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
PUBLIC.forEach(f => app.get('/' + f, (req, res) => res.sendFile(path.join(__dirname, f))));
app.get('/.well-known/assetlinks.json', (req, res) => res.sendFile(path.join(__dirname, 'assetlinks.json'), e => e && res.status(404).end()));
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
    players: room.players.map(p => ({ id: p.id, name: p.name, role: p.role, house: p.house, online: p.online })) };
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
      s.emit('state', G.view(room.game, seat));
    }
  }
}
function freeHouse(room) { return HOUSE_KEYS.find(h => !room.players.some(p => p.role === 'house' && p.house === h)); }

io.on('connection', socket => {
  let room = null, me = null;

  function attach(r, p) { room = r; me = p; p.socket = socket.id; p.online = true; socket.join(r.code); broadcast(r); }

  socket.on('create', ({ name, pid }) => {
    const r = { code: code(), host: pid, players: [], game: null, touched: Date.now() };
    rooms[r.code] = r;
    const p = { id: pid, name: String(name || 'Warden').slice(0, 16), role: 'shadow', house: null };
    r.players.push(p);
    attach(r, p);
  });

  socket.on('join', ({ code, name, pid }, cb) => {
    const r = rooms[String(code || '').toUpperCase()];
    if (!r) return cb && cb({ err: 'No room with that code.' });
    let p = r.players.find(x => x.id === pid);
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
      if (taken) return;
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
    if (!room || !room.game || !me) return;
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
    else me.online = false;
    me.socket = null;
    if (room.host === me.id && room.players.length) room.host = room.players[0].id;
    socket.leave(room.code);
    const r = room; room = null; me = null;
    if (!r.players.length) delete rooms[r.code]; else broadcast(r);
  });

  socket.on('disconnect', () => { if (me) { me.online = false; me.socket = null; broadcast(room); } });
});

// Clean up rooms idle for 6 hours
setInterval(() => { const now = Date.now(); for (const c in rooms) if (now - rooms[c].touched > 6 * 3600e3) delete rooms[c]; }, 600e3);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Wardens of Thornhold on port ' + PORT));
