# Katkı rehberi / Contributing

Teşekkürler! Teknodoz Studio ücretsiz ve açık kaynaktır; hata bildirimi, belge düzeltmesi, çeviri ve kod katkıları memnuniyetle karşılanır.
Davranış kuralları: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Güvenlik açığı: [`SECURITY.md`](SECURITY.md) (herkese açık Issue açmayın).

## Nereden başlamalı?

| Ne yapmak istiyorsun | Nereye |
|---|---|
| Hata bildir / fikir öner | GitHub **Issues** (şablonlar hazır) |
| Soru sor, fikir tartış | Topluluk kanalları: [`docs/COMMUNITY.md`](docs/COMMUNITY.md) · `/community` |
| Kılavuzu geliştir / çeviri | [`docs/USER-GUIDE.md`](docs/USER-GUIDE.md) (kaynak: `src/studio/guide/content.ts`) |
| Kod katkısı | Aşağıdaki akış |

## Geliştirme ortamı

```bash
git clone https://github.com/izmgamestudios/Teknodoz-Stream-Studio.git && cd Teknodoz-Stream-Studio
npm install
npm run dev            # http://localhost:5173
npm run test           # vitest (jsdom)
npx tsc --noEmit       # tip denetimi (strict)
npx eslint .           # ESLint + Prettier (80 sütun)
npm run build          # üretim derlemesi (Cloudflare hedefi)
NITRO_PRESET=node-server npm run build   # Node sunucu derlemesi (oda rölesi + canlı köprü)
```

Mimari ve kurallar: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Kısaca:

- **Sunucusuz, veritabansız, girişsiz** ilkesi korunur; yeni bir dış servis ya da bağımlılık eklemeden önce Issue açıp tartışın.
- Katı TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). SSR açıktır: `window`/`document`/`navigator`'a modül
  seviyesinde dokunmayın.
- Dış girdi (içe aktarılan dosyalar, ağ mesajları, URL parçaları, yapılandırma) **doğrulanmadan** kullanılmaz; kullanıcı metni `innerHTML` ile basılmaz.
- Saf mantık `src/studio/<modül>/` altında olur ve yanına `*.test.ts` yazılır.
- Biçim: `npx eslint --fix <dosyalar>` (Prettier ESLint içinden çalışır).

## Değişiklik akışı

1. Issue'da kısaca konuşun (küçük düzeltmelerde şart değil).
2. `main`'den bir dal açın: `feat/…`, `fix/…`, `docs/…`.
3. Küçük, odaklı commit'ler yazın; mesaj "ne ve neden" söylesin.
4. PR göndermeden önce: `npx tsc --noEmit && npx eslint . && npm run test && npm run build`.
5. PR açıklamasında ne değiştiğini, nasıl denediğinizi ve **denemediklerinizi** dürüstçe yazın.

> Bu depo [Lovable](https://lovable.dev) ile bağlıdır: yayınlanmış git geçmişini **yeniden yazmayın** (force-push, rebase, amend, squash yok);
> `main`'e giden dalları çalışır durumda tutun.

## Belgeleri güncel tutma

| Değişiklik | Güncellenecek |
|---|---|
| Kılavuz içeriği | `src/studio/guide/content.ts` → `UPDATE_DOCS=1 npx vitest run src/studio/guide` (`docs/USER-GUIDE*.md` yeniden üretilir; güncellenmezse senkron testi başarısız olur) |
| Yeni marka alanı | `brand.ts` + `labels.ts` + `docs/BRANDING.md` (testler eksik alanı yakalar) |
| Yeni kanal / bağlantı | `src/studio/community/links.ts`, [`docs/COMMUNITY.md`](docs/COMMUNITY.md) |
| Yerel kurulum dosyası | `src/studio/pwa/downloads-config.ts`, [`docs/DOWNLOADS.md`](docs/DOWNLOADS.md) |
| Yeni kaynak/standart | [`docs/KAYNAKCA.md`](docs/KAYNAKCA.md) |

## Lisans

Katkıların MIT lisansı ([`LICENSE`](LICENSE)) altında yayınlanmasını kabul etmiş olursunuz.

---

**EN:** Open an issue first for anything non-trivial, keep the zero-server / zero-database / zero-login principle, validate all external input,
add tests next to pure logic, run `npx tsc --noEmit && npx eslint . && npm run test && npm run build` before a PR, and never rewrite published git history
(the repository is connected to Lovable).
