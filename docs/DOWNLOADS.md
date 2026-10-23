# İndirme, uygulama olarak yükleme ve yerel kurulum dosyaları

`/download` sayfası şunları sunar:

1. **Uygulama olarak yükle (PWA)** — her platformda, mağazasız: tarayıcıdan tek tıkla yüklenir, kendi penceresinde açılır,
   kendiliğinden güncellenir. **Bugün hazır olan yol budur.**
2. **Yerel kurulum dosyaları / mağaza bağlantıları** — Windows, macOS, Linux, Android, iOS. Bunlar **ayrı derlemelerdir**
   ve henüz üretilmemiştir; sayfada "Henüz yok" görünür. Üretildiklerinde bağlantılarını
   `src/studio/pwa/downloads-config.ts` dosyasına yazarsınız (§4).

## 1. PWA: nasıl çalışır

| Parça            | Dosya                                              | Görev                                                                                                              |
| ---------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Manifest         | `/manifest.webmanifest` (`src/server/manifest.ts`) | ad, simgeler, renkler, kısayollar; markadan canlı üretilir ([`BRANDING.md`](BRANDING.md))                          |
| Service worker   | `public/sw.js`                                     | yalnızca **statik dosyaları** (`/assets`, `/fonts`, `/icons`) önbelleğe alır; ağ yokken `public/offline.html` açar |
| Kayıt            | `src/studio/pwa/register.ts`                       | yalnızca **üretim** derlemesinde kaydolur; geliştirmede varsa siler                                                |
| Yükle düğmesi    | `src/studio/pwa/use-install.ts`                    | `beforeinstallprompt` (Chromium), yüklü uygulama (standalone) algılama                                             |
| Platform/adımlar | `src/studio/pwa/platform.ts`                       | cihazı/tarayıcıyı tanır, doğru kurulum adımlarını gösterir                                                         |

Service worker **bilerek küçüktür**: `/api/*` (oda, sohbet, canlı köprü), `POST`'lar, başka kökenler ve HTML sayfaları
önbelleğe alınmaz; böylece eski bir oda ya da marka bilgisi sunulmaz. Stüdyo, oda ve canlı yayın internet ister;
çevrimdışıyken yalnızca "bağlantı yok" sayfası açılır. Önbelleği sıfırlamak için `public/sw.js` içindeki `VERSION`'u artırın.

### Platform başına yükleme yolu (beklenen — gerçek cihazlarda doğrulanmadı)

| Platform                | Tarayıcı                                    | Yol                                                                 |
| ----------------------- | ------------------------------------------- | ------------------------------------------------------------------- |
| Windows / Linux / macOS | Chrome, Edge                                | adres çubuğundaki **Yükle** simgesi ya da menü → _Uygulamayı yükle_ |
| macOS                   | Safari 17+                                  | Dosya → _Dock'a Ekle…_                                              |
| Android                 | Chrome, Edge, Samsung Internet              | menü → _Uygulamayı yükle_ / _Ana ekrana ekle_                       |
| Android                 | Firefox                                     | menü → _Yükle_                                                      |
| iOS / iPadOS            | Safari (16.4'ten beri diğer tarayıcılar da) | Paylaş → _Ana Ekrana Ekle_                                          |
| Masaüstü Firefox        | –                                           | uygulama yüklemeyi desteklemez; site yine de tam çalışır            |

Yükleme için HTTPS, geçerli manifest (ad, simgeler, `start_url`, `display`) ve kayıtlı bir service worker gerekir; hepsi hazırdır.
**Bilinen platform sınırları:** iOS'ta ekran paylaşımı (`getDisplayMedia`) yoktur; iOS'ta `beforeinstallprompt` olmadığı için
yalnızca adım adım anlatım gösterilir.

## 2. Yerel kurulum dosyası üretme yolları

Hiçbiri bu depoda **derlenmedi veya denenmedi**; seçenekler, kullanıma hazır bir yol haritasıdır.

| Hedef                              | Yol                                                                 | Artı                                | Eksi / dikkat                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows (MSIX)                     | [PWABuilder](https://www.pwabuilder.com) siteyi tarar, paket üretir | en az emek, Microsoft Store'a uygun | mağaza hesabı ve imzalama gerekir                                                                                                                                                               |
| Android                            | PWABuilder ya da Bubblewrap ile **Trusted Web Activity** (TWA)      | küçük APK/AAB, Google Play'e uygun  | `assetlinks.json` ile alan adı doğrulaması, imza anahtarı (keystore) yedeği                                                                                                                     |
| iOS                                | PWABuilder'ın Xcode projesi ya da Capacitor                         | App Store'da yer almak              | Apple geliştirici hesabı (yıllık ücret), Mac + Xcode, WebView'de WebRTC/ekran yakalama farkları                                                                                                 |
| Windows / macOS / Linux (masaüstü) | **Electron** (Chromium dahili) ya da **Tauri** (sistem WebView)     | gerçek yükleyici, dosya sistemi     | Tauri Linux'ta WebKitGTK kullanır; WebRTC / `MediaRecorder` desteği sürüme bağlıdır → Studio gibi bir uygulama için Chromium tabanlı Electron daha güvenli; **önce hedef WebView'de test edin** |

Ortak yükümlülükler: **kod imzalama** (Windows SmartScreen, macOS Gatekeeper + noter onayı/_notarization_, Android keystore),
mağazaların gizlilik/politika formları, her platformda ayrı sürüm ve güncelleme akışı. Küçük bir ekip için öneri: **önce PWA +
Android TWA**, masaüstü yükleyiciyi talep gelince ekleyin. Mağaza ücretlerini ve kurallarını başvurmadan önce güncel kaynaklardan doğrulayın.

## 3. Sürümü yayınlama (GitHub Releases)

1. Derlenen dosyaları bir **GitHub Release**'e ekleyin (`Releases → Draft a new release`).
2. Kararlı bir bağlantı için: `https://github.com/izmgamestudios/Teknodoz-Stream-Studio/releases/latest/download/<dosya-adı>`
   (dosya adını her sürümde aynı tutun).
3. Bütünlük için SHA-256 üretin ve sürüm notuna ve yapılandırmaya yazın:

```bash
sha256sum Teknodoz-Studio-Setup.msi          # Linux
shasum -a 256 Teknodoz-Studio.dmg            # macOS
certutil -hashfile Teknodoz-Studio-Setup.msi SHA256   # Windows
```

## 4. Bağlantıları sayfaya ekleme: `downloads-config.ts`

```ts
// src/studio/pwa/downloads-config.ts
export const DOWNLOADS_CONFIG: DownloadsConfig = {
  links: {
    windows: {
      url: "https://github.com/izmgamestudios/Teknodoz-Stream-Studio/releases/latest/download/Teknodoz-Studio-Setup.msi",
      version: "0.1.0",
      sha256: "…64 hex…",
    },
    android: {
      url: "https://play.google.com/store/apps/details?id=org.teknodoz.studio",
    },
    ios: { url: "https://apps.apple.com/app/id0000000000" },
  },
  extraHosts: [], // örn. "dl.siteniz.com" ya da "*.cdn.siteniz.com"
};
```

Kurallar (`src/studio/pwa/downloads.ts`): yalnızca `https`, kimlik bilgisiz ve izinli bir alan adında olan bağlantılar düğme olur —
GitHub (`github.com`, `*.githubusercontent.com`), uygulama mağazaları (Google Play, App Store/TestFlight, Microsoft Store),
Flathub, Snapcraft, F-Droid, **sitenin kendi alan adı** (`siteUrl`) ve `extraHosts`. Başka her şey yok sayılır ve
`/download` sayfasında **Bağlantı durumu** altında nedeniyle listelenir. `sha256` 64 onaltılık karakter olmalıdır. Dosya
biçimi (MSI, DMG, AppImage, APK…) adresin uzantısından anlaşılır; mağaza bağlantıları "Mağazada aç" düğmesi olur.

## 5. Test listesi (yayın öncesi, gerçek cihazlarda)

- [ ] HTTPS altında `/manifest.webmanifest` 200 dönüyor ve simgeler açılıyor.
- [ ] Chrome → Uygulamayı yükle → uygulama kendi penceresinde açılıyor; `/studio` kamera izni isteyebiliyor.
- [ ] Android Chrome: _Uygulamayı yükle_, ana ekran simgesi doğru (maskable kesilmiyor).
- [ ] iPhone Safari: _Ana Ekrana Ekle_ → simge ve ad doğru.
- [ ] Ağ kapatılınca `offline.html` açılıyor, ağ gelince "Yeniden dene" çalışıyor.
- [ ] Marka değişince (§ [`BRANDING.md`](BRANDING.md)) manifest ve simgeler güncelleniyor.
- [ ] Yeni sürümden sonra `sw.js` `VERSION`'u artırıldı; eski önbellek temizlendi.

## 6. Dürüst sınırlar

- Yerel yükleyiciler ve mağaza listeleri **yoktur**; bu doküman ve `downloads-config.ts` onlara hazırlıktır.
- Platform davranışları (özellikle iOS/Safari ve masaüstü Firefox) tarayıcı sürümüne bağlıdır ve gerçek cihazlarda denenmemiştir.
- PWA, işletim sisteminin "yüklü uygulama" ayrıcalıklarının (arka planda çalışma, tam dosya erişimi) tamamını vermez.
