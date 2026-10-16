// War of History - oyun simülasyonu (sunucu tarafı, yetkili)
const { SCENARIOS, DEPENDENCIES } = require('./scenarios');
const { TECHS, TECH, START_TECHS } = require('./techs');

// ---------------- Sabit dünya verisi ----------------
let W = null; // hazırlanmış dünya
function prepareWorld(world) {
  const { gw, gh, rle, biome: brle } = world.grid;
  const NC = gw * gh, NP = world.provs.length;
  const cellProv = new Int32Array(NC), biome = new Uint8Array(NC);
  { let k = 0; for (let i = 0; i < rle.length; i += 2) for (let j = 0; j < rle[i + 1]; j++) cellProv[k++] = rle[i]; }
  { let k = 0; for (let i = 0; i < brle.length; i += 2) for (let j = 0; j < brle[i + 1]; j++) biome[k++] = brle[i]; }
  const P = world.provs.map(([name, country, anchor, coastal, ncell], i) => ({
    id: i, name, country, anchor, coastal, ncell, ax: anchor % gw + 0.5, ay: ((anchor / gw) | 0) + 0.5,
    adj: world.adj[i], sea: world.sea[i].map(([t]) => t), basePop: 0, city: 0,
  }));
  // nüfus: arazi tipine göre hücre başı + şehirler
  const PER = [0, 2e3, 2e4, 6e4, 2.2e5, 3e4, 1.8e5, 9e4];
  for (let i = 0; i < NC; i++) if (cellProv[i]) P[cellProv[i] - 1].basePop += PER[biome[i]] || 1e5;
  for (const [, , , pop, prov] of world.cities) { P[prov].basePop += pop * 1.6; P[prov].city = Math.max(P[prov].city, pop); }
  const countryByName = new Map(world.countries.map(c => [c.name, c]));
  W = { world, gw, gh, NC, NP, cellProv, biome, P, countryByName };
  return W;
}

const PALETTE = ['#c0392b', '#2e86c1', '#28b463', '#d4ac0d', '#8e44ad', '#e67e22', '#16a085', '#7f8c8d', '#e84393', '#2c3e50', '#a04000', '#5dade2',
  '#58d68d', '#f4d03f', '#af7ac5', '#eb984e', '#48c9b0', '#cd6155', '#1f618d', '#b7950b', '#6c3483', '#1e8449', '#ca6f1e', '#76448a', '#839192', '#f1948a',
  '#85c1e9', '#a9dfbf', '#f9e79f', '#d7bde2'];
const RICH = new Set('us ca gb fr de it es nl be ch at se no dk fi jp kr au nz ie is lu il sg tw ae qa'.split(' '));
const MID = new Set('tr ru cn br mx ar pl cz pt gr hu sa my th cl za ro bg hr sk si ee lv lt kz ir ua by rs uy cr pa kw om bh'.split(' '));

const MS_PER_DAY = [0, 30000, 10000, 3000, 1000, 250]; // hız 0 = duraklat
const SPEED_NAMES = ['Durdu', '1 gün / 30 sn', '1 gün / 10 sn', '1 gün / 3 sn', '1 gün / sn', '4 gün / sn'];
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

const RECRUIT_COST = 6;   // 1000 asker = 6 altın
const UPKEEP = 0.12;      // 1000 asker / gün
const BUILD = {
  factory: { name: 'Fabrika', base: 120, step: 80, max: 5, desc: '+2 altın/gün' },
  fort: { name: 'Kale', base: 100, step: 70, max: 5, desc: 'Savunma +%15, kuşatma yavaşlar' },
  barracks: { name: 'Kışla', base: 90, step: 60, max: 3, desc: 'İnsan gücü artışı +%25' },
  univ: { name: 'Üniversite', base: 160, step: 120, max: 3, desc: '+1 araştırma puanı/gün' },
};
const AIR_COST = 150;
const MAX_ARMIES = 30;

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

class Game {
  constructor(scenarioId, hooks) {
    if (!W) throw new Error('dünya hazır değil');
    this.sc = SCENARIOS[scenarioId] || SCENARIOS['2026'];
    this.scenarioId = SCENARIOS[scenarioId] ? scenarioId : '2026';
    this.hooks = hooks; // { event(msg, civs?), toCiv(civId, msg) }
    const [y, m, d] = this.sc.date;
    this.date = new Date(Date.UTC(y, m - 1, d));
    this.day = 0;
    this.speed = 3;
    this.dayAcc = 0;
    this.nextArmy = 1; this.nextWar = 1; this.nextOffer = 1;
    this.armies = new Map();
    this.wars = new Map();
    this.offers = new Map();
    this.changes = [];      // il sahiplik değişiklikleri [prov, owner, ctrl]
    this.dirtyProv = new Set();
    this.events = [];
    this.buildCivs();
    this.initProvinces();
    this.initDiplomacy();
    this.initArmies();
    this.recount();
  }

  // ---------------- kurulum ----------------
  buildCivs() {
    const NP = W.NP, P = W.P;
    const countryToCiv = new Map();
    const civs = [];
    const addCiv = (key, name, iso, members) => {
      const civ = { id: civs.length, key, name, iso, members, color: null, cap: -1, gold: 0, manpower: 0, techs: new Set(START_TECHS[this.scenarioId] || []),
        research: null, air: 0, airCd: 0, rel: null, allies: new Set(), pacts: new Map(), enemies: new Map(), human: null, alive: true,
        provs: 0, troops: 0, income: 0, aiTick: Math.floor(Math.random() * 5), stat: {} };
      civs.push(civ);
      for (const m of members) { const c = W.countryByName.get(m); if (c) countryToCiv.set(c.id, civ.id); }
      return civ;
    };
    const used = new Set();
    for (const g of this.sc.groups) {
      const mem = [];
      for (const m of g.members) { mem.push(m); used.add(m); for (const d of DEPENDENCIES[m] || []) { mem.push(d); used.add(d); } }
      addCiv(g.key, g.name, g.iso, mem);
    }
    const depOf = new Map(); for (const [s, ds] of Object.entries(DEPENDENCIES)) for (const d of ds) depOf.set(d, s);
    for (const c of W.world.countries) {
      if (used.has(c.name)) continue;
      if (depOf.has(c.name) && !used.has(depOf.get(c.name))) continue; // egemen devletle birlikte eklenecek
      const mem = [c.name, ...(DEPENDENCIES[c.name] || [])];
      mem.forEach(m => used.add(m));
      addCiv(c.name, c.tr || c.name, c.iso, mem);
    }
    this.civs = civs;
    this.owner = new Int16Array(NP); this.ctrl = new Int16Array(NP);
    for (let p = 0; p < NP; p++) { const cv = countryToCiv.get(P[p].country); this.owner[p] = cv ?? 0; this.ctrl[p] = this.owner[p]; }
    // başkent: ana ülkenin başkenti
    for (const civ of civs) {
      const main = W.countryByName.get(civ.members[0]);
      civ.cap = main && main.cap >= 0 && this.owner[main.cap] === civ.id ? main.cap : -1;
      if (civ.cap < 0) { let best = -1, bp = -1; for (let p = 0; p < NP; p++) if (this.owner[p] === civ.id && P[p].basePop > bp) { bp = P[p].basePop; best = p; } civ.cap = best; }
      if (civ.cap < 0) civ.alive = false;
    }
    // renkler: komşu ülkeler farklı renk alsın
    const nb = civs.map(() => new Set());
    for (let p = 0; p < NP; p++) for (const q of P[p].adj) if (this.owner[p] !== this.owner[q]) nb[this.owner[p]].add(this.owner[q]);
    const order = [...civs].sort((a, b) => nb[b.id].size - nb[a.id].size);
    const hash = s => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
    for (const civ of order) {
      const usedC = new Set([...nb[civ.id]].map(o => civs[o].color).filter(Boolean));
      const start = hash(civ.key) % PALETTE.length;
      for (let k = 0; k < PALETTE.length; k++) { const col = PALETTE[(start + k) % PALETTE.length]; if (!usedC.has(col)) { civ.color = col; break; } }
      civ.color ||= PALETTE[start];
    }
  }

  initProvinces() {
    const NP = W.NP, P = W.P;
    this.pop = new Float64Array(NP); this.dev = new Uint8Array(NP);
    this.fort = new Uint8Array(NP); this.factory = new Uint8Array(NP); this.barracks = new Uint8Array(NP); this.univ = new Uint8Array(NP);
    this.siege = new Float32Array(NP);
    const histPenalty = this.scenarioId === '2026' ? 0 : 1;
    const popScale = this.scenarioId === '1914' ? 0.45 : this.scenarioId === '1939' ? 0.6 : 1;
    for (let p = 0; p < NP; p++) {
      const civ = this.civs[this.owner[p]];
      const iso = W.world.countries[P[p].country].iso || '';
      this.pop[p] = P[p].basePop * popScale;
      this.dev[p] = clamp((RICH.has(iso) ? 5 : MID.has(iso) ? 4 : 2) - histPenalty + (P[p].city > 3e6 ? 2 : P[p].city > 1e6 ? 1 : 0), 1, 10);
      if (p === civ.cap) { this.fort[p] = 3; this.factory[p] = 1; }
    }
    for (const civ of this.civs) {
      let pop = 0; for (let p = 0; p < NP; p++) if (this.owner[p] === civ.id) pop += this.pop[p];
      civ.gold = 200 + pop / 1e6 * 4;
      civ.manpower = pop * 0.01;
    }
    this.recount();
  }

  initDiplomacy() {
    const n = this.civs.length;
    for (const c of this.civs) { c.rel = new Float32Array(n); for (let i = 0; i < n; i++) c.rel[i] = rand(-10, 25); c.rel[c.id] = 100; }
    const keyCiv = k => this.civs.find(c => c.key === k || c.members.includes(k));
    for (const a of this.sc.alliances) {
      const mem = [...new Set(a.members.map(keyCiv).filter(Boolean))];
      for (const x of mem) for (const y of mem) if (x !== y) { x.allies.add(y.id); x.rel[y.id] = 80; }
    }
    for (const w of this.sc.wars) {
      const att = w.attackers.map(keyCiv).filter(Boolean), def = w.defenders.map(keyCiv).filter(Boolean);
      if (att.length && def.length) this.startWar(att[0], def[0], true, att.slice(1), def.slice(1));
    }
  }

  initArmies() {
    const NP = W.NP, P = W.P;
    for (const civ of this.civs) {
      if (!civ.alive) continue;
      let pop = 0; const owned = [];
      for (let p = 0; p < NP; p++) if (this.owner[p] === civ.id) { pop += this.pop[p]; owned.push(p); }
      const total = Math.max(3000, Math.round(pop * 0.003 / 1000) * 1000);
      // sınır illeri
      const border = owned.filter(p => P[p].adj.some(q => this.owner[q] !== civ.id));
      const n = Math.min(4, 1 + Math.floor(owned.length / 25));
      this.addArmy(civ.id, civ.cap, Math.round(total * (n === 1 ? 1 : 0.4)));
      for (let i = 1; i < n; i++) this.addArmy(civ.id, border.length ? pick(border) : pick(owned), Math.round(total * 0.6 / (n - 1)));
      if (civ.techs.has('ucak')) civ.air = Math.min(10, Math.floor(pop / 3e7));
    }
  }

  // ---------------- yardımcılar ----------------
  atWar(a, b) { return a !== b && this.civs[a].enemies.has(b); }
  friendly(a, b) { return a === b || this.civs[a].allies.has(b); }
  techEff(civ, key) { let v = 0; for (const t of civ.techs) v += (TECH[t].eff[key] || 0); return v; }
  provValue(p) { return 1 + this.pop[p] / 1e6 + (this.civs[this.owner[p]].cap === p ? 6 : 0); }
  addArmy(civ, prov, troops) {
    const a = { id: this.nextArmy++, civ, prov, x: W.P[prov].ax + rand(-0.6, 0.6), y: W.P[prov].ay + rand(-0.6, 0.6), troops, path: [], battle: false, sieging: false };
    this.armies.set(a.id, a);
    return a;
  }
  dateStr() { const d = this.date; return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
  log(text, civs) { this.events.push({ text, civs: civs || null, date: this.dateStr() }); }
  recount() {
    for (const c of this.civs) { c.provs = 0; c.troops = 0; c.popTotal = 0; }
    for (let p = 0; p < W.NP; p++) { const c = this.civs[this.owner[p]]; c.provs++; c.popTotal += this.pop[p]; }
    for (const a of this.armies.values()) this.civs[a.civ].troops += a.troops;
  }
  setCtrl(p, c) {
    if (this.ctrl[p] === c) return;
    this.ctrl[p] = c; this.siege[p] = 0;
    this.changes.push(p, this.owner[p], c);
  }
  setOwner(p, c) {
    this.owner[p] = c; this.ctrl[p] = c; this.siege[p] = 0;
    this.changes.push(p, c, c);
  }

  coreBonus(p) { // il, sahibinin ana ülke toprağındaysa direniş daha güçlü
    const civ = this.civs[this.owner[p]], home = W.countryByName.get(civ.members[0]);
    return home && W.P[p].country === home.id ? 1 : 0;
  }
  // ---------------- savaş ilişkileri ----------------
  startWar(att, def, silent, attAllies = [], defAllies = []) {
    if (this.atWar(att.id, def.id) || att.id === def.id) return null;
    const war = { id: this.nextWar++, att: new Set(), def: new Set(), start: this.day, leaderA: att.id, leaderD: def.id, score: new Map() };
    this.wars.set(war.id, war);
    const join = (civ, side) => {
      if (!civ.alive) return;
      const S = side === 'att' ? war.att : war.def, O = side === 'att' ? war.def : war.att;
      if (S.has(civ.id) || O.has(civ.id)) return;
      S.add(civ.id);
      for (const o of O) { civ.enemies.set(o, war.id); this.civs[o].enemies.set(civ.id, war.id); civ.rel[o] = Math.min(civ.rel[o], -60); this.civs[o].rel[civ.id] = Math.min(this.civs[o].rel[civ.id], -60); }
    };
    join(att, 'att'); join(def, 'def');
    for (const a of attAllies) join(a, 'att');
    for (const d of defAllies) join(d, 'def');
    // savunanın müttefikleri yardıma gelir; saldıranın müttefikleri ilişkisi iyiyse katılır
    for (const id of [...def.allies]) { const al = this.civs[id]; if (!war.att.has(id) && !(al.allies.has(att.id))) join(al, 'def'); }
    for (const id of [...att.allies]) { const al = this.civs[id]; if (!war.def.has(id) && !al.allies.has(def.id) && (al.human != null || al.rel[att.id] >= 70)) join(al, 'att'); }
    // ittifakı bozanlar: saldırgan, savunanla müttefikse ittifak biter
    if (att.allies.has(def.id)) { att.allies.delete(def.id); def.allies.delete(att.id); }
    att.pacts.delete(def.id); def.pacts.delete(att.id);
    for (const c of this.civs) if (c.id !== def.id && c.id !== att.id) c.rel[att.id] -= c.allies.has(def.id) ? 25 : 5;
    if (!silent) {
      const A = [...war.att].map(i => this.civs[i].name).join(', '), D = [...war.def].map(i => this.civs[i].name).join(', ');
      this.log(`⚔ ${att.name}, ${def.name} ülkesine savaş ilan etti! (${A} ⟷ ${D})`);
    }
    return war;
  }
  leaveWarPair(a, b) {
    // a ile b arasındaki savaşı bitir (ikili barış)
    const wid = this.civs[a].enemies.get(b); if (!wid) return;
    this.civs[a].enemies.delete(b); this.civs[b].enemies.delete(a);
    const war = this.wars.get(wid);
    if (!war) return;
    // taraflardan biri kalmayan savaşı kapat
    const stillAtt = [...war.att].some(x => [...war.def].some(y => this.civs[x].enemies.get(y) === wid));
    if (!stillAtt) this.wars.delete(wid);
  }
  warScore(a, b) {
    // a'nın b üzerindeki savaş skoru (-100..100)
    let occA = 0, occB = 0, totA = 0, totB = 0;
    for (let p = 0; p < W.NP; p++) {
      const o = this.owner[p];
      if (o === b) { const v = this.provValue(p); totB += v; if (this.ctrl[p] === a) occA += v; }
      else if (o === a) { const v = this.provValue(p); totA += v; if (this.ctrl[p] === b) occB += v; }
    }
    const war = this.wars.get(this.civs[a].enemies.get(b));
    const bat = war ? (war.score.get(a + '>' + b) || 0) - (war.score.get(b + '>' + a) || 0) : 0;
    return clamp(Math.round(100 * occA / Math.max(1, totB) - 100 * occB / Math.max(1, totA) + bat), -100, 100);
  }
  stars(a, b) { return clamp(Math.floor(Math.max(0, this.warScore(a, b)) / 12), 0, 5); }

  // ---------------- komutlar (insan ve yapay zekâ ortak) ----------------
  passable(civ, p) {
    const c = this.ctrl[p], o = this.owner[p];
    return this.friendly(civ, c) || this.friendly(civ, o) || this.atWar(civ, c) || this.atWar(civ, o);
  }
  findPath(civId, from, to, maxNodes = 4000) {
    if (from === to) return [];
    const prev = new Int32Array(W.NP).fill(-2); prev[from] = -1;
    const q = [from]; const civ = this.civs[civId];
    for (let h = 0; h < q.length && q.length < maxNodes; h++) {
      const p = q[h];
      for (const n of W.P[p].adj.concat(W.P[p].sea)) {
        if (prev[n] !== -2) continue;
        if (n !== to && !this.passable(civId, n)) continue;
        if (n === to && !this.passable(civId, n)) return null;
        prev[n] = p;
        if (n === to) { const path = []; let x = to; while (x !== from) { path.push(x); x = prev[x]; } return path.reverse(); }
        q.push(n);
      }
    }
    return null;
  }
  cmdMove(civId, ids, target) {
    let ok = 0;
    for (const id of ids) {
      const a = this.armies.get(id); if (!a || a.civ !== civId) continue;
      const path = this.findPath(civId, a.prov, target); if (!path) continue;
      if (a.battle && path.length && !this.friendly(civId, this.ctrl[path[0]])) continue; // savaşta sadece dost toprağa çekilebilir
      if (a.battle) a.troops *= 0.95;
      a.path = path; a.sieging = false; ok++;
    }
    return ok;
  }
  cmdRecruit(civId, prov, amount) {
    const civ = this.civs[civId];
    amount = Math.floor(amount / 1000) * 1000;
    if (amount < 1000 || this.owner[prov] !== civId || this.ctrl[prov] !== civId) return 'Sadece kendi kontrolündeki illerde asker toplanabilir.';
    const cost = amount / 1000 * RECRUIT_COST;
    if (civ.gold < cost) return 'Yeterli altın yok.';
    if (civ.manpower < amount) return 'Yeterli insan gücü yok.';
    if ([...this.armies.values()].filter(a => a.civ === civId).length >= MAX_ARMIES) return 'En fazla ' + MAX_ARMIES + ' ordu olabilir.';
    civ.gold -= cost; civ.manpower -= amount;
    const here = [...this.armies.values()].find(a => a.civ === civId && a.prov === prov && !a.path.length && !a.battle);
    if (here) here.troops += amount; else this.addArmy(civId, prov, amount);
    return null;
  }
  buildCost(type, p) { const b = BUILD[type]; return b.base + b.step * this[type][p]; }
  cmdBuild(civId, prov, type) {
    const civ = this.civs[civId], b = BUILD[type];
    if (!b || this.owner[prov] !== civId || this.ctrl[prov] !== civId) return 'Bu ilde inşaat yapamazsın.';
    if (this[type][prov] >= b.max) return b.name + ' en üst seviyede.';
    const cost = this.buildCost(type, prov);
    if (civ.gold < cost) return 'Yeterli altın yok (' + Math.ceil(cost) + ').';
    civ.gold -= cost; this[type][prov]++; this.dirtyProv.add(prov);
    return null;
  }
  investCost(p) { return 25 + this.dev[p] * this.dev[p] * 8 + this.pop[p] / 1e6 * 3; }
  cmdInvest(civId, prov) {
    const civ = this.civs[civId];
    if (this.owner[prov] !== civId || this.ctrl[prov] !== civId) return 'Bu ile yatırım yapamazsın.';
    if (this.dev[prov] >= 10) return 'Gelişmişlik en üst seviyede.';
    const cost = this.investCost(prov);
    if (civ.gold < cost) return 'Yeterli altın yok (' + Math.ceil(cost) + ').';
    civ.gold -= cost; this.dev[prov]++; this.dirtyProv.add(prov);
    return null;
  }
  cmdResearch(civId, techId) {
    const civ = this.civs[civId], t = TECH[techId];
    if (!t || civ.techs.has(techId)) return 'Geçersiz teknoloji.';
    if (!t.req.every(r => civ.techs.has(r))) return 'Önce gereken teknolojileri araştır.';
    civ.research = { id: techId, progress: civ.research && civ.research.id === techId ? civ.research.progress : 0 };
    return null;
  }
  cmdAirBuild(civId) {
    const civ = this.civs[civId];
    if (!civ.techs.has('ucak')) return 'Önce Savaş Uçakları teknolojisini araştır.';
    if (civ.gold < AIR_COST) return 'Yeterli altın yok (' + AIR_COST + ').';
    civ.gold -= AIR_COST; civ.air++;
    return null;
  }
  cmdAirStrike(civId, prov) {
    const civ = this.civs[civId];
    if (civ.air <= 0) return 'Hava filon yok.';
    if (civ.airCd > 0) return 'Uçaklar hazırlanıyor (' + civ.airCd + ' gün).';
    const targets = [...this.armies.values()].filter(a => a.prov === prov && this.atWar(civId, a.civ));
    if (!targets.length) return 'Bu ilde düşman ordusu yok.';
    // menzil: kendi illerinden 60 hücre
    const P = W.P[prov];
    let near = false;
    for (let p = 0; p < W.NP && !near; p++) if (this.ctrl[p] === civId && Math.hypot(W.P[p].ax - P.ax, W.P[p].ay - P.ay) < 60) near = true;
    if (!near) return 'Hedef menzil dışında.';
    let dmg = civ.air * 1500 * (1 + this.techEff(civ, 'bomb'));
    const tgtCiv = this.civs[targets[0].civ];
    if (tgtCiv.techs.has('radar')) dmg *= 0.6;
    const total = targets.reduce((s, a) => s + a.troops, 0);
    for (const a of targets) a.troops = Math.max(0, a.troops - dmg * a.troops / total);
    civ.airCd = 3;
    this.log(`✈ ${civ.name} hava saldırısı düzenledi: ${W.P[prov].name} (${Math.round(Math.min(dmg, total)).toLocaleString('tr-TR')} kayıp)`, [civId, tgtCiv.id]);
    return null;
  }
  cmdSplit(civId, id) {
    const a = this.armies.get(id); if (!a || a.civ !== civId || a.troops < 2000 || a.battle) return;
    if ([...this.armies.values()].filter(x => x.civ === civId).length >= MAX_ARMIES) return;
    const half = Math.floor(a.troops / 2000) * 1000;
    a.troops -= half;
    const b = this.addArmy(civId, a.prov, half); b.x = a.x + 0.8; b.y = a.y + 0.4;
    return b.id;
  }
  cmdMerge(civId, ids) {
    const list = ids.map(i => this.armies.get(i)).filter(a => a && a.civ === civId && !a.battle);
    const byProv = new Map();
    for (const a of list) { if (!byProv.has(a.prov)) byProv.set(a.prov, []); byProv.get(a.prov).push(a); }
    for (const arr of byProv.values()) { const [m, ...rest] = arr; for (const r of rest) { m.troops += r.troops; this.armies.delete(r.id); } }
  }

  // ---------------- diplomasi ----------------
  diplo(fromId, toId, action, extra = {}) {
    const A = this.civs[fromId], B = this.civs[toId];
    if (!A || !B || !B.alive || fromId === toId) return 'Geçersiz hedef.';
    const notify = (text) => this.log(text, [fromId, toId]);
    switch (action) {
      case 'improve': {
        const cost = 30;
        if (A.gold < cost) return 'Yeterli altın yok (30).';
        A.gold -= cost; B.rel[fromId] = clamp(B.rel[fromId] + 10, -100, 100); A.rel[toId] = clamp(A.rel[toId] + 5, -100, 100);
        return null;
      }
      case 'insult':
        B.rel[fromId] = clamp(B.rel[fromId] - 25, -100, 100); A.rel[toId] = clamp(A.rel[toId] - 10, -100, 100);
        notify(`😠 ${A.name}, ${B.name} ülkesine hakaret etti.`);
        return null;
      case 'gift': {
        const amt = Math.max(0, Math.floor(extra.amount || 100));
        if (A.gold < amt || amt <= 0) return 'Yeterli altın yok.';
        A.gold -= amt; B.gold += amt; B.rel[fromId] = clamp(B.rel[fromId] + amt / 15, -100, 100);
        notify(`🎁 ${A.name}, ${B.name} ülkesine ${amt} altın gönderdi.`);
        return null;
      }
      case 'alliance':
      case 'pact':
      case 'peace': {
        if (action === 'alliance' && A.allies.has(toId)) return 'Zaten müttefiksiniz.';
        if (action === 'alliance' && this.atWar(fromId, toId)) return 'Savaştaki bir ülkeyle ittifak olmaz.';
        if (action === 'pact' && (A.pacts.has(toId) || this.atWar(fromId, toId))) return 'Pakt yapılamaz.';
        if (action === 'peace' && !this.atWar(fromId, toId)) return 'Bu ülkeyle savaşta değilsin.';
        const offer = { id: this.nextOffer++, from: fromId, to: toId, action, take: [], give: [], expires: this.day + 30 };
        if (action === 'peace') {
          offer.take = (extra.take || []).filter(p => this.owner[p] === toId && this.ctrl[p] === fromId).slice(0, 200);
          offer.give = (extra.give || []).filter(p => this.owner[p] === fromId && this.ctrl[p] === toId).slice(0, 200);
        }
        if (B.human != null) {
          this.offers.set(offer.id, offer);
          this.hooks.toCiv(toId, { type: 'offer', offer: this.offerView(offer) });
          return 'sent';
        }
        const ok = this.aiConsider(B, offer);
        if (ok) this.acceptOffer(offer); else notify(`❌ ${B.name}, ${A.name} ülkesinin ${action === 'alliance' ? 'ittifak' : action === 'pact' ? 'saldırmazlık paktı' : 'barış'} teklifini reddetti.`);
        return ok ? 'accepted' : 'rejected';
      }
      case 'war': {
        if (A.pacts.has(toId)) return 'Saldırmazlık paktınız var, önce süresinin dolmasını bekle.';
        if (this.atWar(fromId, toId)) return 'Zaten savaştasınız.';
        if (A.allies.has(toId)) { A.allies.delete(toId); B.allies.delete(fromId); }
        this.startWar(A, B);
        return null;
      }
      case 'leave':
        if (!A.allies.has(toId)) return 'Müttefik değilsiniz.';
        A.allies.delete(toId); B.allies.delete(fromId); B.rel[fromId] -= 30;
        notify(`💔 ${A.name}, ${B.name} ile ittifakını bozdu.`);
        return null;
    }
    return 'Bilinmeyen işlem.';
  }
  offerView(o) {
    const sum = arr => Math.round(arr.reduce((s, p) => s + this.provValue(p), 0) * 10) / 10;
    return { id: o.id, from: o.from, action: o.action, take: o.take, give: o.give, takeValue: sum(o.take), giveValue: sum(o.give),
      stars: o.action === 'peace' ? this.stars(o.from, o.to) : 0, theirStars: o.action === 'peace' ? this.stars(o.to, o.from) : 0 };
  }
  replyOffer(civId, offerId, accept) {
    const o = this.offers.get(offerId);
    if (!o || o.to !== civId) return;
    this.offers.delete(offerId);
    if (accept) this.acceptOffer(o);
    else this.log(`❌ ${this.civs[o.to].name}, ${this.civs[o.from].name} ülkesinin teklifini reddetti.`, [o.from, o.to]);
  }
  acceptOffer(o) {
    const A = this.civs[o.from], B = this.civs[o.to];
    if (o.action === 'alliance') {
      A.allies.add(B.id); B.allies.add(A.id); A.rel[B.id] = Math.max(A.rel[B.id], 60); B.rel[A.id] = Math.max(B.rel[A.id], 60);
      this.log(`🤝 ${A.name} ve ${B.name} ittifak kurdu!`);
    } else if (o.action === 'pact') {
      A.pacts.set(B.id, this.day + 365); B.pacts.set(A.id, this.day + 365);
      this.log(`📜 ${A.name} ve ${B.name} 1 yıllık saldırmazlık paktı imzaladı.`);
    } else if (o.action === 'peace') {
      if (!this.atWar(A.id, B.id)) return;
      this.makePeace(A.id, B.id, o.take.filter(p => this.owner[p] === B.id), o.give.filter(p => this.owner[p] === A.id));
    }
  }
  makePeace(a, b, take, give) {
    const A = this.civs[a], B = this.civs[b];
    for (const p of take) this.setOwner(p, a);
    for (const p of give) this.setOwner(p, b);
    // kalan işgaller geri döner
    for (let p = 0; p < W.NP; p++) {
      if (this.owner[p] === b && this.ctrl[p] === a) this.setCtrl(p, b);
      else if (this.owner[p] === a && this.ctrl[p] === b) this.setCtrl(p, a);
    }
    this.leaveWarPair(a, b);
    A.pacts.set(b, this.day + 180); B.pacts.set(a, this.day + 180);
    A.rel[b] = Math.max(A.rel[b], -20); B.rel[a] = Math.max(B.rel[a], -30);
    // yabancı topraktaki orduları eve gönder
    for (const ar of this.armies.values()) if ((ar.civ === a || ar.civ === b) && !this.friendly(ar.civ, this.ctrl[ar.prov]) && !this.civs[ar.civ].enemies.has(this.ctrl[ar.prov])) this.sendHome(ar);
    const t = take.length ? ` ${A.name} ${take.length} il aldı.` : '', g = give.length ? ` ${B.name} ${give.length} il aldı.` : '';
    this.log(`🕊 ${A.name} ve ${B.name} barış yaptı.${t}${g}`);
    this.recount(); this.checkDeaths();
  }
  sendHome(ar) {
    const civ = this.civs[ar.civ];
    let best = civ.cap, bd = 1e9;
    for (let p = 0; p < W.NP; p++) if (this.ctrl[p] === ar.civ) { const d = Math.hypot(W.P[p].ax - ar.x, W.P[p].ay - ar.y); if (d < bd) { bd = d; best = p; } }
    if (best < 0) { this.armies.delete(ar.id); return; }
    ar.prov = best; ar.x = W.P[best].ax; ar.y = W.P[best].ay; ar.path = []; ar.battle = false; ar.sieging = false;
  }

  // yapay zekâ teklifi değerlendirir
  aiConsider(B, o) {
    const A = this.civs[o.from], rel = B.rel[A.id];
    const strength = c => c.troops + 1;
    if (o.action === 'alliance') {
      const commonEnemy = [...A.enemies.keys()].some(e => B.enemies.has(e) || B.rel[e] < -40);
      return rel >= 60 || (rel >= 35 && commonEnemy) || (rel >= 40 && strength(A) > strength(B) * 2);
    }
    if (o.action === 'pact') return rel >= 15 || strength(A) > strength(B) * 1.5;
    if (o.action === 'peace') {
      const score = this.warScore(A.id, B.id); // A'nın B üzerindeki skoru
      const tot = c => { let s = 0; for (let p = 0; p < W.NP; p++) if (this.owner[p] === c) s += this.provValue(p); return s; };
      const takePct = 100 * o.take.reduce((s, p) => s + this.provValue(p), 0) / Math.max(1, tot(B.id));
      const givePct = 100 * o.give.reduce((s, p) => s + this.provValue(p), 0) / Math.max(1, tot(A.id));
      const warDays = this.day - (this.wars.get(A.enemies.get(B.id))?.start || 0);
      const net = takePct - givePct;
      if (net <= 0) return score > -25 || warDays > 60 || givePct > 5; // beyaz barış veya bize toprak veriyorsa
      return net <= score + 5;
    }
    return false;
  }

  // ---------------- bot sohbeti ----------------
  aiReply(B, fromId, text) {
    const A = this.civs[fromId], rel = B.rel[fromId];
    const t = text.toLocaleLowerCase('tr-TR');
    const mood = rel >= 50 ? 'dost' : rel >= 0 ? 'nötr' : 'düşman';
    const hi = { dost: 'Sevgili dostumuz', nötr: 'Sayın', düşman: 'Bakın' }[mood];
    const war = this.atWar(B.id, fromId);
    if (/ittifak|müttefik|birlik/.test(t)) {
      if (B.allies.has(fromId)) return `${hi} ${A.name}, zaten müttefikiz. Yanınızdayız.`;
      const ok = this.aiConsider(B, { from: fromId, to: B.id, action: 'alliance', take: [], give: [] });
      return ok ? `${A.name} ile ittifaka sıcak bakıyoruz. Diplomasi menüsünden resmi teklifinizi gönderin, kabul edeceğiz.` : `Şu an ${A.name} ile ittifak için yeterli güvenimiz yok. İlişkilerimizi geliştirin (ilişki: ${Math.round(rel)}).`;
    }
    if (/barış|ateşkes|anlaşma/.test(t)) {
      if (!war) return `Zaten savaşta değiliz. ${mood === 'düşman' ? 'Şimdilik.' : 'Böyle kalmasını umarız.'}`;
      const sc = this.warScore(B.id, fromId);
      return sc > 20 ? `Barış mı? Cephede biz kazanıyoruz (${sc} puan). Bedelini ödemeye hazırsanız konuşuruz.` : sc < -20 ? `Halkımız yoruldu. Makul bir barışa açığız, teklifinizi bekliyoruz.` : `Barış teklifinizi değerlendiririz, ama ağır şartlar kabul etmeyiz.`;
    }
    if (/savaş|saldır|yok edece|tehdit|işgal/.test(t)) {
      B.rel[fromId] = clamp(rel - 5, -100, 100);
      return war ? `Ordularımız sonuna kadar direnecek. ${A.name} bu savaşı kaybedecek!` : B.troops > A.troops ? `Tehditleriniz bizi korkutmaz. Ordumuz sizinkinden güçlü.` : `Tehditlerinizi not ettik. Müttefiklerimiz de bunu duyacak.`;
    }
    if (/para|altın|yardım|kredi/.test(t)) {
      if (rel >= 60 && B.gold > 300 && Math.random() < 0.5) { const amt = Math.floor(B.gold * 0.1); B.gold -= amt; A.gold += amt; return `Dostlarımıza yardım etmekten mutluluk duyarız. ${amt} altın gönderdik.`; }
      return rel >= 30 ? `Hazinemiz şu an buna müsait değil, ama ileride yardımcı olabiliriz.` : `Size neden yardım edelim? Önce güvenimizi kazanın.`;
    }
    if (/pakt|saldırmazlık/.test(t)) return rel >= 15 ? `Saldırmazlık paktına açığız. Resmi teklifinizi gönderin.` : `Size henüz güvenmiyoruz.`;
    if (/merhaba|selam|iyi günler|nasılsın/.test(t)) return { dost: `Merhaba ${A.name}! Dostlarımızdan haber almak her zaman güzel.`, nötr: `Selamlar ${A.name}. Ne istiyorsunuz?`, düşman: `${A.name}... Ne istediğinizi çabuk söyleyin.` }[mood];
    if (/hakaret|aptal|salak|zayıf/.test(t)) { B.rel[fromId] = clamp(rel - 10, -100, 100); return 'Bu küstahlık unutulmayacak.'; }
    return pick({
      dost: [`${A.name} ile dostluğumuz bizim için çok değerli.`, `Her konuda işbirliğine hazırız.`, `Ortak düşmanlarımıza karşı birlikte durmalıyız.`],
      nötr: [`Mesajınızı aldık. Tekliflerinizi değerlendiririz.`, `Ülkemiz kendi çıkarlarını gözetir.`, `İlişkilerimizi geliştirmek isterseniz somut adımlar bekliyoruz.`],
      düşman: [`Size güvenmiyoruz.`, `Sınırlarımıza dikkat edin.`, `Konuşacak pek bir şeyimiz yok.`],
    }[mood]);
  }

  // ---------------- zaman ----------------
  update(dtMs) {
    if (!this.speed) return;
    const msDay = MS_PER_DAY[this.speed];
    const frac = dtMs / msDay;
    this.moveArmies(frac);
    this.dayAcc += frac;
    while (this.dayAcc >= 1) { this.dayAcc -= 1; this.newDay(); }
  }
  moveArmies(frac) {
    for (const a of this.armies.values()) {
      if (!a.path.length || a.battle || a.sieging) continue;
      const civ = this.civs[a.civ];
      let step = 2.6 * (1 + this.techEff(civ, 'spd')) * frac;
      while (step > 0 && a.path.length) {
        const n = a.path[0], tx = W.P[n].ax, ty = W.P[n].ay;
        const isSea = !W.P[a.prov].adj.includes(n);
        const sp = isSea ? (civ.techs.has('deniz') ? 0.6 : 0.35) : 1;
        const d = Math.hypot(tx - a.x, ty - a.y), s = step * sp;
        if (d <= s) {
          a.x = tx; a.y = ty; a.path.shift(); step -= d / sp; a.prov = n;
          if (!this.passable(a.civ, n)) { a.path = []; break; } // diplomasi değişti
          if (!this.friendly(a.civ, this.ctrl[n]) || (this.owner[n] !== this.ctrl[n] && this.friendly(a.civ, this.owner[n]))) { a.sieging = true; break; }
        } else { a.x += (tx - a.x) / d * s; a.y += (ty - a.y) / d * s; step = 0; }
      }
    }
  }
  newDay() {
    this.day++;
    this.date = new Date(this.date.getTime() + 864e5);
    this.battles();
    this.sieges();
    this.economy();
    this.ai();
    for (const c of this.civs) {
      for (const [o, end] of c.pacts) if (end <= this.day) c.pacts.delete(o);
      for (let i = 0; i < c.rel.length; i++) if (i !== c.id) {
        if (c.enemies.has(i)) c.rel[i] = Math.max(-100, c.rel[i] - 0.2);
        else if (c.allies.has(i)) c.rel[i] += (70 - c.rel[i]) * 0.003;
        else c.rel[i] += (5 - c.rel[i]) * 0.002;
      }
      if (c.airCd > 0) c.airCd--;
    }
    for (const [id, o] of this.offers) if (o.expires <= this.day) this.offers.delete(id);
    this.checkDeaths();
    this.recount();
    if (this.hooks.day) this.hooks.day();
  }
  battles() {
    const byProv = new Map();
    for (const a of this.armies.values()) { a.battle = false; if (!byProv.has(a.prov)) byProv.set(a.prov, []); byProv.get(a.prov).push(a); }
    const dmg = new Map();
    for (const [p, list] of byProv) {
      if (list.length < 2) continue;
      for (const a of list) {
        const enemies = list.filter(e => this.atWar(a.civ, e.civ));
        if (!enemies.length) continue;
        a.battle = true; a.sieging = false;
        const side = list.filter(f => !this.atWar(a.civ, f.civ) && enemies.some(e => this.atWar(f.civ, e.civ)));
        const sideTroops = side.reduce((s, f) => s + f.troops, 0) || a.troops;
        const civ = this.civs[a.civ];
        const def = 1 + this.techEff(civ, 'def') + (this.friendly(a.civ, this.owner[p]) ? this.fort[p] * 0.15 + this.coreBonus(p) * 0.25 : 0);
        let atk = 0;
        for (const e of enemies) atk += e.troops * (1 + this.techEff(this.civs[e.civ], 'atk'));
        const d = 0.06 * atk * (a.troops / sideTroops) / def * rand(0.85, 1.15);
        dmg.set(a, (dmg.get(a) || 0) + d);
        // savaş skoru: verilen kayıplar
        for (const e of enemies) {
          const war = this.wars.get(this.civs[e.civ].enemies.get(a.civ));
          if (war) { const k = e.civ + '>' + a.civ; war.score.set(k, Math.min(40, (war.score.get(k) || 0) + d * (e.troops / atk) / 25000)); }
        }
      }
    }
    for (const [a, d] of dmg) {
      a.troops -= Math.min(d, a.troops * 0.5);
      if (a.troops < 800) {
        this.armies.delete(a.id);
        this.log(`💀 ${this.civs[a.civ].name} ordusu ${W.P[a.prov].name} muharebesinde yok edildi.`, [a.civ]);
      }
    }
  }
  sieges() {
    const prog = new Map();
    for (const a of this.armies.values()) {
      if (!a.sieging || a.battle) continue;
      const p = a.prov, c = this.ctrl[p];
      const hostile = this.atWar(a.civ, c);
      const liberate = !hostile && this.owner[p] !== c && this.friendly(a.civ, this.owner[p]);
      if (!hostile && !liberate) { a.sieging = false; continue; }
      prog.set(p, (prog.get(p) || 0) + Math.min(1, a.troops / (this.pop[p] / 60 + 8000)) / (1.6 + this.fort[p] * 1.4 + this.coreBonus(p)));
    }
    for (const [p, v] of prog) {
      this.siege[p] += v;
      if (this.siege[p] < 1) continue;
      const strongest = [...this.armies.values()].filter(a => a.prov === p && a.sieging).sort((x, y) => y.troops - x.troops)[0];
      if (!strongest) continue;
      const civ = strongest.civ, old = this.ctrl[p];
      const newCtrl = this.friendly(civ, this.owner[p]) ? this.owner[p] : civ;
      this.setCtrl(p, newCtrl);
      if (this.fort[p] > 0 && newCtrl !== this.owner[p]) { this.fort[p]--; this.dirtyProv.add(p); }
      for (const a of this.armies.values()) if (a.prov === p) a.sieging = false;
      // başkent düştü: ülkenin kalan illerinin yarısı işgal edilir
      const ownerCiv = this.civs[this.owner[p]];
      if (newCtrl !== this.owner[p] && ownerCiv.cap === p && this.atWar(newCtrl, ownerCiv.id)) {
        const rest = [];
        for (let q = 0; q < W.NP; q++) if (this.owner[q] === ownerCiv.id && this.ctrl[q] === ownerCiv.id && W.P[q].country === W.P[p].country) rest.push(q);
        const P0 = W.P[p];
        rest.sort((x, y) => Math.hypot(W.P[x].ax - P0.ax, W.P[x].ay - P0.ay) - Math.hypot(W.P[y].ax - P0.ax, W.P[y].ay - P0.ay));
        const half = Math.min(40, Math.ceil(rest.length / 2));
        for (let i = 0; i < half; i++) this.setCtrl(rest[i], newCtrl);
        this.log(`🏛 ${ownerCiv.name} başkenti ${W.P[p].name} düştü! ${this.civs[newCtrl].name} ülkenin yarısını işgal etti (${half + 1} il).`);
      } else if (old !== newCtrl) {
        this.log(`🚩 ${this.civs[civ].name}, ${W.P[p].name} ilini ${newCtrl === civ ? 'işgal etti' : 'kurtardı'}.`, [civ, old]);
      }
    }
  }
  economy() {
    const NP = W.NP;
    for (const c of this.civs) { c.income = 0; c.rp = 0.2; c.mpGain = 0; c.upkeep = 0; }
    for (let p = 0; p < NP; p++) {
      const o = this.owner[p], c = this.civs[o];
      this.pop[p] *= 1 + 0.00004 + this.dev[p] * 0.000004;
      if (this.ctrl[p] !== o) continue; // işgal altındaki il gelir vermez
      c.income += this.pop[p] / 1e6 * (0.25 + 0.08 * this.dev[p]) + this.factory[p] * 2;
      c.rp += this.dev[p] / 60 + this.univ[p];
      c.mpGain += this.pop[p] * 0.00003 * (1 + this.barracks[p] * 0.25);
    }
    for (const a of this.armies.values()) this.civs[a.civ].upkeep += a.troops / 1000 * UPKEEP;
    for (const c of this.civs) {
      if (!c.alive) continue;
      c.income *= 1 + this.techEff(c, 'inc');
      c.upkeep += c.air * 0.6;
      c.net = c.income - c.upkeep;
      c.gold += c.net;
      if (c.gold < 0) { // borç: ordular erir
        c.gold = 0;
        for (const a of this.armies.values()) if (a.civ === c.id) a.troops *= 0.99;
      }
      c.manpower = Math.min(c.popTotal * 0.03, c.manpower + c.mpGain * (1 + this.techEff(c, 'mp')));
      if (c.research) {
        c.research.progress += c.rp;
        const t = TECH[c.research.id];
        if (c.research.progress >= t.cost) {
          c.techs.add(t.id); c.research = null;
          this.log(`🔬 ${c.name} "${t.name}" teknolojisini geliştirdi.`, [c.id]);
        }
      }
    }
  }
  checkDeaths() {
    for (const c of this.civs) {
      if (!c.alive) continue;
      let owned = 0, ctrlOwn = 0;
      for (let p = 0; p < W.NP; p++) if (this.owner[p] === c.id) { owned++; if (this.ctrl[p] === c.id) ctrlOwn++; }
      if (owned > 0 && ctrlOwn > 0) continue;
      // tamamen işgal edildi: iller işgalcilere geçer
      for (let p = 0; p < W.NP; p++) if (this.owner[p] === c.id) this.setOwner(p, this.ctrl[p] !== c.id ? this.ctrl[p] : this.owner[p]);
      c.alive = false;
      for (const a of [...this.armies.values()]) if (a.civ === c.id) this.armies.delete(a.id);
      for (const e of [...c.enemies.keys()]) this.leaveWarPair(c.id, e);
      for (const al of c.allies) this.civs[al].allies.delete(c.id);
      c.allies.clear();
      this.log(`☠ ${c.name} haritadan silindi!`);
      if (this.hooks.civDied) this.hooks.civDied(c.id);
    }
  }

  // ---------------- yapay zekâ ----------------
  ai() {
    for (const c of this.civs) {
      if (!c.alive || c.human != null) continue;
      if ((this.day + c.aiTick) % 4 !== 0) continue;
      this.aiEconomy(c);
      this.aiMilitary(c);
      this.aiDiplomacy(c);
    }
    // insan oyuncuların boştaki birleşik ordularını değil, yalnız yapay zekâyı yönetiriz
  }
  ownedProvs(c) { const r = []; for (let p = 0; p < W.NP; p++) if (this.owner[p] === c.id && this.ctrl[p] === c.id) r.push(p); return r; }
  aiEconomy(c) {
    if (!c.research) {
      const avail = TECHS.filter(t => !c.techs.has(t.id) && t.req.every(r => c.techs.has(r))).sort((a, b) => a.cost - b.cost);
      if (avail.length) c.research = { id: avail[0].id, progress: 0 };
    }
    const atWar = c.enemies.size > 0;
    const reserve = atWar ? 150 : 80;
    const owned = this.ownedProvs(c); if (!owned.length) return;
    const rich = owned.sort((a, b) => this.pop[b] - this.pop[a]).slice(0, 8);
    for (let k = 0; k < 4 && c.gold > reserve + 60; k++) this.aiSpend(c, rich, reserve, atWar);
  }
  aiSpend(c, rich, reserve, atWar) {
    const r = Math.random();
    if (r < 0.35) { const p = rich.find(p => this.factory[p] < BUILD.factory.max); if (p != null && c.gold - this.buildCost('factory', p) > reserve) this.cmdBuild(c.id, p, 'factory'); }
    else if (r < 0.6) { const p = rich.find(p => this.dev[p] < 10); if (p != null && c.gold - this.investCost(p) > reserve) this.cmdInvest(c.id, p); }
    else if (r < 0.7 && atWar && this.fort[c.cap] < 4) { if (c.gold - this.buildCost('fort', c.cap) > reserve) this.cmdBuild(c.id, c.cap, 'fort'); }
    else if (r < 0.78 && c.techs.has('ucak') && c.air < Math.max(2, c.popTotal / 2e7)) this.cmdAirBuild(c.id);
    else if (r < 0.85) { const p = rich.find(p => this.univ[p] < 1); if (p != null && c.gold - this.buildCost('univ', p) > reserve) this.cmdBuild(c.id, p, 'univ'); }
  }
  aiMilitary(c) {
    const mine = [...this.armies.values()].filter(a => a.civ === c.id);
    const atWar = c.enemies.size > 0;
    const target = c.popTotal * (atWar ? 0.008 : 0.004);
    if (c.troops < target && c.gold > 40 && c.manpower > 2000) {
      const amt = Math.min(c.manpower * 0.5, (c.gold - 20) / RECRUIT_COST * 1000, Math.max(2000, target - c.troops));
      // savaşta cepheye en yakın kendi ili, yoksa başkent
      let where = c.cap;
      if (atWar) {
        const front = this.ownedProvs(c).filter(p => W.P[p].adj.some(q => this.atWar(c.id, this.ctrl[q])));
        if (front.length) where = pick(front);
      }
      if (where >= 0 && this.ctrl[where] === c.id) this.cmdRecruit(c.id, where, amt);
    }
    // aynı ildeki boşta orduları birleştir
    const idle = mine.filter(a => !a.path.length && !a.battle && !a.sieging && this.armies.has(a.id));
    const seen = new Map();
    for (const a of idle) { const o = seen.get(a.prov); if (o && this.armies.has(o.id)) { o.troops += a.troops; this.armies.delete(a.id); } else seen.set(a.prov, a); }
    const armies = [...this.armies.values()].filter(a => a.civ === c.id);
    if (!atWar) {
      // barışta: orduları sınırlara yay
      for (const a of armies) if (!a.path.length && Math.random() < 0.1) {
        const border = this.ownedProvs(c).filter(p => W.P[p].adj.some(q => this.owner[q] !== c.id && c.rel[this.owner[q]] < 20));
        if (border.length) this.cmdMove(c.id, [a.id], pick(border));
      }
      return;
    }
    // savaşta: hava saldırısı
    if (c.air > 0 && c.airCd === 0) {
      const tgt = [...this.armies.values()].filter(e => this.atWar(c.id, e.civ) && this.owner[e.prov] === c.id).sort((x, y) => y.troops - x.troops)[0];
      if (tgt) this.cmdAirStrike(c.id, tgt.prov);
    }
    // ordular: yakındaki zayıf düşman ilini hedefle; başkent tehlikedeyse savun
    const enemyNear = (p) => { let s = 0; for (const e of this.armies.values()) if (this.atWar(c.id, e.civ) && (e.prov === p || W.P[p].adj.includes(e.prov))) s += e.troops; return s; };
    const capThreat = c.cap >= 0 ? enemyNear(c.cap) : 0;
    const sorted = armies.filter(a => !a.battle && !a.sieging).sort((x, y) => y.troops - x.troops);
    let capDefended = armies.some(a => a.prov === c.cap);
    for (const a of sorted) {
      if (a.path.length && Math.random() < 0.7) continue;
      if (capThreat > 0 && !capDefended && a.troops > capThreat * 0.5) { this.cmdMove(c.id, [a.id], c.cap); capDefended = true; continue; }
      const t = this.aiTarget(c, a);
      if (t != null) this.cmdMove(c.id, [a.id], t);
    }
  }
  aiTarget(c, a) {
    // BFS ile en yakın uygun hedef
    const seen = new Set([a.prov]); let frontier = [a.prov];
    const enemyAt = new Map();
    for (const e of this.armies.values()) if (this.atWar(c.id, e.civ)) enemyAt.set(e.prov, (enemyAt.get(e.prov) || 0) + e.troops);
    for (let depth = 0; depth < 14 && frontier.length; depth++) {
      const next = [];
      const cands = [];
      for (const p of frontier) for (const n of W.P[p].adj.concat(W.P[p].sea)) {
        if (seen.has(n)) continue; seen.add(n);
        if (!this.passable(c.id, n)) continue;
        next.push(n);
        const hostileCtrl = this.atWar(c.id, this.ctrl[n]);
        const liberate = this.owner[n] === c.id && this.ctrl[n] !== c.id;
        const foe = enemyAt.get(n) || 0;
        if ((hostileCtrl || liberate) && foe < a.troops * 1.2) cands.push([n, foe, this.provValue(n)]);
        else if (foe && foe < a.troops * 0.8) cands.push([n, foe, 5]);
      }
      if (cands.length) { cands.sort((x, y) => y[2] - x[2]); return cands[0][0]; }
      frontier = next;
    }
    return null;
  }
  aiDiplomacy(c) {
    const strengthOf = id => { const x = this.civs[id]; let s = x.troops; for (const al of x.allies) s += this.civs[al].troops * 0.5; return s + 1; };
    // savaştaysa barış düşün
    for (const [e, wid] of c.enemies) {
      const war = this.wars.get(wid); if (!war) continue;
      const days = this.day - war.start;
      if (days < 40 || Math.random() > 0.25) continue;
      const sc = this.warScore(c.id, e);
      const E = this.civs[e];
      if (sc <= -30) {
        // kaybediyor: işgal edilen illerini vererek barış iste
        const give = []; for (let p = 0; p < W.NP; p++) if (this.owner[p] === c.id && this.ctrl[p] === e) give.push(p);
        this.diplo(c.id, e, 'peace', { give: give.slice(0, 60) });
      } else if (sc >= 25) {
        const take = []; for (let p = 0; p < W.NP; p++) if (this.owner[p] === e && this.ctrl[p] === c.id) take.push(p);
        if (E.human == null) this.diplo(c.id, e, 'peace', { take });
        else if (Math.random() < 0.3) this.diplo(c.id, e, 'peace', { take });
      } else if (days > 200 && Math.random() < 0.3) this.diplo(c.id, e, 'peace', {});
    }
    // ittifak kur
    if (Math.random() < 0.05) {
      const cand = this.civs.filter(o => o.alive && o.id !== c.id && o.human == null && !c.allies.has(o.id) && c.rel[o.id] > 60 && o.rel[c.id] > 60);
      if (cand.length) { const o = pick(cand); this.acceptOffer({ from: c.id, to: o.id, action: 'alliance', take: [], give: [] }); }
    }
    // ilişki geliştir
    if (Math.random() < 0.1 && c.gold > 200) {
      const nb = new Set(); for (const p of this.ownedProvs(c)) for (const q of W.P[p].adj) if (this.owner[q] !== c.id) nb.add(this.owner[q]);
      const strong = [...nb].sort((x, y) => strengthOf(y) - strengthOf(x))[0];
      if (strong != null && !this.atWar(c.id, strong)) this.diplo(c.id, strong, 'improve');
    }
    // sınır gerginlikleri (rastgele olaylar)
    if (Math.random() < 0.03) {
      const nbs = new Set(); for (const p of this.ownedProvs(c)) for (const q of W.P[p].adj) if (this.owner[q] !== c.id) nbs.add(this.owner[q]);
      const o = pick([...nbs]); if (o != null && !c.allies.has(o)) { c.rel[o] -= 15; this.civs[o].rel[c.id] -= 10; }
    }
    // savaş ilanı
    if (c.enemies.size || this.day < 45) return;
    const aggr = this.scenarioId === '2026' ? 0.015 : 0.04;
    if (Math.random() > aggr) return;
    const nb = new Set(); for (let p = 0; p < W.NP; p++) if (this.owner[p] === c.id) for (const q of W.P[p].adj) if (this.owner[q] !== c.id) nb.add(this.owner[q]);
    const my = strengthOf(c.id);
    const targets = [...nb].filter(o => this.civs[o].alive && !c.allies.has(o) && !c.pacts.has(o) && !this.civs[o].allies.has(c.id) && c.rel[o] < (this.civs[o].enemies.size ? 10 : -25) && my > strengthOf(o) * 1.6);
    if (!targets.length) return;
    const t = targets.sort((x, y) => strengthOf(x) - strengthOf(y))[0];
    this.diplo(c.id, t, 'war');
  }

  // ---------------- ağ görünümleri ----------------
  staticView() {
    return {
      scenario: this.scenarioId, scenarioName: this.sc.name,
      civs: this.civs.map(c => ({ id: c.id, key: c.key, name: c.name, iso: c.iso, color: c.color, cap: c.cap })),
      techs: TECHS, build: BUILD, airCost: AIR_COST, recruitCost: RECRUIT_COST, speeds: SPEED_NAMES,
    };
  }
  provView() {
    return { owner: Array.from(this.owner), ctrl: Array.from(this.ctrl), pop: Array.from(this.pop, v => Math.round(v / 1000)), dev: Array.from(this.dev),
      fort: Array.from(this.fort), factory: Array.from(this.factory), barracks: Array.from(this.barracks), univ: Array.from(this.univ) };
  }
  armyList() { return [...this.armies.values()].map(a => [a.id, a.civ, Math.round(a.x * 100) / 100, Math.round(a.y * 100) / 100, Math.round(a.troops), a.path.length ? a.path[a.path.length - 1] : -1, a.battle ? 1 : a.sieging ? 2 : 0, a.prov]); }
  civPrivate(id) {
    const c = this.civs[id];
    return { gold: Math.floor(c.gold), income: Math.round((c.income || 0) * 10) / 10, upkeep: Math.round((c.upkeep || 0) * 10) / 10, manpower: Math.floor(c.manpower),
      troops: Math.round(c.troops), pop: Math.round(c.popTotal), rp: Math.round((c.rp || 0) * 10) / 10, techs: [...c.techs], research: c.research, air: c.air, airCd: c.airCd,
      rel: Array.from(c.rel, v => Math.round(v)), relTo: this.civs.map(o => Math.round(o.rel[id])), allies: [...c.allies], pacts: [...c.pacts.entries()].map(([k, v]) => [k, v - this.day]),
      enemies: [...c.enemies.keys()].map(e => [e, this.warScore(id, e), this.stars(id, e), this.stars(e, id)]), alive: c.alive };
  }
  civSummary() { return this.civs.map(c => [c.alive ? 1 : 0, c.provs, Math.round(c.troops), Math.round(c.popTotal / 1e5) / 10, c.human, [...c.allies]]); }
  warList() { return [...this.wars.values()].map(w => [w.id, [...w.att], [...w.def], w.start]); }
}

module.exports = { Game, prepareWorld, MS_PER_DAY, SPEED_NAMES };
