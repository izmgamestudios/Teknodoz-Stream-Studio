// src/studio/guide/content.ts
// The user guide, ONE source for the /guide page and docs/USER-GUIDE(.en).md (see markdown.ts and
// content.test.ts, which fails when the Markdown files are out of date).
// Rule: only describe what the app really does (README.md / docs/*.md are the references).
import type { Lang } from "../i18n/messages";

export type GuideRoute =
  | "/"
  | "/studio"
  | "/room"
  | "/live"
  | "/community"
  | "/download"
  | "/settings";

export interface GuideText {
  title: string;
  summary: string;
  steps: readonly string[];
  tips?: readonly string[];
}

export interface GuideSection {
  id: string;
  icon: string;
  /** page to open next to this section */
  to?: GuideRoute;
  tr: GuideText;
  en: GuideText;
}

export interface GuideFaq {
  id: string;
  tr: { q: string; a: string };
  en: { q: string; a: string };
}

export const GUIDE: readonly GuideSection[] = [
  {
    id: "start",
    icon: "🚀",
    to: "/studio",
    tr: {
      title: "Hızlı başlangıç (5 dakika)",
      summary:
        "Kurulum, hesap ya da veritabanı yok: her şey tarayıcında çalışır.",
      steps: [
        "Siteyi HTTPS ile aç (kamera ve mikrofon yalnızca güvenli bağlantıda çalışır).",
        "Prompter'da (/) metnini yapıştır ya da .txt / .md / .srt / .docx içe aktar; Boşluk tuşuyla başlat.",
        "Stüdyo'da (/studio) kamera ve mikrofonu seç, “▦ Şablon” ile hazır bir sahne ekle.",
        "Kaydı başlat (Shift+R). M tuşuyla bölüm işareti ekle.",
        "Kayıt bitince video, chapters.txt ve .srt birlikte iner.",
        "Konuk çağıracaksan Oda'yı (/room), canlı yayın için Canlı yayın'ı (/live) aç.",
      ],
      tips: [
        "Projeni “.pptdz” olarak dışa aktar: sahneler, katmanlar, prompter metni ve görseller tek dosyada yedeklenir.",
      ],
    },
    en: {
      title: "Quick start (5 minutes)",
      summary:
        "No install, account or database: everything runs in your browser.",
      steps: [
        "Open the site over HTTPS (camera and microphone only work on secure connections).",
        "In the Prompter (/) paste your script or import .txt / .md / .srt / .docx; start with the Space key.",
        "In the Studio (/studio) pick your camera and microphone and add a ready-made scene with “▦ Şablon”.",
        "Start recording (Shift+R). Press M to add a chapter marker.",
        "When the recording ends the video, chapters.txt and .srt download together.",
        "To invite guests open Room (/room); to go live open Live (/live).",
      ],
      tips: [
        "Export your project as “.pptdz”: scenes, layers, the prompter script and images are saved in one file.",
      ],
    },
  },
  {
    id: "prompter",
    icon: "📜",
    to: "/",
    tr: {
      title: "Prompter",
      summary:
        "Kayda girmeyen HUD ya da yayına işlenen altyazı olarak okuma metni.",
      steps: [
        "Metni yapıştır veya dosyadan içe aktar (.txt, .md, .srt, .docx).",
        "Hız, yazı boyutu, satır aralığı, kontrast ve ayna (ekran yansıtma) ayarlarını yap.",
        "Boşluk ile başlat / durdur, ↑ ↓ ile hızı değiştir, R ile başa dön.",
        "Metnin yayında da görünmesi için “burn-in” (altyazı, kayan şerit veya kamera altı notch) seç.",
      ],
      tips: [
        "HUD yalnızca sende görünür; kayda ve yayına girmez.",
        "Sesle takip (Chrome / Edge) varsayılan olarak kapalıdır; açarsan ses Google'a gidebilir, arayüz seni uyarır.",
      ],
    },
    en: {
      title: "Prompter",
      summary:
        "Reading text as a HUD that is never recorded, or as captions burned into the stream.",
      steps: [
        "Paste the text or import a file (.txt, .md, .srt, .docx).",
        "Adjust speed, font size, line spacing, contrast and mirror.",
        "Space starts / stops, ↑ ↓ change the speed, R rewinds.",
        "To show the text on the stream too, choose “burn-in” (captions, ticker strip or under-camera notch).",
      ],
      tips: [
        "The HUD is visible only to you; it never reaches the recording or the stream.",
        "Voice follow (Chrome / Edge) is off by default; when on, audio may go to Google and the interface warns you.",
      ],
    },
  },
  {
    id: "studio",
    icon: "🎬",
    to: "/studio",
    tr: {
      title: "Stüdyo: sahneler ve katmanlar",
      summary: "Sınırsız sahne, katmanlı kompozisyon, kayıt.",
      steps: [
        "Kaynak çubuğundan kamera, mikrofon ve ekran paylaşımını seç.",
        "Sahne panelinden sahne ekle; 1–9 tuşlarıyla sahneler arasında geç (kesme, fade veya slide geçişi).",
        "Katmanlar panelinde “+ Katman ekle…” ile kamera, ekran, görsel, metin, şekil gibi katmanlar ekle; sıralarını, görünürlüklerini, kilitlerini, opaklık ve karışım modlarını ayarla.",
        "Katmanı sahnede sürükleyerek taşı, tutamaçlarla boyutlandır / döndür (Shift: oran / 15°, Alt: merkezden).",
        "Gerekirse kamera katmanında yeşil perdeyi (chroma key) aç.",
        "Ayarlar'dan çözünürlük, kare hızı ve bit hızını seç; kaydı başlat. Tarayıcı destekliyorsa MP4, yoksa WebM kaydedilir.",
      ],
      tips: [
        "Prototip (mobil 390×844 / masaüstü çerçeve) görüntüsü ekran ya da sekme yakalamayla girer; iframe içeriği doğrudan çizilemez.",
        "Ses ve efekt dosyaları .pptdz paketine girmez; yalnızca sahnelerde kullanılan görsel ve videolar girer.",
      ],
    },
    en: {
      title: "Studio: scenes and layers",
      summary: "Unlimited scenes, layered compositions, recording.",
      steps: [
        "Pick camera, microphone and screen share in the source bar.",
        "Add scenes in the scene panel; switch with keys 1–9 (cut, fade or slide transition).",
        "In the layers panel use “+ Katman ekle…” to add camera, screen, image, text or shape layers; set order, visibility, lock, opacity and blend mode.",
        "Drag a layer on the stage to move it, use the handles to resize / rotate (Shift: ratio / 15°, Alt: from center).",
        "Turn on the green screen (chroma key) on a camera layer if needed.",
        "Choose resolution, frame rate and bit rate in Settings, then record. MP4 is used when the browser supports it, otherwise WebM.",
      ],
      tips: [
        "Prototype (mobile 390×844 / desktop frame) video enters through screen or tab capture; iframe content cannot be drawn directly.",
        "Audio and effect files are not part of the .pptdz bundle; only images and videos used in scenes are.",
      ],
    },
  },
  {
    id: "templates",
    icon: "▦",
    to: "/studio",
    tr: {
      title: "Şablonlar ve logo",
      summary:
        "Haber, konuşma, eğitim ve demo için hazır yayın çerçeveleri; kendi logon ve arka planınla.",
      steps: [
        "Sahne panelinde “▦ Şablon” düğmesine bas.",
        "Haber / Breaking News, solo, mobil test, masaüstü prototip, 2'li / 3'lü / 4'lü konuşma, yan yana, oyun yayını, eğitim, çift ekran ve sunum şablonlarından birini seç.",
        "Tema rengini, başlığı, etiketi ve kayan yazıyı yaz; önizleme anında güncellenir.",
        "İstersen logonu ve özel arka plan görselini yükle (PNG, JPEG, WebP, GIF, AVIF; en çok 12 MB).",
        "“Yeni sahne olarak ekle” ya da “Aktif sahnenin katmanlarını değiştir”i seç ve uygula.",
      ],
      tips: [
        "Şablon sıradan katmanlardan kurulur; uyguladıktan sonra dilediğin gibi düzenleyebilirsin.",
        "Konuk panelleri boş gelir: konuğu “Yayına al”dığında ilk boş panele yerleşir.",
      ],
    },
    en: {
      title: "Templates and logo",
      summary:
        "Ready-made broadcast frames for news, talks, tutorials and demos; with your own logo and background.",
      steps: [
        "Press “▦ Şablon” in the scene panel.",
        "Pick one of News / Breaking News, solo, mobile test, desktop prototype, 2-, 3- and 4-person talk, side by side, gaming, tutorial, dual screen or presentation.",
        "Type the accent color, title, tag and ticker text; the preview updates instantly.",
        "Optionally upload your logo and a custom background image (PNG, JPEG, WebP, GIF, AVIF; up to 12 MB).",
        "Choose “Yeni sahne olarak ekle” (new scene) or “Aktif sahnenin katmanlarını değiştir” (replace the active scene's layers) and apply.",
      ],
      tips: [
        "A template is built from ordinary layers; edit it freely after applying.",
        "Guest panels start empty: the guest lands in the first free panel when you press “Yayına al” (put on air).",
      ],
    },
  },
  {
    id: "show-control",
    icon: "🎬",
    to: "/studio",
    tr: {
      title: "Yayın akışı: otomatik sıra, kendi şablonların ve sistem sağlığı",
      summary:
        "Sahnelerin süreli olarak sırayla geçmesi, düzenlerini kaydedip her formatta yeniden kullanman ve takılma/ses sorunlarını önceden görmen için.",
      steps: [
        "Sahne panelinde bir sahneyi seç, “Otomatik geç (sn)” alanına süre yaz (0 = elle). Aynı işi istediğin kadar sahne için yap.",
        "“▶ Otomatik sıra”ya bas: sahneler süreleri dolunca sırayla kendiliğinden geçer, düğmede kalan süre görünür. Son sahneden sonra otomatik sıra durur; elle sahne değiştirmek sayacı yeniden başlatır.",
        "Beğendiğin bir düzeni “▦ Şablon” penceresinde “+ Aktif sahneyi şablon olarak kaydet” ile sakla; “★ Benim şablonlarım”dan istediğin zaman ve istediğin formatta (16:9, 9:16…) yeni sahne ya da aktif sahnenin yerine uygula.",
        "Kayıt/Canlı alanındaki “Sistem sağlığı” satırını izle: kare hızı, çizim süresi ve ses seviyesi normal değilse sebebi ve ne yapacağın yazılır (örn. düşük FPS, ses kırpılması, sekmenin arka planda kalması).",
        "Kayıt dosyasının adında format yer alır (örn. proje-9x16-20261019-231500), dikey ve yatay çekimleri ayırt etmek kolaylaşır.",
      ],
      tips: [
        "Benim şablonlarım bu tarayıcıda saklanır; medya dosyaları aynı tarayıcının kütüphanesinde durduğu sürece şablonla birlikte gelir.",
        "Kayıt sırasında sekmeyi arka plana atma: tarayıcı çizimi yavaşlatır ve Sistem sağlığı bunu kırmızı uyarıyla bildirir.",
      ],
    },
    en: {
      title: "Show flow: auto-run, your own templates and system health",
      summary:
        "Run scenes on a timer, save your layouts and reuse them in any format, and see stutter or audio problems before they hurt a take.",
      steps: [
        "In the scene panel select a scene and type a time into “Otomatik geç (sn)” (auto-advance, 0 = manual). Do the same for as many scenes as you like.",
        "Press “▶ Otomatik sıra” (auto-run): scenes switch on their own when their time is up and the button shows the time left. Auto-run stops after the last scene; switching a scene by hand restarts the timer.",
        "Save a layout you like with “+ Aktif sahneyi şablon olarak kaydet” (save active scene as template) in the “▦ Şablon” window; apply it later from “★ Benim şablonlarım” (my templates) in any format (16:9, 9:16…) as a new scene or in place of the active one.",
        "Watch the “Sistem sağlığı” (system health) row under the recorder: when frame rate, render time or audio level is off it tells you why and what to do (low FPS, clipping, tab in the background...).",
        "The recording file name contains the format (e.g. project-9x16-20261019-231500) so vertical and landscape takes are easy to tell apart.",
      ],
      tips: [
        "My templates are stored in this browser; media files travel with a template as long as they stay in the same browser's library.",
        "Do not put the tab in the background while recording: the browser throttles drawing and System health flags it in red.",
      ],
    },
  },
  {
    id: "vertical",
    icon: "📱",
    to: "/studio",
    tr: {
      title: "Dikey format (Reels, Shorts, TikTok) ve güvenli bölge",
      summary:
        "Aynı stüdyoda 16:9, 9:16, 4:5, 1:1 ve 4:3 çıkış: sahneler yeni formata otomatik uyarlanır, canlı yayın ve kayıt aynı boyutta çıkar.",
      steps: [
        "Stüdyo'da sahnenin üstündeki “Format” çubuğundan 9:16 (dikey), 4:5 (portre) ya da 1:1 (kare) seç.",
        "Sahneler yeni formata uyarlanır: tam ekran katmanlar tam ekran kalır, kamera ve logolar oranını korur. Beğenmezsen Ctrl+Z ile geri al.",
        "“▦ Şablon” penceresinde “Dikey, 4:5 ve kare” grubundaki şablonlar çıktı formatını kendileri ayarlar.",
        "“Güvenli bölge”yi aç: platform arayüzünün örteceği alanlar kırmızı, güvenli alan yeşil kesikli çizgiyle gösterilir (çıktıya girmez).",
        "Canlı yayın (/live) kalitesi formata uyar: dikeyde 1080p seçeneği 1080×1920 gönderir.",
        "Kayıt başlamadan önce Geri sayım (3 / 5 / 10 sn) seçebilirsin; sayaç sırasında tekrar basmak iptal eder.",
      ],
      tips: [
        "Kayıt sürerken format değiştirilemez (kaydedici tuvali kilitler).",
        "Klasik Stüdyo'da da aynı formatlar var (Kaynak & Görüntü sekmesi); ana Stüdyo'ya gönderince sahneler hedef formata uyarlanır.",
      ],
    },
    en: {
      title: "Vertical format (Reels, Shorts, TikTok) and safe zones",
      summary:
        "16:9, 9:16, 4:5, 1:1 and 4:3 output in the same studio: scenes adapt automatically, and live streaming and recording use the same size.",
      steps: [
        "In the Studio pick 9:16 (vertical), 4:5 (portrait) or 1:1 (square) from the “Format” bar above the stage.",
        "Scenes are re-laid out: full-frame layers stay full-frame, cameras and logos keep their aspect ratio. Undo with Ctrl+Z.",
        "In the “▦ Şablon” (template) window, templates in the “Dikey, 4:5 ve kare” group set the output format themselves.",
        "Turn on “Güvenli bölge” (safe zone): areas covered by platform UI are shaded red and the safe area is outlined in green (never part of the output).",
        "Live streaming (/live) follows the format: in vertical, the 1080p option sends 1080×1920.",
        "Pick a countdown (3 / 5 / 10 s) before recording; pressing again during the countdown cancels it.",
      ],
      tips: [
        "The format cannot change while recording (the recorder locks the canvas).",
        "Classic Studio has the same formats (Kaynak & Görüntü tab); sending scenes to the main Studio fits them to the target format.",
      ],
    },
  },
  {
    id: "camera-audio",
    icon: "🎚",
    to: "/studio",
    tr: {
      title: "Kamera ayarları, ses iyileştirme ve ducking",
      summary:
        "Parlaklık, kontrast, netlik, bulanıklık, vinyet ve sıcaklık; mikrofon için gürültü kapısı, EQ, sıkıştırıcı ve konuşurken müziği kısma.",
      steps: [
        "Bir kamera, ekran, video veya görsel katmanı seç; sağdaki Özellikler'de “Görüntü ayarları”nı bul.",
        "Doğal, Aydınlık, Canlı, Sinema, Podcast, Yumuşak, Sıcak, Soğuk, Retro, Siyah-beyaz, Gece, Loş ışık ön ayarlarından birini seç ya da sürgüleri elle ayarla.",
        "Parlaklık, kontrast, doygunluk, ton, netlik/keskinlik, bulanıklık, sıcaklık ve vinyet sürgüleri anında canlı önizlemeye yansır; “Ayarları sıfırla” hepsini temizler.",
        "“Ses iyileştirme” panelinde Konuşma, Podcast ya da Gürültülü ortam ön ayarını seç; gürültü kapısı eşiğini, bastırma miktarını, EQ+sıkıştırma gücünü ve uğultu filtresini ayarla.",
        "Sessiz kalıp “Ortam gürültüsünü ölç” düğmesine bas: kapı eşiği ölçülen gürültünün hemen üstüne ayarlanır.",
        "“Konuşurken müziği kıs”ı aç: sen konuşurken müzik kanalları kısılır, bitince yumuşakça geri gelir; sürgüyü elle oynatırsan o değer yeni taban olur.",
        "Gürültülü ortamda “Yapay zeka gürültü bastırma (RNNoise)”u aç: açık kaynak bir sinir ağı sesini tarayıcıda, bilgisayarında yerel olarak temizler (ilk açılışta model birkaç saniye yüklenir).",
        "NVIDIA Broadcast / RTX Voice / Krisp kullanıyorsan mikrofon listesinden “✨” işaretli sanal mikrofonu seç: tarayıcının kendi gürültü engelleme ve otomatik kazancı kapanır, ses iki kez işlenmez ve “NVIDIA / AI mikrofon” ön ayarı seçilir.",
        "Gelişmiş: NVIDIA Broadcast 2.3+ yerel MCP gateway'ine (127.0.0.1:18100–18109) panelden bağlanabilirsin; gateway'in bildirdiği efektler (gürültü giderme, yankı giderme, Studio Voice…) listelenir. Tarayıcı yerel ağ erişimine izin vermeli.",
      ],
      tips: [
        "Tarayıcının gürültü engelleme, yankı önleme ve otomatik kazancı mikrofon açılırken zaten etkindir; panel onun üstüne çalışır.",
        "Kulaklık kullanmak yankıyı en iyi şekilde önler. Sunucu CPU'su yerine tarayıcı çalıştığı için ek bir hesap gerekmez.",
        "Netlik ve vinyet gibi efektler Safari'de (ctx.filter yok) kısmen çalışır.",
      ],
    },
    en: {
      title: "Camera adjustments, voice enhancement and ducking",
      summary:
        "Brightness, contrast, sharpness, blur, vignette and warmth; for the microphone a noise gate, EQ, compressor and automatic music ducking while you speak.",
      steps: [
        "Select a camera, screen, video or image layer; find “Görüntü ayarları” (image adjustments) in Properties on the right.",
        "Pick a preset (Doğal, Aydınlık, Canlı, Sinema, Podcast, Yumuşak, Sıcak, Soğuk, Retro, Siyah-beyaz, Gece, Loş ışık) or move the sliders by hand.",
        "Brightness, contrast, saturation, hue, sharpness, blur, warmth and vignette apply instantly to the live preview; “Ayarları sıfırla” clears them all.",
        "In the “Ses iyileştirme” (voice enhancement) panel choose Konuşma (speech), Podcast or Gürültülü ortam (noisy room); tune the gate threshold, reduction, EQ + compression amount and rumble filter.",
        "Stay silent and press “Ortam gürültüsünü ölç” (measure room noise): the gate threshold is set just above the measured noise.",
        "Turn on “Konuşurken müziği kıs” (duck music while speaking): music channels are lowered while you talk and come back smoothly; moving the slider by hand sets the new base level.",
        "In a noisy room turn on “Yapay zeka gürültü bastırma (RNNoise)” (AI noise suppression): an open-source neural network cleans your voice locally in the browser (the model takes a few seconds to load the first time).",
        "If you use NVIDIA Broadcast / RTX Voice / Krisp pick the “✨” virtual microphone from the microphone list: the browser's own noise suppression and auto gain are switched off so the audio is not processed twice, and the “NVIDIA / AI mikrofon” preset is selected.",
        "Advanced: connect to the local NVIDIA Broadcast 2.3+ MCP gateway (127.0.0.1:18100–18109) from the panel; the effects it advertises (noise removal, echo removal, Studio Voice…) are listed. The browser must allow local network access.",
      ],
      tips: [
        "The browser's noise suppression, echo cancellation and auto gain are already on when the mic opens; the panel works on top of that.",
        "Headphones prevent echo best. Everything runs in the browser, no server CPU is used.",
        "Effects such as sharpness and vignette work only partly in Safari (no ctx.filter).",
      ],
    },
  },
  {
    id: "sound",
    icon: "🎧",
    to: "/studio",
    tr: {
      title: "Ses kütüphanesi ve geçişler",
      summary:
        "Telifsiz, kodla üretilen müzik ve ses efektleri; 28 WebGL sahne geçişi. Dosya indirmen gerekmez.",
      steps: [
        "Stüdyo'da sağ sütundaki “Ses kütüphanesi” panelinden bir müzik parçası seç (Lo-fi Sabah, Gece Sürüşü, Yağmurlu Kafe, Podcast Açılışı, Ambient Fon); aynı düğmeyle durdur.",
        "Efektleri tıkla ya da Alt+1…8 kısayoluyla çal (whoosh, ding, alkış, davul roll…).",
        "Ses mikserinde müziğin seviyesini ayarla; müzik ve efektler kayda ve canlı yayına karışır.",
        "Sahne panelinde “Geçiş türü” listesinden ✦ (WebGL) işaretli bir geçiş seç; süreyi ms olarak yaz.",
        "“Sahne geçişinde whoosh çal” kutusu açıkken kesme dışındaki her geçişte whoosh duyulur.",
      ],
      tips: [
        "WebGL kullanılamıyorsa geçiş otomatik olarak yumuşak geçişe (fade) düşer.",
        "Müzik ve efektler tarayıcıda sentezlenir; telif veya lisans takibi gerekmez.",
      ],
    },
    en: {
      title: "Sound library and transitions",
      summary:
        "Royalty-free, code-generated music and sound effects; 28 WebGL scene transitions. Nothing to download.",
      steps: [
        "In the Studio, pick a track from the “Ses kütüphanesi” (sound library) panel in the right column (Lo-fi Sabah, Gece Sürüşü, Yağmurlu Kafe, Podcast Açılışı, Ambient Fon); press the same button to stop.",
        "Click an effect or press Alt+1…8 (whoosh, ding, applause, drum roll…).",
        "Set the music level in the audio mixer; music and effects are mixed into the recording and the live stream.",
        "In the scene panel choose a ✦ (WebGL) entry under “Geçiş türü” (transition type) and set the duration in ms.",
        "With “Sahne geçişinde whoosh çal” (play whoosh on scene change) enabled, every non-cut transition plays a whoosh.",
      ],
      tips: [
        "If WebGL is unavailable, the transition falls back to a plain fade.",
        "Music and effects are synthesized in the browser; there is no licence to track.",
      ],
    },
  },
  {
    id: "classic",
    icon: "🎛️",
    to: "/studio",
    tr: {
      title: "Klasik Stüdyo ve senkron",
      summary:
        "Solda düzenle, sağda canlıyı izle: taslağı “Yayına al” ile geçişli olarak canlıya aktar. Prompter metni ve sahneler ana Stüdyo ile eşleşir.",
      steps: [
        "Yan menüden “Klasik Stüdyo”yu (/classic) aç; 8 şablondan biriyle başla.",
        "Taslağı soldaki alanda düzenle; “Yayına al →” ile sağdaki canlı ekrana geçiş efektiyle aktar.",
        "“+ Taslağı ekle” ile sahne listesi (rundown) oluştur; N / P ile sıradaki ve önceki sahneye geç.",
        "“⇄ Ana Stüdyo'ya gönder” sahneleri ana Stüdyo'ya “↪ ad” olarak ekler (ana Stüdyo açıksa anında).",
        "Klasik prompter'daki (/classic/prompter) metin, ana Stüdyo'nun prompter metniyle iki yönlü senkrondur.",
      ],
      tips: [
        "Senkron aynı tarayıcıda çalışır; başka cihazla paylaşmak için Oda'yı kullan.",
        "Logolar ve arka plan videosu sahne aktarımına dahil değildir; ana Stüdyo'da yeniden ekle.",
        "Klasik Stüdyo'nun kendi telefon kumandası (/classic/remote) ve konuk daveti (/classic/join) vardır.",
      ],
    },
    en: {
      title: "Classic Studio and sync",
      summary:
        "Edit on the left, watch the live program on the right: push the draft live with a transition. Prompter text and scenes stay in sync with the main Studio.",
      steps: [
        "Open “Classic Studio” (/classic) from the side menu; start from one of the 8 templates.",
        "Edit the draft on the left; press “Yayına al →” (go live) to push it to the live screen on the right with a transition.",
        "Build a scene list (rundown) with “+ Taslağı ekle” (add draft); N / P jump to the next / previous scene.",
        "“⇄ Ana Stüdyo'ya gönder” (send to main Studio) adds the scenes to the main Studio as “↪ name” (instantly if it is open).",
        "The text in the classic prompter (/classic/prompter) is kept in two-way sync with the main Studio's prompter text.",
      ],
      tips: [
        "Sync works inside one browser; use the Room to share with another device.",
        "Logos and background videos are not carried over; add them again in the main Studio.",
        "Classic Studio has its own phone remote (/classic/remote) and guest invite (/classic/join).",
      ],
    },
  },
  {
    id: "room",
    icon: "🚪",
    to: "/room",
    tr: {
      title: "Oda: konuk daveti",
      summary:
        "Kısa bağlantı ya da QR ile konuk çağır; sen onaylayana kadar kimse bağlanmaz.",
      steps: [
        "/room sayfasında “Odayı aç”a bas. Dört bağlantı üretilir: Konuk, İzleyici, Kumanda (telefon) ve Sohbet.",
        "Bağlantıyı (/r/KOD) ya da QR'ı konuğa gönder.",
        "Konuk adını yazar ve bekleme havuzuna girer; sen “Onayla”ya basınca bağlantı birkaç saniyede kendiliğinden kurulur.",
        "Konuğu “Yayına al”: konuk katmanı sahneye girer. Ses düzeyini (0–150 %), susturmayı ve ses göstergesini mikserden yönet.",
        "Telefonunu Kumanda bağlantısıyla uzaktan kumanda olarak kullan (sahne, prompter, mute, kayıt, işaret).",
      ],
      tips: [
        "Yankıyı önlemek için herkes kulaklık kullansın; karışımda mix-minus yoktur.",
        "Aynı anda en çok yaklaşık 8 kişi önerilir (her biri için ayrı kodlama yapılır).",
        "“Yeni kod” eski odayı kapatır; eski bağlantılar ve QR'lar çalışmaz.",
        "Röle yoksa (sunucusuz barındırma) arayüz “Manuel bağlantı”ya geçer: davet ve yanıt kodu değiş tokuşu.",
        "Etkinlik günlüğü yalnızca senin tarayıcında tutulur, CSV olarak indirilebilir.",
      ],
    },
    en: {
      title: "Room: inviting guests",
      summary:
        "Invite guests with a short link or QR; nobody connects until you approve.",
      steps: [
        "On /room press “Odayı aç” (open room). Four links are produced: Guest, Viewer, Remote (phone) and Chat.",
        "Send the link (/r/CODE) or the QR to the guest.",
        "The guest types a name and enters the waiting pool; when you press “Onayla” (approve) the connection completes by itself within seconds.",
        "Put the guest on air (“Yayına al”): the guest layer enters the scene. Manage volume (0–150 %), mute and the level meter in the mixer.",
        "Use your phone as a remote with the Remote link (scene, prompter, mute, record, marker).",
      ],
      tips: [
        "Everyone should wear headphones to avoid echo; there is no mix-minus in the mix.",
        "About 8 people at a time is the practical limit (the program is encoded once per person).",
        "“Yeni kod” (new code) closes the old room; old links and QR codes stop working.",
        "Without a relay (serverless hosting) the interface falls back to “Manuel bağlantı”: exchange of invite and answer codes.",
        "The activity log lives only in your browser and can be exported as CSV.",
      ],
    },
  },
  {
    id: "chat",
    icon: "💬",
    to: "/room",
    tr: {
      title: "Moderasyonlu sohbet",
      summary:
        "Katılımcı mesajları, sen ya da editör onaylamadan kimseye ve yayına ulaşmaz.",
      steps: [
        "/room'da sohbet modunu seç: onaylı (varsayılan), serbest veya kapalı.",
        "Katılımcılar yazar; mesajlar onay kuyruğuna düşer. Reji veya editör onaylar, reddeder ya da düzenler.",
        "Onaylanan bir mesajı yalnızca reji “Yayına al”; yayında görünmesi için katmanlar paneline “Sohbet (oda)” katmanı ekle.",
        "Editör için “Editör bağlantısı” üret ve başka bir cihazda aç (/chat/KOD#k=…); editör onaylar ama yayına alamaz.",
        "İzlemeyi başka yerden yapan kalabalık için Sohbet bağlantısını paylaş: onaysız, görüntüsüz, yalnızca yazma.",
      ],
      tips: [
        "Mesajlar en çok 280 karakter olur ve düz metin olarak gösterilir.",
        "Sohbet yalnızca sunucu belleğindedir; oda kapanınca silinir. Editör bağlantısını “Yenile” ile geçersiz kılabilirsin.",
        "Sidebar'daki “Oda” girişi bekleyen istek (n) ve onay bekleyen mesaj (💬 n) rozetlerini gösterir.",
      ],
    },
    en: {
      title: "Moderated chat",
      summary:
        "Participant messages reach nobody and never the stream until you or an editor approve them.",
      steps: [
        "On /room choose the chat mode: moderated (default), open or off.",
        "Participants write; messages land in the approval queue. The director or an editor approves, rejects or edits.",
        "Only the director puts an approved message on air (“Yayına al”); add a “Sohbet (oda)” layer in the layers panel so it shows on the stream.",
        "For an editor generate an “Editör bağlantısı” (editor link) and open it on another device (/chat/CODE#k=…); an editor approves but cannot put on air.",
        "For an audience that watches elsewhere, share the Chat link: no approval, no video, writing only.",
      ],
      tips: [
        "Messages are at most 280 characters and shown as plain text.",
        "Chat lives only in server memory and disappears with the room. Invalidate the editor link with “Yenile”.",
        "The “Oda” entry in the sidebar shows badges for waiting requests (n) and messages awaiting moderation (💬 n).",
      ],
    },
  },
  {
    id: "live",
    icon: "📡",
    to: "/live",
    tr: {
      title: "Canlı yayın (RTMP / RTMPS)",
      summary:
        "Program çıkışını YouTube, Facebook, Twitch, Kick, Instagram, TikTok ya da özel bir RTMP(S) adresine gönder.",
      steps: [
        "Bu özellik için sunucuda ffmpeg ve LIVE_ADMIN_TOKEN ayarlı olmalıdır (docs/LIVE.md). Ayarlı değilse sayfa “Sunucu köprüsü hazır değil” der.",
        "/live sayfasında operatör anahtarını gir.",
        "Hedef ekle: platformu seç, yayın anahtarı ile sunucu adresini yapıştır (en çok 4 hedef).",
        "Kaliteyi seç ve “Canlı yayına çık”a bas.",
        "Bitirince yayını sonlandır.",
      ],
      tips: [
        "Yayın anahtarları günlüğe yazılmaz ve sunucudan geri dönmez; tarayıcı yalnızca “bu tarayıcıda hatırla”yı işaretlersen saklar.",
        "Gerçek platform ve RTMPS el sıkışması bu depoda henüz denenmedi; ilk yayından önce bir test yayını yap.",
      ],
    },
    en: {
      title: "Live streaming (RTMP / RTMPS)",
      summary:
        "Send the program output to YouTube, Facebook, Twitch, Kick, Instagram, TikTok or any custom RTMP(S) address.",
      steps: [
        "This needs ffmpeg and LIVE_ADMIN_TOKEN on the server (docs/LIVE.md). Without them the page says “Sunucu köprüsü hazır değil” (server bridge not ready).",
        "On /live enter the operator token.",
        "Add a destination: pick the platform, paste the stream key and server address (up to 4 destinations).",
        "Choose the quality and press “Canlı yayına çık” (go live).",
        "End the stream when you are done.",
      ],
      tips: [
        "Stream keys are never logged or returned by the server; the browser only stores them if you tick “remember in this browser”.",
        "Real platform ingest and the RTMPS handshake have not been verified in this repository yet; do a test stream first.",
      ],
    },
  },
  {
    id: "community",
    icon: "🤝",
    to: "/community",
    tr: {
      title: "Topluluk, duyuru ve sponsorlar",
      summary:
        "Kanallara katıl, yayınını duyur, sponsor ve destekçileri yönet.",
      steps: [
        "/community'de WhatsApp, LinkedIn, Instagram, YouTube, Slack ve X kanallarımıza katıl.",
        "“Yayın duyurusu” ile başlık, zaman ve bağlantıdan hazır bir metin üret; WhatsApp, Telegram, LinkedIn, Facebook, X veya e-postayla paylaş (API anahtarı gerekmez).",
        "Stüdyo → Sponsorlar panelinde sponsor ekle: logo, seviye, yayında göster.",
        "Sahneye dönüşümlü “Sponsorlar” katmanını ekle; ekranda kalma süresi raporunu CSV olarak indir.",
        "Destekçi olmak ya da sponsor kiti için /community'deki paketlere ve başvuru taslaklarına bak.",
      ],
      tips: [
        "Süre, ekranda kalma süresidir; izleyici sayısı değildir.",
        "Sponsor verileri projenle birlikte (.pptdz) taşınır; sunucuya gitmez.",
      ],
    },
    en: {
      title: "Community, announcements and sponsors",
      summary:
        "Join the channels, announce your stream, manage sponsors and supporters.",
      steps: [
        "On /community join our WhatsApp, LinkedIn, Instagram, YouTube, Slack and X channels.",
        "Use “Yayın duyurusu” (stream announcement) to build a ready text from a title, time and link; share via WhatsApp, Telegram, LinkedIn, Facebook, X or e-mail (no API key needed).",
        "In Studio → Sponsorlar add a sponsor: logo, tier, show on air.",
        "Add the rotating “Sponsorlar” layer to a scene; download the on-screen-time report as CSV.",
        "To become a supporter or get the sponsor kit see the packages and application drafts on /community.",
      ],
      tips: [
        "Time means time on screen, not audience size.",
        "Sponsor data travels with your project (.pptdz); nothing goes to a server.",
      ],
    },
  },
  {
    id: "install",
    icon: "⬇️",
    to: "/download",
    tr: {
      title: "Uygulama olarak yükle",
      summary:
        "Windows, macOS, Linux, Android ve iOS'ta kendi penceresinde açılan, kendiliğinden güncellenen uygulama.",
      steps: [
        "/download sayfasını aç; tarayıcın destekliyorsa “Uygulamayı yükle” düğmesi görünür.",
        "Chrome / Edge (Windows, macOS, Linux): adres çubuğundaki “Yükle” simgesine tıkla.",
        "Android: menü (⋮) → “Uygulamayı yükle” ya da “Ana ekrana ekle”.",
        "iPhone / iPad: Safari'de Paylaş → “Ana Ekrana Ekle”.",
        "macOS Safari 17+: Dosya → “Dock'a Ekle…”.",
      ],
      tips: [
        "Telefonda açmak için /download sayfasındaki QR'ı okut.",
        "Mağaza ve yerel kurulum dosyaları ayrı yapılardır; yayınlandıklarında /download'da görünür (docs/DOWNLOADS.md).",
      ],
    },
    en: {
      title: "Install as an app",
      summary:
        "An app on Windows, macOS, Linux, Android and iOS that opens in its own window and updates itself.",
      steps: [
        "Open /download; if your browser supports it an “Install the app” button appears.",
        "Chrome / Edge (Windows, macOS, Linux): click the “Install” icon in the address bar.",
        "Android: menu (⋮) → “Install app” or “Add to Home screen”.",
        "iPhone / iPad: in Safari tap Share → “Add to Home Screen”.",
        "macOS Safari 17+: File → “Add to Dock…”.",
      ],
      tips: [
        "To open it on your phone scan the QR on the /download page.",
        "Store and native installers are separate builds; they appear on /download once published (docs/DOWNLOADS.md).",
      ],
    },
  },
  {
    id: "customize",
    icon: "🎨",
    to: "/settings",
    tr: {
      title: "Markayı ve görünümü özelleştir",
      summary:
        "Ad, slogan, “Erken erişim” etiketi, renkler, köşe yuvarlaklığı, ölçek, logo ve paylaşım bilgileri.",
      steps: [
        "Ayarlar → “Marka ve görünüm (bu tarayıcı)”: ad, slogan, logo altı etiket, vurgu renkleri, köşe yuvarlaklığı, arayüz ölçeği ve logo; değişiklik anında uygulanır, yalnızca bu tarayıcıda kalır.",
        "Herkes için kalıcı yapmak: Ayarlar → “Site, meta ve paylaşım”: açıklama, paylaşım görseli, simgeler, site adresi, X hesabı, dil ve arama motoru ayarlarını doldur.",
        "Önizlemeyi ve kontrol uyarılarını incele, çıktıyı .env, JSON ya da config.ts olarak kopyala / indir.",
        "Çıktıyı sunucuya (BRAND_* ortam değişkenleri) ya da src/studio/branding/config.ts dosyasına koy ve yeniden başlat.",
      ],
      tips: [
        "“Logo altı etiket”i boş bırakırsan “Erken erişim” rozeti gizlenir.",
        "Ayrıntı: docs/BRANDING.md.",
      ],
    },
    en: {
      title: "Customize brand and look",
      summary:
        "Name, slogan, “Early access” label, colors, corner radius, scale, logo and share metadata.",
      steps: [
        "Settings → “Marka ve görünüm (bu tarayıcı)” (brand and look, this browser): name, slogan, label under the logo, accent colors, corner radius, interface scale and logo; changes apply instantly and stay in this browser.",
        "To make it permanent for everybody: Settings → “Site, meta ve paylaşım” (site, metadata and sharing): fill in description, share image, icons, site URL, X handle, language and search-engine settings.",
        "Check the preview and the advisory warnings, then copy / download the output as .env, JSON or config.ts.",
        "Put the output into the server environment (BRAND_* variables) or src/studio/branding/config.ts and restart.",
      ],
      tips: [
        "Leave the label under the logo empty to hide the “Early access” badge.",
        "Details: docs/BRANDING.md.",
      ],
    },
  },
  {
    id: "privacy",
    icon: "🔒",
    to: "/settings",
    tr: {
      title: "Gizlilik ve veri",
      summary:
        "Hesap yok, veritabanı yok; ayarların ve projelerin cihazında kalır.",
      steps: [
        "Ayarlar tarayıcı deposunda (localStorage / IndexedDB) tutulur.",
        "Kamera, mikrofon ve ekran görüntün yalnızca senin açtığın doğrudan (P2P) bağlantılarda karşı tarafa gider.",
        "Genel STUN (stun.l.google.com) yalnızca IP adresini görür; Ayarlar'dan kapatabilirsin.",
        "Oda rölesi isimleri ve bağlantı kodlarını geçici olarak bellekte tutar; diske yazmaz.",
        "Canlı yayın yaparsan program çıkışı kendi sunucundan geçip seçtiğin platforma gider.",
      ],
      tips: ["Tam liste ve istisnalar: README.md → Güvenlik & Gizlilik."],
    },
    en: {
      title: "Privacy and data",
      summary:
        "No accounts, no database; your settings and projects stay on your device.",
      steps: [
        "Settings live in browser storage (localStorage / IndexedDB).",
        "Camera, microphone and screen only reach the other side through the direct (P2P) connections you open.",
        "Public STUN (stun.l.google.com) only sees your IP address; you can turn it off in Settings.",
        "The room relay keeps names and connection codes briefly in memory and never writes to disk.",
        "If you go live, the program output passes through your own server to the platform you chose.",
      ],
      tips: ["Full list and exceptions: README.md → Security & Privacy."],
    },
  },
];

export const FAQ: readonly GuideFaq[] = [
  {
    id: "permissions",
    tr: {
      q: "Kamera veya mikrofon izni çıkmıyor.",
      a: "Siteyi HTTPS ile açtığından emin ol (localhost hariç düz http'de tarayıcı cihazlara erişim vermez). Adres çubuğundaki kilit simgesinden site izinlerini kontrol et ve kamerayı başka bir uygulamanın kullanmadığından emin ol.",
    },
    en: {
      q: "The camera or microphone permission never appears.",
      a: "Make sure the site is opened over HTTPS (browsers expose devices on plain http only for localhost). Check the site permissions behind the lock icon and make sure no other app is using the camera.",
    },
  },
  {
    id: "guest-fails",
    tr: {
      q: "Konuk bağlanamıyor (“başarısız”).",
      a: "TURN sunucusu yoktur; simetrik NAT veya katı kurumsal güvenlik duvarı arkasındaki konuklar bağlanamayabilir. Konuktan mobil veri ya da başka bir ağ denemesini iste. Ayarlar'daki “Röleyi sına” ile rölenin çalıştığını doğrula.",
    },
    en: {
      q: "A guest cannot connect (“başarısız” / failed).",
      a: "There is no TURN server; guests behind symmetric NAT or strict corporate firewalls may fail. Ask them to try mobile data or another network. Use “Röleyi sına” (test relay) in Settings to confirm the relay works.",
    },
  },
  {
    id: "echo",
    tr: {
      q: "Yankı ya da geri besleme var.",
      a: "Herkes kulaklık takmalı. Konuk sesi yayın karışımına girer ve mix-minus yoktur; hoparlörden çıkan ses mikrofona geri döner.",
    },
    en: {
      q: "There is echo or feedback.",
      a: "Everybody should wear headphones. Guest audio is part of the program mix and there is no mix-minus, so speaker sound flows back into a microphone.",
    },
  },
  {
    id: "webm",
    tr: {
      q: "Kayıt MP4 yerine WebM çıktı.",
      a: "Tarayıcın MP4 kaydını desteklemiyor (ör. Firefox). Chrome, Edge veya Safari'de MP4 kaydedilir; WebM'i istediğin bir araçla dönüştürebilirsin.",
    },
    en: {
      q: "The recording is WebM instead of MP4.",
      a: "Your browser does not support MP4 recording (e.g. Firefox). Chrome, Edge and Safari record MP4; you can convert WebM with any tool.",
    },
  },
  {
    id: "live-not-ready",
    tr: {
      q: "/live “Sunucu köprüsü hazır değil” diyor.",
      a: "Sunucuda ffmpeg kurulu ve LIVE_ADMIN_TOKEN (en az 16 karakter) tanımlı olmalı; sunucusuz barındırmada köprü çalışmaz. Adımlar docs/LIVE.md içindedir.",
    },
    en: {
      q: "/live says “Sunucu köprüsü hazır değil” (server bridge not ready).",
      a: "ffmpeg must be installed and LIVE_ADMIN_TOKEN (at least 16 characters) set on the server; serverless hosting cannot run the bridge. Steps are in docs/LIVE.md.",
    },
  },
  {
    id: "iframe",
    tr: {
      q: "Prototip sayfam sahnede görünmüyor.",
      a: "Başka alan adındaki iframe içeriği canvas'a çizilemez. “Başka sekmeyi yakala” ile ekran / sekme yakalamayı kullan; Chrome ve Edge'de bölge kırpma da vardır.",
    },
    en: {
      q: "My prototype page does not show on the stage.",
      a: "Cross-origin iframe content cannot be drawn to the canvas. Use “Başka sekmeyi yakala” (capture another tab) for screen / tab capture; Chrome and Edge also support region cropping.",
    },
  },
  {
    id: "ios-screen",
    tr: {
      q: "iPhone'dan ekran paylaşamıyorum.",
      a: "iOS tarayıcıları ekran paylaşımını (getDisplayMedia) desteklemez. Telefon konuk kamerası ve kumanda olarak çalışır; ekran paylaşımı için bilgisayar kullan.",
    },
    en: {
      q: "I cannot share my screen from an iPhone.",
      a: "iOS browsers do not support screen sharing (getDisplayMedia). The phone works as a guest camera and a remote; use a computer for screen sharing.",
    },
  },
  {
    id: "backup",
    tr: {
      q: "Projemi nasıl yedeklerim ya da taşırım?",
      a: "Proje menüsünden “.pptdz” olarak dışa aktar ve başka bir tarayıcıda içe aktar. Ses ve efekt dosyaları pakete girmez; onları yeniden eklemen gerekir.",
    },
    en: {
      q: "How do I back up or move my project?",
      a: "Export it as “.pptdz” from the project menu and import it in another browser. Audio and effect files are not included; add them again.",
    },
  },
  {
    id: "no-relay",
    tr: {
      q: "Oda “röle yok” diyor.",
      a: "Oda modu sunucuda tek ve uzun ömürlü bir Node süreci ister (docs/ROOM.md). Cloudflare gibi sunucusuz ortamlarda röle yoktur; arayüz otomatik olarak manuel bağlantıya geçer.",
    },
    en: {
      q: "The room says there is no relay.",
      a: "Room mode needs one long-lived Node process on the server (docs/ROOM.md). Serverless platforms such as Cloudflare have no relay; the interface falls back to manual connection automatically.",
    },
  },
];

export function sectionText(s: GuideSection, lang: Lang): GuideText {
  return s[lang];
}
