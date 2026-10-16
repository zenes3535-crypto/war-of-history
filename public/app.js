// War of History - istemci
'use strict';
const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('tr-TR');
const fmtK = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' M' : n >= 1e4 ? Math.round(n / 1e3) + ' B' : fmt(n);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
try { const q = new URLSearchParams(location.search).get('room'); if (q) $('code').value = q.toUpperCase(); } catch {}

// ---------------- tuval ----------------
const cv = $('cv'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
function resize() { DPR = Math.min(2, window.devicePixelRatio || 1); W = innerWidth; H = innerHeight; cv.width = W * DPR; cv.height = H * DPR; landDirty = true; }
addEventListener('resize', resize);

// ---------------- dünya ----------------
let world, GW, GH, CELL, NP, cellProv, biome, provCount, provCountry, anchorX, anchorY, allPath, provTiles = [], cityList = [];
const flagImgs = new Map();
function flag(iso) {
  if (!iso) return null;
  if (!flagImgs.has(iso)) { const im = new Image(); im.src = `https://flagcdn.com/w40/${iso}.png`; im.onload = () => { landDirty = true; }; flagImgs.set(iso, im); }
  const im = flagImgs.get(iso); return im.complete && im.naturalWidth ? im : null;
}
const flagTag = (iso, big) => iso ? `<img class="flag${big ? ' big' : ''}" src="https://flagcdn.com/w40/${iso}.png" alt="">` : `<span class="flag${big ? ' big' : ''}"></span>`;
const rle = (r, out) => { let k = 0; for (let i = 0; i < r.length; i += 2) for (let j = 0; j < r[i + 1]; j++) out[k++] = r[i]; return out; };

async function loadWorld() {
  world = await (await fetch('world.json')).json();
  GW = world.grid.gw; GH = world.grid.gh; CELL = world.grid.cell; NP = world.provs.length;
  cellProv = rle(world.grid.rle, new Int32Array(GW * GH));
  biome = rle(world.grid.biome, new Uint8Array(GW * GH));
  provCount = new Int32Array(NP); provCountry = new Int32Array(NP); anchorX = new Float32Array(NP); anchorY = new Float32Array(NP);
  world.provs.forEach(([, c, a, , n], i) => { provCountry[i] = c; provCount[i] = n; anchorX[i] = (a % GW) + 0.5; anchorY[i] = ((a / GW) | 0) + 0.5; });
  allPath = new Path2D(); for (const c of world.countries) allPath.addPath(new Path2D(c.d));
  const T = world.prov.tile;
  provTiles = Object.entries(world.prov.tiles).map(([k, d]) => { const [tx, ty] = k.split(',').map(Number); return { x0: tx * T, y0: ty * T, x1: tx * T + T, y1: ty * T + T, path: new Path2D(d) }; });
  cityList = world.cities;
  buildTerrain();
  fitCam();
  $('loading').textContent = '';
}

// arazi dokusu: biyom renkleri + gürültü
let terrainCv;
function buildTerrain() {
  const S = 4, w = GW * S, h = GH * S;
  const small = document.createElement('canvas'); small.width = GW; small.height = GH;
  const sctx = small.getContext('2d'); const img = sctx.createImageData(GW, GH); const d = img.data;
  const COL = [[0, 0, 0], [226, 233, 238], [138, 146, 118], [70, 98, 62], [100, 128, 72], [196, 170, 120], [52, 104, 50], [150, 148, 96]];
  for (let i = 0; i < GW * GH; i++) { const c = COL[biome[i]] || COL[4]; d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = cellProv[i] ? 255 : 0; }
  sctx.putImageData(img, 0, 0);
  terrainCv = document.createElement('canvas'); terrainCv.width = w; terrainCv.height = h;
  const t = terrainCv.getContext('2d');
  t.imageSmoothingEnabled = true; t.drawImage(small, 0, 0, w, h);
  // kabartma gürültüsü
  const nd = t.getImageData(0, 0, w, h), D = nd.data;
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const grid = new Float32Array((w / 8 + 2) * (h / 8 + 2)); for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const gw = w / 8 + 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; if (!D[i + 3]) continue;
    const gx = x / 8, gy = y / 8, x0 = gx | 0, y0 = gy | 0, fx = gx - x0, fy = gy - y0;
    const v = (grid[y0 * gw + x0] * (1 - fx) + grid[y0 * gw + x0 + 1] * fx) * (1 - fy) + (grid[(y0 + 1) * gw + x0] * (1 - fx) + grid[(y0 + 1) * gw + x0 + 1] * fx) * fy;
    const n = (v - 0.5) * 34 + (rnd() - 0.5) * 14;
    D[i] = clamp(D[i] + n, 0, 255); D[i + 1] = clamp(D[i + 1] + n, 0, 255); D[i + 2] = clamp(D[i + 2] + n * 0.8, 0, 255);
  }
  t.putImageData(nd, 0, 0);
}

// ---------------- durum ----------------
let ws, myPid = 0, roomCode = '', lobby = null, previewData = null, playing = false;
let st = null, me = null, prov = null, priv = null, sum = [], wars = [], speed = 3, dateStr = '';
let armies = new Map(), selected = new Set(), selProv = -1, openPanel = null, civPanelId = -1, mapMode = 'pol';
const chats = new Map(); let chatWith = -1;
const eventsLog = [];
let pendingOffers = [];
let peace = null; // barış masası durumu {to, take:Set, give:Set}

// ---------------- kamera ----------------
let cam = { x: 0, y: 0, s: 1 };
function fitCam() { cam.s = Math.min(W / world.w, H / world.h) * 1.0; cam.x = (W - world.w * cam.s) / 2; cam.y = (H - world.h * cam.s) / 2; }
const toWorld = (sx, sy) => [(sx - cam.x) / cam.s, (sy - cam.y) / cam.s];
function cellAt(sx, sy) { const [wx, wy] = toWorld(sx, sy); const gx = Math.floor(wx / CELL), gy = Math.floor(wy / CELL); return gx < 0 || gy < 0 || gx >= GW || gy >= GH ? -1 : gy * GW + gx; }
function provAt(sx, sy) { const c = cellAt(sx, sy); return c >= 0 ? cellProv[c] - 1 : -1; }
function centerOn(p, zoom) { if (zoom) cam.s = zoom; cam.x = W / 2 - anchorX[p] * CELL * cam.s; cam.y = H / 2 - anchorY[p] * CELL * cam.s; }

// ---------------- ağ ----------------
function connect(first) {
  const name = $('name').value.trim() || 'Lider';
  try { localStorage.setItem('woh_name', name); } catch {}
  $('err').textContent = '';
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => ws.send(JSON.stringify({ ...first, name }));
  ws.onmessage = e => handle(JSON.parse(e.data));
  ws.onclose = () => { if (playing) toast('Bağlantı koptu. Sayfayı yenileyip aynı isimle tekrar katılabilirsin.', true); };
}
const send = o => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

function civ(id) { return (st ? st.civs : previewData ? previewData.civs : [])[id]; }
function civColor(id) { const c = civ(id); return c ? c.color : '#777'; }

function handle(m) {
  switch (m.type) {
    case 'error': if (!playing) $('err').textContent = m.msg; else toast(m.msg, true); break;
    case 'info': toast(m.msg); break;
    case 'welcome': myPid = m.id; roomCode = m.code; $('menu').classList.add('hidden'); history.replaceState(null, '', '?room=' + m.code); break;
    case 'lobby': lobby = m; if (!playing) renderLobby(); break;
    case 'preview': previewData = m; owner = Int16Array.from(m.owner); ctrl = Int16Array.from(m.owner); polDirty = true; labelsDirty = true; renderLobby(); break;
    case 'init': onInit(m); break;
    case 'tick': onTick(m); break;
    case 'day': if (m.priv) priv = m.priv; if (m.sum) sum = m.sum; if (m.wars) wars = m.wars; if (m.pop) { prov.pop = m.pop; } updateTop(); refreshPanels(); break;
    case 'events': for (const e of m.list) { eventsLog.unshift(e); if (eventsLog.length > 300) eventsLog.pop(); const imp = /⚔|🕊|🏛|☠|🤝|💔/.test(e.text) || (e.civs && e.civs.includes(me)); if (imp) toast(e.text); } if (openPanel === 'log') renderSide(); break;
    case 'speed': speed = m.s; renderSpeed(); break;
    case 'offer': pendingOffers.push(m.offer); showOffer(); break;
    case 'chat': {
      const other = m.from === me ? m.to : m.from;
      if (!chats.has(other)) chats.set(other, []);
      chats.get(other).push(m);
      if (m.from !== me && !(openPanel === 'chat' && chatWith === other)) toast(`💬 ${civ(m.from).name}: ${m.text}`);
      if (openPanel === 'chat') renderSide();
      break;
    }
    case 'defeated': $('defeat').classList.remove('hidden'); $('defeat').innerHTML = '☠ Ülken haritadan silindi.<div style="font:14px system-ui;margin-top:12px"><button onclick="location.href=location.pathname">Ana menü</button></div>'; break;
  }
}

let owner = null, ctrl = null;
function onInit(m) {
  playing = true; st = m.st; me = m.me; speed = m.speed; dateStr = m.date; priv = m.priv; sum = m.sum || []; wars = m.wars || [];
  prov = m.prov; owner = Int16Array.from(prov.owner); ctrl = Int16Array.from(prov.ctrl);
  armies = new Map(); setArmies(m.armies);
  pendingOffers = m.offers || [];
  ['lobby', 'menu'].forEach(i => $(i).classList.add('hidden'));
  ['top', 'tools'].forEach(i => $(i).classList.remove('hidden'));
  const c = civ(me);
  $('me').innerHTML = `${flagTag(c.iso)} <span>${esc(c.name)}</span>`;
  $('me').onclick = () => togglePanel('overview');
  renderSpeed(); updateTop();
  if (c.cap >= 0) centerOn(c.cap, 5.5);
  polDirty = true; labelsDirty = true; landDirty = true;
  if (pendingOffers.length) showOffer();
  toast(`${c.name} lideri olarak göreve başladın. Bol şans!`);
}
function onTick(m) {
  setArmies(m.a);
  for (let i = 0; i < m.c.length; i += 3) { owner[m.c[i]] = m.c[i + 1]; ctrl[m.c[i]] = m.c[i + 2]; polDirty = true; labelsDirty = true; }
  if (m.dp) for (const [p, dev, fort, fac, bar, uni, pop] of m.dp) { prov.dev[p] = dev; prov.fort[p] = fort; prov.factory[p] = fac; prov.barracks[p] = bar; prov.univ[p] = uni; prov.pop[p] = pop; }
  if (m.date !== dateStr) { dateStr = m.date; $('date').textContent = dateStr; }
  if (m.dp && selProv >= 0) renderProv();
  if (m.c.length && (peace || openPanel)) refreshPanels();
}
function setArmies(list) {
  const seen = new Set();
  for (const [id, c, x, y, troops, dest, state, p] of list) {
    seen.add(id);
    let a = armies.get(id);
    if (!a) { a = { id, rx: x, ry: y }; armies.set(id, a); }
    Object.assign(a, { civ: c, x, y, troops, dest, state, prov: p });
  }
  for (const id of [...armies.keys()]) if (!seen.has(id)) { armies.delete(id); selected.delete(id); }
  updateSel();
}

// ---------------- lobi ----------------
function renderLobby() {
  if (!lobby) return;
  $('lobby').classList.remove('hidden');
  $('roomBox').classList.toggle('hidden', !!lobby.solo);
  $('roomCode').textContent = lobby.code;
  const host = lobby.hostId === myPid;
  const sc = $('scenario'); sc.innerHTML = lobby.scenarios.map(s => `<option value="${s.id}" ${s.id === lobby.scenario ? 'selected' : ''}>${esc(s.name)}</option>`).join(''); sc.disabled = !host;
  const sp = $('speedSel'); sp.innerHTML = lobby.speeds.map((s, i) => i ? `<option value="${i}" ${i === lobby.speed ? 'selected' : ''}>${esc(s)}</option>` : '').join(''); sp.disabled = !host;
  $('plist').innerHTML = lobby.players.map(p => { const c = p.civ != null && previewData ? previewData.civs[p.civ] : null; return `<div class="pl">${c ? flagTag(c.iso) : '<span class="flag"></span>'}<b>${esc(p.name)}</b>${p.id === lobby.hostId ? ' 👑' : ''}${p.id === myPid ? ' <span class="mut">(sen)</span>' : ''}<small>${c ? esc(c.name) : 'ülke seçmedi'}</small></div>`; }).join('');
  const mine = lobby.players.find(p => p.id === myPid);
  const c = mine && mine.civ != null && previewData ? previewData.civs[mine.civ] : null;
  if (c && previewData) {
    const n = previewData.owner.filter(o => o === c.id).length;
    $('pickInfo').innerHTML = `<div class="row">${flagTag(c.iso, true)}<div><b style="font:800 16px Georgia,serif">${esc(c.name)}</b><div class="mut">${n} il</div></div></div>`;
  } else $('pickInfo').textContent = 'Haritada bir ülkeye tıklayarak ülkeni seç.';
  $('start').classList.toggle('hidden', !host); $('wait').classList.toggle('hidden', host);
  $('start').disabled = lobby.players.some(p => p.civ == null);
}
$('scenario').onchange = e => send({ type: 'scenario', scenario: e.target.value });
$('speedSel').onchange = e => send({ type: 'speed', s: +e.target.value });
$('start').onclick = () => send({ type: 'start' });
$('copy').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(location.origin + location.pathname + '?room=' + roomCode); toast('Davet linki kopyalandı'); };
$('solo').onclick = () => connect({ type: 'create', solo: true });
$('create').onclick = () => connect({ type: 'create' });
$('join').onclick = () => connect({ type: 'join', code: $('code').value });
try { $('name').value = localStorage.getItem('woh_name') || ''; } catch {}

// ---------------- üst bar ----------------
function renderSpeed() {
  const host = lobby && lobby.hostId === myPid;
  const icons = ['⏸', '▶', '▶▶', '▶▶▶', '⏩', '⏩⏩'];
  $('spdBtns').innerHTML = icons.map((ic, i) => `<button class="spd ${i === speed ? 'on' : ''}" ${host ? '' : 'disabled'} title="${st ? esc(st.speeds[i]) : ''}" onclick="send({type:'speed',s:${i}})">${ic}</button>`).join(' ');
  $('date').textContent = dateStr;
}
function updateTop() {
  if (!priv) return;
  $('sGold').textContent = fmt(priv.gold);
  const net = priv.income - priv.upkeep;
  $('sNet').textContent = (net >= 0 ? '+' : '') + net.toFixed(1) + '/gün';
  $('sNet').style.color = net >= 0 ? '#8bc34a' : '#ff8a80';
  $('sTroops').textContent = fmt(priv.troops);
  $('sMan').textContent = fmtK(priv.manpower);
  $('sPop').textContent = fmtK(priv.pop);
  const r = priv.research;
  $('sRes').textContent = r ? `${st.techs.find(t => t.id === r.id).name} %${Math.floor(100 * r.progress / st.techs.find(t => t.id === r.id).cost)}` : 'Boşta';
  $('sAir').textContent = priv.air;
  if (selProv >= 0) renderProv();
}

// ---------------- harita çizimi ----------------
let polCv, polDirty = true, landDirty = true, labelsDirty = true, lastPol = 0, labels = [];
const PS = 3; // siyasi katman ölçeği (hücre başına piksel)
const hexRgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function relColor(c) {
  if (c === me) return '#e8b84a';
  if (!priv) return '#777';
  if (priv.enemies.some(e => e[0] === c)) return '#c0392b';
  if (priv.allies.includes(c)) return '#2e86c1';
  if (priv.pacts.some(p => p[0] === c)) return '#28b463';
  const r = priv.relTo[c] ?? 0;
  return r > 30 ? '#7fb3a0' : r < -30 ? '#b5655e' : '#8a8f94';
}
function buildPolitical() {
  if (!owner) return;
  const w = GW * PS, h = GH * PS;
  if (!polCv) { polCv = document.createElement('canvas'); polCv.width = w; polCv.height = h; }
  const pc = polCv.getContext('2d'); const img = pc.createImageData(w, h); const buf = new Uint32Array(img.data.buffer);
  const n = (st || previewData) ? (st || previewData).civs.length : 0;
  const cols = new Uint32Array(n), dark = new Uint32Array(n), light = new Uint32Array(n);
  const pack = (r, g, b, a) => (a << 24) | (b << 16) | (g << 8) | r;
  for (let i = 0; i < n; i++) {
    const [r, g, b] = hexRgb(mapMode === 'dip' ? relColor(i) : civColor(i));
    cols[i] = pack(r, g, b, 172); dark[i] = pack(r * 0.6 | 0, g * 0.6 | 0, b * 0.6 | 0, 200); light[i] = pack(Math.min(255, r + 120), Math.min(255, g + 120), Math.min(255, b + 120), 235);
  }
  const selOwner = selProv >= 0 ? owner[selProv] : -1;
  for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) {
    const ci = cy * GW + cx, pv = cellProv[ci] - 1;
    if (pv < 0) continue;
    const o = owner[pv], c = ctrl[pv];
    const oL = cx > 0 ? cellProv[ci - 1] - 1 : -1, oR = cx < GW - 1 ? cellProv[ci + 1] - 1 : -1, oU = cy > 0 ? cellProv[ci - GW] - 1 : -1, oD = cy < GH - 1 ? cellProv[ci + GW] - 1 : -1;
    const civEdge = q => q >= 0 && owner[q] !== o;
    const provEdge = q => q >= 0 && q !== pv && owner[q] === o;
    for (let sy = 0; sy < PS; sy++) for (let sx = 0; sx < PS; sx++) {
      const X = cx * PS + sx, Y = cy * PS + sy;
      let col = cols[o];
      if (c !== o && ((X + Y) % 6) < 3) col = cols[c] | 0xff000000; // işgal: çizgili
      if ((sx === 0 && civEdge(oL)) || (sx === PS - 1 && civEdge(oR)) || (sy === 0 && civEdge(oU)) || (sy === PS - 1 && civEdge(oD))) col = light[o];
      else if ((sx === 0 && provEdge(oL)) || (sy === 0 && provEdge(oU))) col = dark[o];
      if (peace && (peace.take.has(pv) || peace.give.has(pv)) && ((X + Y) % 4) < 2) col = peace.take.has(pv) ? 0xff40d0ff : 0xffffa040;
      if (pv === selProv && ((X + Y) & 1)) col = 0xe0ffffff;
      buf[Y * w + X] = col;
    }
  }
  pc.putImageData(img, 0, 0);
  polDirty = false; landDirty = true; lastPol = performance.now();
}
// ülke isimleri: her ülkenin hücrelerinden ağırlık merkezi ve ana eksen
function buildLabels() {
  if (!owner) return;
  const n = (st || previewData).civs.length;
  // her ülkenin illerini kara komşuluğuyla parçalara ayır, en büyük parçayı etiketle
  const comp = new Int32Array(NP).fill(-1), compCells = [], compOwner = [];
  for (let p = 0; p < NP; p++) {
    if (comp[p] >= 0) continue;
    const id = compCells.length, o = owner[p]; let cells = 0; const q = [p]; comp[p] = id;
    for (let h = 0; h < q.length; h++) { const x = q[h]; cells += provCount[x]; for (const y of world.adj[x]) if (comp[y] < 0 && owner[y] === o) { comp[y] = id; q.push(y); } }
    compCells.push(cells); compOwner.push(o);
  }
  const best = new Int32Array(n).fill(-1);
  for (let k = 0; k < compCells.length; k++) { const o = compOwner[k]; if (best[o] < 0 || compCells[k] > compCells[best[o]]) best[o] = k; }
  const sx = new Float64Array(n), sy = new Float64Array(n), sxx = new Float64Array(n), syy = new Float64Array(n), sxy = new Float64Array(n), cnt = new Float64Array(n);
  for (let i = 0; i < GW * GH; i++) {
    const p = cellProv[i] - 1; if (p < 0) continue;
    const o = owner[p]; if (comp[p] !== best[o]) continue;
    const x = i % GW, y = (i / GW) | 0;
    cnt[o]++; sx[o] += x; sy[o] += y; sxx[o] += x * x; syy[o] += y * y; sxy[o] += x * y;
  }
  labels = [];
  for (let o = 0; o < n; o++) {
    if (cnt[o] < 3) continue;
    const mx = sx[o] / cnt[o], my = sy[o] / cnt[o];
    const vx = sxx[o] / cnt[o] - mx * mx, vy = syy[o] / cnt[o] - my * my, cxy = sxy[o] / cnt[o] - mx * my;
    const tr = vx + vy, det = vx * vy - cxy * cxy, l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det)), l2 = Math.max(0.3, tr - l1);
    let ang = 0.5 * Math.atan2(2 * cxy, vx - vy);
    if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
    ang = clamp(ang, -0.6, 0.6);
    const len = Math.sqrt(l1) * 3.2 * CELL, thick = Math.sqrt(l2) * 2 * CELL;
    labels.push({ o, x: (mx + 0.5) * CELL, y: (my + 0.5) * CELL, ang, len, thick, name: civ(o).name.toLocaleUpperCase('tr-TR') });
  }
  labelsDirty = false; landDirty = true;
}

let landCv, lastCam = {};
function drawLand() {
  if (!landCv) landCv = document.createElement('canvas');
  if (landCv.width !== W * DPR || landCv.height !== H * DPR) { landCv.width = W * DPR; landCv.height = H * DPR; }
  const c = landCv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, landCv.width, landCv.height);
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  c.save(); c.translate(cam.x, cam.y); c.scale(cam.s, cam.s);
  // kıyı parıltısı
  c.lineJoin = 'round';
  c.strokeStyle = 'rgba(150,215,235,.16)'; c.lineWidth = 14 / cam.s; c.stroke(allPath);
  c.strokeStyle = 'rgba(190,235,250,.28)'; c.lineWidth = 3 / cam.s; c.stroke(allPath);
  // arazi
  c.save(); c.clip(allPath);
  c.imageSmoothingEnabled = true; c.drawImage(terrainCv, 0, 0, world.w, world.h);
  c.restore();
  // siyasi katman (AoH tarzı pikselli)
  if (polCv) { c.imageSmoothingEnabled = false; c.drawImage(polCv, 0, 0, world.w, world.h); }
  // detaylı il sınırları (yakınlaşınca)
  if (cam.s > 3.2) {
    const vx0 = -cam.x / cam.s, vy0 = -cam.y / cam.s, vx1 = (W - cam.x) / cam.s, vy1 = (H - cam.y) / cam.s;
    c.strokeStyle = 'rgba(30,25,15,.35)'; c.lineWidth = 0.6 / cam.s;
    for (const t of provTiles) if (t.x1 >= vx0 && t.x0 <= vx1 && t.y1 >= vy0 && t.y0 <= vy1) c.stroke(t.path);
  }
  c.strokeStyle = 'rgba(10,20,30,.55)'; c.lineWidth = 0.8 / cam.s; c.stroke(allPath);
  // şehirler ve başkentler
  const capOf = new Set(); const civs = (st || previewData) ? (st || previewData).civs : [];
  for (const cv2 of civs) if (cv2.cap >= 0 && owner && owner[cv2.cap] === cv2.id) capOf.add(cv2.cap);
  c.textAlign = 'left'; c.textBaseline = 'middle';
  const cityShow = cam.s > 2.2;
  for (const [name, x, y, pop, p, isCap] of cityList) {
    if (x * cam.s + cam.x < -20 || x * cam.s + cam.x > W + 20 || y * cam.s + cam.y < -20 || y * cam.s + cam.y > H + 20) continue;
    const capital = isCap && capOf.has(p);
    if (!capital && !cityShow) continue;
    if (!capital && pop < (cam.s > 5 ? 0 : cam.s > 3.5 ? 1.5e6 : 3e6)) continue;
    if (capital && cam.s < 1.4) continue;
    const r = (capital ? 3.2 : 1.6) / cam.s;
    c.beginPath(); c.arc(x, y, r, 0, 7); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 0.8 / cam.s; c.strokeStyle = '#000'; c.stroke();
    if (cam.s > 2.6 || (capital && cam.s > 1.4)) {
      c.font = `${capital ? 700 : 500} ${(capital ? 11 : 10) / cam.s}px system-ui`;
      c.lineWidth = 2.5 / cam.s; c.strokeStyle = 'rgba(0,0,0,.8)'; c.strokeText(name, x + 4 / cam.s, y); c.fillStyle = '#fff'; c.fillText(name, x + 4 / cam.s, y);
    }
  }
  // başkent yıldızları
  for (const cv2 of civs) {
    if (cv2.cap < 0 || !capOf.has(cv2.cap)) continue;
    const city = cityList.find(ct => ct[4] === cv2.cap && ct[5]);
    const x = city ? city[1] : anchorX[cv2.cap] * CELL, y = city ? city[2] : anchorY[cv2.cap] * CELL;
    star(c, x, y, (cam.s < 1.4 ? 3.5 : 6.5) / cam.s, cv2.color);
  }
  // ülke isimleri
  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const L of labels) {
    let size = Math.min(L.len * 0.95 / (Math.max(4, L.name.length) * 0.66), L.thick * 0.95, 90);
    const scr = size * cam.s;
    if (scr < 7) continue;
    if (scr > 70) size = 70 / cam.s;
    c.save(); c.translate(L.x, L.y); c.rotate(L.ang);
    c.font = `900 ${size}px Georgia,'Times New Roman',serif`;
    const spaced = L.name.split('').join('\u200a');
    c.lineWidth = Math.max(2, size * 0.22); c.strokeStyle = 'rgba(0,0,0,.85)'; c.lineJoin = 'round';
    c.strokeText(spaced, 0, 0); c.fillStyle = 'rgba(255,255,255,.95)'; c.fillText(spaced, 0, 0);
    c.restore();
  }
  c.restore();
  landDirty = false;
}
function star(c, x, y, r, col) {
  c.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  c.closePath(); c.fillStyle = '#ffd34d'; c.fill(); c.lineWidth = r * 0.25; c.strokeStyle = '#3a2a00'; c.stroke();
}

function drawSea(now) {
  const t = now / 1000;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#16455f'); g.addColorStop(.5, '#1a4d68'); g.addColorStop(1, '#123a52');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const sp = 24, par = 0.5, oy = ((cam.y * par) % sp + sp) % sp, ox = cam.x * par;
  ctx.lineWidth = 1.3; ctx.lineCap = 'round';
  for (let y = oy - sp; y < H + sp; y += sp) {
    const k = Math.floor((y - oy) / sp), ph = t * (0.8 + (k & 3) * 0.15) + k * 1.7 - ox * 0.012, amp = 3 + (k & 1) * 1.5;
    ctx.beginPath();
    for (let x = -10; x <= W + 10; x += 14) { const yy = y + Math.sin(x * 0.026 + ph) * amp + Math.sin(x * 0.011 - ph * 0.6 + k) * 2; x === -10 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy); }
    ctx.strokeStyle = `rgba(190,230,250,${0.06 + ((k & 3) === 0 ? 0.05 : 0)})`; ctx.stroke();
  }
}

// ordular: bayrak + asker sayısı (AoH tarzı)
const armyBoxes = [];
function drawArmies(now) {
  armyBoxes.length = 0;
  const groups = new Map();
  for (const a of armies.values()) {
    const moving = a.dest >= 0 && !a.state;
    const k = moving ? 'm' + a.id : a.civ + ':' + a.prov;
    let g = groups.get(k);
    if (!g) { g = { ids: [], civ: a.civ, troops: 0, x: 0, y: 0, n: 0, state: 0, dest: -1 }; groups.set(k, g); }
    g.ids.push(a.id); g.troops += a.troops; g.x += a.rx; g.y += a.ry; g.n++; g.state = Math.max(g.state, a.state); if (a.dest >= 0) g.dest = a.dest;
  }
  ctx.font = '700 12px system-ui'; ctx.textBaseline = 'middle';
  const zoomedIn = cam.s > 2.6;
  for (const g of groups.values()) {
    const sx = cam.x + g.x / g.n * CELL * cam.s, sy = cam.y + g.y / g.n * CELL * cam.s;
    if (sx < -60 || sy < -30 || sx > W + 60 || sy > H + 30) continue;
    const mine = g.civ === me;
    const enemy = priv && priv.enemies.some(e => e[0] === g.civ);
    const ally = priv && priv.allies.includes(g.civ);
    if (!zoomedIn && !mine && !enemy && !(ally && cam.s > 1.6)) continue;
    const c = civ(g.civ), sel = g.ids.some(id => selected.has(id));
    const txt = fmt(g.troops), tw = ctx.measureText(txt).width;
    const fw = 18, fh = 12, padd = 4, w = fw + tw + padd * 3, h = 18;
    const x = sx - w / 2, y = sy - h - 5;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; roundRect(x + 1.5, y + 2, w, h, 4); ctx.fill();
    ctx.fillStyle = enemy ? '#3a1414' : mine ? '#1d2630' : '#11161c'; roundRect(x, y, w, h, 4); ctx.fill();
    ctx.lineWidth = sel ? 2.5 : 1.5; ctx.strokeStyle = sel ? '#ffe14d' : c.color; ctx.stroke();
    const im = flag(c.iso);
    if (im) ctx.drawImage(im, x + padd, y + (h - fh) / 2, fw, fh); else { ctx.fillStyle = c.color; ctx.fillRect(x + padd, y + (h - fh) / 2, fw, fh); }
    ctx.fillStyle = enemy ? '#ffb4ad' : ally ? '#bfe0ff' : '#fff';
    ctx.fillText(txt, x + padd * 2 + fw, y + h / 2 + 0.5);
    if (g.state === 1) { ctx.font = '14px system-ui'; ctx.fillText('⚔', x + w + 2, y + h / 2 + Math.sin(now / 120) * 1.5); ctx.font = '700 12px system-ui'; }
    else if (g.state === 2) { ctx.font = '13px system-ui'; ctx.fillText('🏴', x + w + 2, y + h / 2); ctx.font = '700 12px system-ui'; }
    ctx.beginPath(); ctx.moveTo(sx, y + h); ctx.lineTo(sx, sy); ctx.strokeStyle = c.color; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(sx, sy, 2.5, 0, 7); ctx.fillStyle = c.color; ctx.fill();
    armyBoxes.push({ ids: g.ids, id: g.ids[0], x, y, w, h, mine });
    if (mine && g.dest >= 0 && sel) {
      ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(cam.x + anchorX[g.dest] * CELL * cam.s, cam.y + anchorY[g.dest] * CELL * cam.s); ctx.stroke(); ctx.setLineDash([]);
    }
  }
}
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  for (const a of armies.values()) { const k = Math.min(1, dt * 6); a.rx += (a.x - a.rx) * k; a.ry += (a.y - a.ry) * k; }
  if (world) {
    if (polDirty && now - lastPol > 300) buildPolitical();
    if (labelsDirty) buildLabels();
    if (cam.x !== lastCam.x || cam.y !== lastCam.y || cam.s !== lastCam.s || W !== lastCam.W) { landDirty = true; lastCam = { x: cam.x, y: cam.y, s: cam.s, W }; }
    if (landDirty) drawLand();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawSea(now);
    ctx.drawImage(landCv, 0, 0, W, H);
    if (playing) drawArmies(now);
  }
  requestAnimationFrame(frame);
}

// ---------------- girdi ----------------
let drag = null;
function armyAt(x, y) { for (let i = armyBoxes.length - 1; i >= 0; i--) { const b = armyBoxes[i]; if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b; } return null; }
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false, btn: e.button }; });
addEventListener('mousemove', e => {
  if (drag && drag.btn !== 2) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (drag.moved) { cam.x = drag.cx + dx; cam.y = drag.cy + dy; }
  }
  if (e.target === cv && world && !drag) showTip(e.clientX, e.clientY); else $('tip').classList.add('hidden');
});
addEventListener('mouseup', e => {
  if (!drag) return; const d = drag; drag = null;
  if (e.target !== cv || d.moved) return;
  if (d.btn === 2) { if (playing && selected.size) moveSelected(provAt(e.clientX, e.clientY)); return; }
  clickMap(e.clientX, e.clientY, e.shiftKey);
});
cv.addEventListener('dblclick', e => { const b = armyAt(e.clientX, e.clientY); if (b && b.mine) { const a = armies.get(b.id); for (const x of armies.values()) if (x.civ === me && x.prov === a.prov) selected.add(x.id); updateSel(); } });
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const f = Math.exp(-e.deltaY * 0.0015), ns = clamp(cam.s * f, Math.min(W / world.w, H / world.h) * 0.8, 16);
  const wx = (e.clientX - cam.x) / cam.s, wy = (e.clientY - cam.y) / cam.s;
  cam.s = ns; cam.x = e.clientX - wx * ns; cam.y = e.clientY - wy * ns;
}, { passive: false });
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (!playing) return;
  const k = e.key.toLowerCase();
  if (k === 'a') { selected = new Set([...armies.values()].filter(a => a.civ === me).map(a => a.id)); updateSel(); }
  else if (k === 'escape') { selected.clear(); updateSel(); closeAll(); }
  else if (k === ' ') { e.preventDefault(); send({ type: 'speed', s: speed ? 0 : (lastSpeed || 3) }); }
  else if (/^[1-5]$/.test(k)) send({ type: 'speed', s: +k });
});
let lastSpeed = 3;
// dokunmatik
let tch = null;
cv.addEventListener('touchstart', e => {
  if (e.touches.length === 1) tch = { x: e.touches[0].clientX, y: e.touches[0].clientY, cx: cam.x, cy: cam.y, t: Date.now(), moved: false };
  else if (e.touches.length === 2) tch = { pinch: true, d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), s: cam.s };
}, { passive: true });
cv.addEventListener('touchmove', e => {
  if (!tch) return; e.preventDefault();
  if (tch.pinch && e.touches.length === 2) {
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2, my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const wx = (mx - cam.x) / cam.s, wy = (my - cam.y) / cam.s;
    cam.s = clamp(tch.s * d / tch.d, 0.3, 16); cam.x = mx - wx * cam.s; cam.y = my - wy * cam.s;
  } else if (!tch.pinch) {
    const dx = e.touches[0].clientX - tch.x, dy = e.touches[0].clientY - tch.y;
    if (Math.hypot(dx, dy) > 8) tch.moved = true;
    if (tch.moved) { cam.x = tch.cx + dx; cam.y = tch.cy + dy; }
  }
}, { passive: false });
cv.addEventListener('touchend', () => {
  if (!tch || tch.pinch || tch.moved) { tch = null; return; }
  const { x, y } = tch; tch = null;
  const b = playing ? armyAt(x, y) : null;
  if (playing && !b && selected.size && !peace) { const p = provAt(x, y); if (p >= 0 && p !== selProv) { moveSelected(p); return; } }
  clickMap(x, y, true);
});

function clickMap(x, y, add) {
  const p = provAt(x, y);
  if (!playing) { // lobi: ülke seç
    if (p >= 0 && previewData) send({ type: 'pick', civ: owner[p] });
    return;
  }
  const b = armyAt(x, y);
  if (b && b.mine) {
    const all = b.ids.every(id => selected.has(id));
    if (!add) selected.clear();
    for (const id of b.ids) (add && all) ? selected.delete(id) : selected.add(id);
    updateSel(); return;
  }
  if (peace) { togglePeaceProv(p); return; }
  if (!add) selected.clear();
  updateSel();
  selProv = p; polDirty = true;
  if (p >= 0) renderProv(); else $('provPanel').classList.add('hidden');
}
function moveSelected(p) {
  if (p < 0 || !selected.size) return;
  send({ type: 'move', ids: [...selected], prov: p });
}
function showTip(x, y) {
  const tip = $('tip'), p = provAt(x, y);
  if (p < 0 || !owner) { tip.classList.add('hidden'); return; }
  const o = civ(owner[p]), c = civ(ctrl[p]);
  tip.innerHTML = `<b>${esc(world.provs[p][0])}</b> · ${esc(o ? o.name : '')}${ctrl[p] !== owner[p] && c ? ` <span style="color:#ff8a80">(işgalde: ${esc(c.name)})</span>` : ''}`;
  tip.style.left = (x + 14) + 'px'; tip.style.top = (y + 14) + 'px'; tip.classList.remove('hidden');
}

// ---------------- seçim çubuğu ----------------
function updateSel() {
  const el = $('sel');
  const list = [...selected].map(id => armies.get(id)).filter(Boolean);
  if (!list.length || !playing) { el.classList.add('hidden'); return; }
  const total = list.reduce((s, a) => s + a.troops, 0);
  el.classList.remove('hidden');
  el.innerHTML = `<b>${list.length} ordu · ${fmt(total)} asker</b><span class="mut">Sağ tık: yürüt</span>
    <button class="sec" onclick="send({type:'split',id:${list[0].id}})">Böl</button>
    <button class="sec" onclick="send({type:'merge',ids:[${list.map(a => a.id)}]})">Birleştir</button>
    <button class="sec" onclick="selected.clear();updateSel()">✕</button>`;
}

// ---------------- il paneli ----------------
const provValue = p => 1 + prov.pop[p] / 1000 + (civ(owner[p]) && civ(owner[p]).cap === p ? 6 : 0);
function provIncome(p) { return prov.pop[p] / 1000 * (0.25 + 0.08 * prov.dev[p]) + prov.factory[p] * 2; }
function renderProv() {
  const p = selProv, el = $('provPanel');
  if (p < 0 || !prov) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const o = civ(owner[p]), c = civ(ctrl[p]), mine = owner[p] === me && ctrl[p] === me;
  const isCap = o.cap === p;
  const gold = priv ? priv.gold : 0;
  const B = st.build;
  const bcost = (t) => B[t].base + B[t].step * prov[t][p];
  const investCost = 25 + prov.dev[p] * prov.dev[p] * 8 + prov.pop[p] / 1000 * 3;
  const here = [...armies.values()].filter(a => a.prov === p);
  const enemyHere = here.filter(a => priv && priv.enemies.some(e => e[0] === a.civ));
  let html = `<button class="close" onclick="selProv=-1;polDirty=true;renderProv()">✕</button>
    <div class="row" style="margin-bottom:6px">${flagTag(o.iso, true)}<div><div style="font:800 16px Georgia,serif">${esc(world.provs[p][0])} ${isCap ? '⭐' : ''}</div>
    <a href="#" onclick="openCiv(${o.id});return false" style="color:var(--acc)">${esc(o.name)}</a>${ctrl[p] !== owner[p] ? ` <span style="color:#ff8a80">· ${esc(c.name)} işgalinde</span>` : ''}</div></div>
    <div class="kv"><span class="mut">Nüfus</span><b>${fmt(prov.pop[p] * 1000)}</b><span class="mut">Gelişmişlik</span><b>${prov.dev[p]} / 10</b>
    <span class="mut">Gelir</span><b>${provIncome(p).toFixed(1)} altın/gün</b><span class="mut">Kale</span><b>${prov.fort[p]}</b></div>`;
  if (here.length) html += `<div class="mut" style="margin:4px 0">Burada: ${here.map(a => `${flagTag(civ(a.civ).iso)} ${fmt(a.troops)}`).join(' · ')}</div>`;
  if (mine) {
    html += `<h3 style="margin-top:8px">Yatırım ve binalar</h3>
      <div class="bld"><span class="grow">📈 Yatırım (gelişmişlik +1)</span><button ${gold < investCost || prov.dev[p] >= 10 ? 'disabled' : ''} onclick="send({type:'invest',prov:${p}})">${Math.ceil(investCost)} 💰</button></div>`;
    for (const t of ['factory', 'fort', 'barracks', 'univ']) {
      const ic = { factory: '🏭', fort: '🏰', barracks: '⛺', univ: '🎓' }[t];
      const maxed = prov[t][p] >= B[t].max;
      html += `<div class="bld"><span class="grow">${ic} ${B[t].name} <span class="lvl">${prov[t][p]}/${B[t].max}</span><br><small class="mut">${B[t].desc}</small></span><button ${maxed || gold < bcost(t) ? 'disabled' : ''} onclick="send({type:'build',prov:${p},what:'${t}'})">${maxed ? 'Tam' : Math.ceil(bcost(t)) + ' 💰'}</button></div>`;
    }
    html += `<h3 style="margin-top:8px">Asker topla</h3><div class="row">${[5000, 10000, 25000, 50000].map(n => `<button class="sec" ${gold < n / 1000 * st.recruitCost || (priv && priv.manpower < n) ? 'disabled' : ''} onclick="send({type:'recruit',prov:${p},amount:${n}})">${fmtK(n)}<br><small>${n / 1000 * st.recruitCost}💰</small></button>`).join('')}</div>`;
  } else if (enemyHere.length && priv && priv.air > 0) {
    html += `<button class="red" style="width:100%;margin-top:8px" ${priv.airCd ? 'disabled' : ''} onclick="send({type:'airstrike',prov:${p}})">✈ Hava saldırısı (${priv.air} filo)${priv.airCd ? ' · ' + priv.airCd + ' gün' : ''}</button>`;
  }
  if (!mine && o.id !== me) html += `<button class="sec" style="width:100%;margin-top:8px" onclick="openCiv(${o.id})">🤝 ${esc(o.name)} ile diplomasi</button>`;
  el.innerHTML = html;
}

// ---------------- ülke (diplomasi) paneli ----------------
function openCiv(id) { civPanelId = id; renderCiv(); }
function stars(n) { return `<span class="stars">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>`; }
function renderCiv() {
  const el = $('civPanel'), id = civPanelId;
  if (id < 0 || !priv) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const c = civ(id), s = sum[id] || [1, 0, 0, 0, null, []];
  const myRel = priv.rel[id], theirRel = priv.relTo[id];
  const enemy = priv.enemies.find(e => e[0] === id);
  const ally = priv.allies.includes(id), pact = priv.pacts.find(x => x[0] === id);
  const human = lobby && lobby.players.find(p => p.civ === id);
  let html = `<button class="close" onclick="civPanelId=-1;renderCiv()">✕</button>
    <div class="row">${flagTag(c.iso, true)}<div><div style="font:800 17px Georgia,serif">${esc(c.name)}</div><div class="mut">${human ? '👤 ' + esc(human.name) : '🤖 Yapay zekâ'}</div></div></div>
    <div class="kv"><span class="mut">İl</span><b>${s[1]}</b><span class="mut">Ordu</span><b>${fmt(s[2])}</b><span class="mut">Nüfus</span><b>${String(s[3]).replace('.', ',')} M</b>
    <span class="mut">Müttefikleri</span><b>${(s[5] || []).slice(0, 6).map(a => flagTag(civ(a).iso)).join(' ') || '—'}</b></div>`;
  if (id !== me) {
    html += `<div class="mut">Bize bakışı: <b style="color:${theirRel >= 0 ? '#8bc34a' : '#ff8a80'}">${theirRel}</b></div><div class="relbar" style="margin:6px 0 10px"><i style="left:calc(${(theirRel + 100) / 2}% - 2px)"></i></div>`;
    html += `<div>${enemy ? `<span class="tag war">⚔ Savaştayız</span> Skor: <b>${enemy[1]}</b> · Sen ${stars(enemy[2])} · O ${stars(enemy[3])}` : ally ? '<span class="tag ally">🤝 Müttefik</span>' : pact ? `<span class="tag pact">📜 Saldırmazlık paktı (${pact[1]} gün)</span>` : '<span class="tag">Barış</span>'}</div>`;
    html += `<div class="btns">
      <button class="sec" onclick="openChat(${id})">💬 Mesaj</button>
      <button class="sec" onclick="dip(${id},'improve')">➕ İlişki (30💰)</button>
      <button class="sec" onclick="dip(${id},'gift',{amount:100})">🎁 Hediye (100💰)</button>
      <button class="sec" onclick="dip(${id},'insult')">😠 Hakaret et</button>
      ${ally ? `<button class="sec" onclick="dip(${id},'leave')">💔 İttifakı boz</button>` : `<button class="sec" ${enemy ? 'disabled' : ''} onclick="dip(${id},'alliance')">🤝 İttifak öner</button>`}
      <button class="sec" ${enemy || pact ? 'disabled' : ''} onclick="dip(${id},'pact')">📜 Saldırmazlık</button>
      ${enemy ? `<button class="green" onclick="openPeace(${id})">🕊 Barış masası</button>` : `<button class="red" ${pact ? 'disabled' : ''} onclick="confirmWar(${id})">⚔ Savaş ilan et</button>`}
      <button class="sec" onclick="centerOn(${c.cap}, Math.max(cam.s, 3))">📍 Haritada göster</button></div>`;
  }
  el.innerHTML = html;
}
function dip(to, action, extra = {}) { send({ type: 'diplo', to, action, ...extra }); }
function confirmWar(id) {
  const c = civ(id); const allies = (sum[id] && sum[id][5]) || [];
  modal(`<h3>Savaş ilanı</h3><div style="font:800 18px Georgia,serif;margin-bottom:8px">${flagTag(c.iso)} ${esc(c.name)}</div>
    <p>${allies.length ? `Müttefikleri de savaşa girecek: ${allies.map(a => flagTag(civ(a).iso) + ' ' + esc(civ(a).name)).join(', ')}` : 'Bu ülkenin müttefiki yok.'}</p>
    <div class="row"><button class="red grow" onclick="dip(${id},'war');closeModal()">⚔ Savaş ilan et</button><button class="sec grow" onclick="closeModal()">Vazgeç</button></div>`);
}

// ---------------- barış masası ----------------
function openPeace(id) {
  peace = { to: id, take: new Set(), give: new Set() };
  for (let p = 0; p < NP; p++) if (owner[p] === id && ctrl[p] === me) peace.take.add(p);
  polDirty = true; civPanelId = -1; renderCiv(); renderPeace();
}
function togglePeaceProv(p) {
  if (p < 0 || !peace) return;
  if (owner[p] === peace.to && ctrl[p] === me) { peace.take.has(p) ? peace.take.delete(p) : peace.take.add(p); }
  else if (owner[p] === me && ctrl[p] === peace.to) { peace.give.has(p) ? peace.give.delete(p) : peace.give.add(p); }
  else return toast('Sadece işgal ettiğin illeri isteyebilir, işgal altındaki kendi illerini verebilirsin.');
  polDirty = true; renderPeace();
}
function renderPeace() {
  if (!peace) return;
  const c = civ(peace.to), en = priv.enemies.find(e => e[0] === peace.to);
  if (!en) { closePeace(); return; }
  let tot = 0, totMe = 0; for (let p = 0; p < NP; p++) { if (owner[p] === peace.to) tot += provValue(p); if (owner[p] === me) totMe += provValue(p); }
  const takeV = [...peace.take].reduce((s, p) => s + provValue(p), 0), giveV = [...peace.give].reduce((s, p) => s + provValue(p), 0);
  const need = Math.round(100 * takeV / Math.max(1, tot) - 100 * giveV / Math.max(1, totMe));
  const human = lobby && lobby.players.some(p => p.civ === peace.to);
  const ok = need <= 0 ? en[1] > -25 : need <= en[1] + 5;
  const list = (set, cls) => [...set].map(p => `<label><input type="checkbox" checked onchange="togglePeaceProv(${p})"> ${esc(world.provs[p][0])} <small class="mut">(${provValue(p).toFixed(1)})</small></label>`).join('') || '<span class="mut">Yok</span>';
  modal(`<h3>Barış masası</h3><div class="row" style="margin-bottom:6px">${flagTag(c.iso, true)}<div style="font:800 18px Georgia,serif">${esc(c.name)}</div></div>
    <div>Savaş skoru: <b>${en[1]}</b> · Sen ${stars(en[2])} · O ${stars(en[3])}</div>
    <p class="mut" style="margin:6px 0">Haritada tıklayarak il ekle/çıkar. Mavi taralı: istediklerin, turuncu: verdiklerin.</p>
    <h3>İstenen iller (${peace.take.size})</h3><div class="plist">${list(peace.take)}</div>
    <h3>Verilen iller (${peace.give.size})</h3><div class="plist">${list(peace.give)}</div>
    <div style="margin:8px 0">Talep: <b>%${Math.max(0, need)}</b> · ${human ? 'Karşı taraf bir oyuncu, onaylaması gerekecek.' : ok ? '<span style="color:#8bc34a">Muhtemelen kabul eder</span>' : '<span style="color:#ff8a80">Muhtemelen reddeder (skorunu artır ya da daha az iste)</span>'}</div>
    <div class="row"><button class="green grow" onclick="sendPeace()">🕊 Barış teklif et</button><button class="sec grow" onclick="closePeace()">Kapat</button></div>`, true);
}
function sendPeace() { if (!peace) return; dip(peace.to, 'peace', { take: [...peace.take], give: [...peace.give] }); closePeace(); }
function closePeace() { peace = null; polDirty = true; closeModal(); }

// ---------------- gelen teklifler ----------------
function showOffer() {
  if (!pendingOffers.length || peace) return;
  const o = pendingOffers[0], c = civ(o.from);
  const what = { alliance: 'ittifak kurmak istiyor', pact: 'saldırmazlık paktı istiyor', peace: 'barış istiyor' }[o.action];
  let body = '';
  if (o.action === 'peace') body = `<div>Senden istediği iller: <b>${o.take.length}</b>${o.take.length ? ` <small class="mut">(${o.take.slice(0, 8).map(p => esc(world.provs[p][0])).join(', ')}${o.take.length > 8 ? '…' : ''})</small>` : ''}</div>
    <div>Sana verdiği iller: <b>${o.give.length}</b></div><div class="mut" style="margin-top:4px">Onun yıldızı ${stars(o.stars)} · Senin yıldızın ${stars(o.theirStars)}</div>`;
  modal(`<h3>Diplomatik teklif</h3><div class="row" style="margin-bottom:8px">${flagTag(c.iso, true)}<div style="font:800 17px Georgia,serif">${esc(c.name)} ${what}</div></div>${body}
    <div class="row" style="margin-top:12px"><button class="green grow" onclick="answerOffer(true)">Kabul et</button><button class="red grow" onclick="answerOffer(false)">Reddet</button></div>`);
}
function answerOffer(ok) { const o = pendingOffers.shift(); if (o) send({ type: 'reply', offer: o.id, accept: ok }); closeModal(); setTimeout(showOffer, 200); }

function modal(html, right) { const m = $('modal'); m.innerHTML = html; m.classList.remove('hidden'); m.classList.toggle('right', !!right); }
function closeModal() { $('modal').classList.add('hidden'); }

// ---------------- yan paneller ----------------
document.querySelectorAll('#tools button[data-p]').forEach(b => b.onclick = () => togglePanel(b.dataset.p));
$('mapMode').onclick = () => { mapMode = mapMode === 'pol' ? 'dip' : 'pol'; $('mapMode').classList.toggle('on', mapMode === 'dip'); polDirty = true; toast(mapMode === 'dip' ? 'Diplomatik harita: mavi müttefik, kırmızı düşman, yeşil pakt' : 'Siyasi harita'); };
function togglePanel(p) { openPanel = openPanel === p ? null : p; document.querySelectorAll('#tools button[data-p]').forEach(b => b.classList.toggle('on', b.dataset.p === openPanel)); renderSide(); }
function closeAll() { openPanel = null; renderSide(); civPanelId = -1; renderCiv(); selProv = -1; renderProv(); document.querySelectorAll('#tools button').forEach(b => b.classList.remove('on')); }
function refreshPanels() { if (openPanel && openPanel !== 'chat') renderSide(); if (civPanelId >= 0) renderCiv(); if (peace) renderPeace(); if (selProv >= 0) renderProv(); }
function openChat(id) { chatWith = id; openPanel = 'chat'; document.querySelectorAll('#tools button[data-p]').forEach(b => b.classList.toggle('on', b.dataset.p === 'chat')); renderSide(); }
function renderSide() {
  const el = $('side');
  if (!openPanel || !priv) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const close = `<button class="close" onclick="togglePanel('${openPanel}')">✕</button>`;
  if (openPanel === 'overview') {
    const c = civ(me);
    const myWars = priv.enemies.map(e => `<div class="civrow" onclick="openCiv(${e[0]})">${flagTag(civ(e[0]).iso)} ${esc(civ(e[0]).name)} <span class="tag war" style="margin-left:auto">skor ${e[1]}</span></div>`).join('') || '<span class="mut">Savaşta değilsin.</span>';
    el.innerHTML = `${close}<div class="row">${flagTag(c.iso, true)}<div style="font:800 18px Georgia,serif">${esc(c.name)}</div></div>
      <div class="kv"><span class="mut">Hazine</span><b>${fmt(priv.gold)} 💰</b><span class="mut">Gelir</span><b>+${priv.income}/gün</b><span class="mut">Ordu gideri</span><b>-${priv.upkeep}/gün</b>
      <span class="mut">Toplam asker</span><b>${fmt(priv.troops)}</b><span class="mut">İnsan gücü</span><b>${fmt(priv.manpower)}</b><span class="mut">Nüfus</span><b>${fmt(priv.pop)}</b>
      <span class="mut">Araştırma</span><b>${priv.rp} puan/gün</b><span class="mut">Hava filosu</span><b>${priv.air}</b></div>
      <button class="sec" style="width:100%" onclick="send({type:'airbuild'})" ${priv.techs.includes('ucak') ? '' : 'disabled'}>✈ Hava filosu kur (${st.airCost} 💰)</button>
      <h3 style="margin-top:12px">Savaşlar</h3>${myWars}
      <h3 style="margin-top:12px">Müttefikler</h3>${priv.allies.map(a => `<div class="civrow" onclick="openCiv(${a})">${flagTag(civ(a).iso)} ${esc(civ(a).name)}</div>`).join('') || '<span class="mut">Müttefikin yok.</span>'}
      <h3 style="margin-top:12px">İpuçları</h3><div class="mut">İline tıkla: yatırım, bina, asker. Ordunu seç, sağ tıkla yürüt. Savaşta işgal ettiğin illeri barış masasında isteyebilirsin. Başkent düşerse ülkenin yarısı işgal edilir.</div>`;
  } else if (openPanel === 'tech') {
    const cur = priv.research;
    const rank = t => (cur && cur.id === t.id) ? 0 : priv.techs.includes(t.id) ? 3 : t.req.every(r => priv.techs.includes(r)) ? 1 : 2;
    el.innerHTML = `${close}<h3>Teknoloji (${priv.rp} puan/gün)</h3>` + [...st.techs].sort((a, b) => rank(a) - rank(b)).map(t => {
      const done = priv.techs.includes(t.id), avail = t.req.every(r => priv.techs.includes(r)), isCur = cur && cur.id === t.id;
      const pct = isCur ? Math.floor(100 * cur.progress / t.cost) : 0;
      const days = isCur ? Math.ceil((t.cost - cur.progress) / Math.max(0.1, priv.rp)) : Math.ceil(t.cost / Math.max(0.1, priv.rp));
      return `<div class="tech ${done ? 'done' : !avail ? 'lock' : ''} ${isCur ? 'cur' : ''}" ${!done && avail && !isCur ? `onclick="send({type:'research',tech:'${t.id}'})"` : ''}>
        <div class="row"><b class="grow">${done ? '✅' : avail ? '🔬' : '🔒'} ${esc(t.name)}</b><small class="mut">${done ? 'tamam' : '~' + days + ' gün'}</small></div>
        <small class="mut">${esc(t.desc)}${t.req.length ? ' · Gerekli: ' + t.req.map(r => st.techs.find(x => x.id === r).name).join(', ') : ''}</small>
        ${isCur ? `<div class="bar" style="margin-top:5px"><i style="width:${pct}%"></i></div>` : ''}</div>`;
    }).join('');
  } else if (openPanel === 'diplo') {
    const rows = st.civs.map(c => ({ c, s: sum[c.id] || [0] })).filter(x => x.s[0] && x.c.id !== me).sort((a, b) => b.s[2] - a.s[2]);
    el.innerHTML = `${close}<h3>Dünya (${rows.length} ülke)</h3>` + rows.map(({ c, s }) => {
      const en = priv.enemies.some(e => e[0] === c.id), al = priv.allies.includes(c.id), pa = priv.pacts.some(p => p[0] === c.id);
      const r = priv.relTo[c.id];
      return `<div class="civrow" onclick="openCiv(${c.id})">${flagTag(c.iso)}<span class="grow">${esc(c.name)}${s[4] ? ' 👤' : ''}</span>
        ${en ? '<span class="tag war">⚔</span>' : al ? '<span class="tag ally">🤝</span>' : pa ? '<span class="tag pact">📜</span>' : ''}
        <small style="color:${r >= 0 ? '#8bc34a' : '#ff8a80'};min-width:28px;text-align:right">${r}</small><small class="mut" style="min-width:58px;text-align:right">${fmtK(s[2])}</small></div>`;
    }).join('');
  } else if (openPanel === 'chat') {
    if (chatWith < 0) {
      const ids = [...chats.keys()];
      el.innerHTML = `${close}<h3>Mesajlar</h3>${ids.map(i => `<div class="civrow" onclick="openChat(${i})">${flagTag(civ(i).iso)} ${esc(civ(i).name)} <small class="mut" style="margin-left:auto">${chats.get(i).length}</small></div>`).join('') || '<div class="mut">Henüz mesaj yok. Bir ülkenin diplomasi panelinden "Mesaj" diyerek konuşmaya başla. Yapay zekâ ülkeleri ilişkinize göre cevap verir (ittifak, barış, yardım, tehdit…).</div>'}`;
    } else {
      const c = civ(chatWith), list = chats.get(chatWith) || [];
      el.innerHTML = `${close}<div class="row"><button class="sec" onclick="chatWith=-1;renderSide()">←</button>${flagTag(c.iso)} <b>${esc(c.name)}</b></div>
        <div id="chatBox">${list.map(m => `<div class="msg ${m.from === me ? 'me' : ''}"><span>${esc(m.text)}</span></div>`).join('') || '<div class="mut">Bir şey yaz… (ör. "ittifak kuralım", "barış istiyoruz", "yardım lazım")</div>'}</div>
        <div class="row"><input id="chatIn" class="grow" placeholder="Mesaj yaz…" maxlength="300"><button onclick="sendChat()">Gönder</button></div>`;
      const box = $('chatBox'); box.scrollTop = box.scrollHeight;
      const inp = $('chatIn'); inp.onkeydown = e => { if (e.key === 'Enter') sendChat(); }; inp.focus();
    }
  } else if (openPanel === 'log') {
    el.innerHTML = `${close}<h3>Olaylar</h3>` + (eventsLog.slice(0, 150).map(e => `<div class="evrow"><small>${esc(e.date)}</small><br>${esc(e.text)}</div>`).join('') || '<span class="mut">Henüz olay yok.</span>');
  }
}
function sendChat() { const inp = $('chatIn'); if (!inp || !inp.value.trim()) return; send({ type: 'chat', to: chatWith, text: inp.value.trim() }); inp.value = ''; }

function toast(t, err) {
  const d = document.createElement('div'); d.className = 'toast' + (err ? ' err' : ''); d.textContent = t;
  $('toasts').appendChild(d);
  while ($('toasts').children.length > 6) $('toasts').firstChild.remove();
  setTimeout(() => d.remove(), 6000);
}

// hız değişince son hızı hatırla
setInterval(() => { if (speed) lastSpeed = speed; }, 500);

resize();
loadWorld().then(() => requestAnimationFrame(frame));
