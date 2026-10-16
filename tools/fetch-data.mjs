// Natural Earth il verisini (kamu malı) indirir; zaten varsa atlar.
import { existsSync, writeFileSync } from 'node:fs';
const out = new URL('./ne_10m_admin_1.geojson', import.meta.url);
if (existsSync(out)) { console.log('il verisi zaten var'); process.exit(0); }
const url = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson';
const res = await fetch(url);
if (!res.ok) throw new Error('indirme başarısız: ' + res.status);
writeFileSync(out, Buffer.from(await res.arrayBuffer()));
console.log('il verisi indirildi');
