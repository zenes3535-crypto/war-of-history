# War of History

Age of History tarzı, tarayıcıda oynanan büyük strateji oyunu. Tek oyunculu (yapay zekâya karşı) veya 8 kişiye kadar çok oyunculu.

## Özellikler
- 3 senaryo: Modern Dünya (2026), İkinci Dünya Savaşı (1939), Birinci Dünya Savaşı (1914)
- Gerçek dünya haritası, 2.792 il, 900+ şehir, başkentler yıldızla gösterilir
- Diğer bütün ülkeleri yapay zekâ yönetir: ekonomi, araştırma, ordu, savaş, barış, ittifak
- Sağ üstte işleyen takvim, 5 hız kademesi ve duraklatma
- Ekonomi: il bazında nüfus, gelir, yatırım (gelişmişlik), fabrika, kale, kışla, üniversite
- Asker toplama, orduları il il yürütme, deniz geçişleri, muharebeler, işgal
- Başkent düşerse ülkenin yarısı işgal edilir
- Teknoloji ağacı: topçu, tank, savaş ve bombardıman uçakları, radar, füze, İHA...
- Hava filosu ve hava saldırısı
- Diplomasi: ilişki geliştirme, hediye, hakaret, ittifak, saldırmazlık paktı, savaş ilanı
- Barış masası: işgal ettiğin illeri haritadan seçip iste, savaş skoru (yıldız) belirler
- Ülkelerle sohbet: oyuncularla canlı, yapay zekâ ülkeleri ilişkinize göre cevap verir
- Diplomatik harita modu (müttefik/düşman/pakt renkleri)

## Kontroller
- Sol tık: il veya ordu seç (Shift ile çoklu), çift tık: ildeki tüm ordular
- Sağ tık: seçili orduları yürüt
- Sürükle: kaydır, tekerlek: yakınlaştır
- Boşluk: duraklat/devam, 1-5: hız, A: tüm orduları seç, Esc: kapat

## Çalıştırma
    npm install
    npm run build   # Natural Earth verisini indirir, public/world.json üretir
    npm start       # http://localhost:3000

## Yayın (Render)
Build: `npm install && npm run build`, Start: `node server.js`, plan: Free.

## Veri
Harita: Natural Earth (kamu malı). Bayraklar: flagcdn.com.
