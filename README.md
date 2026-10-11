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
| Yeşil perde (chroma key) | ✅ | WebGL2, yoksa CPU |
| **DozGreenRoom** — P2P konuk, kulis, "Yayına al", konuk katmanı, ses (0–150 %, mute, VU) | ✅ | Manuel imzalama (bkz. aşağı) |
| **DozDeck** — telefon kumandası (`/remote`) | ✅ | Sahne, prompter, mute, kayıt, işaret |
| Bölüm işaretleri → `chapters.txt` + `.srt` | ✅ | `M` tuşu; kayıt bitince video ile iner |
| `.pptdz` proje paketi | ✅ | Sahneler, katmanlar, prompter, kısayollar ve IndexedDB görselleri/videoları |
| 1080p 60 fps tuval + Web Audio karışımı → MP4/WebM | ✅ | MP4 desteklenirse MP4, yoksa WebM |
| Video/ses efektleri, müzik | ✅ | Medya kütüphanesi (IndexedDB) |
| Kısayol eşlemesini arayüzden düzenleme, İngilizce arayüz | ⏳ | Ayar katmanı hazır (`storage/`), arayüz yok |

### ⚠️ Teknik sınırlar (dürüst liste)

- **Prototip görüntüsü canvas'a doğrudan çizilemez.** `<iframe>` içeriği ancak ekran/sekme yakalamayla
  (Chrome/Edge'de bölge kırpma ile) sahneye girer. CSP / `X-Frame-Options` yasaklayan siteler için
  "Başka sekmeyi yakala" kullanılır.
- **Başka alan adındaki sayfaya yapılan tıklamalar görünmez.** Dokunma efekti için "Demo overlay"
  (tıklama yakalanır, sayfa tıklanamaz) ya da aynı alan adındaki *güvenilir* sayfa seçeneği vardır.
- **Sunucu olmadığı için bağlantı kurulumu manuel ve iki adımlıdır:** davet bağlantısı/QR → karşı tarafın
  *yanıt kodu* → yayıncıya yapıştırılır. Her katılımcı için ayrı davet gerekir.
- **TURN yok.** Simetrik NAT / katı kurumsal güvenlik duvarı arkasındaki bağlantılar kurulamayabilir.
  Yayıncı her katılımcıya ayrı kodlama yaptığı için pratik üst sınır ≈ 8 kişidir.
- Konuk sesi yayın karışımına girer; geri besleme olmaması için **kulaklık** önerilir (mix-minus yok).
- Ses/efekt dosyaları `.pptdz` paketine girmez (yalnızca sahnelerde kullanılan görsel ve videolar).

## 🔒 Güvenlik & Gizlilik İlkeleri / Privacy & Security

- ❌ **Sıfır Veritabanı:** Supabase, Firebase veya SQL kullanılmaz.
- ❌ **Sıfır Kayıt/Giriş:** Hesap oluşturma veya e-posta doğrulama yoktur.
- ✅ **Tamamen Yerel:** Tüm ayarlar `localStorage` ve `IndexedDB` üzerinde tutulur.
- ✅ **Sıfır Veri Sızıntısı:** Video ve ses akışları hiçbir sunucuya gitmez; yalnızca sizin açtığınız P2P bağlantılarında doğrudan karşı tarafa iletilir.

**Dürüst istisnalar:**

| Ne | Kime ne görünür | Nasıl kapatılır |
|---|---|---|
| Genel STUN (`stun.l.google.com`) | Yalnızca IP adresiniz; medya/kod gitmez | Ayarlarda `usePublicStun` kapatılır (yalnızca yerel ağ) |
| Sesle takip (Web Speech API) | Chrome'da mikrofon sesi Google'a gidebilir | Varsayılan **kapalı**, açarken uyarı gösterilir |
| Google Fonts (Space Grotesk) | Sayfayı açan ziyaretçinin IP adresi | `src/routes/__root.tsx` içindeki font bağlantısı kaldırılarak yerel yazı tipi kullanılabilir |

Davet/yanıt kodları URL'nin `#` kısmında taşınır; tarayıcılar bunu sunucuya göndermez. İçe aktarılan `.pptdz`,
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
