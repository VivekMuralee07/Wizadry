# Wardens of Thornhold

Online asymmetric deck-building board game for 2–5 friends (1 Hollow vs 1–4 Wardens), inspired by the mechanics of *Defenders of Hogwarts*. Original theme, names and art.

## Files (all flat at the repo root)
| File | What it does |
|---|---|
| `server.js` | Express + Socket.io server: rooms, codes, reconnect |
| `game.js` | Authoritative rules engine (server only) |
| `bots.js` | Easy / Medium / Hard bot AI (server only) |
| `shared.js` | Map, cards, events, pathfinding (server + browser) |
| `index.html`, `app.js`, `style.css` | The game client + full in-game rules |
| `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png` | PWA, ready for PWABuilder → Android APK |
| `package.json` | Dependencies and start script |

## Deploy on Render
1. Create a new GitHub repo and upload every file to the root of `main`.
2. Render → New → **Web Service** → connect the repo.
3. Build command: `npm install` · Start command: `npm start` · Instance: Free or Starter.
4. Open the `.onrender.com` URL, create a room, share the 4-letter code.

## Bots
Host adds bots in the lobby (Easy, Medium, Hard, any free seat), or tap **Play vs bots** on the home screen. If a player leaves mid-game a Medium bot takes their seat until they rejoin.

## Android app
Run the Render URL through https://www.pwabuilder.com → Android → download the package. If you publish via a TWA, upload your `assetlinks.json` to the repo root; the server serves it at `/.well-known/assetlinks.json`. Open `/twa-check` on your site to see the package and fingerprints Android will read.

## Run locally
`npm install && npm start` → http://localhost:3000
