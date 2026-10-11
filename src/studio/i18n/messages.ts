// src/studio/i18n/messages.ts
// UI strings for the pages that guests and the settings screen use. Turkish is the source
// language; every key must exist in English (enforced by the `Record<MessageKey, string>` type).
// The studio panels are not translated yet.
export type Lang = "tr" | "en";

export const tr = {
  // shell / navigation
  "nav.menu": "Ana menü",
  "nav.prompter": "Prompter",
  "nav.prompter.hint": "Metin, kamera, kayıt",
  "nav.studio": "Stüdyo",
  "nav.studio.hint": "Sahne, katman, kayıt",
  "nav.room": "Oda",
  "nav.room.hint": "Konuk, telefon, onaylar",
  "nav.live": "Canlı yayın",
  "nav.live.hint": "YouTube, Instagram, TikTok… (RTMPS)",
  "nav.settings": "Ayarlar",
  "nav.settings.hint": "Çıkış, kısayol, dil",
  "shell.workspace": "Yayıncı çalışma alanı",
  "shell.headline.a": "Yayını",
  "shell.headline.b": "sahnede kur.",
  "shell.tagline":
    "Prompter, kayıt ve stüdyo tek yerde. Her şey tarayıcında kalır.",
  "shell.modules": "Modüller",
  "shell.local": "100% client-side · gizlilik odaklı",
  "shell.pending": "{n} bekleyen istek",

  // credits
  "credits.developer": "Geliştirici",
  "credits.about": "Hakkında / Künye",
  "credits.email": "E-posta",
  "credits.phone": "Telefon",
  "credits.source": "Kaynak kod",
  "credits.license": "Lisans",
  "credits.privacy":
    "Sunucu yok, veritabanı yok, giriş yok. Kamera, mikrofon ve ekran görüntüsü cihazınızdan çıkmaz; ayarlar ve medya dosyaları yalnızca bu tarayıcıda (localStorage / IndexedDB) saklanır. Oda bağlantıları için küçük bir röle yalnızca bağlantı kurulumuna aracılık eder.",

  // common
  "common.copy": "Kopyala",
  "common.copied": "✓ Kopyalandı",
  "common.cancel": "İptal",
  "common.reset": "Sıfırla",
  "common.on": "Açık",
  "common.off": "Kapalı",

  // manual connect (/join, /remote)
  "join.title": "Yayına katıl",
  "remote.title": "Telefon kumandası",
  "connect.step1": "1. adım — daveti doğrulayın",
  "connect.inviteLabel": "Davet bağlantısı veya kodu",
  "connect.invitePlaceholder": "Bağlantı otomatik gelmediyse buraya yapıştırın",
  "connect.name": "Adınız (yayıncı görür)",
  "connect.stun":
    "Genel STUN kullan (internet üzerinden bağlanmak için; yalnızca IP adresiniz STUN sağlayıcısına görünür)",
  "connect.continue": "Devam",
  "connect.preparing": "Hazırlanıyor…",
  "connect.privacy":
    "Kamera, mikrofon veya ekran görüntünüz hiçbir sunucuya gitmez; yalnızca yayıncının tarayıcısıyla doğrudan (P2P) paylaşılır.",
  "connect.step2": "2. adım — yanıt kodunu yayıncıya gönderin",
  "connect.step2.body":
    "Aşağıdaki kodu kopyalayıp yayıncıya iletin; yayıncı “Yanıt kodu” kutusuna yapıştırınca bağlantı otomatik kurulur.",
  "connect.answerLabel": "Yanıt kodu",
  "connect.copyCode": "Kodu kopyala",
  "connect.waitingHost": "Yayıncının kodu girmesi bekleniyor…",
  "connect.lost": "Bağlantı koptu. Sayfayı yenileyip yeni bir davet isteyin.",

  // room landing (/r/<code>)
  "room.title": "Yayına katıl",
  "room.code": "Oda",
  "room.checking": "Oda kontrol ediliyor…",
  "room.missing":
    "Bu oda bulunamadı veya süresi doldu. Yayıncıdan yeni bir bağlantı isteyin.",
  "room.closed": "Bu oda kapatılmış.",
  "room.unavailable":
    "Bu sunucuda hızlı oda bağlantısı kullanılamıyor. Yayıncıdan “manuel bağlantı” daveti isteyin.",
  "room.how": "Nasıl katılmak istiyorsunuz?",
  "room.role.guest": "Konuk",
  "room.role.guest.hint": "Kamera ve mikrofonla yayına çıkarım",
  "room.role.viewer": "İzleyici",
  "room.role.viewer.hint": "Yalnızca yayını izlerim",
  "room.role.remote": "Telefon kumandası",
  "room.role.remote.hint": "Sahne, prompter ve kaydı yönetirim",
  "room.role.chat": "Yalnızca sohbet",
  "room.role.chat.hint": "Mesaj yazarım; görüntü ve ses göndermem",
  "room.chatting": "Sohbetesiniz",
  "room.chatting.body":
    "Mesajlarınız yayından önce yöneticinin onayından geçer. Onaylananlar herkese görünür.",
  "shell.pendingChat": "{n} onay bekleyen sohbet mesajı",
  "room.joinAs": "{role} olarak katılacaksınız.",
  "room.name": "Adınız (yayıncı görür)",
  "room.hostOffline":
    "Yayıncı şu an çevrimdışı görünüyor. İstek göndermeye devam edebilirsiniz; yayıncı döndüğünde görür.",
  "room.hostOffline.short": "Yayıncı şu an çevrimdışı görünüyor.",
  "room.rejected": "Yayıncı isteğinizi reddetti.",
  "room.closedNow": "Oda kapatıldı. Yeni bir bağlantı isteyin.",
  "room.send": "Katılma isteği gönder",
  "room.sending": "Gönderiliyor…",
  "room.advanced": "Gelişmiş",
  "room.stun":
    "Genel STUN kullan (internet üzerinden bağlanmak için; yalnızca IP adresiniz STUN sağlayıcısına görünür).",
  "room.privacy":
    "Kamera, mikrofon veya ekran görüntünüz hiçbir sunucuya gitmez; yalnızca yayıncının tarayıcısıyla doğrudan (P2P) paylaşılır. Sunucu yalnızca bağlantı kurulumuna aracılık eder.",
  "room.waiting": "Yayıncının onayı bekleniyor…",
  "room.waiting.body":
    "İsteğiniz stüdyodaki bekleme havuzuna düştü. Onaylanınca otomatik bağlanacaksınız; bu sayfayı açık tutun.",
  "room.giveUp": "Vazgeç",
  "room.connecting": "Onaylandı — bağlanılıyor…",
  "room.connecting.body": "Bu birkaç saniye sürebilir.",
  "room.err.rate-limited":
    "Çok fazla deneme yapıldı. Biraz bekleyip tekrar deneyin.",
  "room.err.full": "Bekleme havuzu dolu. Yayıncıdan yer açmasını isteyin.",
  "room.err.closed": "Oda kapatılmış.",
  "room.err.not-found": "Oda bulunamadı.",
  "room.err.forbidden": "Oturum süresi doldu. Tekrar katılma isteği gönderin.",
  "room.err.network":
    "Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.",
  "room.err.default": "Katılma isteği gönderilemedi.",

  // connected views
  "view.status.connecting": "Bağlanıyor…",
  "view.status.connected": "Bağlandı — yayını izliyorsunuz",
  "view.status.requesting": "Katılma isteği gönderiliyor…",
  "view.status.waiting":
    "Kulistesiniz. Yayıncı sizi yayına alınca görüntünüz yayınlanır.",
  "view.status.on-air": "● Yayındasınız — kulaklık takmanız önerilir",
  "view.status.rejected": "Yayıncı isteğinizi reddetti.",
  "view.status.disconnected": "Bağlantı koptu.",
  "view.sound": "🔊 Sesi aç",
  // room chat (participant side)
  "chat.title": "Sohbet",
  "chat.placeholder": "Bir mesaj yazın…",
  "chat.send": "Gönder",
  "chat.empty": "Henüz mesaj yok.",
  "chat.moderated": "Mesajlar yayınlanmadan önce yönetici onayından geçer.",
  "chat.off": "Sohbet şu an kapalı.",
  "chat.pending": "Onay bekliyor",
  "chat.rejected": "Yayınlanmadı",
  "chat.onair": "Yayında",
  "chat.offline": "Sohbet bağlantısı yeniden kuruluyor…",
  "chat.err.rate-limited": "Çok hızlı yazıyorsunuz, biraz bekleyin.",
  "chat.err.queue-full": "Onay kuyruğu dolu, birazdan tekrar deneyin.",
  "chat.err.chat-closed": "Sohbet kapalı.",
  "chat.err.default": "Mesaj gönderilemedi.",
  "view.guest.title": "Konuk olarak yayına çık",
  "view.guest.test": "🎥 Kamera ve mikrofonu test et",
  "view.guest.name": "Adınız",
  "view.guest.mic": "Mikrofon seviyesi",
  "view.guest.join": "Kulise gir (istek gönder)",
  "view.guest.leave": "Ayrıl (izleyiciye dön)",
  "view.guest.cameraOff": "Kamerayı kapat",
  "view.guest.err.media": "Kamera/mikrofon açılamadı.",
  "view.guest.err.send": "İstek gönderilemedi.",
  "remote.heading": "📱 Kumanda",
  "remote.ready": "hazır",
  "remote.waitState": "Stüdyodan durum bekleniyor…",
  "remote.scenes": "Sahneler",
  "remote.prompter": "Prompter",
  "remote.play": "▶ Kaydır",
  "remote.pause": "❚❚ Durdur",
  "remote.slower": "Yavaşlat",
  "remote.faster": "Hızlandır",
  "remote.rewind": "⏮ Başa dön",
  "remote.speed": "Hız: {n} px/sn",
  "remote.recordGroup": "Kayıt ve ses",
  "remote.rec": "● Kayda başla",
  "remote.stop": "■ Kaydı bitir",
  "remote.marker": "🔖 İşaret",
  "remote.micOn": "🎙 Mikrofon açık",
  "remote.micOff": "🔇 Mikrofon kapalı",

  // settings
  "settings.title": "Ayarlar",
  "settings.intro":
    "Ayarlar bu tarayıcıda saklanır ve proje dosyasına (.pptdz) dahil edilir.",
  "settings.output": "Çıkış (kayıt ve yayın)",
  "settings.output.resolution": "Çözünürlük",
  "settings.output.resolution.custom": "Özel",
  "settings.output.fps": "Kare hızı",
  "settings.output.videoBitrate": "Video bit hızı: {n} Mbps",
  "settings.output.audioBitrate": "Ses bit hızı",
  "settings.output.container": "Kayıt biçimi",
  "settings.output.container.auto": "Otomatik (MP4 varsa MP4, yoksa WebM)",
  "settings.output.estimate": "Tahmini dosya boyutu: ≈ {mb} MB / dakika",
  "settings.output.locked": "Kayıt sürerken çıkış ayarları değiştirilemez.",
  "settings.output.heavy":
    "Yüksek çözünürlük ve 60 fps ağır bir işlemci yükü getirir; kare atlanırsa 1080p30'a düşün.",
  "settings.connection": "Bağlantı (P2P)",
  "settings.stun": "Genel STUN sunucusu kullan",
  "settings.stun.body":
    "Açıkken internet üzerinden bağlanabilirsiniz; STUN sağlayıcısı (Google) yalnızca IP adresinizi görür, görüntü/ses/kod görmez. Kapalıyken yalnızca aynı yerel ağdaki cihazlar bağlanır. Yeni davetlerde geçerlidir.",
  "settings.stun.busy":
    "Bağlı kişiler varken değişiklik, onlar ayrılınca uygulanır.",
  "settings.relay": "Oda rölesi",
  "settings.relay.check": "Röleyi sına",
  "settings.relay.ok": "✓ Röle erişilebilir",
  "settings.relay.fail":
    "✗ Röle yok (statik/serverless barındırma). Manuel bağlantı kullanılır.",
  "settings.shortcuts": "Kısayollar",
  "settings.shortcuts.body":
    "Bir satırın “Değiştir” düğmesine basın, sonra yeni tuş kombinasyonuna basın. Esc iptal eder. Sahne kısayolları (1–9) Stüdyo’daki sahne panelinden verilir.",
  "settings.shortcuts.change": "Değiştir",
  "settings.shortcuts.press": "Bir tuşa basın…",
  "settings.shortcuts.reset": "Varsayılana dön",
  "settings.shortcuts.conflict":
    "Çakışma: {a} ve {b} aynı tuşu kullanıyor ({combo}).",
  "settings.lang": "Dil",
  "settings.lang.body":
    "Yan menü, ayarlar ve konuk/kumanda sayfaları çevrilir. Stüdyo panelleri henüz yalnızca Türkçe.",
  "settings.reset.all": "Tüm ayarları varsayılana döndür",
  "settings.reset.confirm": "Tüm ayarlar varsayılana dönsün mü?",
  "action.record.toggle": "Kaydı başlat / bitir",
  "action.marker.add": "Bölüm işareti ekle",
  "action.prompter.toggle": "Prompter başlat / durdur",
  "action.prompter.speedUp": "Prompter hızlandır",
  "action.prompter.speedDown": "Prompter yavaşlat",
  "action.prompter.rewind": "Prompter başa dön",
  "action.audio.muteMic": "Mikrofonu sustur",
  "action.scene.next": "Sonraki sahne",
  "action.scene.prev": "Önceki sahne",
} as const;

export type MessageKey = keyof typeof tr;

export const en: Record<MessageKey, string> = {
  "nav.menu": "Main menu",
  "nav.prompter": "Prompter",
  "nav.prompter.hint": "Script, camera, record",
  "nav.studio": "Studio",
  "nav.studio.hint": "Scenes, layers, record",
  "nav.room": "Room",
  "nav.room.hint": "Guests, phone, approvals",
  "nav.live": "Go live",
  "nav.live.hint": "YouTube, Instagram, TikTok… (RTMPS)",
  "nav.settings": "Settings",
  "nav.settings.hint": "Output, shortcuts, language",
  "shell.workspace": "Broadcaster workspace",
  "shell.headline.a": "Build the show",
  "shell.headline.b": "on stage.",
  "shell.tagline":
    "Prompter, recording and studio in one place. Everything stays in your browser.",
  "shell.modules": "Modules",
  "shell.local": "100% client-side · privacy first",
  "shell.pending": "{n} pending requests",

  "credits.developer": "Developer",
  "credits.about": "About / Credits",
  "credits.email": "Email",
  "credits.phone": "Phone",
  "credits.source": "Source code",
  "credits.license": "License",
  "credits.privacy":
    "No server, no database, no login. Camera, microphone and screen never leave your device; settings and media files stay in this browser (localStorage / IndexedDB). For room links a small relay only helps to set up the connection.",

  "common.copy": "Copy",
  "common.copied": "✓ Copied",
  "common.cancel": "Cancel",
  "common.reset": "Reset",
  "common.on": "On",
  "common.off": "Off",

  "join.title": "Join the stream",
  "remote.title": "Phone remote",
  "connect.step1": "Step 1 — verify the invite",
  "connect.inviteLabel": "Invite link or code",
  "connect.invitePlaceholder":
    "Paste it here if it did not fill in automatically",
  "connect.name": "Your name (the host sees it)",
  "connect.stun":
    "Use public STUN (to connect over the internet; only your IP address is visible to the STUN provider)",
  "connect.continue": "Continue",
  "connect.preparing": "Preparing…",
  "connect.privacy":
    "Your camera, microphone or screen never go to any server; they are shared directly (P2P) with the host's browser only.",
  "connect.step2": "Step 2 — send the answer code to the host",
  "connect.step2.body":
    "Copy the code below and send it to the host; when they paste it into the “Answer code” box the connection is made automatically.",
  "connect.answerLabel": "Answer code",
  "connect.copyCode": "Copy code",
  "connect.waitingHost": "Waiting for the host to enter the code…",
  "connect.lost": "Connection lost. Reload the page and ask for a new invite.",

  "room.title": "Join the stream",
  "room.code": "Room",
  "room.checking": "Checking the room…",
  "room.missing":
    "This room was not found or has expired. Ask the host for a new link.",
  "room.closed": "This room has been closed.",
  "room.unavailable":
    "Quick room links are not available on this server. Ask the host for a “manual connection” invite.",
  "room.how": "How do you want to join?",
  "room.role.guest": "Guest",
  "room.role.guest.hint": "I go on air with camera and microphone",
  "room.role.viewer": "Viewer",
  "room.role.viewer.hint": "I only watch the stream",
  "room.role.remote": "Phone remote",
  "room.role.remote.hint": "I control scenes, prompter and recording",
  "room.role.chat": "Chat only",
  "room.role.chat.hint": "I write messages; no video or audio",
  "room.chatting": "You are in the chat",
  "room.chatting.body":
    "Your messages are reviewed by the host before they appear. Approved ones are visible to everyone.",
  "shell.pendingChat": "{n} chat messages awaiting approval",
  "room.joinAs": "You will join as {role}.",
  "room.name": "Your name (the host sees it)",
  "room.hostOffline":
    "The host seems to be offline. You can still send the request; they will see it when they return.",
  "room.hostOffline.short": "The host seems to be offline.",
  "room.rejected": "The host declined your request.",
  "room.closedNow": "The room was closed. Ask for a new link.",
  "room.send": "Send join request",
  "room.sending": "Sending…",
  "room.advanced": "Advanced",
  "room.stun":
    "Use public STUN (to connect over the internet; only your IP address is visible to the STUN provider).",
  "room.privacy":
    "Your camera, microphone or screen never go to any server; they are shared directly (P2P) with the host's browser only. The server only helps to set up the connection.",
  "room.waiting": "Waiting for the host's approval…",
  "room.waiting.body":
    "Your request is in the studio's waiting pool. You will connect automatically once approved; keep this page open.",
  "room.giveUp": "Cancel",
  "room.connecting": "Approved — connecting…",
  "room.connecting.body": "This can take a few seconds.",
  "room.err.rate-limited": "Too many attempts. Wait a moment and try again.",
  "room.err.full": "The waiting pool is full. Ask the host to make room.",
  "room.err.closed": "The room is closed.",
  "room.err.not-found": "Room not found.",
  "room.err.forbidden": "Your session expired. Send the join request again.",
  "room.err.network":
    "Could not reach the server. Check your internet connection.",
  "room.err.default": "The join request could not be sent.",

  "view.status.connecting": "Connecting…",
  "view.status.connected": "Connected — you are watching the stream",
  "view.status.requesting": "Sending join request…",
  "view.status.waiting":
    "You are in the green room. Your video goes live when the host brings you on air.",
  "view.status.on-air": "● You are on air — headphones recommended",
  "view.status.rejected": "The host declined your request.",
  "view.status.disconnected": "Connection lost.",
  "view.sound": "🔊 Turn sound on",
  // room chat (participant side)
  "chat.title": "Chat",
  "chat.placeholder": "Write a message…",
  "chat.send": "Send",
  "chat.empty": "No messages yet.",
  "chat.moderated": "Messages are reviewed by the host before they appear.",
  "chat.off": "Chat is currently closed.",
  "chat.pending": "Awaiting approval",
  "chat.rejected": "Not published",
  "chat.onair": "On air",
  "chat.offline": "Reconnecting to the chat…",
  "chat.err.rate-limited": "You are typing too fast, please wait a moment.",
  "chat.err.queue-full": "The approval queue is full, try again shortly.",
  "chat.err.chat-closed": "Chat is closed.",
  "chat.err.default": "The message could not be sent.",
  "view.guest.title": "Go on air as a guest",
  "view.guest.test": "🎥 Test camera and microphone",
  "view.guest.name": "Your name",
  "view.guest.mic": "Microphone level",
  "view.guest.join": "Enter the green room (send request)",
  "view.guest.leave": "Leave (back to viewer)",
  "view.guest.cameraOff": "Turn camera off",
  "view.guest.err.media": "Could not open camera/microphone.",
  "view.guest.err.send": "The request could not be sent.",
  "remote.heading": "📱 Remote",
  "remote.ready": "ready",
  "remote.waitState": "Waiting for the studio state…",
  "remote.scenes": "Scenes",
  "remote.prompter": "Prompter",
  "remote.play": "▶ Scroll",
  "remote.pause": "❚❚ Pause",
  "remote.slower": "Slower",
  "remote.faster": "Faster",
  "remote.rewind": "⏮ Rewind",
  "remote.speed": "Speed: {n} px/s",
  "remote.recordGroup": "Recording and audio",
  "remote.rec": "● Start recording",
  "remote.stop": "■ Stop recording",
  "remote.marker": "🔖 Marker",
  "remote.micOn": "🎙 Microphone on",
  "remote.micOff": "🔇 Microphone muted",

  "settings.title": "Settings",
  "settings.intro":
    "Settings are stored in this browser and included in the project file (.pptdz).",
  "settings.output": "Output (recording and stream)",
  "settings.output.resolution": "Resolution",
  "settings.output.resolution.custom": "Custom",
  "settings.output.fps": "Frame rate",
  "settings.output.videoBitrate": "Video bitrate: {n} Mbps",
  "settings.output.audioBitrate": "Audio bitrate",
  "settings.output.container": "Recording format",
  "settings.output.container.auto":
    "Automatic (MP4 if supported, otherwise WebM)",
  "settings.output.estimate": "Estimated file size: ≈ {mb} MB / minute",
  "settings.output.locked":
    "Output settings cannot be changed while recording.",
  "settings.output.heavy":
    "High resolution at 60 fps is CPU-heavy; if frames drop, switch to 1080p30.",
  "settings.connection": "Connection (P2P)",
  "settings.stun": "Use a public STUN server",
  "settings.stun.body":
    "When on, you can connect over the internet; the STUN provider (Google) only sees your IP address, never video, audio or codes. When off, only devices on the same local network can connect. Applies to new invites.",
  "settings.stun.busy":
    "While people are connected the change applies once they leave.",
  "settings.relay": "Room relay",
  "settings.relay.check": "Test relay",
  "settings.relay.ok": "✓ Relay reachable",
  "settings.relay.fail":
    "✗ No relay (static/serverless hosting). Manual connection is used.",
  "settings.shortcuts": "Shortcuts",
  "settings.shortcuts.body":
    "Press “Change” on a row, then press the new key combination. Esc cancels. Scene shortcuts (1–9) are set in the Studio scene panel.",
  "settings.shortcuts.change": "Change",
  "settings.shortcuts.press": "Press a key…",
  "settings.shortcuts.reset": "Restore defaults",
  "settings.shortcuts.conflict":
    "Conflict: {a} and {b} use the same key ({combo}).",
  "settings.lang": "Language",
  "settings.lang.body":
    "The side menu, settings and the guest/remote pages are translated. Studio panels are Turkish only for now.",
  "settings.reset.all": "Reset all settings to defaults",
  "settings.reset.confirm": "Reset all settings to defaults?",
  "action.record.toggle": "Start / stop recording",
  "action.marker.add": "Add chapter marker",
  "action.prompter.toggle": "Prompter start / pause",
  "action.prompter.speedUp": "Prompter faster",
  "action.prompter.speedDown": "Prompter slower",
  "action.prompter.rewind": "Prompter rewind",
  "action.audio.muteMic": "Mute microphone",
  "action.scene.next": "Next scene",
  "action.scene.prev": "Previous scene",
};

export const MESSAGES: Record<Lang, Record<MessageKey, string>> = { tr, en };

export function translate(
  lang: Lang,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  let s: string = MESSAGES[lang][key] ?? tr[key] ?? key;
  if (vars)
    for (const [k, v] of Object.entries(vars))
      s = s.split(`{${k}}`).join(String(v));
  return s;
}
