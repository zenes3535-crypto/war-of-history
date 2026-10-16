// Harita üretici -> public/world.json
// Kaynaklar (hepsi Natural Earth, kamu malı): ülkeler (world-atlas 50m), iller (admin-1), şehirler (populated places)
// Çıktı: ülke yolları, il sınır çizgileri, 600x300 il ızgarası, arazi tipleri, il komşulukları + deniz geçişleri, şehirler, başkentler
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';

const META = JSON.parse(readFileSync('tools/country-meta.json', 'utf8')); // ad -> [iso2, türkçe ad]
const topo = JSON.parse(readFileSync('node_modules/world-atlas/countries-50m.json', 'utf8'));
const geoms = topo.objects.countries.geometries.filter(g => g.properties.name !== 'Antarctica');
const W = 2000, H = 1000;
const proj = geoNaturalEarth1().fitSize([W, H], { type: 'Sphere' });
const path = geoPath(proj).digits(1);
const feats = geoms.map(g => feature(topo, g));

function rings(f) {
  const r = []; let cur = null;
  const ctx = { moveTo(x, y) { cur = [[x, y]]; r.push(cur); }, lineTo(x, y) { cur.push([x, y]); }, closePath() {}, arc() {}, rect() {}, beginPath() {} };
  geoPath(proj, ctx)(f);
  return r;
}

const countries = feats.map((f, i) => {
  let best = f, bestA = 0;
  if (f.geometry.type === 'MultiPolygon') {
    for (const poly of f.geometry.coordinates) {
      const pf = { type: 'Feature', geometry: { type: 'Polygon', coordinates: poly } };
      const a = path.area(pf);
      if (a > bestA) { bestA = a; best = pf; }
    }
  }
  const bc = path.centroid(best);
  const meta = META[f.properties.name] || [null, f.properties.name];
  return { id: i, name: f.properties.name, tr: meta[1], iso: meta[0], d: path(f) || '', cx: Math.round(bc[0]), cy: Math.round(bc[1]), area: Math.round(path.area(f)) };
});

// ---------- Izgara ----------
const GW = 600, GH = 300, CELL = W / GW, NCELL = GW * GH;
function pip(rs, px, py) {
  let inside = false;
  for (const r of rs) for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
    const [xa, ya] = r[a], [xb, yb] = r[b];
    if ((ya > py) !== (yb > py) && px < (xb - xa) * (py - ya) / (yb - ya) + xa) inside = !inside;
  }
  return inside;
}
function rasterize(rs, fn) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const r of rs) for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const gx0 = Math.max(0, Math.floor(x0 / CELL)), gx1 = Math.min(GW - 1, Math.ceil(x1 / CELL));
  const gy0 = Math.max(0, Math.floor(y0 / CELL)), gy1 = Math.min(GH - 1, Math.ceil(y1 / CELL));
  for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
    const i = gy * GW + gx;
    if (pip(rs, (gx + 0.5) * CELL, (gy + 0.5) * CELL)) fn(i);
  }
}
const cellOf = (px, py) => { const gx = Math.floor(px / CELL), gy = Math.floor(py / CELL); return gx < 0 || gy < 0 || gx >= GW || gy >= GH ? -1 : gy * GW + gx; };

// 1) ülke ızgarası
const cgrid = new Int16Array(NCELL);
for (const c of countries) rasterize(rings(feats[c.id]), i => { if (!cgrid[i]) cgrid[i] = c.id + 1; });
for (const c of countries) if (!cgrid.includes(c.id + 1)) { const i = cellOf(c.cx, c.cy); if (i >= 0) cgrid[i] = c.id + 1; }

// 2) il ızgarası
const a1 = JSON.parse(readFileSync('tools/ne_10m_admin_1.geojson', 'utf8'));
const pgrid = new Int32Array(NCELL).fill(-1);
const pnames = [];
a1.features.forEach(f => {
  if (!f.geometry || f.properties.admin === 'Antarctica') return;
  const idx = pnames.length; pnames.push(f.properties.name || f.properties.name_en || '?');
  rasterize(rings(f), i => { if (cgrid[i] && pgrid[i] < 0) pgrid[i] = idx; });
});
const modeCountry = new Map();
for (let i = 0; i < NCELL; i++) if (pgrid[i] >= 0) { const m = modeCountry.get(pgrid[i]) || new Map(); m.set(cgrid[i], (m.get(cgrid[i]) || 0) + 1); modeCountry.set(pgrid[i], m); }
const pcountry = new Map();
for (const [p, m] of modeCountry) pcountry.set(p, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
for (let i = 0; i < NCELL; i++) if (pgrid[i] >= 0 && pcountry.get(pgrid[i]) !== cgrid[i]) pgrid[i] = -1;
{
  const q = [];
  for (let i = 0; i < NCELL; i++) if (pgrid[i] >= 0) q.push(i);
  for (let h = 0; h < q.length; h++) {
    const c = q[h], cx = c % GW, cy = (c / GW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
      const n = y * GW + x;
      if (pgrid[n] < 0 && cgrid[n] && cgrid[n] === cgrid[c]) { pgrid[n] = pgrid[c]; q.push(n); }
    }
  }
}
const synth = new Map();
for (let i = 0; i < NCELL; i++) if (cgrid[i] && pgrid[i] < 0) {
  const cid = cgrid[i];
  if (!synth.has(cid)) { synth.set(cid, pnames.length); pcountry.set(pnames.length, cid); pnames.push(countries[cid - 1].name); }
  pgrid[i] = synth.get(cid);
}
const remap = new Map(); const provList = [];
for (let i = 0; i < NCELL; i++) if (pgrid[i] >= 0 && !remap.has(pgrid[i])) { remap.set(pgrid[i], provList.length); provList.push({ name: pnames[pgrid[i]], c: pcountry.get(pgrid[i]) - 1, cells: [] }); }
const final = new Int32Array(NCELL);
for (let i = 0; i < NCELL; i++) if (pgrid[i] >= 0) { const p = remap.get(pgrid[i]); final[i] = p + 1; provList[p].cells.push(i); }
const NP = provList.length;

// 3) il merkezi (çapa hücresi), kıyı bilgisi, kara komşulukları
const adj = Array.from({ length: NP }, () => new Set());
for (const [pi, p] of provList.entries()) {
  let sx = 0, sy = 0;
  for (const c of p.cells) { sx += c % GW; sy += (c / GW) | 0; }
  sx /= p.cells.length; sy /= p.cells.length;
  let best = p.cells[0], bd = 1e9;
  for (const c of p.cells) { const d = (c % GW - sx) ** 2 + (((c / GW) | 0) - sy) ** 2; if (d < bd) { bd = d; best = c; } }
  p.anchor = best;
  p.coastal = 0;
  for (const c of p.cells) {
    const x = c % GW, y = (c / GW) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= GW || yy >= GH) continue;
      const n = yy * GW + xx;
      if (!final[n]) p.coastal = 1;
      else if (final[n] - 1 !== pi) { adj[pi].add(final[n] - 1); }
    }
  }
}
// 4) deniz geçişleri: kıyı illerinden su üzerinden en fazla SEA_R hücre ötedeki diğer kıyı illeri
const SEA_R = 10;
const sea = Array.from({ length: NP }, () => new Map());
{
  const dist = new Int16Array(NCELL).fill(-1);
  for (const [pi, p] of provList.entries()) {
    if (!p.coastal) continue;
    const touched = [], q = [];
    for (const c of p.cells) {
      const x = c % GW, y = (c / GW) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= GW || yy >= GH) continue;
        const n = yy * GW + xx;
        if (!final[n] && dist[n] < 0) { dist[n] = 1; q.push(n); touched.push(n); }
      }
    }
    for (let h = 0; h < q.length; h++) {
      const c = q[h], x = c % GW, y = (c / GW) | 0, d = dist[c];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= GW || yy >= GH) continue;
        const n = yy * GW + xx;
        if (final[n]) {
          const t = final[n] - 1;
          if (t !== pi && !adj[pi].has(t) && (!sea[pi].has(t) || sea[pi].get(t) > d)) sea[pi].set(t, d);
        } else if (dist[n] < 0 && d < SEA_R) { dist[n] = d + 1; q.push(n); touched.push(n); }
      }
    }
    for (const c of touched) dist[c] = -1;
  }
  for (let pi = 0; pi < NP; pi++) { // en yakın 5 ve simetrik yap
    const keep = [...sea[pi].entries()].sort((a, b) => a[1] - b[1]).slice(0, 5);
    sea[pi] = new Map(keep);
  }
  for (let pi = 0; pi < NP; pi++) for (const [t, d] of sea[pi]) if (!sea[t].has(pi)) sea[t].set(pi, d);
}

// 5) arazi tipi (biyom): 1 buz, 2 tundra, 3 tayga, 4 ılıman, 5 çöl, 6 tropik orman, 7 bozkır/savan
const deserts = [[16, 31, -17, 33], [15, 31, 35, 58], [25, 34, 55, 70], [24, 29, 69, 74], [36, 46, 76, 112], [-32, -19, 117, 142], [-28, -17, 12, 24], [29, 38, -118, -104], [-28, -17, -71, -68]];
const steppes = [[42, 52, 47, 87], [-50, -38, -72, -64], [8, 16, -17, 45], [-24, -8, 15, 40], [30, 50, -110, -97], [-34, -24, -66, -58], [45, 52, 88, 120]];
const inBox = (lat, lon, b) => lat >= b[0] && lat <= b[1] && lon >= b[2] && lon <= b[3];
const biome = new Uint8Array(NCELL);
const greenland = countries.find(c => c.name === 'Greenland');
for (let i = 0; i < NCELL; i++) {
  if (!final[i]) continue;
  const ll = proj.invert([(i % GW + .5) * CELL, ((i / GW | 0) + .5) * CELL]);
  if (!ll) { biome[i] = 4; continue; }
  const [lon, lat] = ll;
  let b = 4;
  if (Math.abs(lat) >= 72 || (greenland && cgrid[i] === greenland.id + 1 && lat > 63)) b = 1;
  else if (lat >= 63 || lat <= -52) b = 2;
  else if (lat >= 52) b = 3;
  else if (deserts.some(d => inBox(lat, lon, d))) b = 5;
  else if (steppes.some(d => inBox(lat, lon, d))) b = 7;
  else if (Math.abs(lat) < 13) b = 6;
  biome[i] = b;
}

// 6) şehirler ve başkentler
const pp = JSON.parse(readFileSync('tools/ne_10m_populated_places.geojson', 'utf8'));
const cities = [];
const capCity = new Map(); // ülke id -> {pop, prov}
for (const f of pp.features) {
  const P = f.properties;
  const isCap = P.adm0cap === 1;
  if (!(P.pop_max >= 600000 || isCap)) continue;
  const [px, py] = proj([P.longitude, P.latitude]);
  let c = cellOf(px, py);
  if (c < 0) continue;
  if (!final[c]) { // en yakın kara hücresi (3 hücreye kadar)
    let best = -1, bd = 99;
    const gx = c % GW, gy = (c / GW) | 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x = gx + dx, y = gy + dy; if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
      const n = y * GW + x; if (final[n] && dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = n; }
    }
    if (best < 0) continue;
    c = best;
  }
  const prov = final[c] - 1;
  cities.push([P.name, Math.round(px * 10) / 10, Math.round(py * 10) / 10, P.pop_max, prov, isCap ? 1 : 0]);
  if (isCap) {
    const cid = cgrid[c] - 1;
    if (cid >= 0 && (!capCity.has(cid) || capCity.get(cid).pop < P.pop_max)) capCity.set(cid, { pop: P.pop_max, prov });
  }
}
cities.sort((a, b) => b[3] - a[3]);
for (const c of countries) {
  if (capCity.has(c.id) && provList[capCity.get(c.id).prov].c === c.id) { c.cap = capCity.get(c.id).prov; continue; }
  // yedek: ülke merkezine en yakın ilin
  let best = -1, bd = 1e9;
  for (const [pi, p] of provList.entries()) if (p.c === c.id) {
    const a = p.anchor, d = Math.hypot((a % GW + .5) * CELL - c.cx, ((a / GW | 0) + .5) * CELL - c.cy);
    if (d < bd) { bd = d; best = pi; }
  }
  c.cap = best;
}

// RLE yardımcı
const rleOf = arr => { const out = []; let prev = arr[0], cnt = 0; for (const v of arr) { if (v === prev) cnt++; else { out.push(prev, cnt); prev = v; cnt = 1; } } out.push(prev, cnt); return out; };

// ---------- İl sınır çizgileri (karolara bölünmüş) ----------
const TILE = 100, tiles = {};
const emit = (key, str) => { (tiles[key] ||= []).push(str); };
for (const f of a1.features) {
  if (!f.geometry || f.properties.admin === 'Antarctica') continue;
  for (const r of rings(f)) {
    const pts = [];
    for (const p of r) { const qq = pts[pts.length - 1]; if (!qq || Math.hypot(p[0] - qq[0], p[1] - qq[1]) >= 0.7) pts.push(p); }
    if (pts.length < 3) continue;
    let cur = null, curKey = null;
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      const key = Math.floor(x / TILE) + ',' + Math.floor(y / TILE);
      const rx = Math.round(x * 10) / 10, ry = Math.round(y * 10) / 10;
      if (key !== curKey) {
        if (cur && i > 0) { cur.push(`L${rx} ${ry}`); emit(curKey, cur.join('')); }
        cur = [`M${i > 0 ? Math.round(pts[i - 1][0] * 10) / 10 : rx} ${i > 0 ? Math.round(pts[i - 1][1] * 10) / 10 : ry}`];
        curKey = key;
      }
      cur.push(`L${rx} ${ry}`);
    }
    if (cur) emit(curKey, cur.join(''));
  }
}
const provTiles = {}; for (const k in tiles) provTiles[k] = tiles[k].join('');

const out = {
  w: W, h: H,
  grid: { gw: GW, gh: GH, cell: CELL, rle: rleOf(final), biome: rleOf(biome) },
  provs: provList.map(p => [p.name, p.c, p.anchor, p.coastal, p.cells.length]),
  adj: adj.map(s => [...s]),
  sea: sea.map(m => [...m.entries()].map(([t, d]) => [t, d])),
  cities,
  prov: { tile: TILE, tiles: provTiles },
  countries,
};
mkdirSync('public', { recursive: true });
writeFileSync('public/world.json', JSON.stringify(out));
console.log('ülke:', countries.length, 'il:', NP, 'şehir:', cities.length, 'deniz bağı:', sea.reduce((a, m) => a + m.size, 0) / 2);
