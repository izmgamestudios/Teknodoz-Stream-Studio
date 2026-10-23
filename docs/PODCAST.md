<!-- docs/PODCAST.md -->

# Podcast modu (sesli canlı yayın odası)

Videolu stüdyo odasından ayrı, **yalnızca ses** üzerine kurulu, çok sade bir canlı yayın akışı. Mevcut oda altyapısını (kısa link/QR, bekleme havuzu, onay, P2P WebRTC) kullanır; video, kamera ve sahne kavramı yoktur.

## Koltuklar ve kim neyi görür

| Koltuk | Nasıl katılır | Ne görür / yapar | Prompter |
|---|---|---|---|
| **Yönetici / moderatör** | `/podcast` sayfasını açan kişi (admin girişi) | Odayı açar, QR + bağlantıları verir, konukları onaylar, herkesi sessize alır, kayıt başlatır | **Yönetici notu** (yalnızca kendisi görür) + **Konuk metni** (konuklara gönderir) |
| **Konuk** (konuşmacı, katılımcı) | `/r/KOD?as=guest&mode=podcast` (QR/bağlantı) | Sadece **kendi sesini kısma/açma**, seviye göstergesi, **kendisine ayrılan metin** | Yalnızca konuk metnini görür |
| **Dinleyici** | `/r/KOD?as=viewer&mode=podcast` | Sadece dinler (oynat/ses) | **Hiçbir metin görmez** |

Gizlilik sunucuda değil, **yöneticinin tarayıcısında zorlanır**: metin yalnızca `guest` rolündeki bağlantılara gönderilir; `viewer` (dinleyici) ve `remote` bağlantılarına hiçbir zaman gitmez (test kapsamında). Yönetici notu hiçbir yere gönderilmez.

## İki prompter

1. **Yönetici notu:** yönetici sayfasında, yalnızca yönetici için. `/` Prompter'da yazılan metin "Prompter'dan al" ile içe aktarılabilir.
2. **Konuk metni:** tüm konuklara aynı anda gösterilir (oynat/duraklat, hız, yazı boyutu ve konum yöneticiden eşzamanlı akar). İsterseniz bir konuğa **özel metin** verirsiniz (ör. kendi soruları); özel metin yalnızca o konuğa gider, diğerleri ortak metni görür.

Sınır: tek bir metin en fazla **20.000 karakter** (kontrol kanalı mesaj sınırı 64 KB). Konuğun ekranında metin yöneticinin hızıyla kayar, konuk kaydırma düğmesi görmez.

## Ses kalitesi (otomatik, konuk bir şey ayarlamaz)

```
mikrofon ──▶ [NVIDIA Broadcast / RTX Voice sanal mikrofonu varsa o seçilir]
          ──▶ tarayıcı yankı giderme (AI mikrofon yoksa)
          ──▶ RNNoise (açık kaynak sinir ağı: parazit, klavye, fan, uğultu silme)
          ──▶ kapı/expander (konuşma arası dış sesleri kısar)
          ──▶ EQ (bulanıklık azaltma, netlik) + kompresör + sınırlayıcı
          ──▶ WebRTC (Opus)
```

- **NVIDIA:** tarayıcılar NVIDIA RTX Voice/Broadcast SDK'sını doğrudan çağıramaz. NVIDIA Broadcast (veya RTX Voice) kuruluysa Windows'ta **"Microphone (NVIDIA Broadcast)"** adlı sanal mikrofon görünür; sayfa onu **otomatik algılayıp seçer** ve çift işlemeyi önlemek için tarayıcı gürültü bastırmasını ve kendi kapısını kapatır ("nvidia" ön ayarı). NVIDIA yoksa aynı iş **RNNoise** ile yapılır ("podcast" ön ayarı + yapay zekâ gürültü bastırma).
- "Güçlü temizlik" (gürültülü ortam): kapı eşiği yükselir, dış sesler daha çok kısılır.
- Kayıt ve yayın aynı işlenmiş sesi kullanır.

## Akış

```
Yönetici (/podcast)  ── oda aç ──▶ röle (kısa kod)      Konuk (QR/link)
   │  bekleme havuzu  ◀── katılma isteği (ses-only) ────────┘
   │  [Onayla] ─▶ yalnızca-ses WebRTC teklifi ─▶ konuk bağlanır
   │  [Yayına al] konuk sesi karışıma girer
   ├─ karışım (yönetici mikrofonu + yayındaki konuklar) ─▶ dinleyicilere (P2P, ses)
   └─ kayıt (MediaRecorder, yalnızca ses) ─▶ medya kütüphanesi ─▶ düzenle (gürültü, altyazı) ─▶ /library/podcasts
```

Dinleyiciler yöneticinin tarayıcısından P2P bağlanır (kapasite ≈ 8 eşzamanlı bağlantı: kişisel/özel dinleme). **Kitlesel canlı dinleme** için karışım, mevcut RTMP köprüsüyle (Canlı Yayın sayfası) YouTube'a ses yayını olarak verilebilir; ayrıca herkese açık kayıt sonrası sayfası `/library/podcasts/...` altında yayınlanır.

## Protokol eklemeleri (kontrol kanalı "ctl")

| Yön | Mesaj | Anlam |
|---|---|---|
| yönetici → konuk | `{type:"prompter", state}` | metin, konum, oynatma, hız, yazı boyutu |
| yönetici → konuk | `{type:"mute", muted}` | yöneticinin sessize alma isteği (konuk geri açabilir mi: hayır, yönetici açana dek kilitli) |
| konuk → yönetici | `{type:"mic", muted}` | kendi sessize alma durumu (yöneticide görünür) |

Röleye `join` isteğinde `audio: true` bayrağı eklenir; onaylanınca yalnızca ses transceiver'lı teklif üretilir (video ve kamera hiç istenmez).

## Sprint planı

| Sprint | İçerik |
|---|---|
| P1 | Bu belge |
| P2 | Protokol (prompter/mute/mic), yalnızca-ses davet, röle `audio` bayrağı, rol filtreli prompter gönderimi, testler |
| P3 ✅ | `/podcast` yönetici sayfası, konuk ve dinleyici görünümleri, ses zinciri (NVIDIA algılama + RNNoise), kayıt → kütüphane, 4 dil |
| P4 ✅ | Konuk başına mix-minus, ikinci moderatör cihazı |
| P5 ✅ | Podcast stüdyonun içinde: panel, ses görseli katmanı, podcast şablonları, video ile birlikte WAV, kütüphanede ses analizi ve podcast düzenleme, İzle & Dinle sayfasında herkese açık podcast |
| sonraki | Sunucu tarafı karışım (SFU) ile yüzlerce dinleyici, otomatik bölüm işaretleri/altyazı |

## Kullanım (P3)

1. **Yönetici:** menüden **Podcast** (`/podcast`, admin girişi) → "Podcast odasını aç". Mikrofon açılır, NVIDIA/RNNoise zinciri otomatik kurulur.
2. QR kodu / **konuk bağlantısı** konuğa, **dinleyici bağlantısı** dinleyiciye gönderilir. "Gelenleri otomatik onayla" ve "Onaylanan konuk otomatik yayına girsin" açıksa elle bir şey yapmanız gerekmez.
3. **Konuk metni** yazılır, oynatılır; konuğun ekranında hız/konum yöneticiyle eşzamanlı akar. Konuk satırındaki 📝 ile yalnızca o konuğa özel metin verilir. **Yönetici notu** yalnızca yöneticide kalır (bu tarayıcıda saklanır).
4. **Kaydı başlat** → bölüm işaretleri → **Kaydı bitir** → "Kütüphaneye gönder" (medya kütüphanesinde düzenlenir, gürültü/altyazı araçlarıyla).
5. Konuk sayfasında yalnızca **mikrofon aç/kapat**, seviye çubuğu ve kendi metni vardır; moderatör susturduğunda düğme kilitlenir. Dinleyici sayfasında yalnızca oynat/ses vardır, **metin hiç gönderilmez**.

Odalar ayrı saklanır (`podcast:` önekli yerel depolama): Podcast odası ile video stüdyo odası aynı anda açık olabilir.

Doğrulama: gerçek Chromium + sahte mikrofonla yönetici, konuk ve dinleyici oturumu uçtan uca denendi (yayına alma, dinleyicide prompter sayısı 0, konuk metni kayması, sustur/kilit, kayıt → kütüphane).

## Mix-minus (P4)

Konuk, odayı **kendi sesi olmadan** duyar: yönetici tarayıcısı her konuk için ayrı bir "dönüş" karışımı üretir (yönetici mikrofonu + kendisi dışındaki yayındaki konuklar) ve `StudioHost.setPeerProgram(peerId, stream)` ile yalnızca o konuğa gönderir. Dinleyiciler ve kayıt, herkesin karışımını alır. Susturulmuş veya bekleyen konuk kimsenin karışımında yoktur. Kulaklık yine önerilir (hoparlörden gelen ses mikrofona girebilir), ama konuk kendi gecikmeli sesini duymaz.

Doğrulama (Chromium, sahte mikrofon): tek konukta dönüş seviyesi ≈ 0 (kendini duymuyor), yönetici açınca ≈ 1, ikinci konuk gelince diğerini duyuyor, ikinci konuk kendini susturunca ≈ 0.

## İkinci moderatör cihazı (P4)

Yönetici sayfasında üçüncü bağlantı: **telefon kumandası** (`/r/KOD?as=remote`). Mevcut video stüdyosu kumandası (yeni protokol yok) podcast'e bağlandı: mikrofon aç/kapat, konuk metni oynat/hız/başa sar, kayıt başlat/bitir, bölüm işareti. Kumanda **her zaman elle onay** ister (otomatik onay yalnızca konuk ve dinleyici içindir), medyası yoktur, sahne düğmeleri boş gelir.

## Stüdyoda podcast (P5)

**Tek yer:** `/podcast` artık `/studio#podcast` adresine yönlenir. Stüdyodaki **Podcast** paneli odayı açar (QR, konuk / dinleyici / telefon kumandası bağlantıları, onaylar, konuk metni, yönetici notu). Oda açıkken podcast karışımı (yönetici mikrofonu + yayındaki konuklar) stüdyo mikserinde **"Podcast karışımı"** kanalıdır: stüdyo kaydı, canlı yayın ve WAV bu sesi içerir. Yönetici sesi karışımda zaten olduğu için stüdyo mikrofonu otomatik susturulur, oda kapanınca eski hâline döner. Yönetici konukları kulaklıktan duyar (kapatılabilir).

**Ses görseli (frekans) katmanı:** Katman ekle → *Ses görseli*. Görünüm: çubuklar, simetrik çubuklar, dalga çizgisi, halka. **Konuşanlar (otomatik)** = yönetici + yayındaki konuklar; her biri kendi şeridinde, renginde ve adıyla çizilir. İsterseniz belirli sesleri ya da genel karışımı seçersiniz. Kayıtta ve canlı yayında ekrana işlenir.

**Şablonlar (Podcast grubu):** Ses dalgası · Konuşan şeritleri · Videolu iki kişi (kamera + konuk + dalga) · Kamera + halka · Dikey podcast (9:16). Videolu podcast için "Videolu iki kişi" ile konuğu video odasından davet edin; yalnızca ses isteyenler için podcast bağlantısı yeterlidir.

**Kayıt:** Stüdyonun *Kayda başla* düğmesi videoyu (ekrandaki ses görseliyle) kaydeder ve **aynı anda** 48 kHz / 16 bit WAV de alır (Ayarlar → Çıkış → "Videoyla birlikte WAV"). İkisi birlikte iner; "Kütüphaneye gönder" ikisini de gönderir.

**Kütüphane:** Her kayıt *video* ya da *ses* olarak tutulur; **Ses analizi** (loudness LUFS, tepe, dinamik aralık, duraklamalar, konuşma oranı + öneriler), indirme paneli (ham kayıt, altyazısız, altyazılı, .srt/.vtt, WAV) ve **Podcast düzenleme** (tek tık ön ayar: ses temizleme + gürültü + sıkıştırma + −16 LUFS; "uzun sessizlikleri kısalt") vardır.

**Herkese açık:** Yayınlanan (public) podcast / video / hikâye içerikleri **İzle & Dinle** sayfasında da görünür; kategoriler İlçede Pembe Haber konularıyla aynıdır.
