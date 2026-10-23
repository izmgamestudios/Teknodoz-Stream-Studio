# Kaynakça / Bibliography

Teknodoz Studio'nun dayandığı standartlar, belgeler ve araçlar. "Projede" sütunu, kaynağın koda ya da tasarıma
nerede yansıdığını gösterir.

> **Doğrulama notu:** Bağlantılar yazım sırasında doğru bilinen kalıcı adreslerdir; bu doküman hazırlanırken çıkış ağı kapalı
> olduğu için **tek tek açılıp doğrulanmadı**. Bir bağlantı kırıksa başlıkla arayıp [Issue](https://github.com/izmgamestudios/Teknodoz-Stream-Studio/issues)
> açın ya da düzeltip PR gönderin. Özellik desteği tabloları (ör. `DEVICE-TESTING.md`) API varlığından türetilmiş **hipotezlerdir**.

## 1. Web standartları

| Kaynak                                                                                | Yayıncı    | Projede                                                                                         |
| ------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------- |
| [WebRTC 1.0: Real-Time Communication Between Browsers](https://www.w3.org/TR/webrtc/) | W3C        | konuk/izleyici bağlantısı, oda (`src/studio/p2p`, `room`)                                       |
| [MediaStream Recording](https://www.w3.org/TR/mediastream-recording/)                 | W3C        | kayıt ve canlı yayın parçaları (`engine/recorder.ts`, `live/`)                                  |
| [Screen Capture](https://www.w3.org/TR/screen-capture/)                               | W3C        | ekran/sekme paylaşımı, prototip yakalama (`proto/`)                                             |
| [Web Audio API](https://www.w3.org/TR/webaudio/)                                      | W3C        | ses karışımı, VU göstergesi (`engine/audio-bus.ts`)                                             |
| [Web Speech API](https://webaudio.github.io/web-speech-api/)                          | WICG       | prompter sesle takip (`prompter/`)                                                              |
| [Web Application Manifest](https://www.w3.org/TR/appmanifest/)                        | W3C        | `/manifest.webmanifest` (`branding/head.ts`, `server/manifest.ts`)                              |
| [Service Workers](https://www.w3.org/TR/service-workers/)                             | W3C        | `public/sw.js`                                                                                  |
| [Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/)      | W3C        | kontrast oranı hesabı ve okunur yazı rengi (`branding/brand.ts`: `contrastRatio`, `readableOn`) |
| [The Open Graph protocol](https://ogp.me/)                                            | Open Graph | paylaşım kartı meta verisi (`branding/head.ts`)                                                 |

## 2. Ağ protokolleri (RFC)

| Kaynak                                                                                            | Projede                                                |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [RFC 8445 — Interactive Connectivity Establishment (ICE)](https://www.rfc-editor.org/rfc/rfc8445) | WebRTC bağlantı kurulumu, "TURN yok" sınırı            |
| [RFC 8489 — Session Traversal Utilities for NAT (STUN)](https://www.rfc-editor.org/rfc/rfc8489)   | genel STUN ayarı (`usePublicStun`)                     |
| [RFC 8656 — Traversal Using Relays around NAT (TURN)](https://www.rfc-editor.org/rfc/rfc8656)     | ileride röle seçeneği (şimdilik yok)                   |
| [RFC 8866 — Session Description Protocol (SDP)](https://www.rfc-editor.org/rfc/rfc8866)           | konuk teklif/yanıt kodları (`p2p/`, `server/rooms.ts`) |
| [RTMP Specification 1.0](https://rtmp.veriskope.com/docs/spec/) (Adobe; Veriskope barındırır)     | canlı yayın köprüsü (`docs/LIVE.md`)                   |

## 3. Belgeler ve rehberler

| Kaynak                                                                                                       | Yayıncı           | Projede                                      |
| ------------------------------------------------------------------------------------------------------------ | ----------------- | -------------------------------------------- |
| [Web API'leri: WebRTC, MediaRecorder, Screen Capture, IndexedDB](https://developer.mozilla.org/docs/Web/API) | MDN               | tarayıcı desteği ve davranış notları         |
| [Progressive web apps](https://developer.mozilla.org/docs/Web/Progressive_web_apps)                          | MDN               | PWA kurulumu, `docs/DOWNLOADS.md`            |
| [Learn PWA](https://web.dev/learn/pwa)                                                                       | web.dev           | yükleme ölçütleri, çevrimdışı sayfa          |
| [Trusted Web Activity](https://developer.chrome.com/docs/android/trusted-web-activity)                       | Chrome Developers | Android paketleme yolu (`docs/DOWNLOADS.md`) |
| [FFmpeg — Protocols (rtmp, rtmps)](https://ffmpeg.org/ffmpeg-protocols.html)                                 | FFmpeg            | canlı köprü komutu (`server/live.ts`)        |
| [FFmpeg — Formats (tee muxer)](https://ffmpeg.org/ffmpeg-formats.html)                                       | FFmpeg            | çoklu hedefe tek kodlama                     |

## 4. Güvenlik

| Kaynak                                                                                                                                                       | Yayıncı | Projede                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------- |
| [Server-Side Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) | OWASP   | canlı köprüde SSRF koruması (`server/live-policy.ts`)                                 |
| [OWASP Top 10](https://owasp.org/Top10/)                                                                                                                     | OWASP   | girdi doğrulama (zod), `innerHTML` yasağı, hız sınırları, sabit zamanlı karşılaştırma |

## 5. Araçlar ve kütüphaneler

| Araç                                                                                                     | Rol                                                       |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [TanStack Start](https://tanstack.com/start)                                                             | dosya tabanlı yönlendirme + SSR                           |
| [React](https://react.dev)                                                                               | arayüz                                                    |
| [Vite](https://vite.dev) / [Nitro](https://nitro.build)                                                  | derleme ve Node sunucusu                                  |
| [Tailwind CSS](https://tailwindcss.com)                                                                  | stil                                                      |
| [zod](https://zod.dev)                                                                                   | tüm dış girdilerin doğrulanması                           |
| [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) (SIL OFL 1.1)                           | yazı tipi; kendi sunucumuzdan sunulur (`public/fonts`)    |
| [PWABuilder](https://www.pwabuilder.com)                                                                 | Windows/Android/iOS paketleme (öneri, denenmedi)          |
| [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)                                             | Android TWA paketleme (öneri, denenmedi)                  |
| [Electron](https://www.electronjs.org), [Tauri](https://tauri.app), [Capacitor](https://capacitorjs.com) | masaüstü/mobil sarmalayıcı seçenekleri (öneri, denenmedi) |

## 6. Proje süreci

| Kaynak                                                          | Projede                                                  |
| --------------------------------------------------------------- | -------------------------------------------------------- |
| [Citation File Format](https://citation-file-format.github.io/) | `CITATION.cff`                                           |
| [Contributor Covenant](https://www.contributor-covenant.org/)   | `CODE_OF_CONDUCT.md`'nin ilham aldığı davranış kuralları |

## 7. Bu depodaki iç belgeler

[`ARCHITECTURE.md`](ARCHITECTURE.md) · [`ROOM.md`](ROOM.md) · [`LIVE.md`](LIVE.md) · [`COMMUNITY.md`](COMMUNITY.md) ·
[`STRATEGY.md`](STRATEGY.md) · [`BRANDING.md`](BRANDING.md) · [`DOWNLOADS.md`](DOWNLOADS.md) · [`DEVICE-TESTING.md`](DEVICE-TESTING.md) ·
[`USER-GUIDE.md`](USER-GUIDE.md)

## 8. Nasıl alıntı yapılır

Depo kökündeki [`CITATION.cff`](../CITATION.cff) dosyası GitHub'ın "Cite this repository" düğmesini besler.
