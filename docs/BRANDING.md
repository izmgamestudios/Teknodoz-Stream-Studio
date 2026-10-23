# Marka ve görünümü özelleştirme

Ad, logo, slogan, "Erken erişim" etiketi, renkler, köşe yuvarlaklığı, ölçek, simgeler ve paylaşım (meta) bilgileri
**tek bir doğrulanmış modelden** (`src/studio/branding/brand.ts`) beslenir: sayfa `<head>`'i (başlık, açıklama, Open Graph /
X kartı), web uygulama manifesti (`/manifest.webmanifest`), CSS tema değişkenleri ve yan menü.

## 1. Katmanlar (sonraki öncekini ezer)

| #   | Katman                      | Kim değiştirir | Nerede                                       | Kime uygulanır              |
| --- | --------------------------- | -------------- | -------------------------------------------- | --------------------------- |
| 1   | Yerleşik varsayılan         | –              | `DEFAULT_BRAND` (`brand.ts`)                 | herkes                      |
| 2   | **Sahip yapılandırması**    | proje sahibi   | `src/studio/branding/config.ts` (git'te)     | herkes (yeniden derleme)    |
| 3   | **Ortam değişkenleri**      | dağıtımı yapan | `BRAND_JSON`, `BRAND_<ALAN>` (sunucu süreci) | herkes (yeniden başlatma)   |
| 4   | **Tarayıcı geçersiz kılma** | her ziyaretçi  | Ayarlar → _Marka ve görünüm (bu tarayıcı)_   | yalnızca o tarayıcı, anında |

Tarayıcı katmanı yalnızca arayüz alanlarını kapsar (ad, kısa ad, logo yanı etiket, slogan, alt yazı, logo altı etiket, 3 renk,
köşe, ölçek, logo). Arama motorlarını, paylaşım kartlarını ve yüklü uygulamayı ilgilendiren alanlar (açıklama, site
adresi, paylaşım görseli, simgeler, tarayıcı teması…) yalnızca 2. ve 3. katmandan gelir; çünkü bir ziyaretçinin kendi
tarayıcısındaki seçimi başkasının gördüğü sayfayı değiştirmemelidir.

## 2. En kolay yol: Ayarlar sayfasındaki düzenleyici

1. **Ayarlar → Marka ve görünüm (bu tarayıcı)**: değiştir, anında gör. _Sunucu değerlerine dön_ ile geri al.
2. Herkes için kalıcı yapmak: **Ayarlar → Site, meta ve paylaşım (dağıtım sahibi)** bölümünü aç. Tüm alanlar burada.
   - Sağdaki **paylaşım önizlemesi** bir bağlantının sosyal ağlarda nasıl görüneceğini yaklaşık gösterir.
   - **Kontroller**: düşük kontrast, boş site adresi, çok uzun/kısa açıklama gibi uyarılar (engellemez).
   - **Dışa aktar**: `.env`, `JSON` ya da `config.ts` olarak kopyala/indir. **İçe aktar**: aynı biçimlerden birini yapıştır.
3. Çıktıyı §3 veya §4'e koy ve yeniden başlat/derle.

> Bu bölüm sunucuyu değiştirmez; yalnızca doğru, doğrulanmış bir yapılandırma üretir.

## 3. `config.ts` (git'te kalıcı)

```ts
// src/studio/branding/config.ts
import type { Brand } from "./brand";

export const BRAND_CONFIG: Partial<Brand> = {
  name: "Acme Studio",
  slogan: "Yayını sahnede kur",
  badge: "Beta", // "" yazarsan rozet gizlenir
  accent: "#ff8800",
  siteUrl: "https://studio.acme.example",
  twitterHandle: "@acme",
};
```

## 4. Ortam değişkenleri (sunucuda)

Tek bir JSON ya da alan başına bir değişken (tek değişkenler JSON'u ezer):

```bash
export BRAND_JSON='{"name":"Acme Studio","badge":"Beta","accent":"#ff8800"}'
export BRAND_SITE_URL='https://studio.acme.example'
export BRAND_RADIUS=0.5
NITRO_PORT=3011 NITRO_HOST=127.0.0.1 pm2 start .output/server/index.mjs --name teknodoz-studio --update-env && pm2 save
```

Geçersiz değerler **yok sayılır** ve sunucu günlüğüne `[brand] ignored invalid values: env.accent` gibi bir uyarı düşer;
uygulama asla bozuk bir değerle açılmaz. `static`/serverless ortamlarda `process.env` okunamayabilir; orada `config.ts` kullanın.

## 5. Alan tablosu

| Alan              | Varsayılan                   | Ortam değişkeni          | Ne değiştirir                                         | Tarayıcıda değişir |
| ----------------- | ---------------------------- | ------------------------ | ----------------------------------------------------- | ------------------ |
| `name`            | Teknodoz Studio              | `BRAND_NAME`             | başlıklar, paylaşım kartı, uygulama adı               | ✅                 |
| `shortName`       | Teknodoz                     | `BRAND_SHORT_NAME`       | uygulama simgesi altı                                 | ✅                 |
| `productLabel`    | STUDIO                       | `BRAND_PRODUCT_LABEL`    | logo yanındaki kelime                                 | ✅                 |
| `slogan`          | (çeviri)                     | `BRAND_SLOGAN`           | yan menü başlığı; son kelime vurgulanır               | ✅                 |
| `tagline`         | (çeviri)                     | `BRAND_TAGLINE`          | yan menü alt yazısı                                   | ✅                 |
| `badge`           | Erken erişim                 | `BRAND_BADGE`            | logo altı etiket; boş = gizli                         | ✅                 |
| `accent`          | (tema)                       | `BRAND_ACCENT`           | vurgu rengi (`--speaker-b`)                           | ✅                 |
| `accent2`         | (tema)                       | `BRAND_ACCENT2`          | ikinci vurgu (`--speaker-a`)                          | ✅                 |
| `primary`         | (tema)                       | `BRAND_PRIMARY`          | eylem rengi (`--primary`, okunur yazı rengi otomatik) | ✅                 |
| `themeColor`      | #12141a                      | `BRAND_THEME_COLOR`      | adres çubuğu / görev değiştirici rengi                | –                  |
| `backgroundColor` | #12141a                      | `BRAND_BACKGROUND_COLOR` | yüklü uygulamanın açılış rengi                        | –                  |
| `radius`          | 0.75                         | `BRAND_RADIUS`           | köşe yuvarlaklığı (rem, 0–1.5)                        | ✅                 |
| `uiScale`         | 1                            | `BRAND_UI_SCALE`         | arayüz ölçeği (0.85–1.3)                              | ✅                 |
| `logoUrl`         | "" (yerleşik yazı logosu)    | `BRAND_LOGO_URL`         | yan menü logosu                                       | ✅ (dosyadan da)   |
| `iconUrl`         | /favicon.ico                 | `BRAND_ICON_URL`         | sekme simgesi                                         | –                  |
| `icon192`         | /icons/icon-192.png          | `BRAND_ICON192`          | uygulama simgesi                                      | –                  |
| `icon512`         | /icons/icon-512.png          | `BRAND_ICON512`          | uygulama simgesi                                      | –                  |
| `maskableIcon`    | /icons/icon-maskable-512.png | `BRAND_MASKABLE_ICON`    | Android uyarlanabilir simge                           | –                  |
| `appleTouchIcon`  | /icons/apple-touch-icon.png  | `BRAND_APPLE_TOUCH_ICON` | iOS ana ekran simgesi                                 | –                  |
| `ogImage`         | /og-image.png                | `BRAND_OG_IMAGE`         | paylaşım görseli (1200×630)                           | –                  |
| `description`     | (varsayılan metin)           | `BRAND_DESCRIPTION`      | arama sonucu ve paylaşım açıklaması                   | –                  |
| `keywords`        | …                            | `BRAND_KEYWORDS`         | anahtar kelimeler                                     | –                  |
| `siteUrl`         | ""                           | `BRAND_SITE_URL`         | mutlak paylaşım ve canonical adresleri                | –                  |
| `twitterHandle`   | @infoteknodoz                | `BRAND_TWITTER_HANDLE`   | X kartındaki hesap                                    | –                  |
| `author`          | Hüseyin Bayer · Teknodoz     | `BRAND_AUTHOR`           | sayfa meta verisi                                     | –                  |
| `lang`            | tr                           | `BRAND_LANG`             | `<html lang>` ve manifest dili                        | –                  |
| `locale`          | tr_TR                        | `BRAND_LOCALE`           | `og:locale`                                           | –                  |
| `robots`          | index,follow                 | `BRAND_ROBOTS`           | arama motoru yönergesi                                | –                  |

`siteUrl`'i **mutlaka** doldurun: Open Graph görselleri ve canonical adres mutlak URL ister; boşsa bağıl kalır ve bazı
platformlar önizleme göstermez.

## 6. Logo, simge ve paylaşım görseli

Dosyalar `public/` altındadır; aynı adlı dosyaları kendi tasarımınızla değiştirmeniz yeterlidir (ya da yukarıdaki
alanlara başka bir `/yol` ya da `https://…` adresi yazın).

| Dosya                                | Boyut                        | Not                                                 |
| ------------------------------------ | ---------------------------- | --------------------------------------------------- |
| `public/favicon.ico`                 | 32×32 (çok boyutlu olabilir) | sekme simgesi                                       |
| `public/icons/icon-192.png`          | 192×192                      | PWA simgesi                                         |
| `public/icons/icon-512.png`          | 512×512                      | PWA simgesi, mağaza görseli                         |
| `public/icons/icon-maskable-512.png` | 512×512                      | içerik **orta %80** güvenli alanda, tam taşan zemin |
| `public/icons/apple-touch-icon.png`  | 180×180                      | saydamlık olmasın; iOS köşeleri kendisi yuvarlar    |
| `public/og-image.png`                | 1200×630                     | paylaşım görseli; metin kenarlardan uzak            |

Varsayılan simge ve görseller `scripts/generate-brand-assets.py` ile üretilir (Pillow gerekir):
`python3 scripts/generate-brand-assets.py`. Bunlar yer tutucu bir markadır; kendi tasarımınızla değiştirin.

Paylaşım önizlemesini yayında doğrulamak için platformların kendi araçlarını kullanın (Facebook _Sharing Debugger_,
LinkedIn _Post Inspector_); eski önizlemeler platform önbelleğinde kalabilir.

## 7. Güvenlik ve doğrulama

Tüm değerler kullanılmadan önce `zod` ile doğrulanır; CSS'e ve `<head>`'e yalnızca doğrulanmış değerler girer:

- Renkler yalnızca `#rgb` / `#rrggbb` (küçük harfe normalize edilir); sayılar sınırlıdır.
- Metinler tek satıra indirilir, kontrol ve sıfır genişlikli karakterler atılır, uzunluk sınırlıdır; hiçbir yerde HTML yorumlanmaz.
- Görsel adresleri: boş, aynı kaynaklı `/yol` (`..` ve `//` yasak), ya da kimlik bilgisiz `https://`. `javascript:` ve `http:` reddedilir.
  Tarayıcıya özel logo dosyası yüklemesi küçültülmüş bir `data:` görseli (≤ 300 KB) olarak yalnızca o tarayıcıda saklanır.
- `siteUrl` yalnızca `http(s)` kökenine indirilir (yol, sorgu ve parça atılır); X hesabı `@harf_rakam_` biçimindedir.
- Tarayıcıdaki değerler her okunuşta yeniden doğrulanır; bozulmuş bir `localStorage` kaydı arayüzü bozamaz.

## 8. Yüklü uygulama (PWA) ve manifest

`/manifest.webmanifest` sunucudan canlı üretilir (`src/server/manifest.ts`), 5 dakika önbelleğe alınır. Ad, renk veya simge
değiştiğinde: tarayıcılar manifesti belirli aralıklarla yeniden kontrol eder; **zaten yüklü** uygulamalarda yeni ad/simge
gecikmeyle yansır, iOS'ta ana ekran simgesi için uygulamanın kaldırılıp yeniden eklenmesi gerekebilir.
Ayrıntı: [`DOWNLOADS.md`](DOWNLOADS.md).

## 9. Sınırlar

- Metinler (menü, ayarlar) hâlâ yalnızca TR/EN çevirilidir; özel slogan/etiket **yazıldığı gibi** gösterilir.
- Yan menüdeki yazı logosu (`TeknodozLogo`) bir SVG+metin bileşenidir; kendi logonuz için `logoUrl` kullanın.
- Tarayıcı katmanı tek cihaz içindir; başka cihaza aktarmak için §2'deki dışa aktarmayı kullanın.
