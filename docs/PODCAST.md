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
| sonraki | İkinci moderatör cihazı, sunucu tarafı karışım (SFU) ile yüzlerce dinleyici, otomatik bölüm işaretleri/altyazı |

## Kullanım (P3)

1. **Yönetici:** menüden **Podcast** (`/podcast`, admin girişi) → "Podcast odasını aç". Mikrofon açılır, NVIDIA/RNNoise zinciri otomatik kurulur.
2. QR kodu / **konuk bağlantısı** konuğa, **dinleyici bağlantısı** dinleyiciye gönderilir. "Gelenleri otomatik onayla" ve "Onaylanan konuk otomatik yayına girsin" açıksa elle bir şey yapmanız gerekmez.
3. **Konuk metni** yazılır, oynatılır; konuğun ekranında hız/konum yöneticiyle eşzamanlı akar. Konuk satırındaki 📝 ile yalnızca o konuğa özel metin verilir. **Yönetici notu** yalnızca yöneticide kalır (bu tarayıcıda saklanır).
4. **Kaydı başlat** → bölüm işaretleri → **Kaydı bitir** → "Kütüphaneye gönder" (medya kütüphanesinde düzenlenir, gürültü/altyazı araçlarıyla).
5. Konuk sayfasında yalnızca **mikrofon aç/kapat**, seviye çubuğu ve kendi metni vardır; moderatör susturduğunda düğme kilitlenir. Dinleyici sayfasında yalnızca oynat/ses vardır, **metin hiç gönderilmez**.

Odalar ayrı saklanır (`podcast:` önekli yerel depolama): Podcast odası ile video stüdyo odası aynı anda açık olabilir.

Doğrulama: gerçek Chromium + sahte mikrofonla yönetici, konuk ve dinleyici oturumu uçtan uca denendi (yayına alma, dinleyicide prompter sayısı 0, konuk metni kayması, sustur/kilit, kayıt → kütüphane).
