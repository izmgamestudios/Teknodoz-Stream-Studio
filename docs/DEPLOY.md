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
