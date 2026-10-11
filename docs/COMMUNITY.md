# Topluluk kanalları — kurulum kılavuzu

Kanalları (WhatsApp Kanalı, LinkedIn Sayfası, Facebook grubu, Telegram, Slack, Discord…) **proje sahibi kendi
hesabıyla açar**; platformlar hesap/sayfa oluşturmayı başkası adına yapmaya izin vermez. Uygulama tarafı hazırdır:

- `/community` sayfası, `src/studio/community/links.ts` içindeki adresleri **doğrulayıp** "Katıl" düğmelerine çevirir
  (yalnızca platformun kendi alan adındaki `https` adresleri kabul edilir; yanlış adres düğme olmaz, "Kurulum durumu"
  listesinde uyarı olarak görünür).
- **Yayın duyurusu** kartı (`/community` ve `/live`): başlık + bağlantı + tarih → TR/EN metin → WhatsApp, Telegram,
  LinkedIn, Facebook, X, e-posta paylaşım pencereleri; Slack/Discord/grup için "metni kopyala". Hesap bağlama ve API
  anahtarı yoktur; her paylaşımı platformun kendi penceresinde siz onaylarsınız.

## 1. Kanal mimarisi (öneri)

| Rol | Kanal | Neden |
|---|---|---|
| Kaynak ve geliştirme | **GitHub** (Issues + Discussions) | Hata bildirimi, katkı, sürüm notları tek yerde |
| Tek yönlü duyuru | **WhatsApp Kanalı**, **Telegram Kanalı** | Yayın zamanı ve sürüm haberleri; spam/gürültü yok |
| Sohbet ve destek | **Telegram grubu** (kanala bağlı) veya **Discord** | Herkese açık, hızlı soru-cevap |
| Kurumsal / B2B | **LinkedIn Sayfası** | Ortaklıklar, sponsorlar, yatırımcılar için vitrin |
| Geniş kitle | **Facebook grubu** | Topluluk üyeliği, paylaşım; marka için ayrıca Sayfa |
| Ortak/sponsor odası | **Slack** (özel) | Sponsor ve ortaklarla kapalı çalışma alanı; herkese açık topluluk için uygun değil |
| İçerik | **YouTube** (+ Instagram/TikTok kısa videolar) | Yayın kayıtları, eğitimler |

Önce **2–3 kanalla başlayın** (GitHub + WhatsApp/Telegram duyuru + LinkedIn). Her kanal bir moderasyon yüküdür; 90 gün
sonra neyin kullanıldığına bakıp ekleyin/kapatın.

## 2. Hesap başına yapılacaklar (≈10–15 dk)

> Arayüz adları platformlarca değişebilir; adımlar güncel yardım sayfalarıyla doğrulanmalıdır.

| Kanal | Oluşturma | Ayar notları | Adresi nereye yazın |
|---|---|---|---|
| **WhatsApp Kanalı** | WhatsApp → Güncellemeler → Kanallar → oluştur | Ad "Teknodoz Studio Duyurular", simge = logo. Yalnızca yöneticiler yazar. Kanal bağlantısını kopyalayın. | `links.ts` → `whatsapp` (`https://whatsapp.com/channel/…`) |
| **Telegram** | Yeni Kanal → herkese açık `t.me/kullaniciadi` | Kanal ayarlarından bir **tartışma grubu** bağlayın; grupta yavaş mod (slow mode) açın. | `telegram` (`https://t.me/…`) |
| **LinkedIn Sayfası** | İş için → Sayfa oluştur → Şirket (ya da Showcase) | Kişisel profil ≠ Sayfa. Logo, kapak, tek cümlelik slogan, web sitesi, "Hakkında" metni. İkinci bir yönetici ekleyin. | `linkedin` (`…/company/…`) |
| **Facebook** | Gruplar → yeni grup (herkese açık/gizli seç) | Üyelik soruları (spam için 1–2 soru), kurallar sekmesi. Marka sayfası ayrıca gerekiyorsa Sayfa açın. | `facebook` (`…/groups/…`) |
| **Slack** | Çalışma alanı oluştur → `#sponsorlar`, `#ortaklar`, `#duyuru` | Davet bağlantısı süreli olabilir; ücretsiz planın geçmiş/entegrasyon sınırlarını güncel fiyat sayfasından doğrulayın. | `slack` (`join.slack.com/…`) |
| **Discord** | Sunucu oluştur → Community'yi etkinleştir | `#kurallar`, `#duyuru`, `#sohbet`, `#destek`, `#yayın-sohbeti`. Kalıcı (süresiz) davet bağlantısı üretin. | `discord` (`discord.gg/…`) |
| **GitHub** | Depoda Settings → Features → **Discussions** | Kategoriler: Duyurular, Fikirler, Soru-Cevap, Sergi. | zaten tanımlı |

## 3. Hazır metinler

**Kısa açıklama (TR):** "Teknodoz Studio: tarayıcıda çalışan ücretsiz ve açık kaynak prompter, canlı yayın ve
prototip yayını stüdyosu. Güncellemeler, yayın duyuruları ve topluluk."

**Short description (EN):** "Teknodoz Studio: a free, open-source, browser-based prompter, live-stream and prototype
broadcast studio. Updates, stream announcements and community."

**Topluluk kuralları (kısa):**
1. Saygılı olun; kişisel saldırı, ayrımcılık ve taciz yok.
2. Konu dışı reklam/spam ve izinsiz toplu mesaj yok; sponsorluk ve iş birliği için yöneticilere yazın.
3. Başkasının kişisel verisini, yayın anahtarını veya parolasını paylaşmayın.
4. Hata bildirirken sürümü, tarayıcıyı ve adımları yazın (GitHub Issues tercih edilir).
5. Yöneticilerin kararı nihaidir; itirazlar özel mesajla.

**Hoş geldin mesajı (TR):** "Hoş geldin! 👋 Teknodoz Studio ücretsiz ve açık kaynak. Başlamak için README'ye, hata ve
fikirler için GitHub Issues/Discussions'a bakın. Haftalık demo yayınımızın zamanını bu kanalda duyuruyoruz."

**Sabitlenecek ilk gönderi:** ne olduğu (2 cümle) + 3 bağlantı (uygulama, GitHub, kurallar) + yayın takvimi.

## 4. Haftalık ritim (küçük ama sürdürülebilir)

| Gün | İçerik | Kanallar |
|---|---|---|
| Pzt | Haftalık yayın duyurusu (uygulamadaki **Yayın duyurusu** kartı) | WhatsApp/Telegram duyuru, LinkedIn, X |
| Çar | Kısa ipucu/ekran kaydı ("şablonla haber stüdyosu 60 sn") | YouTube Shorts/Instagram/TikTok, kanallar |
| Cum | Haftalık demo yayını (`/live`) + sohbette Soru-Cevap (moderasyonlu sohbet) | YouTube/Facebook/Twitch… |
| Cmt | Özet + sürüm notu (GitHub Releases) | tüm duyuru kanalları |

Yayın başlamadan 24 saat ve 1 saat önce iki hatırlatma; yayın sonrası kayıt bağlantısı.

## 5. Moderasyon, güvenlik, gizlilik

- Her topluluk kanalında **en az iki yönetici** olsun (hesap kaybına karşı); parolalar için parola yöneticisi + 2 adımlı doğrulama.
- **İzinsiz üye ekleme/toplu mesaj yapmayın** (WhatsApp ve Telegram'da hesap kısıtlama sebebidir). Yalnızca davet bağlantısı/QR.
- Üyelerden alınan e-posta/telefon için **KVKK/GDPR**: amaç, saklama süresi ve çıkış yolu açık yazılmalı; ihtiyaç yoksa toplamayın.
- Sponsorlu içerikte bunu açıkça belirtin ("Sponsorlu / İş birliği"); ayrıntı: [`STRATEGY.md`](STRATEGY.md).
- Yayın anahtarı veya `LIVE_ADMIN_TOKEN` hiçbir kanalda paylaşılmaz; sızarsa hemen yenileyin.

## 6. Ölçüm (90 gün)

Üye/takipçi sayısı, haftalık aktif üye, duyuru → izleme tıklaması (bağlantıya `?utm_source=whatsapp` gibi etiket
ekleyebilirsiniz), GitHub yıldız/issue sayısı, sponsor adayı görüşmesi sayısı. Hedefleri [`STRATEGY.md`](STRATEGY.md) içindeki
sprint planına bağlayın.

## 7. Henüz yapılmayanlar (bilinçli)

- **Bot/webhook otomasyonu** (yayın açılınca Telegram/Slack'e otomatik mesaj): bot belirteci veya webhook adresi gibi
  gizli bilgi sunucuda tutulmalı ve gerçek servislerle denenmeli. Kanallar açıldıktan sonra, `LIVE_ADMIN_TOKEN` ile
  korunan bir `/api/live/announce` ucu olarak eklenebilir (sabit hedefler: `api.telegram.org`, `hooks.slack.com`).
- Üyelik/CRM listesi: sunucu tarafı veritabanı gerektirir; projenin "veritabansız" ilkesine aykırıdır. Şimdilik
  platformların kendi üye yönetimi kullanılır.
