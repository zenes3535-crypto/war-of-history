const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const world = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'world.json'), 'utf8'));
const { gw: GW, gh: GH, rle } = world.grid;
const NC = GW * GH;
const NP = world.provs.length;

// Hücre -> il (0 = deniz, id+1)
const cellProv = new Int32Array(NC);
{ let k = 0; for (let i = 0; i < rle.length; i += 2) for (let j = 0; j < rle[i + 1]; j++) cellProv[k++] = rle[i]; }
const provCountry = world.provs.map(p => p[1]);
const provCells = Array.from({ length: NP }, () => []);
let LAND = 0;
for (let i = 0; i < NC; i++) if (cellProv[i]) { provCells[cellProv[i] - 1].push(i); LAND++; }
const GMAX = provCells.map(c => Math.round(6 + 1.6 * c.length));            // il garnizonu üst sınırı
// il komşulukları
const provAdj = Array.from({ length: NP }, () => new Set());
for (let i = 0; i < NC; i++) {
  const a = cellProv[i] - 1; if (a < 0) continue;
  const x = i % GW;
  if (x + 1 < GW) { const b = cellProv[i + 1] - 1; if (b >= 0 && b !== a) { provAdj[a].add(b); provAdj[b].add(a); } }
  if (i + GW < NC) { const b = cellProv[i + GW] - 1; if (b >= 0 && b !== a) { provAdj[a].add(b); provAdj[b].add(a); } }
}
const provCenter = provCells.map(cs => { let sx = 0, sy = 0; for (const c of cs) { sx += c % GW; sy += (c / GW) | 0; } return [sx / cs.length, sy / cs.length]; });
const countryProvs = new Map();
provCountry.forEach((c, p) => { if (!countryProvs.has(c)) countryProvs.set(c, []); countryProvs.get(c).push(p); });
const capOf = c => world.countries[c].cap;

const COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#46c6c6', '#f0c800', '#e87fd0'];
const MAX_PLAYERS = 8;
const TICK_MS = 200;
const SPEED = 1.3;            // tick başına hücre
const WIN_RATIO = 0.5;
const INCOME = 0.0012;        // hücre başına tick başına asker
const MAX_UNITS = 40, MIN_UNIT = 5;
const GARRISON_REGEN = 0.002; // tick başına GMAX oranı
const STAR_POINTS = 4;        // 1 yıldız için gereken net puan
const PROV_PER_STAR = 3;
const OFFER_TTL = 45000, WAR_COOLDOWN = 30000;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && /\.(json|js|html|css)$/.test(file);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    const h = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
    if (gz) { h['Content-Encoding'] = 'gzip'; data = zlib.gzipSync(data, { level: 6 }); }
    res.writeHead(200, h);
    res.end(data);
  });
});

const rooms = new Map();
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); } while (rooms.has(code));
  return code;
}
function makeRoom() {
  return { code: genCode(), players: [], hostId: null, status: 'lobby', owner: null, own: {}, provOwner: null, garrison: null, units: new Map(), nextUnit: 1,
    timer: null, winner: null, nextId: 1, changes: [], provChanges: [], peace: new Set(), warSince: new Map(), score: {}, offers: new Map(), ticks: 0, events: [] };
}
const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const broadcast = (room, msg) => { const s = JSON.stringify(msg); for (const p of room.players) if (p.ws && p.ws.readyState === 1) p.ws.send(s); };
const pairKey = (a, b) => a < b ? a + '-' + b : b + '-' + a;
const atPeace = (room, a, b) => room.peace.has(pairKey(a, b));

function lobbyInfo(room) {
  return { type: 'lobby', code: room.code, hostId: room.hostId, status: room.status,
    players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, country: p.country, online: !!p.ws })) };
}
const r1 = v => Math.round(v * 10) / 10;
const unitList = room => [...room.units.values()].map(u => [u.id, u.owner, Math.round(u.x * 100) / 100, Math.round(u.y * 100) / 100, r1(u.troops), u.path.length ? u.path[u.path.length - 1] : -1, u.fight ? 1 : 0]);
const garList = room => Array.from(room.garrison, g => Math.round(g));

// Yıldızlar: a'nın b üzerindeki net savaş puanı
function stars(room, a, b) {
  const net = (room.score[a + '>' + b] || 0) - (room.score[b + '>' + a] || 0);
  return Math.max(0, Math.min(5, Math.floor(net / STAR_POINTS)));
}
function dipInfo(room, player) {
  const rel = [];
  for (const o of room.players) if (o.id !== player.id) rel.push({ id: o.id, peace: atPeace(room, player.id, o.id), mine: stars(room, player.id, o.id), theirs: stars(room, o.id, player.id) });
  return { type: 'dip', rel };
}
function fullState(room, player) {
  return { type: 'full', owner: Buffer.from(room.owner).toString('base64'), provOwner: Array.from(room.provOwner), gar: garList(room), units: unitList(room),
    reserve: player ? Math.floor(player.reserve) : 0, own: room.own };
}
function setCell(room, i, o) {
  const prev = room.owner[i];
  if (prev === o) return;
  if (prev) room.own[prev]--;
  if (o) room.own[o] = (room.own[o] || 0) + 1;
  room.owner[i] = o;
  room.changes.push(i, o);
}
function setProvOwner(room, p, o) {
  room.provOwner[p] = o;
  for (const c of provCells[p]) setCell(room, c, o);
  room.provChanges.push(p, o);
}
function addUnit(room, owner, x, y, troops) {
  const u = { id: room.nextUnit++, owner, x, y, troops, path: [], fight: false, nm: 0 };
  room.units.set(u.id, u);
  return u;
}

function startGame(room) {
  room.status = 'playing';
  room.owner = new Uint8Array(NC);
  room.provOwner = new Uint8Array(NP);
  room.garrison = new Float32Array(NP);
  for (let p = 0; p < NP; p++) room.garrison[p] = GMAX[p] * 0.8;
  room.own = {};
  const taken = new Set(room.players.map(p => p.country).filter(x => x != null));
  const cids = [...countryProvs.keys()];
  for (const p of room.players) {
    if (p.country == null) {
      let c; do { c = cids[Math.floor(Math.random() * cids.length)]; } while (taken.has(c));
      p.country = c; taken.add(c);
    }
    p.reserve = 50;
    for (const pr of countryProvs.get(p.country)) { setProvOwner(room, pr, p.id); room.garrison[pr] = GMAX[pr]; }
    const cap = capOf(p.country), [cx, cy] = provCenter[cap];
    addUnit(room, p.id, cx + 0.5, cy + 0.5, 40);
  }
  room.changes = []; room.provChanges = [];
  room.timer = setInterval(() => tick(room), TICK_MS);
  broadcast(room, lobbyInfo(room));
  for (const p of room.players) { send(p.ws, { type: 'start' }); send(p.ws, fullState(room, p)); send(p.ws, dipInfo(room, p)); }
}

// Hedeften geriye BFS
function bfsFrom(target) {
  const next = new Int32Array(NC).fill(-2);
  next[target] = -1;
  const q = [target];
  for (let h = 0; h < q.length; h++) {
    const c = q[h], cx = c % GW, cy = (c / GW) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
      const n = y * GW + x;
      if (!cellProv[n] || next[n] !== -2) continue;
      if (dx && dy && !cellProv[cy * GW + x] && !cellProv[y * GW + cx]) continue;
      next[n] = c; q.push(n);
    }
  }
  return next;
}

// ---- il ele geçirme ----
function addScore(room, a, b, pts) { if (a > 0 && b > 0 && a !== b) room.score[a + '>' + b] = (room.score[a + '>' + b] || 0) + pts; }
function transferProv(room, p, newOwner, garrison) {
  setProvOwner(room, p, newOwner);
  room.garrison[p] = Math.min(GMAX[p], garrison);
}
function captureProv(room, p, newOwner) {
  const old = room.provOwner[p];
  if (old === newOwner) return;
  transferProv(room, p, newOwner, Math.max(3, GMAX[p] * 0.15));
  addScore(room, newOwner, old, 1);
  const c = provCountry[p];
  room.events.push({ type: 'conquer', by: newOwner, prov: p, from: old });
  // Başkent düştü: ülkenin (eski sahibinin elindeki) illerinin yarısı doğrudan geçer
  if (p === capOf(c)) {
    const rest = (countryProvs.get(c) || []).filter(x => x !== p && room.provOwner[x] === old);
    const [cx, cy] = provCenter[p];
    rest.sort((a, b) => Math.hypot(provCenter[a][0] - cx, provCenter[a][1] - cy) - Math.hypot(provCenter[b][0] - cx, provCenter[b][1] - cy));
    const take = Math.ceil(rest.length / 2);
    for (let i = 0; i < take; i++) transferProv(room, rest[i], newOwner, Math.max(3, GMAX[rest[i]] * 0.1));
    addScore(room, newOwner, old, 3 + take * 0.5);
    room.events.push({ type: 'capital', by: newOwner, prov: p, from: old, taken: take + 1 });
  }
}

function tick(room) {
  room.ticks++;
  const units = [...room.units.values()];
  // 1) birim-birim savaşı (barışta olmayan farklı sahipler)
  const dmg = new Map();
  for (const u of units) u.fight = false;
  for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
    const a = units[i], b = units[j];
    if (a.owner === b.owner || atPeace(room, a.owner, b.owner)) continue;
    if (Math.hypot(a.x - b.x, a.y - b.y) <= 3.4) {
      a.fight = b.fight = true;
      dmg.set(a, (dmg.get(a) || 0) + 0.025 * b.troops + 0.1);
      dmg.set(b, (dmg.get(b) || 0) + 0.025 * a.troops + 0.1);
    }
  }
  // 2) il garnizonu savaşı: düşman ilindeki birimler garnizonla çarpışır
  const sieging = new Map();
  for (const u of units) {
    const c = Math.floor(u.y) * GW + Math.floor(u.x);
    const p = cellProv[c] - 1;
    if (p < 0) continue;
    const po = room.provOwner[p];
    if (po === u.owner) continue;
    if (po > 0 && atPeace(room, po, u.owner)) continue;
    u.fight = true;
    if (!sieging.has(p)) sieging.set(p, []);
    sieging.get(p).push(u);
  }
  for (const [p, us] of sieging) {
    const G = room.garrison[p];
    let total = 0;
    for (const u of us) { dmg.set(u, (dmg.get(u) || 0) + 0.012 * G + 0.06); total += 0.012 * u.troops + 0.06; }
    room.garrison[p] = G - total;
  }
  for (const [u, d] of dmg) u.troops -= d;
  for (const [p, us] of sieging) {
    if (room.garrison[p] <= 0.5) {
      const alive = us.filter(u => u.troops >= 1).sort((a, b) => b.troops - a.troops);
      if (alive.length) captureProv(room, p, alive[0].owner);
      else room.garrison[p] = 1;
    }
  }
  // garnizon yenilenmesi
  for (let p = 0; p < NP; p++) if (!sieging.has(p) && room.garrison[p] < GMAX[p]) room.garrison[p] = Math.min(GMAX[p], room.garrison[p] + GMAX[p] * GARRISON_REGEN);

  // 3) hareket + ilerleyen cephe: birimin çevresi (kaybetmediği yerler) ele geçer
  for (const u of units) {
    if (u.troops < 1) { room.units.delete(u.id); continue; }
    if (!u.fight && u.path.length) {
      let step = SPEED;
      while (step > 0 && u.path.length) {
        const t = u.path[0], tx = (t % GW) + 0.5, ty = ((t / GW) | 0) + 0.5;
        const d = Math.hypot(tx - u.x, ty - u.y);
        if (d <= step) { u.x = tx; u.y = ty; u.path.shift(); step -= d; }
        else { u.x += (tx - u.x) / d * step; u.y += (ty - u.y) / d * step; step = 0; }
      }
    }
    const R = Math.min(8, 2 + Math.floor(Math.sqrt(u.troops) / 3));
    const ux = Math.floor(u.x), uy = Math.floor(u.y);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > R * R + 1) continue;
      const x = ux + dx, y = uy + dy;
      if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
      const c = y * GW + x;
      if (!cellProv[c] || room.owner[c] === u.owner) continue;
      const prev = room.owner[c];
      if (prev && atPeace(room, prev, u.owner)) continue;
      setCell(room, c, u.owner);
    }
  }
  // 4) aynı yerde duran dost birimleri birleştir
  for (const u of room.units.values()) if (u.nm > 0) u.nm--;
  const still = [...room.units.values()].filter(u => !u.path.length && !u.fight && u.nm <= 0);
  for (let i = 0; i < still.length; i++) {
    const a = still[i]; if (!room.units.has(a.id)) continue;
    for (let j = i + 1; j < still.length; j++) {
      const b = still[j];
      if (!room.units.has(b.id) || a.owner !== b.owner) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) < 1.6) { a.troops += b.troops; room.units.delete(b.id); }
    }
  }
  // 5) gelir
  for (const p of room.players) p.reserve += (room.own[p.id] || 0) * INCOME;
  // 6) süresi dolan barış teklifleri
  const now = Date.now();
  for (const [k, o] of room.offers) if (o.expires < now) room.offers.delete(k);

  checkWin(room);
  const msg = { type: 'tick', units: unitList(room), changes: room.changes, pc: room.provChanges, own: room.own };
  if (room.events.length) msg.events = room.events;
  if (room.ticks % 10 === 0) msg.gar = garList(room);
  const dipNow = room.ticks % 5 === 0 || room.events.length > 0;
  room.changes = []; room.provChanges = []; room.events = [];
  const base = JSON.stringify(msg).slice(0, -1);
  for (const p of room.players) if (p.ws && p.ws.readyState === 1) {
    p.ws.send(base + ',"reserve":' + Math.floor(p.reserve) + '}');
    if (dipNow) p.ws.send(JSON.stringify(dipInfo(room, p)));
  }
}

function checkWin(room) {
  if (room.status !== 'playing') return;
  const alive = room.players.filter(p => (room.own[p.id] || 0) > 0 || [...room.units.values()].some(u => u.owner === p.id));
  let winner = null;
  for (const p of room.players) if ((room.own[p.id] || 0) / LAND >= WIN_RATIO) winner = p.id;
  if (winner === null && alive.length === 1 && room.players.length > 1) winner = alive[0].id;
  if (winner !== null) {
    room.status = 'ended'; room.winner = winner;
    clearInterval(room.timer); room.timer = null;
    broadcast(room, { type: 'end', winner });
  }
}

// ---- barış / savaş ----
function demandFor(room, proposer, target) {
  const s = stars(room, proposer, target);
  if (s <= 0) return [];
  const limit = s * PROV_PER_STAR;
  const seen = new Set(), out = [], q = [];
  for (let p = 0; p < NP; p++) if (room.provOwner[p] === proposer) for (const n of provAdj[p]) if (room.provOwner[n] === target && !seen.has(n)) { seen.add(n); q.push(n); }
  for (let h = 0; h < q.length && out.length < limit; h++) {
    const p = q[h]; out.push(p);
    for (const n of provAdj[p]) if (room.provOwner[n] === target && !seen.has(n)) { seen.add(n); q.push(n); }
  }
  return out;
}
function proposePeace(room, from, toId) {
  const to = room.players.find(p => p.id === toId);
  if (!to || to.id === from.id || atPeace(room, from.id, to.id)) return;
  const reverse = room.offers.get(to.id + '>' + from.id);
  if (reverse && reverse.demand.length === 0) { room.offers.delete(to.id + '>' + from.id); makePeace(room, from.id, to.id, []); return; }
  const demand = demandFor(room, from.id, to.id);
  room.offers.set(from.id + '>' + to.id, { from: from.id, to: to.id, demand, expires: Date.now() + OFFER_TTL });
  send(to.ws, { type: 'offer', from: from.id, demand: demand.length, stars: stars(room, from.id, to.id), theirStars: stars(room, to.id, from.id) });
  send(from.ws, { type: 'info', msg: to.name + ' oyuncusuna barış teklif edildi' + (demand.length ? ` (${demand.length} il talep)` : '') });
}
function makePeace(room, a, b, demand) {
  for (const p of demand) if (room.provOwner[p] === b) transferProv(room, p, a, Math.max(3, GMAX[p] * 0.2));
  room.peace.add(pairKey(a, b));
  room.warSince.set(pairKey(a, b), Date.now());
  delete room.score[a + '>' + b]; delete room.score[b + '>' + a];
  const pa = room.players.find(p => p.id === a), pb = room.players.find(p => p.id === b);
  broadcast(room, { type: 'info', msg: `${pa.name} ve ${pb.name} barış yaptı` + (demand.length ? ` (${demand.length} il devredildi)` : '') });
  for (const p of room.players) send(p.ws, dipInfo(room, p));
}
function replyPeace(room, player, fromId, accept) {
  const o = room.offers.get(fromId + '>' + player.id); if (!o) return;
  room.offers.delete(fromId + '>' + player.id);
  const from = room.players.find(p => p.id === fromId);
  if (!accept) return send(from && from.ws, { type: 'info', msg: player.name + ' barış teklifini reddetti' });
  makePeace(room, fromId, player.id, demandFor(room, fromId, player.id).slice(0, o.demand.length));
}
function declareWar(room, player, toId) {
  const k = pairKey(player.id, toId);
  if (!room.peace.has(k)) return;
  if (Date.now() - (room.warSince.get(k) || 0) < WAR_COOLDOWN) return send(player.ws, { type: 'info', msg: 'Barıştan hemen sonra savaş ilan edemezsin (30 sn)' });
  room.peace.delete(k);
  const other = room.players.find(p => p.id === toId);
  broadcast(room, { type: 'info', msg: `${player.name}, ${other ? other.name : ''} oyuncusuna savaş ilan etti!` });
  for (const p of room.players) send(p.ws, dipInfo(room, p));
}

const ownUnits = (room, player, ids) => (Array.isArray(ids) ? ids : []).slice(0, 60).map(id => room.units.get(id)).filter(u => u && u.owner === player.id);

function removePlayer(room, player) {
  if (room.status === 'lobby') {
    room.players = room.players.filter(p => p !== player);
    if (room.hostId === player.id && room.players.length) room.hostId = room.players[0].id;
  } else player.ws = null;
  if (room.players.every(p => !p.ws)) { clearInterval(room.timer); rooms.delete(room.code); return; }
  broadcast(room, lobbyInfo(room));
}

const wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let room = null, player = null;

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const name = s => String(s || '').trim().slice(0, 16) || 'Oyuncu';

    if (m.type === 'create' || m.type === 'join') {
      if (room) return;
      let r;
      if (m.type === 'create') { r = makeRoom(); rooms.set(r.code, r); }
      else { r = rooms.get(String(m.code || '').toUpperCase().trim()); if (!r) return send(ws, { type: 'error', msg: 'Oda bulunamadı.' }); }
      const re = r.status !== 'lobby' && r.players.find(p => !p.ws && p.name === name(m.name));
      if (r.status !== 'lobby' && !re) return send(ws, { type: 'error', msg: 'Oyun başlamış.' });
      if (!re && r.players.length >= MAX_PLAYERS) return send(ws, { type: 'error', msg: 'Oda dolu.' });
      room = r;
      if (re) { player = re; player.ws = ws; }
      else {
        const used = new Set(room.players.map(p => p.color));
        player = { id: room.nextId++, name: name(m.name), color: COLORS.find(c => !used.has(c)), country: null, ws, reserve: 0 };
        room.players.push(player);
        if (room.hostId === null) room.hostId = player.id;
      }
      send(ws, { type: 'welcome', id: player.id, code: room.code });
      broadcast(room, lobbyInfo(room));
      if (room.status !== 'lobby') {
        send(ws, { type: 'start' });
        send(ws, fullState(room, player));
        send(ws, dipInfo(room, player));
        if (room.status === 'ended') send(ws, { type: 'end', winner: room.winner });
      }
      return;
    }
    if (!room || !player) return;

    if (m.type === 'pick' && room.status === 'lobby') {
      const c = m.country;
      if (c === null) player.country = null;
      else if (Number.isInteger(c) && countryProvs.has(c) && !room.players.some(p => p.country === c)) player.country = c;
      broadcast(room, lobbyInfo(room));
    } else if (m.type === 'start' && room.status === 'lobby' && room.hostId === player.id) {
      startGame(room);
    } else if (room.status === 'playing') {
      if (m.type === 'move') {
        const t = m.cell;
        if (!Number.isInteger(t) || t < 0 || t >= NC || !cellProv[t]) return;
        const us = ownUnits(room, player, m.units);
        if (!us.length) return;
        const next = bfsFrom(t);
        for (const u of us) {
          let c = Math.floor(u.y) * GW + Math.floor(u.x);
          if (next[c] === -2) continue;
          const p = [];
          while (next[c] >= 0) { c = next[c]; p.push(c); if (p.length > 4000) break; }
          u.path = p;
        }
      } else if (m.type === 'recruit') {
        const cell = m.cell, amt = Math.floor(Number(m.amount));
        if (!Number.isInteger(cell) || cell < 0 || cell >= NC || room.owner[cell] !== player.id) return;
        if (!(amt >= MIN_UNIT) || amt > player.reserve) return;
        if ([...room.units.values()].filter(u => u.owner === player.id).length >= MAX_UNITS) return;
        player.reserve -= amt;
        addUnit(room, player.id, (cell % GW) + 0.5, ((cell / GW) | 0) + 0.5, amt);
      } else if (m.type === 'split') {
        for (const u of ownUnits(room, player, m.units)) {
          if (u.troops < MIN_UNIT * 2) continue;
          if ([...room.units.values()].filter(x => x.owner === player.id).length >= MAX_UNITS) break;
          const half = Math.floor(u.troops / 2);
          u.troops -= half;
          const n = addUnit(room, player.id, u.x, u.y, half);
          n.nm = 25; u.nm = 25;
        }
      } else if (m.type === 'stop') {
        for (const u of ownUnits(room, player, m.units)) u.path = [];
      } else if (m.type === 'peace') proposePeace(room, player, m.to);
      else if (m.type === 'peaceReply') replyPeace(room, player, m.from, !!m.accept);
      else if (m.type === 'war') declareWar(room, player, m.to);
    }
  });
  ws.on('close', () => { if (room && player) removePlayer(room, player); });
});

setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
}, 30000);

server.listen(PORT, () => console.log('Sunucu çalışıyor: http://localhost:' + PORT));
