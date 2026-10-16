# War of History – çok oyunculu web strateji oyunu

Age of History'den esinlenen, tarayıcıda oynanan 2-8 kişilik oyun. Gerçek dünya haritası, 2800'den fazla il, ordular küçük toplar olarak haritada yürür.

## Bilgisayarında dene
    npm install
    npm run build
    npm start
    # http://localhost:3000

## Ücretsiz yayınlama (Render.com)
1. Bu klasörü GitHub'da yeni bir repoya yükle (node_modules hariç, .gitignore hazır).
2. render.com'a GitHub ile üye ol → New + → Web Service → reponu seç.
3. Runtime: Node, Build Command: `npm install && npm run build` (harita verisini indirip world.json üretir), Start Command: `node server.js`, Plan: Free. (render.yaml bunları zaten içeriyor.)
4. Deploy bitince `https://war-of-history-xxxx.onrender.com` adresin olur. Oda kur, linki arkadaşlara yolla.

Not: Render ücretsiz planda 15 dk kimse girmezse uyur, ilk girişte 30-60 sn geç açılır. Oyun sırasında kimse bağlıyken uyumaz.

## Kontroller
- Bölüğe tıkla = seç (Shift = çoklu), `A` = hepsini seç
- Sağ tık = seçili bölükleri oraya yürüt (sadece kara yolu)
- Kendi toprağına tıkla + `R` = yedek askerden yeni bölük kur
- `F` = bölüğü ikiye böl, `S` = durdur
- Sürükle = kaydır, tekerlek = yakınlaştır. Fareyi bir ilin üstüne getirince il adı, sahibi ve garnizonu görünür.

## Kurallar
- Her ilin bir garnizonu (savunan askeri) vardır. Bölük düşman/tarafsız bir ile girince garnizonla savaşır; garnizon biterse il tamamen ele geçer, bölük ölürse garnizon kalır.
- Bölük ilerledikçe çevresindeki toprağı (kaybetmediği yerleri) alır, sınır çizgisi onunla birlikte ilerler.
- Başkent ili düşerse ülkenin geri kalan illerinin yarısı doğrudan geçer.
- Savaşta ele geçirilen iller savaş puanı (yıldız) kazandırır. Barış teklif ederken yıldızın varsa yıldız başına 3 il talep edilir; karşı taraf kabul ederse iller geçer. Barışta iki taraf birbirine saldıramaz, 30 sn sonra tekrar savaş açılabilir.
- Her hücre yedek asker üretir; yedekten bölük kurarsın. Toplam asker = sahadaki + yedek.
- Haritanın %50'sini alan kazanır.

## Harita verisi
Natural Earth (kamu malı): ülkeler `world-atlas` paketinden, iller `ne_10m_admin_1_states_provinces`. `npm run build` il verisini indirip `public/world.json` dosyasını üretir (Render bunu otomatik yapar).
