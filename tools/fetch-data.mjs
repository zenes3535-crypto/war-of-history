// Natural Earth verilerini (kamu malı) indirir; zaten varsa atlar.
import { existsSync, writeFileSync } from 'node:fs';
const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const files = [
  ['ne_10m_admin_1.geojson', 'ne_10m_admin_1_states_provinces.geojson'],
  ['ne_10m_populated_places.geojson', 'ne_10m_populated_places_simple.geojson'],
];
for (const [local, remote] of files) {
  const out = new URL('./' + local, import.meta.url);
  if (existsSync(out)) { console.log(local, 'zaten var'); continue; }
  const res = await fetch(BASE + remote);
  if (!res.ok) throw new Error('indirme başarısız: ' + remote + ' ' + res.status);
  writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  console.log(local, 'indirildi');
}
