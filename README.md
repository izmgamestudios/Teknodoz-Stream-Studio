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

## 🚀 Öne Çıkan Özellikler / Key Features

### 🎙️ 1. DozPrompt (Akıllı Teleprompter)
- **Gizli HUD Modu:** Metin yalnızca yayıncının ekranında akar; kaydedilen videoya veya tuvale kesinlikle basılmaz.
- **Yayına Aktarma (Burn-in) Modu:** Tek anahtarla kayan yazı alt bant (ticker) veya altyazı olarak tuvale eklenir.
- **Sesle Takip (Voice Auto-Follow):** Yerleşik Web Speech API ile konuşma hızınızı analiz eder; siz konuştukça metin akar, durduğunuzda bekler.
- **Göz Teması (Eyeline Notch) Modu:** Kameranın hemen altına yerleşen kompakt görünüm ile izleyiciyle doğrudan göz teması sağlar.

### 📱 2. DozProto (URL Prototip Test Yayıncılığı)
- **Canlı Web Kaynağı:** Herhangi bir web URL'sini doğrudan tuvale ekleme.
- **Cihaz Çerçeveleri:** iPhone / Android dikey mobil çerçeve (9:16) ve masaüstü tarayıcı çerçevesi (16:9).
- **Tıklama Efektleri (Touch Ripples):** Prototip test edilirken ekranda animasyonlu dokunma halkaları gösterir.
- **Ekran Yakalama Köprüsü:** CSP/iframe kısıtlaması olan siteleri doğrudan sekme paylaşımıyla çerçeveye entegre etme.

### 🎛️ 3. DozScene (Sahneler & Katman Motoru)
- **OBS Mantığında Çoklu Sahne:** Sınırsız sahne oluşturma ve klavyeden `1-9` kısayollarıyla anında/yumuşak geçiş.
- **Photoshop Tarzı Katmanlar:** Z-index sıralama, sürükle-bırak serbest boyutlandırma, şeffaflık (%0-100) ve kilitleme.
- **Yeşil Perde (Chroma Key):** Harici yazılıma gerek duymadan tarayıcı içi arka plan temizleme.

### 👥 4. DozGreenRoom (Sunucusuz P2P Konuk Sistemi)
- **Kulis & Bekleme Odası:** Veritabanı olmadan, WebRTC eşler arası (P2P) bağlantıyla konuk davet etme.
- **Dinamik Konuk Katmanı:** Konuğun görüntüsünü serbestçe boyutlandırıp tuvalde istenen yere koyma.
- **Bağımsız Ses Mikseri:** Her konuk için ayrı kazanç (gain slider), susturma (mute) ve canlı VU metre.

### 📲 5. DozDeck (Mobil Uzaktan Kumanda)
- Ekranda beliren QR kodu telefonla okutarak, telefonu anında sahne ve prompter kontrolleri için büyük butonlu bir kablosuz el kumandasına dönüştürme.

### 📦 6. .pptdz Proje Paketi & YouTube Bölümleme
- **Yerel Yedekleme:** Tüm sahne, katman ve ayarları tek tıkla `.pptdz` dosyası olarak indirme ve geri yükleme.
- **Chapters (Bölümler):** Kayıt sırasında `M` tuşuyla atılan işaretleri YouTube uyumlu `chapters.txt` ve `.srt` olarak dışa aktarma.

---

## 🔒 Güvenlik & Gizlilik İlkeleri / Privacy & Security

- ❌ **Sıfır Veritabanı:** Supabase, Firebase veya SQL kullanılmaz.
- ❌ **Sıfır Kayıt/Giriş:** Hesap oluşturma veya e-posta doğrulama yoktur.
- ✅ **Tamamen Yerel:** Tüm ayarlar `localStorage` ve `IndexedDB` üzerinde tutulur.
- ✅ **Sıfır Veri Sızıntısı:** Video ve ses akışları cihazınızdan dışarı çıkmaz.

---

## 🛠️ Kurulum / Installation

Projeyi yerel ortamınızda çalıştırmak için:

```bash
# Depoyu klonlayın
git clone https://github.com/KULLANICI_ADINIZ/teknodoz-studio.git

# Proje dizinine gidin
cd teknodoz-studio

# Bağımlılıkları yükleyin (npm, pnpm veya bun)
npm install

# Geliştirici sunucusunu başlatın
npm run dev
