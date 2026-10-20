# Teknodoz Studio — Kullanım kılavuzu

> Bu dosya `src/studio/guide/content.ts` içeriğinden üretilir ve uygulamadaki **/guide** sayfasıyla aynıdır. Elle düzenlemeyin: kaynağı değiştirip `UPDATE_DOCS=1 npx vitest run src/studio/guide` çalıştırın.

[English version](USER-GUIDE.en.md)

## İçindekiler

- [🚀 Hızlı başlangıç (5 dakika)](#start)
- [📜 Prompter](#prompter)
- [🎬 Stüdyo: sahneler ve katmanlar](#studio)
- [▦ Şablonlar ve logo](#templates)
- [🎬 Yayın akışı: otomatik sıra, kendi şablonların ve sistem sağlığı](#show-control)
- [📱 Dikey format (Reels, Shorts, TikTok) ve güvenli bölge](#vertical)
- [🎚 Kamera ayarları, ses iyileştirme ve ducking](#camera-audio)
- [🎧 Ses kütüphanesi ve geçişler](#sound)
- [🎛️ Klasik Stüdyo ve senkron](#classic)
- [🚪 Oda: konuk daveti](#room)
- [💬 Moderasyonlu sohbet](#chat)
- [📡 Canlı yayın (RTMP / RTMPS)](#live)
- [🤝 Topluluk, duyuru ve sponsorlar](#community)
- [⬇️ Uygulama olarak yükle](#install)
- [🎨 Markayı ve görünümü özelleştir](#customize)
- [🔒 Gizlilik ve veri](#privacy)
- [Klavye kısayolları](#shortcuts)
- [Sık sorulan sorular](#faq)
- [PDF, video ve bağlantılar](#resources)
- [Daha fazlası](#more)

<a name="start"></a>

## 🚀 Hızlı başlangıç (5 dakika)

Kurulum, hesap ya da veritabanı yok: her şey tarayıcında çalışır.

1. Siteyi HTTPS ile aç (kamera ve mikrofon yalnızca güvenli bağlantıda çalışır).
2. Prompter'da (/) metnini yapıştır ya da .txt / .md / .srt / .docx içe aktar; Boşluk tuşuyla başlat.
3. Stüdyo'da (/studio) kamera ve mikrofonu seç, “▦ Şablon” ile hazır bir sahne ekle.
4. Kaydı başlat (Shift+R). M tuşuyla bölüm işareti ekle.
5. Kayıt bitince video, chapters.txt ve .srt birlikte iner.
6. Konuk çağıracaksan Oda'yı (/room), canlı yayın için Canlı yayın'ı (/live) aç.

> 💡 **İpucu:** Projeni “.pptdz” olarak dışa aktar: sahneler, katmanlar, prompter metni ve görseller tek dosyada yedeklenir.

<a name="prompter"></a>

## 📜 Prompter

Kayda girmeyen HUD ya da yayına işlenen altyazı olarak okuma metni.

1. Metni yapıştır veya dosyadan içe aktar (.txt, .md, .srt, .docx).
2. Hız, yazı boyutu, satır aralığı, kontrast ve ayna (ekran yansıtma) ayarlarını yap.
3. Boşluk ile başlat / durdur, ↑ ↓ ile hızı değiştir, R ile başa dön.
4. Metnin yayında da görünmesi için “burn-in” (altyazı, kayan şerit veya kamera altı notch) seç.

> 💡 **İpucu:** HUD yalnızca sende görünür; kayda ve yayına girmez.

> 💡 **İpucu:** Sesle takip (Chrome / Edge) varsayılan olarak kapalıdır; açarsan ses Google'a gidebilir, arayüz seni uyarır.

<a name="studio"></a>

## 🎬 Stüdyo: sahneler ve katmanlar

Sınırsız sahne, katmanlı kompozisyon, kayıt.

1. Kaynak çubuğundan kamera, mikrofon ve ekran paylaşımını seç.
2. Sahne panelinden sahne ekle; 1–9 tuşlarıyla sahneler arasında geç (kesme, fade veya slide geçişi).
3. Katmanlar panelinde “+ Katman ekle…” ile kamera, ekran, görsel, metin, şekil gibi katmanlar ekle; sıralarını, görünürlüklerini, kilitlerini, opaklık ve karışım modlarını ayarla.
4. Katmanı sahnede sürükleyerek taşı, tutamaçlarla boyutlandır / döndür (Shift: oran / 15°, Alt: merkezden).
5. Gerekirse kamera katmanında yeşil perdeyi (chroma key) aç.
6. Ayarlar'dan çözünürlük, kare hızı ve bit hızını seç; kaydı başlat. Tarayıcı destekliyorsa MP4, yoksa WebM kaydedilir.

> 💡 **İpucu:** Prototip (mobil 390×844 / masaüstü çerçeve) görüntüsü ekran ya da sekme yakalamayla girer; iframe içeriği doğrudan çizilemez.

> 💡 **İpucu:** Ses ve efekt dosyaları .pptdz paketine girmez; yalnızca sahnelerde kullanılan görsel ve videolar girer.

<a name="templates"></a>

## ▦ Şablonlar ve logo

Haber, konuşma, eğitim ve demo için hazır yayın çerçeveleri; kendi logon ve arka planınla.

1. Sahne panelinde “▦ Şablon” düğmesine bas.
2. Haber / Breaking News, solo, mobil test, masaüstü prototip, 2'li / 3'lü / 4'lü konuşma, yan yana, oyun yayını, eğitim, çift ekran ve sunum şablonlarından birini seç.
3. Tema rengini, başlığı, etiketi ve kayan yazıyı yaz; önizleme anında güncellenir.
4. İstersen logonu ve özel arka plan görselini yükle (PNG, JPEG, WebP, GIF, AVIF; en çok 12 MB).
5. “Yeni sahne olarak ekle” ya da “Aktif sahnenin katmanlarını değiştir”i seç ve uygula.

> 💡 **İpucu:** Şablon sıradan katmanlardan kurulur; uyguladıktan sonra dilediğin gibi düzenleyebilirsin.

> 💡 **İpucu:** Konuk panelleri boş gelir: konuğu “Yayına al”dığında ilk boş panele yerleşir.

<a name="show-control"></a>

## 🎬 Yayın akışı: otomatik sıra, kendi şablonların ve sistem sağlığı

Sahnelerin süreli olarak sırayla geçmesi, düzenlerini kaydedip her formatta yeniden kullanman ve takılma/ses sorunlarını önceden görmen için.

1. Sahne panelinde bir sahneyi seç, “Otomatik geç (sn)” alanına süre yaz (0 = elle). Aynı işi istediğin kadar sahne için yap.
2. “▶ Otomatik sıra”ya bas: sahneler süreleri dolunca sırayla kendiliğinden geçer, düğmede kalan süre görünür. Son sahneden sonra otomatik sıra durur; elle sahne değiştirmek sayacı yeniden başlatır.
3. Beğendiğin bir düzeni “▦ Şablon” penceresinde “+ Aktif sahneyi şablon olarak kaydet” ile sakla; “★ Benim şablonlarım”dan istediğin zaman ve istediğin formatta (16:9, 9:16…) yeni sahne ya da aktif sahnenin yerine uygula.
4. Kayıt/Canlı alanındaki “Sistem sağlığı” satırını izle: kare hızı, çizim süresi ve ses seviyesi normal değilse sebebi ve ne yapacağın yazılır (örn. düşük FPS, ses kırpılması, sekmenin arka planda kalması).
5. Kayıt dosyasının adında format yer alır (örn. proje-9x16-20261019-231500), dikey ve yatay çekimleri ayırt etmek kolaylaşır.

> 💡 **İpucu:** Benim şablonlarım bu tarayıcıda saklanır; medya dosyaları aynı tarayıcının kütüphanesinde durduğu sürece şablonla birlikte gelir.

> 💡 **İpucu:** Kayıt sırasında sekmeyi arka plana atma: tarayıcı çizimi yavaşlatır ve Sistem sağlığı bunu kırmızı uyarıyla bildirir.

<a name="vertical"></a>

## 📱 Dikey format (Reels, Shorts, TikTok) ve güvenli bölge

Aynı stüdyoda 16:9, 9:16, 4:5, 1:1 ve 4:3 çıkış: sahneler yeni formata otomatik uyarlanır, canlı yayın ve kayıt aynı boyutta çıkar.

1. Stüdyo'da sahnenin üstündeki “Format” çubuğundan 9:16 (dikey), 4:5 (portre) ya da 1:1 (kare) seç.
2. Sahneler yeni formata uyarlanır: tam ekran katmanlar tam ekran kalır, kamera ve logolar oranını korur. Beğenmezsen Ctrl+Z ile geri al.
3. “▦ Şablon” penceresinde “Dikey, 4:5 ve kare” grubundaki şablonlar çıktı formatını kendileri ayarlar.
4. “Güvenli bölge”yi aç: platform arayüzünün örteceği alanlar kırmızı, güvenli alan yeşil kesikli çizgiyle gösterilir (çıktıya girmez).
5. Canlı yayın (/live) kalitesi formata uyar: dikeyde 1080p seçeneği 1080×1920 gönderir.
6. Kayıt başlamadan önce Geri sayım (3 / 5 / 10 sn) seçebilirsin; sayaç sırasında tekrar basmak iptal eder.

> 💡 **İpucu:** Kayıt sürerken format değiştirilemez (kaydedici tuvali kilitler).

> 💡 **İpucu:** Klasik Stüdyo'da da aynı formatlar var (Kaynak & Görüntü sekmesi); ana Stüdyo'ya gönderince sahneler hedef formata uyarlanır.

<a name="camera-audio"></a>

## 🎚 Kamera ayarları, ses iyileştirme ve ducking

Parlaklık, kontrast, netlik, bulanıklık, vinyet ve sıcaklık; mikrofon için gürültü kapısı, EQ, sıkıştırıcı ve konuşurken müziği kısma.

1. Bir kamera, ekran, video veya görsel katmanı seç; sağdaki Özellikler'de “Görüntü ayarları”nı bul.
2. Doğal, Aydınlık, Canlı, Sinema, Podcast, Yumuşak, Sıcak, Soğuk, Retro, Siyah-beyaz, Gece, Loş ışık ön ayarlarından birini seç ya da sürgüleri elle ayarla.
3. Parlaklık, kontrast, doygunluk, ton, netlik/keskinlik, bulanıklık, sıcaklık ve vinyet sürgüleri anında canlı önizlemeye yansır; “Ayarları sıfırla” hepsini temizler.
4. “Ses iyileştirme” panelinde Konuşma, Podcast ya da Gürültülü ortam ön ayarını seç; gürültü kapısı eşiğini, bastırma miktarını, EQ+sıkıştırma gücünü ve uğultu filtresini ayarla.
5. Sessiz kalıp “Ortam gürültüsünü ölç” düğmesine bas: kapı eşiği ölçülen gürültünün hemen üstüne ayarlanır.
6. “Konuşurken müziği kıs”ı aç: sen konuşurken müzik kanalları kısılır, bitince yumuşakça geri gelir; sürgüyü elle oynatırsan o değer yeni taban olur.
7. Gürültülü ortamda “Yapay zeka gürültü bastırma (RNNoise)”u aç: açık kaynak bir sinir ağı sesini tarayıcıda, bilgisayarında yerel olarak temizler (ilk açılışta model birkaç saniye yüklenir).
8. NVIDIA Broadcast / RTX Voice / Krisp kullanıyorsan mikrofon listesinden “✨” işaretli sanal mikrofonu seç: tarayıcının kendi gürültü engelleme ve otomatik kazancı kapanır, ses iki kez işlenmez ve “NVIDIA / AI mikrofon” ön ayarı seçilir.
9. Gelişmiş: NVIDIA Broadcast 2.3+ yerel MCP gateway'ine (127.0.0.1:18100–18109) panelden bağlanabilirsin; gateway'in bildirdiği efektler (gürültü giderme, yankı giderme, Studio Voice…) listelenir. Tarayıcı yerel ağ erişimine izin vermeli.

> 💡 **İpucu:** Tarayıcının gürültü engelleme, yankı önleme ve otomatik kazancı mikrofon açılırken zaten etkindir; panel onun üstüne çalışır.

> 💡 **İpucu:** Kulaklık kullanmak yankıyı en iyi şekilde önler. Sunucu CPU'su yerine tarayıcı çalıştığı için ek bir hesap gerekmez.

> 💡 **İpucu:** Netlik ve vinyet gibi efektler Safari'de (ctx.filter yok) kısmen çalışır.

<a name="sound"></a>

## 🎧 Ses kütüphanesi ve geçişler

Telifsiz, kodla üretilen müzik ve ses efektleri; 28 WebGL sahne geçişi. Dosya indirmen gerekmez.

1. Stüdyo'da sağ sütundaki “Ses kütüphanesi” panelinden bir müzik parçası seç (Lo-fi Sabah, Gece Sürüşü, Yağmurlu Kafe, Podcast Açılışı, Ambient Fon); aynı düğmeyle durdur.
2. Efektleri tıkla ya da Alt+1…8 kısayoluyla çal (whoosh, ding, alkış, davul roll…).
3. Ses mikserinde müziğin seviyesini ayarla; müzik ve efektler kayda ve canlı yayına karışır.
4. Sahne panelinde “Geçiş türü” listesinden ✦ (WebGL) işaretli bir geçiş seç; süreyi ms olarak yaz.
5. “Sahne geçişinde whoosh çal” kutusu açıkken kesme dışındaki her geçişte whoosh duyulur.

> 💡 **İpucu:** WebGL kullanılamıyorsa geçiş otomatik olarak yumuşak geçişe (fade) düşer.

> 💡 **İpucu:** Müzik ve efektler tarayıcıda sentezlenir; telif veya lisans takibi gerekmez.

<a name="classic"></a>

## 🎛️ Klasik Stüdyo ve senkron

Solda düzenle, sağda canlıyı izle: taslağı “Yayına al” ile geçişli olarak canlıya aktar. Prompter metni ve sahneler ana Stüdyo ile eşleşir.

1. Yan menüden “Klasik Stüdyo”yu (/classic) aç; 8 şablondan biriyle başla.
2. Taslağı soldaki alanda düzenle; “Yayına al →” ile sağdaki canlı ekrana geçiş efektiyle aktar.
3. “+ Taslağı ekle” ile sahne listesi (rundown) oluştur; N / P ile sıradaki ve önceki sahneye geç.
4. “⇄ Ana Stüdyo'ya gönder” sahneleri ana Stüdyo'ya “↪ ad” olarak ekler (ana Stüdyo açıksa anında).
5. Klasik prompter'daki (/classic/prompter) metin, ana Stüdyo'nun prompter metniyle iki yönlü senkrondur.

> 💡 **İpucu:** Senkron aynı tarayıcıda çalışır; başka cihazla paylaşmak için Oda'yı kullan.

> 💡 **İpucu:** Logolar ve arka plan videosu sahne aktarımına dahil değildir; ana Stüdyo'da yeniden ekle.

> 💡 **İpucu:** Klasik Stüdyo'nun kendi telefon kumandası (/classic/remote) ve konuk daveti (/classic/join) vardır.

<a name="room"></a>

## 🚪 Oda: konuk daveti

Kısa bağlantı ya da QR ile konuk çağır; sen onaylayana kadar kimse bağlanmaz.

1. /room sayfasında “Odayı aç”a bas. Dört bağlantı üretilir: Konuk, İzleyici, Kumanda (telefon) ve Sohbet.
2. Bağlantıyı (/r/KOD) ya da QR'ı konuğa gönder.
3. Konuk adını yazar ve bekleme havuzuna girer; sen “Onayla”ya basınca bağlantı birkaç saniyede kendiliğinden kurulur.
4. Konuğu “Yayına al”: konuk katmanı sahneye girer. Ses düzeyini (0–150 %), susturmayı ve ses göstergesini mikserden yönet.
5. Telefonunu Kumanda bağlantısıyla uzaktan kumanda olarak kullan (sahne, prompter, mute, kayıt, işaret).

> 💡 **İpucu:** Yankıyı önlemek için herkes kulaklık kullansın; karışımda mix-minus yoktur.

> 💡 **İpucu:** Aynı anda en çok yaklaşık 8 kişi önerilir (her biri için ayrı kodlama yapılır).

> 💡 **İpucu:** “Yeni kod” eski odayı kapatır; eski bağlantılar ve QR'lar çalışmaz.

> 💡 **İpucu:** Röle yoksa (sunucusuz barındırma) arayüz “Manuel bağlantı”ya geçer: davet ve yanıt kodu değiş tokuşu.

> 💡 **İpucu:** Etkinlik günlüğü yalnızca senin tarayıcında tutulur, CSV olarak indirilebilir.

<a name="chat"></a>

## 💬 Moderasyonlu sohbet

Katılımcı mesajları, sen ya da editör onaylamadan kimseye ve yayına ulaşmaz.

1. /room'da sohbet modunu seç: onaylı (varsayılan), serbest veya kapalı.
2. Katılımcılar yazar; mesajlar onay kuyruğuna düşer. Reji veya editör onaylar, reddeder ya da düzenler.
3. Onaylanan bir mesajı yalnızca reji “Yayına al”; yayında görünmesi için katmanlar paneline “Sohbet (oda)” katmanı ekle.
4. Editör için “Editör bağlantısı” üret ve başka bir cihazda aç (/chat/KOD#k=…); editör onaylar ama yayına alamaz.
5. İzlemeyi başka yerden yapan kalabalık için Sohbet bağlantısını paylaş: onaysız, görüntüsüz, yalnızca yazma.

> 💡 **İpucu:** Mesajlar en çok 280 karakter olur ve düz metin olarak gösterilir.

> 💡 **İpucu:** Sohbet yalnızca sunucu belleğindedir; oda kapanınca silinir. Editör bağlantısını “Yenile” ile geçersiz kılabilirsin.

> 💡 **İpucu:** Sidebar'daki “Oda” girişi bekleyen istek (n) ve onay bekleyen mesaj (💬 n) rozetlerini gösterir.

<a name="live"></a>

## 📡 Canlı yayın (RTMP / RTMPS)

Program çıkışını YouTube, Facebook, Twitch, Kick, Instagram, TikTok ya da özel bir RTMP(S) adresine gönder.

1. Bu özellik için sunucuda ffmpeg ve LIVE_ADMIN_TOKEN ayarlı olmalıdır (docs/LIVE.md). Ayarlı değilse sayfa “Sunucu köprüsü hazır değil” der.
2. /live sayfasında operatör anahtarını gir.
3. Hedef ekle: platformu seç, yayın anahtarı ile sunucu adresini yapıştır (en çok 4 hedef).
4. Kaliteyi seç ve “Canlı yayına çık”a bas.
5. Bitirince yayını sonlandır.

> 💡 **İpucu:** Yayın anahtarları günlüğe yazılmaz ve sunucudan geri dönmez; tarayıcı yalnızca “bu tarayıcıda hatırla”yı işaretlersen saklar.

> 💡 **İpucu:** Gerçek platform ve RTMPS el sıkışması bu depoda henüz denenmedi; ilk yayından önce bir test yayını yap.

<a name="community"></a>

## 🤝 Topluluk, duyuru ve sponsorlar

Kanallara katıl, yayınını duyur, sponsor ve destekçileri yönet.

1. /community'de WhatsApp, LinkedIn, Instagram, YouTube, Slack ve X kanallarımıza katıl.
2. “Yayın duyurusu” ile başlık, zaman ve bağlantıdan hazır bir metin üret; WhatsApp, Telegram, LinkedIn, Facebook, X veya e-postayla paylaş (API anahtarı gerekmez).
3. Stüdyo → Sponsorlar panelinde sponsor ekle: logo, seviye, yayında göster.
4. Sahneye dönüşümlü “Sponsorlar” katmanını ekle; ekranda kalma süresi raporunu CSV olarak indir.
5. Destekçi olmak ya da sponsor kiti için /community'deki paketlere ve başvuru taslaklarına bak.

> 💡 **İpucu:** Süre, ekranda kalma süresidir; izleyici sayısı değildir.

> 💡 **İpucu:** Sponsor verileri projenle birlikte (.pptdz) taşınır; sunucuya gitmez.

<a name="install"></a>

## ⬇️ Uygulama olarak yükle

Windows, macOS, Linux, Android ve iOS'ta kendi penceresinde açılan, kendiliğinden güncellenen uygulama.

1. /download sayfasını aç; tarayıcın destekliyorsa “Uygulamayı yükle” düğmesi görünür.
2. Chrome / Edge (Windows, macOS, Linux): adres çubuğundaki “Yükle” simgesine tıkla.
3. Android: menü (⋮) → “Uygulamayı yükle” ya da “Ana ekrana ekle”.
4. iPhone / iPad: Safari'de Paylaş → “Ana Ekrana Ekle”.
5. macOS Safari 17+: Dosya → “Dock'a Ekle…”.

> 💡 **İpucu:** Telefonda açmak için /download sayfasındaki QR'ı okut.

> 💡 **İpucu:** Mağaza ve yerel kurulum dosyaları ayrı yapılardır; yayınlandıklarında /download'da görünür (docs/DOWNLOADS.md).

<a name="customize"></a>

## 🎨 Markayı ve görünümü özelleştir

Ad, slogan, “Erken erişim” etiketi, renkler, köşe yuvarlaklığı, ölçek, logo ve paylaşım bilgileri.

1. Ayarlar → “Marka ve görünüm (bu tarayıcı)”: ad, slogan, logo altı etiket, vurgu renkleri, köşe yuvarlaklığı, arayüz ölçeği ve logo; değişiklik anında uygulanır, yalnızca bu tarayıcıda kalır.
2. Herkes için kalıcı yapmak: Ayarlar → “Site, meta ve paylaşım”: açıklama, paylaşım görseli, simgeler, site adresi, X hesabı, dil ve arama motoru ayarlarını doldur.
3. Önizlemeyi ve kontrol uyarılarını incele, çıktıyı .env, JSON ya da config.ts olarak kopyala / indir.
4. Çıktıyı sunucuya (BRAND_* ortam değişkenleri) ya da src/studio/branding/config.ts dosyasına koy ve yeniden başlat.

> 💡 **İpucu:** “Logo altı etiket”i boş bırakırsan “Erken erişim” rozeti gizlenir.

> 💡 **İpucu:** Ayrıntı: docs/BRANDING.md.

<a name="privacy"></a>

## 🔒 Gizlilik ve veri

Hesap yok, veritabanı yok; ayarların ve projelerin cihazında kalır.

1. Ayarlar tarayıcı deposunda (localStorage / IndexedDB) tutulur.
2. Kamera, mikrofon ve ekran görüntün yalnızca senin açtığın doğrudan (P2P) bağlantılarda karşı tarafa gider.
3. Genel STUN (stun.l.google.com) yalnızca IP adresini görür; Ayarlar'dan kapatabilirsin.
4. Oda rölesi isimleri ve bağlantı kodlarını geçici olarak bellekte tutar; diske yazmaz.
5. Canlı yayın yaparsan program çıkışı kendi sunucundan geçip seçtiğin platforma gider.

> 💡 **İpucu:** Tam liste ve istisnalar: README.md → Güvenlik & Gizlilik.

<a name="shortcuts"></a>

## ⌨️ Klavye kısayolları

| Tuş | İşlem |
| --- | --- |
| `Shift+R` | Kaydı başlat / bitir |
| `M` | Bölüm işareti ekle |
| `Space` | Prompter başlat / durdur |
| `↑` | Prompter hızlandır |
| `↓` | Prompter yavaşlat |
| `R` | Prompter başa dön |
| `Shift+M` | Mikrofonu sustur |
| `]` | Sonraki sahne |
| `[` | Önceki sahne |
| `1–9` | Sahneye geç (sahne numarası) |

Kısayollar Ayarlar sayfasından değiştirilebilir.

<a name="faq"></a>

## ❓ Sık sorulan sorular

### Kamera veya mikrofon izni çıkmıyor.

Siteyi HTTPS ile açtığından emin ol (localhost hariç düz http'de tarayıcı cihazlara erişim vermez). Adres çubuğundaki kilit simgesinden site izinlerini kontrol et ve kamerayı başka bir uygulamanın kullanmadığından emin ol.

### Konuk bağlanamıyor (“başarısız”).

TURN sunucusu yoktur; simetrik NAT veya katı kurumsal güvenlik duvarı arkasındaki konuklar bağlanamayabilir. Konuktan mobil veri ya da başka bir ağ denemesini iste. Ayarlar'daki “Röleyi sına” ile rölenin çalıştığını doğrula.

### Yankı ya da geri besleme var.

Herkes kulaklık takmalı. Konuk sesi yayın karışımına girer ve mix-minus yoktur; hoparlörden çıkan ses mikrofona geri döner.

### Kayıt MP4 yerine WebM çıktı.

Tarayıcın MP4 kaydını desteklemiyor (ör. Firefox). Chrome, Edge veya Safari'de MP4 kaydedilir; WebM'i istediğin bir araçla dönüştürebilirsin.

### /live “Sunucu köprüsü hazır değil” diyor.

Sunucuda ffmpeg kurulu ve LIVE_ADMIN_TOKEN (en az 16 karakter) tanımlı olmalı; sunucusuz barındırmada köprü çalışmaz. Adımlar docs/LIVE.md içindedir.

### Prototip sayfam sahnede görünmüyor.

Başka alan adındaki iframe içeriği canvas'a çizilemez. “Başka sekmeyi yakala” ile ekran / sekme yakalamayı kullan; Chrome ve Edge'de bölge kırpma da vardır.

### iPhone'dan ekran paylaşamıyorum.

iOS tarayıcıları ekran paylaşımını (getDisplayMedia) desteklemez. Telefon konuk kamerası ve kumanda olarak çalışır; ekran paylaşımı için bilgisayar kullan.

### Projemi nasıl yedeklerim ya da taşırım?

Proje menüsünden “.pptdz” olarak dışa aktar ve başka bir tarayıcıda içe aktar. Ses ve efekt dosyaları pakete girmez; onları yeniden eklemen gerekir.

### Oda “röle yok” diyor.

Oda modu sunucuda tek ve uzun ömürlü bir Node süreci ister (docs/ROOM.md). Cloudflare gibi sunucusuz ortamlarda röle yoktur; arayüz otomatik olarak manuel bağlantıya geçer.

<a name="resources"></a>

## 📎 PDF, video ve bağlantılar

### Bağlantılar

- [YouTube — Teknodoz](https://www.youtube.com/@teknodoz) — Eğitim videoları ve yayın kayıtları / Tutorials and recordings
- [GitHub — kaynak kod, sorunlar, tartışmalar](https://github.com/izmgamestudios/Teknodoz-Stream-Studio) — Hata bildirimi ve katkı / Bug reports and contributions

<a name="more"></a>

## Daha fazlası

- [Oda modu, sohbet ve güvenlik modeli](ROOM.md)
- [Canlı yayın köprüsü kurulumu](LIVE.md)
- [Topluluk kanalları kurulum rehberi](COMMUNITY.md)
- [Marka ve görünüm özelleştirme](BRANDING.md)
- [Uygulama olarak yükleme ve yerel kurulum dosyaları](DOWNLOADS.md)
- [Cihaz ve tarayıcı test rehberi](DEVICE-TESTING.md)
- [Kaynakça](KAYNAKCA.md)
