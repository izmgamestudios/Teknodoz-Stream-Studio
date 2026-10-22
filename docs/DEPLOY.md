# Yayına alma (CloudPanel + Node + PM2)

Proje varsayılan olarak Cloudflare Workers hedefiyle build alır (Lovable). CloudPanel'de
Nginx + Node çalıştığı için build **Node sunucu** hedefiyle alınır: `NITRO_PRESET=node-server`.

## İlk kurulum (bir kere)
1. CloudPanel'de site tipi **Node.js** (Node 22), site kullanıcısıyla SSH'a gir:
   ```bash
   ssh <site-kullanici>@<sunucu-ip>
   cd ~/htdocs/<alan-adi>
   git clone https://github.com/izmgamestudios/Teknodoz-Stream-Studio.git .
   npm install -g bun pm2
   ```
2. CloudPanel → Site → **Settings → App Port** değerini not et (örn. `3011`). Nginx bu porta yönlendirir.
3. İlk yayın:
   ```bash
   PORT=3011 bash scripts/deploy.sh
   ```
4. **SSL (Let's Encrypt) şart**: kamera, mikrofon, ekran paylaşımı ve PWA yalnızca HTTPS'te çalışır.
5. Sunucu yeniden başlayınca açılması için: `pm2 startup` (çıkan `sudo ...` satırını yetkili kullanıcıyla çalıştır), sonra `pm2 save`.

## Her güncelleme
```bash
cd ~/htdocs/<alan-adi> && PORT=3011 bash scripts/deploy.sh
```
Script şunları yapar: `git pull --ff-only` → `bun install --frozen-lockfile` → build →
PM2 `restart` (yoksa `start`) → `/studio` için 200 sağlık kontrolü. Kontrol başarısız olursa
**önceki build'e otomatik geri döner** ve son 30 log satırını yazar.

| Değişken | Varsayılan | Anlamı |
|---|---|---|
| `BRANCH` | `main` | Yayınlanacak dal |
| `PORT` | `3011` | CloudPanel'deki App Port ile aynı olmalı |
| `PM2_NAME` | `studio` | PM2 süreç adı |
| `HEALTH_PATH` | `/studio` | Sağlık kontrolü adresi |

## İzleyici sayfası ve katalog (`/watch`)
İzleyici modundaki ziyaretçiler `/watch` sayfasında canlı odaları ve katalogdaki videoları görür.
Kataloğu yönetmek için sunucuda **en az 16 karakterlik** bir anahtar tanımla:

```bash
# ~/htdocs/<alan-adi>/.env.production   (git'e girmez; chmod 600)
CATALOG_ADMIN_TOKEN=uzun-ve-rastgele-bir-anahtar
# isteğe bağlı: CATALOG_FILE=/home/<kullanici>/catalog.json   (varsayılan: ./data/catalog.json)
```
`deploy.sh` bu dosyayı otomatik okur. Sonra içerik üretici modunda **Katalog** sayfasına gir,
anahtarı yapıştır ve YouTube/Vimeo/.mp4 ya da oda bağlantısı ekle. Özel içerik parola ve/veya gizli
bağlantıyla (`/watch?item=ID&k=ANAHTAR`) açılır. Anahtar tanımlı değilse katalog salt okunurdur.
Odalar, **Oda** sayfasındaki “İzleyici sayfasında listele” ile canlı kart olarak görünür
(oda P2P olduğu için aynı anda yaklaşık 8 izleyiciyi taşır; kalabalık için YouTube canlı yayını ekle).

## Veritabanı: PocketBase (katalog + çeviriler)
Katalog ve çeviri metinleri varsayılan olarak `data/*.json` dosyalarında tutulur. Sunucuda
**PocketBase** (tek dosyalık, SQLite tabanlı veritabanı + yönetim paneli) kurmak için:

```bash
cd ~/htdocs/<alan-adi>
bash scripts/pocketbase.sh      # indirir, süper kullanıcıyı açar, PM2 ile başlatır, .env.production'a yazar
PORT=3011 bash scripts/deploy.sh
```
- PocketBase yalnızca `127.0.0.1:8090` dinler; dışarı **açılmaz**. Site, koleksiyonları
  (`catalog_items`, `i18n_messages`) ilk istekte kendisi oluşturur; tarayıcı PocketBase'e hiç
  bağlanmaz, her şey `/api/catalog` ve `/api/i18n` üzerinden ve yönetici anahtarıyla geçer.
- Yönetim paneli için SSH tüneli: `ssh -L 8090:127.0.0.1:8090 kullanici@sunucu`, sonra
  `http://127.0.0.1:8090/_/` (e-posta/parola `.env.production` içinde).
- PocketBase 0.23 veya üstü gerekir. Veriler `~/pocketbase/pb_data` altındadır; yedek için bu
  klasörü kopyalamak yeterlidir.
- PocketBase erişilemezse site son bilinen listeyi göstermeye devam eder; hiç veri yoksa API 503 döner.
- Daha önce `data/catalog.json` kullandıysan o içerikler PocketBase'e **otomatik taşınmaz**;
  Katalog sayfasından yeniden ekle.

## Yönetici girişi (oturum)
Yönetim sayfaları (`/admin`, `/library`, `/catalog`, `/translations`) ve “Site, meta ve paylaşım” ayarları
yalnızca **yönetici oturumu** açıkken görünür. Menüdeki / panel altındaki **🔒 Yönetici girişi** ile
`CATALOG_ADMIN_TOKEN` girilir; sunucu **HttpOnly, SameSite=Strict (https'te Secure)** bir çerez verir:
12 saat geçerlidir, sayfadaki betikler çerezi okuyamaz, token değişince tüm oturumlar düşer. Giriş
denemeleri sınırlıdır (10 dakikada 10). Betikler hâlâ `Authorization: Bearer <token>` kullanabilir.
Özel (private) depo için GitHub bağlantıları (kaynak kod, Issues, GitHub'daki kılavuz) yalnızca yöneticiye gösterilir.

## Watch yönetimi (`/catalog`)
Yönetici girişiyle **Watch yönetimi**: içerik ekle / düzenle / kopyala / sil, **arşivle** (izleyiciden gizlenir, silinmez),
**hikâye süresi** (24 saat, 3/7/30 gün, süresiz ya da özel tarih; süre dolunca içerik hikâye çubuğundan kalkar,
normal video olarak kalır), **öne çıkar** (sayfa üstünde büyük afiş), arama / durum / kategori filtreleri, sıralama ve
**toplu işlemler** (arşivle, geri al, sil, hikâye aç-kapat, öne çıkar). İzleyici tarafında “kaldığın yerden devam et”
bu cihazın tarayıcısında tutulur (sunucuya gitmez).

## Yönetim paneli (`/admin`)
İçerik üretici modunda menüdeki **Yönetim** sayfası (yönetici anahtarıyla): depolama durumu
(PocketBase / JSON, erişilebilir mi, kayıt sayıları), **Katalog** ve **Çeviriler** yönetimine
kısayollar ve **yedek**: tüm katalog + çevirileri tek JSON dosyası olarak indir / geri yükle.
Yedek parola özetlerini ve gizli bağlantı anahtarlarını içerir, gizli tut. Geri yükleme önce
dosyanın tamamını doğrular (geçersizse hiçbir şey değişmez), sonra aynı kimlikli kayıtları değiştirir.
Ham veriyi görmek/elle düzeltmek için PocketBase'in kendi paneli SSH tüneliyle kullanılır
(`ssh -L 8091:127.0.0.1:8091 kullanici@sunucu` → `http://127.0.0.1:8091/_/`).

## Medya kütüphanesi (`/library`)
Stüdyoda kaydedilen videolar ve yüklenen video/ses dosyaları sunucuda saklanır:

| Değişken | Varsayılan | Anlamı |
|---|---|---|
| `MEDIA_DIR` | `./data/media` | Dosyaların klasörü (yedeğe dahil et) |
| `MEDIA_MAX_MB` | `1024` | Tek dosya üst sınırı |
| `MEDIA_QUOTA_GB` | yok | Kütüphane toplam kotası (GB). Dolunca yükleme 507 ile reddedilir. Boşsa yalnızca disk sınırlar |
| `FFPROBE_PATH` | `ffprobe` | Süre/boyut okumak ve dosyanın gerçekten medya olduğunu doğrulamak için (yoksa MIME türüne güvenilir) |

Kütüphane sayfası kullanılan/boş yeri (kota ve disk) gösterir; dosyalar arama, tür/durum/kaynak/altyazı/tarih/boyut/süre filtreleri ve sıralamayla taranır.

Kayıtlar (başlık, süre, bölüm işaretleri…) katalogla aynı yerde tutulur: PocketBase'te `media_items`
koleksiyonu, yoksa `data/media.json`. Stüdyoda kayıt bitince **Kütüphaneye gönder** düğmesi
(ya da “otomatik gönder”) çıkar; yönetici anahtarı gerekir. Dosyalar `/media/<kimlik>` adresinden
Range destekli (ileri-geri sarma) yayınlanır; kimlik tahmin edilemez 64 bitlik rastgele sayıdır,
özel (parola/bağlantı) içeriklerin kimliği kilit açılmadan sayfaya hiç gönderilmez.

**Nginx sınırı:** büyük dosyalar için CloudPanel → Site → Vhost içinde `client_max_body_size 2g;`
(ya da istenen değer) olmalı, yoksa 413 alırsın. Yükleme sürerken `proxy_request_buffering off;`
da diske geçici yazmayı önler.

### Düzenleme (kırp, intro/outro) ve otomatik altyazı
`/library` → bir dosya seç → **Düzenle** / **Altyazı** sekmeleri.

- **Düzenle** sunucudaki `ffmpeg` ile çalışır (H.264 kodlayıcılı olmalı; `FFMPEG_PATH` ile yol verilebilir):
  kırpma, **başlık kartı** (tarayıcıda çizilir, Türkçe karakter sorunu olmaz) ya da kütüphaneden bir videoyu
  **intro/outro** yapma, giriş-çıkış geçişi (fade), ses seviyesi dengeleme (EBU R128) ve altyazıyı görüntüye
  gömme. Orijinal korunur; sonuç **yeni bir kayıt** olur. Önizleyip beğenirsen aynı sayfadan yayınlarsın.
  Aynı anda tek iş çalışır (sıra); ilerleme çubuğu ve iptal vardır.
- **Altyazı** açık kaynaklı **Whisper** ile sunucuda üretilir (ses hiçbir buluta gitmez):

  ```bash
  cd ~/htdocs/<alan-adi>
  bash scripts/whisper-setup.sh              # whisper.cpp (git + cmake + C++ derleyici gerekir)
  # derleyici yoksa:  bash scripts/whisper-setup.sh ctranslate2   (python3 -m venv + pip)
  PORT=3011 bash scripts/deploy.sh
  ```
  `WHISPER_MODEL_NAME=base` daha hızlı, `medium` daha doğru (2 çekirdekli sunucuda `small` önerilir).
  Üretilen altyazıyı panelde düzeltebilir, kendi `.vtt`/`.srt` dosyanı yükleyebilir ve oynatıcıda
  (CC) izleyiciye sunabilirsin. Çıkan altyazılar WebVTT olarak `MEDIA_DIR` altında saklanır.
- Ortam: `WHISPER_BACKEND` (`whisper-cpp` | `whisper-ctranslate2` | `whisper`), `WHISPER_BIN`, `WHISPER_MODEL`,
  `WHISPER_THREADS`, `WHISPER_TIMEOUT_MIN`. `bash scripts/server-info.sh` hangisinin kurulu olduğunu gösterir.
- Doğrulanamayan kısım: gerçek Whisper modelleri geliştirme ortamında indirilemedi; hat (ses çıkarma →
  CLI → WebVTT → kayıt) sahte bir CLI ile test edildi. İlk gerçek denemede kısa bir dosya ile dene.

## Çeviriler (`/translations`)
Yerleşik metinler tr/en/de/es için kodda durur. **Çeviriler** sayfasından (içerik üretici modu,
aynı yönetici anahtarı) herhangi bir metin sunucuda değiştirilir; yeni sürüm yayınlamadan tüm
ziyaretçilerde geçerli olur. “Yerleşiğe dön” kodla gelen metni geri getirir. `{n}` gibi yer
tutucular kaynakla aynı kalmalıdır.

## Sorun giderme
| Belirti | Neden / çözüm |
|---|---|
| `502 Bad Gateway` | Süreç çalışmıyor ya da port farklı. `pm2 status`, `ss -tlnp \| grep node`; `PORT` değeri App Port ile aynı mı? |
| `pm2: Process or Namespace not found` | İlk kez başlatılıyor: `deploy.sh` bunu kendisi `start` ile halleder. |
| Liste boş / sunucu yeniden başlayınca site düşüyor | `pm2 startup` + `pm2 save` yapılmamış. |
| `git pull` "local changes" hatası | `git status`; sunucuda elle düzenleme yoksa `git checkout -- .`. Script üretilen dosyaları (`bun.lock`, `src/routeTree.gen.ts`) kendisi sıfırlar; eski bir sürümle takılırsan bir kere `git checkout -- src/routeTree.gen.ts bun.lock` çalıştır. |
| Kamera / mikrofon izni hiç sorulmuyor | Site HTTPS değil. |
| Build "mammoth" bulamıyor | `bun install` tamamlanmamış; ağ/izin hatası olup olmadığına bak. |

## CI
`.github/workflows/ci.yml` her push/PR'da tip denetimi, lint, birim testleri ve Node build'ini çalıştırır.
