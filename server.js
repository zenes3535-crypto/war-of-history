// War of History - HTTP + WebSocket sunucusu
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { WebSocketServer } = require('ws');
const { Game, prepareWorld, SPEED_NAMES } = require('./game/sim');
const { SCENARIOS } = require('./game/scenarios');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const world = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'world.json'), 'utf8'));
prepareWorld(world);

// ---------------- statik dosyalar (gzip önbellekli) ----------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const gzCache = new Map();
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('404'); }
    const ext = path.extname(file);
    const h = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.json' ? 'public, max-age=3600' : 'no-cache' };
    const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && /\.(json|js|html|css|svg)$/.test(file);
    const key = file + ':' + st.mtimeMs;
    if (gz && gzCache.has(key)) { h['Content-Encoding'] = 'gzip'; res.writeHead(200, h); return res.end(gzCache.get(key)); }
    fs.readFile(file, (e2, data) => {
      if (e2) { res.writeHead(500); return res.end(); }
      if (gz) { data = zlib.gzipSync(data, { level: 7 }); gzCache.set(key, data); h['Content-Encoding'] = 'gzip'; }
      res.writeHead(200, h); res.end(data);
    });
  });
});

// ---------------- odalar ----------------
const rooms = new Map();
const previews = new Map(); // senaryo -> lobi önizlemesi
function preview(sc) {
  if (!previews.has(sc)) {
    const g = new Game(sc, { toCiv() {} });
    previews.set(sc, { civs: g.civs.map(c => ({ id: c.id, name: c.name, iso: c.iso, color: c.color, cap: c.cap, alive: c.alive })), owner: Array.from(g.owner) });
  }
  return previews.get(sc);
}
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code; do { code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); } while (rooms.has(code));
  return code;
}
const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); };
const bcast = (room, msg) => { const s = JSON.stringify(msg); for (const p of room.players) send(p.ws, s); };
const playerOfCiv = (room, civ) => room.players.find(p => p.civ === civ);

function lobbyMsg(room) {
  return { type: 'lobby', code: room.code, hostId: room.hostId, solo: room.solo, status: room.status, scenario: room.scenario, speed: room.speed,
    scenarios: Object.entries(SCENARIOS).map(([id, s]) => ({ id, name: s.name })), speeds: SPEED_NAMES,
    players: room.players.map(p => ({ id: p.id, name: p.name, civ: p.civ, online: !!p.ws })) };
}

function startGame(room) {
  room.status = 'playing';
  const g = new Game(room.scenario, {
    toCiv: (civ, msg) => { const p = playerOfCiv(room, civ); if (p) send(p.ws, msg); },
    day: () => onDay(room),
    civDied: (civ) => { const p = playerOfCiv(room, civ); if (p) send(p.ws, { type: 'defeated' }); },
  });
  g.speed = room.speed;
  room.game = g;
  for (const p of room.players) if (p.civ != null && g.civs[p.civ]) g.civs[p.civ].human = p.ws ? p.id : null;
  bcast(room, lobbyMsg(room));
  for (const p of room.players) sendInit(room, p);
  room.timer = setInterval(() => tick(room), 250);
  room.tickN = 0;
}
function sendInit(room, p) {
  const g = room.game;
  send(p.ws, { type: 'init', me: p.civ, st: g.staticView(), prov: g.provView(), armies: g.armyList(), date: g.dateStr(), day: g.day, speed: g.speed,
    wars: g.warList(), sum: g.civSummary(), priv: p.civ != null ? g.civPrivate(p.civ) : null,
    offers: [...g.offers.values()].filter(o => o.to === p.civ).map(o => g.offerView(o)) });
}
function tick(room) {
  const g = room.game;
  if (!room.players.some(p => p.ws)) return; // kimse yoksa zaman durur
  g.update(250);
  room.tickN++;
  const msg = { type: 'tick', a: g.armyList(), c: g.changes, date: g.dateStr(), dayFrac: Math.round(g.dayAcc * 100) / 100, speed: g.speed };
  g.changes = [];
  if (g.dirtyProv.size) {
    msg.dp = [...g.dirtyProv].map(p => [p, g.dev[p], g.fort[p], g.factory[p], g.barracks[p], g.univ[p], Math.round(g.pop[p] / 1000)]);
    g.dirtyProv.clear();
  }
  const evs = g.events; g.events = [];
  const base = JSON.stringify(msg);
  for (const p of room.players) {
    if (!p.ws) continue;
    send(p.ws, base);
    const mine = evs.filter(e => !e.civs || e.civs.includes(p.civ));
    if (mine.length) send(p.ws, { type: 'events', list: mine });
  }
}
function onDay(room) {
  const g = room.game;
  const sum = g.day % 5 === 0 ? g.civSummary() : null;
  const wars = g.warList();
  const provEcon = g.day % 10 === 0 ? Array.from(g.pop, v => Math.round(v / 1000)) : null;
  for (const p of room.players) {
    if (!p.ws) continue;
    send(p.ws, { type: 'day', priv: p.civ != null ? g.civPrivate(p.civ) : null, sum, wars, pop: provEcon });
  }
}

function handleGame(room, player, m) {
  const g = room.game, me = player.civ;
  const reply = (err) => { if (err && err !== 'sent' && err !== 'accepted' && err !== 'rejected') send(player.ws, { type: 'error', msg: err }); };
  const int = v => Number.isInteger(v) ? v : -1;
  if (m.type === 'speed') {
    if (room.hostId !== player.id) return;
    const s = int(m.s); if (s >= 0 && s < SPEED_NAMES.length) { g.speed = s; room.speed = s; bcast(room, { type: 'speed', s }); }
    return;
  }
  if (me == null || !g.civs[me] || !g.civs[me].alive) return;
  const prov = int(m.prov);
  const validProv = prov >= 0 && prov < g.owner.length;
  switch (m.type) {
    case 'move': if (validProv && Array.isArray(m.ids)) { const n = g.cmdMove(me, m.ids.slice(0, 60).map(Number), prov); if (!n) reply('Oraya yol yok (savaşta olmadığın ülkelerden geçemezsin).'); } break;
    case 'recruit': if (validProv) reply(g.cmdRecruit(me, prov, Number(m.amount) || 0)); break;
    case 'build': if (validProv) reply(g.cmdBuild(me, prov, String(m.what))); break;
    case 'invest': if (validProv) reply(g.cmdInvest(me, prov)); break;
    case 'research': reply(g.cmdResearch(me, String(m.tech))); break;
    case 'airbuild': reply(g.cmdAirBuild(me)); break;
    case 'airstrike': if (validProv) reply(g.cmdAirStrike(me, prov)); break;
    case 'split': g.cmdSplit(me, int(m.id)); break;
    case 'merge': if (Array.isArray(m.ids)) g.cmdMerge(me, m.ids.slice(0, 60).map(Number)); break;
    case 'diplo': {
      const to = int(m.to); if (to < 0 || to >= g.civs.length) return;
      const extra = { take: Array.isArray(m.take) ? m.take.map(Number) : [], give: Array.isArray(m.give) ? m.give.map(Number) : [], amount: Number(m.amount) || 0 };
      const r = g.diplo(me, to, String(m.action), extra);
      if (r === 'accepted') send(player.ws, { type: 'info', msg: g.civs[to].name + ' teklifini kabul etti!' });
      else if (r === 'rejected') send(player.ws, { type: 'info', msg: g.civs[to].name + ' teklifini reddetti.' });
      else if (r === 'sent') send(player.ws, { type: 'info', msg: 'Teklif ' + g.civs[to].name + ' liderine gönderildi.' });
      else reply(r);
      send(player.ws, { type: 'day', priv: g.civPrivate(me), wars: g.warList() });
      break;
    }
    case 'reply': g.replyOffer(me, int(m.offer), !!m.accept); send(player.ws, { type: 'day', priv: g.civPrivate(me), wars: g.warList() }); break;
    case 'chat': {
      const to = int(m.to); const text = String(m.text || '').slice(0, 300).trim();
      if (to < 0 || to >= g.civs.length || !text) return;
      const msg = { type: 'chat', from: me, to, text, name: player.name, date: g.dateStr() };
      send(player.ws, msg);
      const other = playerOfCiv(room, to);
      if (other && other.ws) send(other.ws, msg);
      else setTimeout(() => { if (room.game) send(player.ws, { type: 'chat', from: to, to: me, text: g.aiReply(g.civs[to], me, text), date: g.dateStr(), ai: true }); }, 700 + Math.random() * 900);
      break;
    }
  }
}

function removePlayer(room, player) {
  if (room.status === 'lobby') {
    room.players = room.players.filter(p => p !== player);
    if (room.hostId === player.id && room.players.length) room.hostId = room.players[0].id;
  } else {
    player.ws = null;
    if (room.game && player.civ != null) room.game.civs[player.civ].human = null; // yapay zekâ devralır
  }
  if (!room.players.some(p => p.ws)) {
    // oyunda herkes çıktıysa 10 dk bekle, sonra sil
    clearTimeout(room.killTimer);
    room.killTimer = setTimeout(() => { if (!room.players.some(p => p.ws)) { clearInterval(room.timer); rooms.delete(room.code); } }, room.status === 'lobby' ? 1000 : 600000);
    return;
  }
  bcast(room, lobbyMsg(room));
}

const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let room = null, player = null;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const name = s => String(s || '').trim().slice(0, 16) || 'Lider';
    if (m.type === 'create' || m.type === 'join') {
      if (room) return;
      let r;
      if (m.type === 'create') {
        r = { code: genCode(), players: [], hostId: null, status: 'lobby', scenario: SCENARIOS[m.scenario] ? m.scenario : '2026', speed: 3, solo: !!m.solo, nextId: 1, game: null };
        rooms.set(r.code, r);
      } else {
        r = rooms.get(String(m.code || '').toUpperCase().trim());
        if (!r) return send(ws, { type: 'error', msg: 'Oda bulunamadı.' });
        if (r.solo) return send(ws, { type: 'error', msg: 'Bu tek oyunculu bir oyun.' });
      }
      const re = r.status !== 'lobby' && r.players.find(p => !p.ws && p.name === name(m.name));
      if (r.status !== 'lobby' && !re) return send(ws, { type: 'error', msg: 'Oyun başlamış. Aynı isimle ayrıldıysan o isimle gir.' });
      if (!re && r.players.length >= 8) return send(ws, { type: 'error', msg: 'Oda dolu.' });
      room = r; clearTimeout(room.killTimer);
      if (re) { player = re; player.ws = ws; if (room.game && player.civ != null) room.game.civs[player.civ].human = player.id; }
      else { player = { id: room.nextId++, name: name(m.name), civ: null, ws }; room.players.push(player); if (room.hostId == null) room.hostId = player.id; }
      send(ws, { type: 'welcome', id: player.id, code: room.code });
      bcast(room, lobbyMsg(room));
      if (room.status === 'lobby') send(ws, { type: 'preview', scenario: room.scenario, ...preview(room.scenario) });
      else sendInit(room, player);
      return;
    }
    if (!room || !player) return;
    if (room.status === 'lobby') {
      if (m.type === 'scenario' && room.hostId === player.id && SCENARIOS[m.scenario]) {
        room.scenario = m.scenario;
        for (const p of room.players) p.civ = null;
        bcast(room, lobbyMsg(room));
        bcast(room, { type: 'preview', scenario: room.scenario, ...preview(room.scenario) });
      } else if (m.type === 'pick') {
        const c = Number.isInteger(m.civ) ? m.civ : null;
        const pv = preview(room.scenario);
        if (c === null || (pv.civs[c] && pv.civs[c].alive && !room.players.some(p => p.civ === c && p !== player))) player.civ = c;
        bcast(room, lobbyMsg(room));
      } else if (m.type === 'speed' && room.hostId === player.id) {
        const s = Number(m.s); if (Number.isInteger(s) && s >= 0 && s < SPEED_NAMES.length) { room.speed = s; bcast(room, lobbyMsg(room)); }
      } else if (m.type === 'start' && room.hostId === player.id) {
        if (room.players.some(p => p.civ == null)) return send(ws, { type: 'error', msg: 'Herkes bir ülke seçmeli.' });
        startGame(room);
      }
      return;
    }
    if (room.status === 'playing') handleGame(room, player, m);
  });
  ws.on('close', () => { if (room && player) removePlayer(room, player); });
});

setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 30000);
server.listen(PORT, () => console.log('War of History sunucusu: http://localhost:' + PORT));
