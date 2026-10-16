// Teknoloji ağacı. eff: atk (saldırı), def (savunma), inc (gelir), mp (insan gücü), spd (hız), sea (deniz geçişi tam hız), air (uçak açılır), bomb (bombardıman x2), airdef (hava savunması)
const TECHS = [
  { id: 'tufek', name: 'Tüfekli Piyade', cost: 40, req: [], eff: { atk: 0.10 }, desc: '+%10 saldırı' },
  { id: 'siper', name: 'Siper Savaşı', cost: 60, req: [], eff: { def: 0.15 }, desc: '+%15 savunma' },
  { id: 'sanayi', name: 'Sanayi Devrimi', cost: 70, req: [], eff: { inc: 0.15 }, desc: '+%15 gelir' },
  { id: 'seferberlik', name: 'Seferberlik', cost: 60, req: [], eff: { mp: 0.5 }, desc: '+%50 insan gücü artışı' },
  { id: 'topcu', name: 'Ağır Topçu', cost: 110, req: ['tufek'], eff: { atk: 0.15 }, desc: '+%15 saldırı' },
  { id: 'demiryolu', name: 'Demiryolları', cost: 100, req: ['sanayi'], eff: { spd: 0.3 }, desc: '+%30 ordu hızı' },
  { id: 'deniz', name: 'Deniz Çıkarması', cost: 90, req: [], eff: { sea: 1 }, desc: 'Denizden geçiş tam hızda' },
  { id: 'tank', name: 'Tank Tümenleri', cost: 200, req: ['topcu', 'demiryolu'], eff: { atk: 0.25, spd: 0.2 }, desc: '+%25 saldırı, +%20 hız' },
  { id: 'ucak', name: 'Savaş Uçakları', cost: 180, req: ['topcu'], eff: { air: 1, atk: 0.05 }, desc: 'Hava filosu kurabilir, hava saldırısı' },
  { id: 'bombardiman', name: 'Bombardıman Uçakları', cost: 260, req: ['ucak'], eff: { bomb: 1 }, desc: 'Hava saldırısı hasarı x2' },
  { id: 'ekonomi', name: 'Modern Ekonomi', cost: 220, req: ['sanayi'], eff: { inc: 0.25 }, desc: '+%25 gelir' },
  { id: 'tahkimat', name: 'Modern Tahkimat', cost: 180, req: ['siper'], eff: { def: 0.25 }, desc: '+%25 savunma' },
  { id: 'radar', name: 'Radar ve Hava Savunması', cost: 240, req: ['ucak'], eff: { def: 0.1, airdef: 1 }, desc: 'Düşman hava saldırıları %40 zayıf' },
  { id: 'roket', name: 'Füze Teknolojisi', cost: 400, req: ['bombardiman', 'ekonomi'], eff: { atk: 0.2 }, desc: '+%20 saldırı' },
  { id: 'siber', name: 'Siber Savaş', cost: 350, req: ['radar'], eff: { def: 0.1, inc: 0.1 }, desc: '+%10 savunma, +%10 gelir' },
  { id: 'insansiz', name: 'İnsansız Hava Araçları', cost: 450, req: ['roket'], eff: { atk: 0.15, bomb: 1 }, desc: '+%15 saldırı' },
  { id: 'yapayzeka', name: 'Yapay Zekâ Ekonomisi', cost: 550, req: ['siber'], eff: { inc: 0.25 }, desc: '+%25 gelir' },
];
const START_TECHS = {
  '1914': ['tufek', 'siper', 'sanayi'],
  '1939': ['tufek', 'siper', 'sanayi', 'seferberlik', 'topcu', 'demiryolu', 'deniz', 'ucak'],
  '2026': ['tufek', 'siper', 'sanayi', 'seferberlik', 'topcu', 'demiryolu', 'deniz', 'tank', 'ucak', 'bombardiman', 'ekonomi', 'tahkimat', 'radar'],
};
for (const t of TECHS) t.cost *= 3;
const TECH = Object.fromEntries(TECHS.map(t => [t.id, t]));
module.exports = { TECHS, TECH, START_TECHS };
