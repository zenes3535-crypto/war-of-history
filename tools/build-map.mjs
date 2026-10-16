// Harita üretici: world-atlas (50m ülkeler) + Natural Earth admin-1 (iller) -> public/world.json
// Çıktı: ülke yolları, il sınır çizgileri (karolar), 600x300 hücre ızgarası (her hücre bir ile ait)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';

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
  return { id: i, name: f.properties.name, d: path(f) || '', cx: Math.round(bc[0]), cy: Math.round(bc[1]), area: Math.round(path.area(f)) };
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

// 1) ülke ızgarası (0 = deniz, id+1)
const cgrid = new Int16Array(NCELL);
for (const c of countries) rasterize(rings(feats[c.id]), i => { if (!cgrid[i]) cgrid[i] = c.id + 1; });
for (const c of countries) { // hücresi olmayan küçük ülkelere merkez hücre ver
  if (!cgrid.includes(c.id + 1)) {
    const gx = Math.min(GW - 1, Math.max(0, Math.floor(c.cx / CELL))), gy = Math.min(GH - 1, Math.max(0, Math.floor(c.cy / CELL)));
    cgrid[gy * GW + gx] = c.id + 1;
  }
}

// 2) il ızgarası
const a1 = JSON.parse(readFileSync('tools/ne_10m_admin_1.geojson', 'utf8'));
const pgrid = new Int32Array(NCELL).fill(-1);
const pnames = [];
a1.features.forEach(f => {
  if (!f.geometry || f.properties.admin === 'Antarctica') return;
  const idx = pnames.length; pnames.push(f.properties.name || f.properties.name_en || '?');
  rasterize(rings(f), i => { if (cgrid[i] && pgrid[i] < 0) pgrid[i] = idx; });
});
// ilin ülkesi: altındaki ülke hücrelerinin çoğunluğu
const modeCountry = new Map();
for (let i = 0; i < NCELL; i++) if (pgrid[i] >= 0) {
  const m = modeCountry.get(pgrid[i]) || new Map(); m.set(cgrid[i], (m.get(cgrid[i]) || 0) + 1); modeCountry.set(pgrid[i], m);
}
const pcountry = new Map();
for (const [p, m] of modeCountry) pcountry.set(p, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
for (let i = 0; i < NCELL; i++) if (pgrid[i] >= 0 && pcountry.get(pgrid[i]) !== cgrid[i]) pgrid[i] = -1;
// boş kara hücrelerini aynı ülkedeki en yakın ile doldur (çok kaynaklı BFS)
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
// hâlâ boş kalanlar: ülke başına sentetik il
const synth = new Map();
for (let i = 0; i < NCELL; i++) if (cgrid[i] && pgrid[i] < 0) {
  const cid = cgrid[i];
  if (!synth.has(cid)) { synth.set(cid, pnames.length); pcountry.set(pnames.length, cid); pnames.push(countries[cid - 1].name); }
  pgrid[i] = synth.get(cid);
}
// hücresi olan illeri yeniden numarala
const remap = new Map(); const provs = [];
for (let i = 0; i < NCELL; i++) if (pgrid[i] >= 0 && !remap.has(pgrid[i])) { remap.set(pgrid[i], provs.length); provs.push([pnames[pgrid[i]], pcountry.get(pgrid[i]) - 1]); }
const final = new Int32Array(NCELL);
for (let i = 0; i < NCELL; i++) final[i] = pgrid[i] >= 0 ? remap.get(pgrid[i]) + 1 : 0;


// Gerçek başkent koordinatları [enlem, boylam]; eşleşmeyen ülkeler merkez noktasını kullanır
const CAPITALS = {
 'Afghanistan':[34.5,69.2],'Albania':[41.3,19.8],'Algeria':[36.8,3.1],'Angola':[-8.8,13.2],'Argentina':[-34.6,-58.4],'Armenia':[40.2,44.5],'Australia':[-35.3,149.1],'Austria':[48.2,16.4],'Azerbaijan':[40.4,49.9],
 'Bangladesh':[23.8,90.4],'Belarus':[53.9,27.6],'Belgium':[50.8,4.4],'Benin':[6.5,2.6],'Bhutan':[27.5,89.6],'Bolivia':[-16.5,-68.1],'Bosnia and Herz.':[43.9,18.4],'Botswana':[-24.6,25.9],'Brazil':[-15.8,-47.9],'Bulgaria':[42.7,23.3],'Burkina Faso':[12.4,-1.5],'Burundi':[-3.4,29.4],
 'Cambodia':[11.6,104.9],'Cameroon':[3.9,11.5],'Canada':[45.4,-75.7],'Central African Rep.':[4.4,18.6],'Chad':[12.1,15.0],'Chile':[-33.4,-70.7],'China':[39.9,116.4],'Colombia':[4.7,-74.1],'Congo':[-4.3,15.3],'Costa Rica':[9.9,-84.1],'Croatia':[45.8,16.0],'Cuba':[23.1,-82.4],'Czechia':[50.1,14.4],
 'Dem. Rep. Congo':[-4.3,15.3],'Denmark':[55.7,12.6],'Djibouti':[11.6,43.1],'Dominican Rep.':[18.5,-69.9],'Ecuador':[-0.2,-78.5],'Egypt':[30.0,31.2],'El Salvador':[13.7,-89.2],'Eq. Guinea':[3.8,8.8],'Eritrea':[15.3,38.9],'Estonia':[59.4,24.7],'Ethiopia':[9.0,38.7],
 'Finland':[60.2,24.9],'France':[48.9,2.4],'Gabon':[0.4,9.5],'Gambia':[13.5,-16.6],'Georgia':[41.7,44.8],'Germany':[52.5,13.4],'Ghana':[5.6,-0.2],'Greece':[38.0,23.7],'Greenland':[64.2,-51.7],'Guatemala':[14.6,-90.5],'Guinea':[9.5,-13.7],'Guinea-Bissau':[11.9,-15.6],'Guyana':[6.8,-58.2],
 'Haiti':[18.5,-72.3],'Honduras':[14.1,-87.2],'Hungary':[47.5,19.1],'Iceland':[64.1,-21.9],'India':[28.6,77.2],'Indonesia':[-6.2,106.8],'Iran':[35.7,51.4],'Iraq':[33.3,44.4],'Ireland':[53.3,-6.3],'Israel':[31.8,35.2],'Italy':[41.9,12.5],"Côte d'Ivoire":[6.8,-5.3],
 'Japan':[35.7,139.7],'Jordan':[31.9,35.9],'Kazakhstan':[51.2,71.4],'Kenya':[-1.3,36.8],'Kosovo':[42.7,21.2],'Kuwait':[29.4,47.98],'Kyrgyzstan':[42.9,74.6],'Laos':[18.0,102.6],'Latvia':[56.9,24.1],'Lebanon':[33.9,35.5],'Lesotho':[-29.3,27.5],'Liberia':[6.3,-10.8],'Libya':[32.9,13.2],'Lithuania':[54.7,25.3],
 'Macedonia':[42.0,21.4],'North Macedonia':[42.0,21.4],'Madagascar':[-18.9,47.5],'Malawi':[-14.0,33.8],'Malaysia':[3.1,101.7],'Mali':[12.6,-8.0],'Mauritania':[18.1,-15.98],'Mexico':[19.4,-99.1],'Moldova':[47.0,28.9],'Mongolia':[47.9,106.9],'Montenegro':[42.4,19.3],'Morocco':[34.0,-6.8],'Mozambique':[-25.97,32.6],'Myanmar':[19.8,96.1],
 'Namibia':[-22.6,17.1],'Nepal':[27.7,85.3],'Netherlands':[52.4,4.9],'New Zealand':[-41.3,174.8],'Nicaragua':[12.1,-86.3],'Niger':[13.5,2.1],'Nigeria':[9.1,7.4],'North Korea':[39.0,125.8],'Norway':[59.9,10.7],'Oman':[23.6,58.4],'Pakistan':[33.7,73.1],'Panama':[9.0,-79.5],'Papua New Guinea':[-9.5,147.2],'Paraguay':[-25.3,-57.6],'Peru':[-12.0,-77.0],'Philippines':[14.6,121.0],'Poland':[52.2,21.0],'Portugal':[38.7,-9.1],
 'Qatar':[25.3,51.5],'Romania':[44.4,26.1],'Russia':[55.75,37.6],'Rwanda':[-1.95,30.1],'Saudi Arabia':[24.7,46.7],'Senegal':[14.7,-17.4],'Serbia':[44.8,20.5],'Sierra Leone':[8.5,-13.2],'Slovakia':[48.1,17.1],'Slovenia':[46.05,14.5],'Somalia':[2.0,45.3],'South Africa':[-25.7,28.2],'South Korea':[37.6,127.0],'S. Sudan':[4.85,31.6],'Spain':[40.4,-3.7],'Sri Lanka':[6.9,79.9],'Sudan':[15.6,32.5],'Suriname':[5.9,-55.2],'Sweden':[59.3,18.1],'Switzerland':[46.9,7.4],'Syria':[33.5,36.3],
 'Taiwan':[25.0,121.5],'Tajikistan':[38.6,68.8],'Tanzania':[-6.2,35.7],'Thailand':[13.75,100.5],'Togo':[6.1,1.2],'Tunisia':[36.8,10.2],'Turkey':[39.9,32.9],'Turkmenistan':[37.95,58.4],'Uganda':[0.3,32.6],'Ukraine':[50.45,30.5],'United Arab Emirates':[24.45,54.4],'United Kingdom':[51.5,-0.1],'United States of America':[38.9,-77.0],'Uruguay':[-34.9,-56.2],'Uzbekistan':[41.3,69.3],'Venezuela':[10.5,-66.9],'Vietnam':[21.0,105.8],'Yemen':[15.35,44.2],'Zambia':[-15.4,28.3],'Zimbabwe':[-17.8,31.05],'Bahamas':[25.05,-77.35],'Belize':[17.25,-88.8],'Jamaica':[18.0,-76.8],'Cyprus':[35.2,33.4],'Brunei':[4.9,114.9],'Bolivia ':[-16.5,-68.1],'W. Sahara':[27.15,-13.2],'Palestine':[31.9,35.2],'Somaliland':[9.56,44.06],'N. Cyprus':[35.2,33.4],'eSwatini':[-26.3,31.1],'Timor-Leste':[-8.55,125.6],'Luxembourg':[49.6,6.1],'Singapore':[1.3,103.8],'Trinidad and Tobago':[10.65,-61.5],'Fiji':[-18.1,178.4],'New Caledonia':[-22.3,166.5],'Falkland Is.':[-51.7,-57.85],'Puerto Rico':[18.5,-66.1],'Vanuatu':[-17.7,168.3],'Solomon Is.':[-9.4,160.0],'Bahrain':[26.2,50.6],'Mauritius':[-20.2,57.5],'Maldives':[4.2,73.5],'Comoros':[-11.7,43.3],'Cape Verde':[14.9,-23.5],'Cabo Verde':[14.9,-23.5],'Andorra':[42.5,1.5],'Monaco':[43.7,7.4],'Malta':[35.9,14.5],
};

// başkent: gerçek koordinat varsa onun ili, yoksa ülke merkezine en yakın hücrenin ili
const missing = [];
for (const c of countries) {
  let best = -1, bd = 1e9;
  for (let i = 0; i < NCELL; i++) if (cgrid[i] === c.id + 1) {
    const d = Math.hypot((i % GW + .5) * CELL - c.cx, ((i / GW | 0) + .5) * CELL - c.cy);
    if (d < bd) { bd = d; best = i; }
  }
  const ll = CAPITALS[c.name];
  if (ll) { // koordinatı hücreye çevir; deniz/başka ülke çıkarsa en yakın kendi hücresini bul
    const [px, py] = proj([ll[1], ll[0]]);
    const gx = Math.min(GW - 1, Math.max(0, Math.floor(px / CELL))), gy = Math.min(GH - 1, Math.max(0, Math.floor(py / CELL)));
    let bb = -1, bdd = 1e9;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = gx + dx, y = gy + dy; if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
      const i = y * GW + x; if (cgrid[i] !== c.id + 1) continue;
      const d = dx * dx + dy * dy; if (d < bdd) { bdd = d; bb = i; }
    }
    if (bb >= 0) best = bb;
  } else if (c.area > 400) missing.push(c.name);
  c.cap = best >= 0 ? final[best] - 1 : -1;
}

if (missing.length) console.log('başkent koordinatı yok (merkez kullanıldı):', missing.join(', '));
const rle = []; let prev = final[0], cnt = 0;
for (const v of final) { if (v === prev) cnt++; else { rle.push(prev, cnt); prev = v; cnt = 1; } }
rle.push(prev, cnt);

// ---------- İl sınır çizgileri (karolara bölünmüş) ----------
const TILE = 100, tiles = {};
const emit = (key, str) => { (tiles[key] ||= []).push(str); };
let npts = 0;
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
      cur.push(`L${rx} ${ry}`); npts++;
    }
    if (cur) emit(curKey, cur.join(''));
  }
}
const provTiles = {}; for (const k in tiles) provTiles[k] = tiles[k].join('');

const out = { w: W, h: H, grid: { gw: GW, gh: GH, cell: CELL, rle }, provs, prov: { tile: TILE, tiles: provTiles }, countries };
mkdirSync('public', { recursive: true });
writeFileSync('public/world.json', JSON.stringify(out));
console.log('ülke:', countries.length, 'il:', provs.length, 'il noktası:', npts, 'rle:', rle.length / 2);
