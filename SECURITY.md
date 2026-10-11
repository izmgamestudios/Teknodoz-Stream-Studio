# Güvenlik politikası / Security policy

## Güvenlik açığı bildirme

Bir güvenlik açığı bulduysanız **herkese açık bir Issue açmayın**. Bunun yerine:

1. GitHub'da **Security → Report a vulnerability** (özel güvenlik bildirimi) bölümünü kullanın, ya da
2. **izmgamestudios@gmail.com** adresine yazın. Konuya `[SECURITY] Teknodoz Studio` ekleyin.

Lütfen şunları yazın: etkilenen sayfa/uç nokta, adımlar, beklenen ve gerçek davranış, tarayıcı/sürüm, varsa kanıt (ekran görüntüsü,
istek). Gerçek kullanıcı verisine erişmeyin, hizmeti aksatacak testler (DoS) yapmayın.

Hedefimiz bildirime **birkaç gün içinde yanıt vermek**, düzeltmeyi koordineli biçimde yayınlamak ve isterseniz teşekkür bölümünde
adınızı anmaktır. Bunlar taahhüt değil, iyi niyetli hedeflerdir (proje gönüllü olarak sürdürülür).

## Kapsam

| Kapsam içinde | Kapsam dışı |
|---|---|
| Bu depodaki kod ve belgeler | Üçüncü taraf platformlar (YouTube, Facebook…), tarayıcı açıkları |
| Oda rölesi (`/api/room`), canlı köprü (`/api/live`), manifest ve marka katmanı | Kendi sunucunuzun yanlış yapılandırması (ör. `LIVE_ADMIN_TOKEN` paylaşmak) |
| URL/girdi doğrulama (`.pptdz` içe aktarma, P2P mesajları, marka ve bağlantı yapılandırmaları) | Sosyal mühendislik, fiziksel erişim |

## Tasarım gereği güvenlik özellikleri

- Hesap ve veritabanı yoktur; ayarlar yalnızca tarayıcıdadır.
- Dış girdi (`.pptdz`, P2P mesajları, URL parçaları, marka/indirme/kılavuz yapılandırması) `zod` ya da elle yazılmış katı doğrulayıcılardan
  geçer; `innerHTML` kullanılmaz.
- Canlı yayın köprüsü varsayılan olarak **kapalıdır**; `LIVE_ADMIN_TOKEN`, ana makine izin listesi, SSRF koruması ve kaynak sınırları
  vardır. Ayrıntı: [`docs/LIVE.md`](docs/LIVE.md). Oda rölesi: [`docs/ROOM.md`](docs/ROOM.md).
- Yayın anahtarları günlüğe yazılmaz ve sunucu yanıtlarında dönmez.

## Desteklenen sürümler

Yalnızca `main` dalındaki güncel sürüm düzeltme alır.

## Sırlar

Yayın anahtarlarını, `LIVE_ADMIN_TOKEN`'ı ve parolaları **asla** depoya, Issue'ya ya da sohbet kanallarına yazmayın. Sızdıysa hemen yenileyin.
