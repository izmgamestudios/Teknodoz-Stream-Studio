# Sponsor, ortaklık ve yatırım stratejisi — Teknodoz Studio

> **Okuma notu.** Bu bir _strateji ve operasyon planıdır_, pazar araştırması değildir. İçinde uydurulmuş sponsor,
> müşteri ya da pazar rakamı yoktur. **"Hipotez"** etiketli her şey ilk 10 görüşmede test edilir. Hukuki ve mali
> konular yalnızca farkındalık içindir; uygulamadan önce avukat/mali müşavir doğrulaması şarttır.

## 0. Özet

|                              |                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Ürün**                     | Ücretsiz, açık kaynak (MIT), tarayıcıda çalışan yayın stüdyosu: prompter, prototip yayını, P2P konuk, moderasyonlu sohbet, şablonlar, RTMPS ile canlı yayın. Sunucusuz; isteğe bağlı sunucu parçaları.       |
| **Strateji**                 | _Önce kitle ve kanıt, sonra para._ 90 günde: (1) görünür bir topluluk + haftalık yayın ritmi, (2) 2–3 **kurucu** sponsor/ortak (vitrin karşılığı indirimli), (3) hibe ve yatırım için **kanıt paketi**.      |
| **Para sırası**              | bireysel destek (kolay) → kurumsal sponsorluk/ortaklık → hibe/teşvik → danışmanlık/özel kurulum → (talep gelirse) barındırılan hizmet ve premium şablonlar → **yatırım en son**, kanıtla.                    |
| **Farklılaştırıcı döngü**    | Ürünün kendisi sponsor değeri üretir: **Sponsor katmanı + ekranda kalma raporu** (Stüdyo → Sponsorlar). Kullanıcılar kendi sponsorlarını bulup raporlar; biz de aynı aracı kendi sponsorlarımıza kullanırız. |
| **Bilinçli yapmadıklarımız** | CRM, faturalama, üyelik veritabanı, ödeme kodu. Ödemeyi platformlar (GitHub Sponsors/Open Collective) ya da fatura+banka halleder. Veri tabanı yok ilkesi korunur.                                           |

## 1. Konumlandırma

**Kime ne:**

| Segment                   | Neden Teknodoz                                           | Sponsor için değeri                  |
| ------------------------- | -------------------------------------------------------- | ------------------------------------ |
| İçerik üretici / yayıncı  | Kurulumsuz stüdyo, şablonlar, RTMPS, moderasyonlu sohbet | Küçük ama nişe odaklı kitle          |
| Eğitmen / kurs            | Ekran + kamera, ders şablonu, bölüm işaretleri           | Eğitim/araç markaları                |
| Geliştirici / ürün demosu | Mobil + masaüstü prototip yayını, cihaz çerçevesi        | Dev-tools, barındırma, bulut         |
| Küçük medya / haber       | Haber çerçevesi, alt bant, kayan yazı                    | Yerel markalar, etkinlik sponsorları |
| Etkinlik / webinar        | Chat-only katılım, moderasyon, QR ile giriş              | Etkinlik sponsorları                 |

**Dürüst zayıflıklar** (sponsora/yatırımcıya saklanmaz): tek geliştirici; gerçek cihaz (Safari, Firefox, telefonlar) ve gerçek
platforma RTMPS testi henüz yapılmadı; OBS/StreamYard gibi olgun rakipler var; kullanıcı sayısı ölçülmüyor (bkz. §7.2).

## 2. Paydaşlar: kim ne ister, biz ne veririz

| Paydaş          | Ne ister                                     | Bugün verebildiğimiz (kodda var)                                                                                    | İstemediğimiz                                                        |
| --------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Sponsor**     | Hedef kitleye görünürlük, hesap verebilirlik | Sponsor katmanı (dönüşümlü logo, seviyeye göre süre), ekranda kalma raporu (CSV), destekçi duvarı, duyuru kanalları | Kod/yol haritası üzerinde karar hakkı, tam münhasırlık               |
| **İş ortağı**   | Dağıtım, entegrasyon, ortak etkinlik         | Ortak yayın, ortak şablon, belge ve entegrasyon desteği                                                             | Kapalı kaynak bağımlılığı                                            |
| **İş birlikçi** | Eğitmen/üretici: kitle ve araç               | Ortak yayın, şablon üretimi, vitrin                                                                                 | Telif karmaşası (içerik lisansı açık olmalı)                         |
| **Yatırımcı**   | Büyüme, sahiplik, çıkış yolu                 | Açık kaynak ürün, mimari ve güvenlik belgeleri, 90 günlük kanıt planı                                               | Erken değerleme baskısı, ilkelerden (gizlilik, veritabanı yok) taviz |
| **Hibe/teşvik** | Kamu yararı, yenilikçilik, açık kaynak       | Lisans, gizlilik modeli, belgeler                                                                                   | Rapor yükü > hibe tutarı                                             |
| **Platformlar** | Kural uyumu                                  | RTMPS/akış anahtarı modeli, "paylaşım penceresi" (sessiz otomatik paylaşım yok)                                     | –                                                                    |

## 3. Gelir ve destek seçenekleri

| #   | Seçenek                                                                                          | Artı                                  | Eksi                                                      | Karar                                             |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------------------- | --------------------------------------------------------- | ------------------------------------------------- |
| 1   | Bireysel destek (GitHub Sponsors, Open Collective, Ko-fi/Patreon)                                | 15 dk kurulum, ödeme/vergi platformda | Düşük tutar                                               | **Sprint 0**                                      |
| 2   | Kurumsal sponsorluk (paketler)                                                                   | Tekrarlayan gelir + vitrin            | Satış emeği                                               | **Sprint 1–3**                                    |
| 3   | Hibe / teşvik: AB'nin açık kaynak fonları (örn. NLnet/NGI), TÜBİTAK BiGG, KOSGEB gibi programlar | Seyreltmeyen para                     | Başvuru yükü, uzun süre                                   | **Araştır + 1 başvuru**; güncel çağrıları doğrula |
| 4   | Danışmanlık / özel kurulum (kurumsal yayın stüdyosu, şablon)                                     | Hızlı nakit                           | Zaman çalar                                               | Kısa vadeli köprü                                 |
| 5   | Barındırılan hizmet (yönetilen yayın köprüsü/röle)                                               | Ölçeklenir                            | Sunucu maliyeti, destek yükü, açık kaynak ilkesiyle denge | **Yalnızca talep kanıtlanırsa**                   |
| 6   | Premium markalı şablon paketleri                                                                 | Düşük maliyet                         | Satın alma niyeti belirsiz                                | Hipotez, deneme                                   |
| 7   | Kurs / eğitim içeriği                                                                            | Uzun vadeli                           | Üretim maliyeti                                           | Sonra                                             |

**İtirazım (Agile/MVP):** abonelik, faturalama, sponsor CRM'i kodlamayın. İlk 5 sponsor tek sayfalık sözleşme + banka
havalesi/fatura ile yönetilir; ölçmeden sistem kurmak teknik borçtur.

## 4. Paketler ve fiyat hipotezi

Uygulamadaki taslak paketler `src/studio/community/supporters.ts` içindedir (yalnızca bugün sunabildiğimiz şeyleri vaat eder).

| Paket       | Ne verir (özet)                                                        | Fiyat **hipotezi** (doğrulanmadı)                     |
| ----------- | ---------------------------------------------------------------------- | ----------------------------------------------------- |
| Destekçi    | Duvarda isim, sürüm notunda teşekkür                                   | bireysel: aylık düşük, kullanıcı belirler             |
| Gümüş       | + logo, dönüşümlü sponsor katmanı, rapor                               | aylık düşük üç haneli (USD/EUR)                       |
| Altın       | + ×2 süre, 10 dk ortak bölüm, teşekkür gönderisi, ortak şablon         | aylık orta üç haneli                                  |
| Ana sponsor | "Sunan: …", ×3 süre, ortak seri, yol haritası girdisi, çeyreklik rapor | aylık yüksek üç/düşük dört haneli veya yıllık anlaşma |

Fiyat çapaları: sponsorun **alternatifi** (küçük bir markanın aylık influencer/etkinlik bütçesi), erişilen _nişin_ kalitesi, sağlanan
**rapor edilebilirlik**. Raporda yalnızca **ekranda kalma süresi** vardır; izleyici sayısı platform analitiğinden eklenir.

**Kurucu 10 (Founding 10).** İlk 10 sponsor/ortak için sınırlı kontenjan: 12 ay sabit indirimli fiyat + duvarda "Kurucu" etiketi + ilk
vaka çalışması. Kıtlık hem karar hızını hem hikâyeyi (sosyal kanıt) artırır. İndirim oranı pilotlarda test edilir (ör. %30–50 hipotezi).

## 5. Aday listesi ve kanallar

**Aday türleri** (şirket adı uydurmuyoruz; liste sizin araştırmanızla dolar): barındırma/VPS sağlayıcıları; mikrofon, kamera,
aydınlatma ve capture donanımı markaları; yayın/creator araçları (entegrasyon ortağı); eğitim platformları ve bootcamp'ler;
yazılım ajansları; teknoparklar ve kuluçka merkezleri; üniversite kulüpleri ve belediye/teknoloji etkinlikleri; dev-tools SaaS'ları.

**Puanlama (her aday 0–5):** kitle uyumu · ulaşılabilirlik (tanıdık/ortak bağlantı) · bütçe sinyali (sponsorluk yapmış mı, ekip büyüklüğü).
Toplamı en yüksek 20 aday ile başlayın.

**Kaynaklar:** LinkedIn araması (sayfanız açılınca), benzer açık kaynak projelerin sponsor listeleri, haftalık yayına konuk olmuş/ilgilenmiş
kişiler, etkinlik katılımcıları, topluluk üyelerinin işyerleri.

## 6. Hafif satış süreci

```
Liste (20) → ilk mesaj (TR/EN) → keşif görüşmesi (20 dk) → PİLOT (1 yayın, ücretsiz/indirimli, rapor) → teklif → tek sayfa sözleşme → rapor + çeyreklik değerlendirme
```

**Keşif soruları:** (1) Hangi kitleye ulaşmak istiyorsunuz? (2) Bugün hangi kanallara bütçe ayırıyorsunuz? (3) Başarıyı nasıl ölçüyorsunuz?
(4) Karar kimde, süreç ne kadar? (5) Daha önce sponsorluk/ortaklık yaptınız mı, ne işe yaradı? (6) Marka güvenliği/uyumluluk kuralları? (7) Hangi
formatta görünmek istersiniz (logo, ortak bölüm, ürün demosu)? (8) Pilot için ne zaman uygun?

**İlk mesaj (TR):**

> Merhaba {ad}, ben Hüseyin. Teknodoz Studio'yu geliştiriyorum: tarayıcıda çalışan ücretsiz/açık kaynak yayın stüdyosu (prompter, prototip
> yayını, moderasyonlu sohbet, RTMPS). {Kitle/konu} ile ilgilenen yayıncılara her hafta canlı demo yapıyoruz. {Marka}'nın bu kitleye ulaşmasını
> **ölçülebilir** (ekranda kalma raporu) ve düşük riskli bir **tek yayınlık pilotla** denemeyi önermek isterim. 20 dakikalık bir görüşme uygun mu?

**First message (EN):**

> Hi {name}, I'm Hüseyin, building Teknodoz Studio, a free, open-source, browser-based live-stream studio (prompter, prototype streaming,
> moderated chat, RTMPS). We run a weekly live demo for {audience}. I'd like to propose a low-risk, single-stream **pilot** for {brand} with a
> **screen-time report**. Is a 20-minute call possible?

**Sözleşme kontrol listesi (tek sayfa):** kapsam ve süre · logo/marka kullanım hakkı · "sponsorlu/iş birliği" ibaresi · kod ve yol haritası üzerinde **karar hakkı yok** ·
münhasırlık varsa yalnızca kategori ve süreli · rapor biçimi · fesih · fatura ve ödeme · kişisel veri (KVKK/GDPR).

## 7. Yatırımcı hazırlığı

### 7.1 Gerçekçi duruş

Bu aşamada hedef bir "tur" değil, **ilk kanıt**: kullanıcı/topluluk büyümesi, 2–3 ödeyen veya taahhüt eden ortak, haftalık yayın ritmi, hibe başvurusu.
Yatırımcı şunu görmek ister: problem, çözüm, neden şimdi, çekim (traction), pazar, iş modeli, ekip, istek. Ürün tarafı güçlü; **çekim verisi** zayıf, çünkü ölçmüyoruz.

### 7.2 Metrik gerilimi: karar sizde

Uygulama bilerek telemetri toplamaz (gizlilik, "sıfır veri sızıntısı"). Seçenekler:

| Seçenek                                          | Not                                                                                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A (önerilen):** telemetri yok, vekil metrikler | GitHub yıldız/fork/issue, topluluk üyeleri, haftalık yayın sayısı ve platform izlenmeleri, barındırılan örneğin çerezsiz erişim günlüğünden toplu sayım, sponsor raporları, kullanıcı hikâyeleri |
| B: isteğe bağlı, anonim, açık onaylı sayaç       | Güveni zedeleyebilir; yalnızca ilkelerle birlikte ve açık kaynak olarak                                                                                                                          |

Gizlilik güvencesi bir **pazarlama varlığıdır**; yatırımcıya "ölçmüyoruz, çünkü ürün sözü bu" diyebilmek için vekil metrikleri düzenli yayınlayın.

### 7.3 Sunum iskeleti (10 slayt)

1 Problem · 2 Çözüm (30 sn demo videosu) · 3 Neden şimdi (tarayıcı API'leri: WebRTC, WebCodecs/MediaRecorder, QR) · 4 Ürün (şablon, sohbet, RTMPS, sponsor katmanı) ·
5 Çekim (vekil metrikler, pilotlar) · 6 İş modeli (sponsor + hizmet + hibe) · 7 Pazar/segmentler · 8 Rekabet ve fark · 9 Ekip ve yol haritası · 10 İstek ve kullanım planı.

### 7.4 Veri odası (klasör)

README + lisans, mimari ve güvenlik belgeleri (`docs/`), güvenlik modeli ve test özeti, 90 günlük plan, vekil metrik tablosu, pilot raporları (CSV), vaka çalışmaları, hukuki/şirket belgeleri.

### 7.5 Ortak ve yatırım ön hazırlıkları

MIT lisansı kodu serbest bırakır: ticari avantaj **marka, topluluk, hız, hizmet ve ortaklıklardadır**. "Teknodoz" markasını/alan adını netleştirin;
şirket yapısını (şahıs/limited) ve sahiplik tablosunu yatırım konuşmadan önce mali müşavirle düzenleyin.

## 8. Büyüme ve oyunlaştırma döngüleri

| Döngü                   | Mekanik                                                                                                    | Ölçü                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Kurucu 10**           | Sınırlı kontenjan, duvarda rozet                                                                           | doldurma hızı                          |
| **Demo Cuma**           | Haftalık yayın: sponsor katmanı, sponsor teşekkür segmenti, moderasyonlu soru-cevap, sohbetten soru seçimi | yayın sayısı, izlenme, sohbet katılımı |
| **Katkıcı seviyeleri**  | Issue → PR → bakımcı; sürüm notunda ve duvarda isim                                                        | aktif katkıcı                          |
| **Şablon yarışması**    | Topluluk şablon üretir, seçilenler yayına girer, sponsorlu ödül                                            | gönderilen şablon                      |
| **Vaka → yeni sponsor** | Pilot raporu + alıntı → LinkedIn yazısı → yeni aday                                                        | pilottan sözleşmeye oran               |
| **Kullanıcı döngüsü**   | Sponsor masası yayıncıya kendi sponsorunu bulma aracı verir ("Teknodoz ile sponsor buldum")                | kullanıcı hikâyesi sayısı              |

## 9. Hukuk, etik, güven (doğrulama gerekir)

- **Sponsorlu içerik:** ekranda ve açıklamada "Sponsorlu / İş birliği" ibaresi; reklam ve influencer işaretleme mevzuatı ile platform kuralları (ör. YouTube'un ücretli tanıtım işaretlemesi) geçerlidir.
- **Gelir/fatura:** şirket türüne göre fatura/e-belge, yurt dışı sponsorlarda KDV/stopaj konuları mali müşavirle netleştirilir.
- **Kişisel veri (KVKK/GDPR):** başvuru kiti sunucuya veri göndermez; e-posta/WhatsApp taslağını kullanıcı kendisi gönderir. Üye ve sponsor iletişim listeleri toplanıyorsa amaç, saklama ve çıkış yolu yazılı olmalı.
- **Bağımsızlık:** sponsor kod/yol haritası üzerinde karar hakkı almaz; çıkar çatışması varsa açıklanır; münhasırlık dar ve süreli.
- **Yatırım toplama:** halka açık "yatırım çağrısı" veya kitlesel fonlama düzenlemeye (ör. SPK) tabi olabilir; bu konuda avukata danışmadan kamuya çağrı yapmayın.
- **Güvenlik:** stüdyoda yüklenen sponsor logoları yalnızca raster resimdir (SVG kabul edilmez); duvardaki logolar geliştiricinin `public/sponsors/` altına koyduğu dosyalardır ve `<img>` ile gösterilir (betik çalışmaz); duvar bağlantıları `noopener noreferrer sponsored`; başvuru kiti metinlerinden başlık/kontrol karakteri temizlenir.

## 10. 90 günlük sprint planı

| Sprint              | Hafta | İş                                                                                                                                                                 | Çıktı / ölçü                                                                 |
| ------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| **0 Temel**         | 1–2   | 2–3 kanal aç ([`COMMUNITY.md`](COMMUNITY.md)) + `links.ts`; GitHub Sponsors/Open Collective profili; 1 sayfalık sponsor özeti; ilk haftalık yayın; 20 aday listesi | kanallar açık · 1 yayın · liste hazır                                        |
| **1 Keşif**         | 3–4   | 10 ilk mesaj; ≥3 keşif görüşmesi; hibe çağrılarını araştır, 1 taslak                                                                                               | yanıt oranı (hipotez: ≥%20) · 3 görüşme · 1 taslak                           |
| **2 Pilot**         | 5–8   | 2 kurucu sponsor/ortakla 4 haftalık pilot; sponsor katmanlı yayınlar; rapor + alıntı                                                                               | 2 pilot · 4 yayın · 2 rapor                                                  |
| **3 Fiyat & kanıt** | 9–12  | 3 teklif (fiyat testi); vaka çalışması; yatırım özeti v1 + veri odası; 1 hibe başvurusu                                                                            | ≥1 ücretli/taahhütlü anlaşma **veya** net fiyat itirazı öğrenimi · 1 başvuru |

**Ritim:** haftada ~4 saat satış/iletişim, 1 yayın, 1 içerik. **Sonlandırma kriteri:** 90. günde hiç ilgi yoksa sponsorluğu bırakıp danışmanlık/hizmete (§3-4) ağırlık verin; ürün çalışması etkilenmesin.

## 11. Satışı destekleyen küçük ürün işleri (talep gelirse)

1. Sponsor katmanında tıklanabilir **QR / kısa bağlantı** (yayında sponsor sayfası).
2. Marka renkli **ortak şablon** paketi (mevcut şablon motoruyla).
3. Yayın sonrası özet kartı (ekranda kalma + izleyici girdisi).
4. Yayın açılınca Telegram/Slack'e otomatik duyuru (bot/webhook; gizli anahtarlar sunucuda) — kanallar açıldıktan sonra.

## 12. Riskler ve itirazlarım

| Risk                   | Önlem                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Tek kişi darboğazı     | Zaman kutusu; haftalık sprint; ortak ve katkıcılarla işi paylaş                            |
| Erken fiyatlama        | Fiyat önce pilotlarda test; kurucu indirimi                                                |
| Olgunluk iddiası       | Sponsorlara dürüst durum raporu: gerçek cihaz/RTMPS testleri bitmeden "üretime hazır" deme |
| Telemetri ikilemi      | §7.2: vekil metrikler, ilke korunur                                                        |
| Sistemi erken kodlamak | CRM/fatura/ödeme kodu yazma; tablo + sözleşme yeter                                        |
| Kanal dağınıklığı      | 2–3 kanal, 90 gün sonra gözden geçir                                                       |

## Ekler

**A. Uygulamadaki karşılıkları**

| İhtiyaç                                               | Yer                                                                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Yayının sponsorlarını yönet, yayında göster, rapor al | Stüdyo → **Sponsorlar** paneli, **Sponsorlar** katmanı                                                |
| Proje sponsorları duvarı, paketler, başvuru kiti      | `/community` → _Destekçiler, ortaklar ve iş birlikçiler_ (veri: `src/studio/community/supporters.ts`) |
| Kanal bağlantıları, yayın duyurusu                    | `/community`, `/live` (Yayını duyur)                                                                  |
| Moderasyonlu soru-cevap                               | `/room` (reji), `/chat/KOD#k=…` (editör)                                                              |

**B. Duvara sponsor ekleme (sözleşme imzalandıktan sonra):** `public/sponsors/<ad>.png` (veya `.webp/.jpg/.svg`) koyun →
`PROJECT_SUPPORTERS` listesine `{ name, kind, tier, url, logo: "/sponsors/<ad>.png", since: "YYYY-AA" }` ekleyin. Geçersiz kayıtlar duvarda görünmez.
