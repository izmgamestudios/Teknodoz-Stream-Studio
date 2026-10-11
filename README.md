# 🎬 Teknodoz Studio
> **Free & Open-Source All-in-One Prompter, Prototype Streaming & Studio Engine**  
> *Zero-Server | No-Database | 100% Client-Side & Privacy-First*

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![React](https://img.shields.io/badge/React-19-61dafb.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6.svg)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4-38b2ac.svg)
![Privacy](https://img.shields.io/badge/Privacy-100%25%20Local-success.svg)

---

## 📌 Proje Hakkında / About the Project

**Teknodoz Studio**, OBS Studio, Streamlabs ve StreamYard gibi yayın yazılımlarının gücünü modern web tarayıcısına taşıyan; **hiçbir veritabanı, sunucu veya kullanıcı girişi (login) gerektirmeyen**, tamamen istemci taraflı (client-side) çalışan profesyonel bir canlı yayın, kayıt, prototip test ve akıllı teleprompter stüdyosudur.

Tüm ses ve video işleme süreçleri doğrudan kullanıcının bilgisayarında (HTML5 Canvas 60 FPS & Web Audio API) gerçekleşir. Hiçbir kamera, mikrofon veya ekran verisi harici sunuculara iletilmez.

---

## 🚀 Özellikler ve Durum / Features & Status

| Modül | Durum | Not |
|---|---|---|
| **DozPrompt** — HUD (kayda girmez), kamera altı *notch*, hız/boyut/satır aralığı/kontrast/ayna, `Boşluk`·`↑↓`·`R`, `.txt/.md/.srt/.docx` + pano | ✅ | `/` ve `/studio` |
| Burn-in (altyazı / kayan şerit / notch) | ✅ | Tek anahtar + sahnedeki "Prompter (burn-in)" katmanı |
| Sesle takip (Web Speech API) | ✅ | Chrome/Edge. Ses Google'a gidebilir; arayüzde uyarı vardır |
| **DozProto** — mobil (390x844) ve masaüstü çerçeve, dokunma efekti | ✅ | Görüntü ekran/sekme yakalamayla girer, bkz. *Teknik sınırlar* |
| **DozScene** — sınırsız sahne, `1-9` kısayol, kesme/fade/slide, katmanlar (z-sıra, göz, kilit, opaklık, karışım modu), taşı/boyutlandır/döndür tutamaçları | ✅ | Hizalama kılavuzları (Shift: oran/15°, Alt: merkezden) |
| **Yayın çerçevesi şablonları** — Haber/Breaking News, solo yakın plan, mobil test, masaüstü prototip, 2'li / 4'lü / 3'lü (podcast) konuşma, eğitim videosu, çift ekran paylaşımı, sunum+konuşmacı | ✅ | Sahne panelinde **▦ Şablon**: tema rengi, başlık, etiket, kayan yazı; sıradan katmanlardan kurulur (sonradan düzenlenir). Konuk panelleri boş gelir, "Yayına al" ilk boş panele yerleştirir. **Logo** ve **özel arka plan görseli** yüklenebilir (PNG/JPEG/WebP/GIF/AVIF, ≤12 MB; `.pptdz`'ye girer) |
| Yeşil perde (chroma key) | ✅ | WebGL2, yoksa CPU |
| **DozGreenRoom** — P2P konuk, kulis, "Yayına al", konuk katmanı, ses (0–150 %, mute, VU) | ✅ | Manuel imzalama (bkz. aşağı) |
| **Oda modu** — kısa link/QR (`/r/KOD`), bekleme havuzu, onayla → otomatik bağlan, günlük (`/room`) | ✅ | Kod kopyalama yok; küçük bir bellek-içi röle gerekir, bkz. [`docs/ROOM.md`](docs/ROOM.md) |
| **Moderasyonlu oda sohbeti** — katılımcı mesajı → editör/reji onayı → yayına al (overlay katmanı) | ✅ | Reji (`/room`) ve editör (`/chat/KOD#k=…`, ayrı cihaz) masaları; modlar: onaylı / serbest / kapalı. Bkz. [`docs/ROOM.md`](docs/ROOM.md) |
| **Canlı yayın** (`/live`) — YouTube, Facebook, Twitch, Kick, Instagram, TikTok veya özel RTMP(S) hedefi; yayın anahtarı + sunucu adresi, çoklu hedef | ✅ | Tarayıcı → **kendi sunucunuzdaki ffmpeg köprüsü** → RTMPS. Varsayılan **kapalı**: `LIVE_ADMIN_TOKEN` + ffmpeg gerekir. Yerelde RTMP'ye uçtan uca doğrulandı; gerçek platform/RTMPS denenmedi. Bkz. [`docs/LIVE.md`](docs/LIVE.md) |
| **DozDeck** — telefon kumandası (`/r/KOD?as=remote`, manuel: `/remote`) | ✅ | Sahne, prompter, mute, kayıt, işaret |
| Ayarlar (`/settings`) — çözünürlük/fps/bit hızı, STUN, kısayol düzenleme, dil (TR/EN) | ✅ | Arayüz çevirisi: menü, ayarlar, konuk/kumanda sayfaları. Stüdyo panelleri henüz Türkçe |
| Manuel (sunucusuz) bağlantı + QR tarama (`BarcodeDetector`) | ✅ | Röle yoksa yedek; QR tarama yalnızca Chromium (Android/macOS) |
| Bölüm işaretleri → `chapters.txt` + `.srt` | ✅ | `M` tuşu; kayıt bitince video ile iner |
| `.pptdz` proje paketi | ✅ | Sahneler, katmanlar, prompter, kısayollar ve IndexedDB görselleri/videoları |
| 1080p 60 fps tuval + Web Audio karışımı → MP4/WebM | ✅ | MP4 desteklenirse MP4, yoksa WebM |
| Video/ses efektleri, müzik | ✅ | Medya kütüphanesi (IndexedDB) |

### ⚠️ Teknik sınırlar (dürüst liste)

- **Prototip görüntüsü canvas'a doğrudan çizilemez.** `<iframe>` içeriği ancak ekran/sekme yakalamayla
  (Chrome/Edge'de bölge kırpma ile) sahneye girer. CSP / `X-Frame-Options` yasaklayan siteler için
  "Başka sekmeyi yakala" kullanılır.
- **Başka alan adındaki sayfaya yapılan tıklamalar görünmez.** Dokunma efekti için "Demo overlay"
  (tıklama yakalanır, sayfa tıklanamaz) ya da aynı alan adındaki *güvenilir* sayfa seçeneği vardır.
- **Oda modu bir röle ister:** sunucu tarafında tek, uzun ömürlü bir Node süreci (`node-server`) gerekir; Cloudflare/serverless
  gibi ortamlarda röle yoktur ve arayüz otomatik olarak **manuel kod değişimine** (davet → yanıt kodu) düşer.
- **TURN yok.** Simetrik NAT / katı kurumsal güvenlik duvarı arkasındaki bağlantılar kurulamayabilir.
  Yayıncı her katılımcıya ayrı kodlama yaptığı için pratik üst sınır ≈ 8 kişidir.
- Konuk sesi yayın karışımına girer; geri besleme olmaması için **kulaklık** önerilir (mix-minus yok).
- Ses/efekt dosyaları `.pptdz` paketine girmez (yalnızca sahnelerde kullanılan görsel ve videolar).

## 🔒 Güvenlik & Gizlilik İlkeleri / Privacy & Security

- ❌ **Sıfır Veritabanı:** Supabase, Firebase veya SQL kullanılmaz. (Oda rölesi yalnızca bellekte tutar, diske yazmaz.)
- ❌ **Sıfır Kayıt/Giriş:** Hesap oluşturma veya e-posta doğrulama yoktur.
- ✅ **Tamamen Yerel:** Tüm ayarlar `localStorage` ve `IndexedDB` üzerinde tutulur.
- ✅ **Sıfır Veri Sızıntısı:** Video ve ses akışları varsayılan olarak hiçbir sunucuya gitmez; yalnızca sizin açtığınız P2P bağlantılarında doğrudan karşı tarafa iletilir. **Tek istisna:** siz kendiniz `/live` ile canlı yayın başlatırsanız program çıkışı *kendi sunucunuza* (ffmpeg köprüsü) ve oradan seçtiğiniz platforma gider.

**Dürüst istisnalar:**

| Ne | Kime ne görünür | Nasıl kapatılır |
|---|---|---|
| Genel STUN (`stun.l.google.com`) | Yalnızca IP adresiniz; medya/kod gitmez | Ayarlarda `usePublicStun` kapatılır (yalnızca yerel ağ) |
| Sesle takip (Web Speech API) | Chrome'da mikrofon sesi Google'a gidebilir | Varsayılan **kapalı**, açarken uyarı gösterilir |
| Oda rölesi (`/api/room`) | Takma adlar, istenen rol, SDP kodları (IP içerir), istemci IP’si (yalnızca hız sınırı için); bellekte, en fazla birkaç saat | Röle kullanılmazsa manuel bağlantı |
| Oda sohbeti | Mesaj metni ve takma ad (onay bekleyenler dahil); röle belleğinde, oda kapanınca silinir | Sohbet modunu *Kapalı* yapın |
| Canlı yayın köprüsü (`/api/live`) | Program görüntüsü/sesi + yayın anahtarı kendi sunucunuza ve oradan platforma gider; anahtar günlüğe yazılmaz, yanıtlarda dönmez | Varsayılan **kapalı** (`LIVE_ADMIN_TOKEN` yoksa çalışmaz) |

Manuel modda davet/yanıt kodları URL'nin `#` kısmında taşınır; tarayıcılar bunu sunucuya göndermez. Yazı tipi (Space Grotesk, OFL) kendi sunucundan sunulur; üçüncü taraf istek yoktur. İçe aktarılan `.pptdz`,
P2P mesajları ve otomatik kayıt `zod` ile doğrulanır; `innerHTML` kullanılmaz.

---

👤 Geliştirici & Künye / Credits
Bu proje Hüseyin Bayer (Teknodoz) tarafından açık kaynak topluluğuna ücretsiz olarak sunulmuştur.

Geliştirici: Hüseyin Bayer
E-posta: izmgamestudios@gmail.com
Telefon: +90 541 770 92 05
LinkedIn: linkedin.com/in/huseyin-bayer-izmgamestudios
Topluluk & Destek: Geri bildirim, hata bildirimi ve katkılar için GitHub Issues sekmesini kullanabilirsiniz.

---

## 🛠️ Kurulum / Installation

Projeyi yerel ortamınızda çalıştırmak için:

```bash
# Depoyu klonlayın
git clone https://github.com/izmgamestudios/Teknodoz-Stream-Studio.git

# Proje dizinine gidin
cd Teknodoz-Stream-Studio

# Bağımlılıkları yükleyin (npm, pnpm veya bun)
npm install

# Geliştirici sunucusunu başlatın
npm run dev        # http://localhost:5173
npm run test       # vitest (1400+ birim testi)
npm run build      # üretim derlemesi (varsayılan hedef Cloudflare; Node için NITRO_PRESET=node-server)
```

---

## 🧱 Mimari / Architecture

Ayrıntılar: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Kısaca: `src/studio/` altında saf mantık modülleri
(`storage`, `engine`, `prompter`, `proto`, `p2p`, `project`), onları birleştiren `runtime/StudioRuntime` ve
React arayüzü `ui/` bulunur. Sayfalar: `/` (prompter), `/studio`, `/join` (izleyici/konuk), `/remote` (telefon).

---

## 🚀 CloudPanel (Node.js) ile yayına alma

```bash
cd ~/htdocs/ALANADI.COM && git fetch origin && git reset --hard origin/main \
  && rm -f bun.lock && ~/.bun/bin/bun install \
  && NITRO_PRESET=node-server ~/.bun/bin/bun run build \
  && (pm2 delete teknodoz-studio 2>/dev/null || true) \
  && NITRO_PORT=3011 NITRO_HOST=127.0.0.1 pm2 start .output/server/index.mjs --name teknodoz-studio && pm2 save
```

- `bun.lock` Lovable'ın özel registry adreslerini içerir ve dışarıdan 403 verir; bu yüzden sunucuda silinip yeniden çözülür.
- CloudPanel sitesi `127.0.0.1:3011`'e reverse proxy olmalı, **HTTPS** şarttır (kamera/mikrofon için).
- pm2'yi **tek örnek** (fork) çalıştırın: oda rölesi belleği süreçler arasında paylaşılmaz. Ayrıntı: [`docs/ROOM.md`](docs/ROOM.md).
- Canlı yayın (`/live`) için sunucuya `ffmpeg` kurun ve ortama gizli bir `LIVE_ADMIN_TOKEN` (≥16 karakter) verin; reverse proxy gövde limiti ≥ 8 MB olmalı. Güvenlik modeli ve kurulum: [`docs/LIVE.md`](docs/LIVE.md).
- Gerçek cihaz test rehberi: [`docs/DEVICE-TESTING.md`](docs/DEVICE-TESTING.md).
