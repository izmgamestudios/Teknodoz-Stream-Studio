# Teknodoz Studio — User guide

> This file is generated from `src/studio/guide/content.ts` and matches the in-app **/guide** page. Do not edit it by hand: change the source and run `UPDATE_DOCS=1 npx vitest run src/studio/guide`.

[Türkçe sürüm](USER-GUIDE.md)

## Contents

- [🚀 Quick start (5 minutes)](#start)
- [📜 Prompter](#prompter)
- [🎬 Studio: scenes and layers](#studio)
- [▦ Templates and logo](#templates)
- [🎬 Show flow: auto-run, your own templates and system health](#show-control)
- [📱 Vertical format (Reels, Shorts, TikTok) and safe zones](#vertical)
- [🎚 Camera adjustments, voice enhancement and ducking](#camera-audio)
- [🎧 Sound library and transitions](#sound)
- [🎛️ Classic Studio and sync](#classic)
- [🚪 Room: inviting guests](#room)
- [💬 Moderated chat](#chat)
- [📡 Live streaming (RTMP / RTMPS)](#live)
- [🤝 Community, announcements and sponsors](#community)
- [⬇️ Install as an app](#install)
- [🎨 Customize brand and look](#customize)
- [🔒 Privacy and data](#privacy)
- [Keyboard shortcuts](#shortcuts)
- [Frequently asked questions](#faq)
- [PDF, videos and links](#resources)
- [More](#more)

<a name="start"></a>

## 🚀 Quick start (5 minutes)

No install, account or database: everything runs in your browser.

1. Open the site over HTTPS (camera and microphone only work on secure connections).
2. In the Prompter (/) paste your script or import .txt / .md / .srt / .docx; start with the Space key.
3. In the Studio (/studio) pick your camera and microphone and add a ready-made scene with “▦ Şablon”.
4. Start recording (Shift+R). Press M to add a chapter marker.
5. When the recording ends the video, chapters.txt and .srt download together.
6. To invite guests open Room (/room); to go live open Live (/live).

> 💡 **Tip:** Export your project as “.pptdz”: scenes, layers, the prompter script and images are saved in one file.

<a name="prompter"></a>

## 📜 Prompter

Reading text as a HUD that is never recorded, or as captions burned into the stream.

1. Paste the text or import a file (.txt, .md, .srt, .docx).
2. Adjust speed, font size, line spacing, contrast and mirror.
3. Space starts / stops, ↑ ↓ change the speed, R rewinds.
4. To show the text on the stream too, choose “burn-in” (captions, ticker strip or under-camera notch).

> 💡 **Tip:** The HUD is visible only to you; it never reaches the recording or the stream.

> 💡 **Tip:** Voice follow (Chrome / Edge) is off by default; when on, audio may go to Google and the interface warns you.

<a name="studio"></a>

## 🎬 Studio: scenes and layers

Unlimited scenes, layered compositions, recording.

1. Pick camera, microphone and screen share in the source bar.
2. Add scenes in the scene panel; switch with keys 1–9 (cut, fade or slide transition).
3. In the layers panel use “+ Katman ekle…” to add camera, screen, image, text or shape layers; set order, visibility, lock, opacity and blend mode.
4. Drag a layer on the stage to move it, use the handles to resize / rotate (Shift: ratio / 15°, Alt: from center).
5. Turn on the green screen (chroma key) on a camera layer if needed.
6. Choose resolution, frame rate and bit rate in Settings, then record. MP4 is used when the browser supports it, otherwise WebM.

> 💡 **Tip:** Prototype (mobile 390×844 / desktop frame) video enters through screen or tab capture; iframe content cannot be drawn directly.

> 💡 **Tip:** Audio and effect files are not part of the .pptdz bundle; only images and videos used in scenes are.

<a name="templates"></a>

## ▦ Templates and logo

Ready-made broadcast frames for news, talks, tutorials and demos; with your own logo and background.

1. Press “▦ Şablon” in the scene panel.
2. Pick one of News / Breaking News, solo, mobile test, desktop prototype, 2-, 3- and 4-person talk, side by side, gaming, tutorial, dual screen or presentation.
3. Type the accent color, title, tag and ticker text; the preview updates instantly.
4. Optionally upload your logo and a custom background image (PNG, JPEG, WebP, GIF, AVIF; up to 12 MB).
5. Choose “Yeni sahne olarak ekle” (new scene) or “Aktif sahnenin katmanlarını değiştir” (replace the active scene's layers) and apply.

> 💡 **Tip:** A template is built from ordinary layers; edit it freely after applying.

> 💡 **Tip:** Guest panels start empty: the guest lands in the first free panel when you press “Yayına al” (put on air).

<a name="show-control"></a>

## 🎬 Show flow: auto-run, your own templates and system health

Run scenes on a timer, save your layouts and reuse them in any format, and see stutter or audio problems before they hurt a take.

1. In the scene panel select a scene and type a time into “Otomatik geç (sn)” (auto-advance, 0 = manual). Do the same for as many scenes as you like.
2. Press “▶ Otomatik sıra” (auto-run): scenes switch on their own when their time is up and the button shows the time left. Auto-run stops after the last scene; switching a scene by hand restarts the timer.
3. Save a layout you like with “+ Aktif sahneyi şablon olarak kaydet” (save active scene as template) in the “▦ Şablon” window; apply it later from “★ Benim şablonlarım” (my templates) in any format (16:9, 9:16…) as a new scene or in place of the active one.
4. Watch the “Sistem sağlığı” (system health) row under the recorder: when frame rate, render time or audio level is off it tells you why and what to do (low FPS, clipping, tab in the background...).
5. The recording file name contains the format (e.g. project-9x16-20261019-231500) so vertical and landscape takes are easy to tell apart.

> 💡 **Tip:** My templates are stored in this browser; media files travel with a template as long as they stay in the same browser's library.

> 💡 **Tip:** Do not put the tab in the background while recording: the browser throttles drawing and System health flags it in red.

<a name="vertical"></a>

## 📱 Vertical format (Reels, Shorts, TikTok) and safe zones

16:9, 9:16, 4:5, 1:1 and 4:3 output in the same studio: scenes adapt automatically, and live streaming and recording use the same size.

1. In the Studio pick 9:16 (vertical), 4:5 (portrait) or 1:1 (square) from the “Format” bar above the stage.
2. Scenes are re-laid out: full-frame layers stay full-frame, cameras and logos keep their aspect ratio. Undo with Ctrl+Z.
3. In the “▦ Şablon” (template) window, templates in the “Dikey, 4:5 ve kare” group set the output format themselves.
4. Turn on “Güvenli bölge” (safe zone): areas covered by platform UI are shaded red and the safe area is outlined in green (never part of the output).
5. Live streaming (/live) follows the format: in vertical, the 1080p option sends 1080×1920.
6. Pick a countdown (3 / 5 / 10 s) before recording; pressing again during the countdown cancels it.

> 💡 **Tip:** The format cannot change while recording (the recorder locks the canvas).

> 💡 **Tip:** Classic Studio has the same formats (Kaynak & Görüntü tab); sending scenes to the main Studio fits them to the target format.

<a name="camera-audio"></a>

## 🎚 Camera adjustments, voice enhancement and ducking

Brightness, contrast, sharpness, blur, vignette and warmth; for the microphone a noise gate, EQ, compressor and automatic music ducking while you speak.

1. Select a camera, screen, video or image layer; find “Görüntü ayarları” (image adjustments) in Properties on the right.
2. Pick a preset (Doğal, Aydınlık, Canlı, Sinema, Podcast, Yumuşak, Sıcak, Soğuk, Retro, Siyah-beyaz, Gece, Loş ışık) or move the sliders by hand.
3. Brightness, contrast, saturation, hue, sharpness, blur, warmth and vignette apply instantly to the live preview; “Ayarları sıfırla” clears them all.
4. In the “Ses iyileştirme” (voice enhancement) panel choose Konuşma (speech), Podcast or Gürültülü ortam (noisy room); tune the gate threshold, reduction, EQ + compression amount and rumble filter.
5. Stay silent and press “Ortam gürültüsünü ölç” (measure room noise): the gate threshold is set just above the measured noise.
6. Turn on “Konuşurken müziği kıs” (duck music while speaking): music channels are lowered while you talk and come back smoothly; moving the slider by hand sets the new base level.

> 💡 **Tip:** The browser's noise suppression, echo cancellation and auto gain are already on when the mic opens; the panel works on top of that.

> 💡 **Tip:** Headphones prevent echo best. Everything runs in the browser, no server CPU is used.

> 💡 **Tip:** Effects such as sharpness and vignette work only partly in Safari (no ctx.filter).

<a name="sound"></a>

## 🎧 Sound library and transitions

Royalty-free, code-generated music and sound effects; 28 WebGL scene transitions. Nothing to download.

1. In the Studio, pick a track from the “Ses kütüphanesi” (sound library) panel in the right column (Lo-fi Sabah, Gece Sürüşü, Yağmurlu Kafe, Podcast Açılışı, Ambient Fon); press the same button to stop.
2. Click an effect or press Alt+1…8 (whoosh, ding, applause, drum roll…).
3. Set the music level in the audio mixer; music and effects are mixed into the recording and the live stream.
4. In the scene panel choose a ✦ (WebGL) entry under “Geçiş türü” (transition type) and set the duration in ms.
5. With “Sahne geçişinde whoosh çal” (play whoosh on scene change) enabled, every non-cut transition plays a whoosh.

> 💡 **Tip:** If WebGL is unavailable, the transition falls back to a plain fade.

> 💡 **Tip:** Music and effects are synthesized in the browser; there is no licence to track.

<a name="classic"></a>

## 🎛️ Classic Studio and sync

Edit on the left, watch the live program on the right: push the draft live with a transition. Prompter text and scenes stay in sync with the main Studio.

1. Open “Classic Studio” (/classic) from the side menu; start from one of the 8 templates.
2. Edit the draft on the left; press “Yayına al →” (go live) to push it to the live screen on the right with a transition.
3. Build a scene list (rundown) with “+ Taslağı ekle” (add draft); N / P jump to the next / previous scene.
4. “⇄ Ana Stüdyo'ya gönder” (send to main Studio) adds the scenes to the main Studio as “↪ name” (instantly if it is open).
5. The text in the classic prompter (/classic/prompter) is kept in two-way sync with the main Studio's prompter text.

> 💡 **Tip:** Sync works inside one browser; use the Room to share with another device.

> 💡 **Tip:** Logos and background videos are not carried over; add them again in the main Studio.

> 💡 **Tip:** Classic Studio has its own phone remote (/classic/remote) and guest invite (/classic/join).

<a name="room"></a>

## 🚪 Room: inviting guests

Invite guests with a short link or QR; nobody connects until you approve.

1. On /room press “Odayı aç” (open room). Four links are produced: Guest, Viewer, Remote (phone) and Chat.
2. Send the link (/r/CODE) or the QR to the guest.
3. The guest types a name and enters the waiting pool; when you press “Onayla” (approve) the connection completes by itself within seconds.
4. Put the guest on air (“Yayına al”): the guest layer enters the scene. Manage volume (0–150 %), mute and the level meter in the mixer.
5. Use your phone as a remote with the Remote link (scene, prompter, mute, record, marker).

> 💡 **Tip:** Everyone should wear headphones to avoid echo; there is no mix-minus in the mix.

> 💡 **Tip:** About 8 people at a time is the practical limit (the program is encoded once per person).

> 💡 **Tip:** “Yeni kod” (new code) closes the old room; old links and QR codes stop working.

> 💡 **Tip:** Without a relay (serverless hosting) the interface falls back to “Manuel bağlantı”: exchange of invite and answer codes.

> 💡 **Tip:** The activity log lives only in your browser and can be exported as CSV.

<a name="chat"></a>

## 💬 Moderated chat

Participant messages reach nobody and never the stream until you or an editor approve them.

1. On /room choose the chat mode: moderated (default), open or off.
2. Participants write; messages land in the approval queue. The director or an editor approves, rejects or edits.
3. Only the director puts an approved message on air (“Yayına al”); add a “Sohbet (oda)” layer in the layers panel so it shows on the stream.
4. For an editor generate an “Editör bağlantısı” (editor link) and open it on another device (/chat/CODE#k=…); an editor approves but cannot put on air.
5. For an audience that watches elsewhere, share the Chat link: no approval, no video, writing only.

> 💡 **Tip:** Messages are at most 280 characters and shown as plain text.

> 💡 **Tip:** Chat lives only in server memory and disappears with the room. Invalidate the editor link with “Yenile”.

> 💡 **Tip:** The “Oda” entry in the sidebar shows badges for waiting requests (n) and messages awaiting moderation (💬 n).

<a name="live"></a>

## 📡 Live streaming (RTMP / RTMPS)

Send the program output to YouTube, Facebook, Twitch, Kick, Instagram, TikTok or any custom RTMP(S) address.

1. This needs ffmpeg and LIVE_ADMIN_TOKEN on the server (docs/LIVE.md). Without them the page says “Sunucu köprüsü hazır değil” (server bridge not ready).
2. On /live enter the operator token.
3. Add a destination: pick the platform, paste the stream key and server address (up to 4 destinations).
4. Choose the quality and press “Canlı yayına çık” (go live).
5. End the stream when you are done.

> 💡 **Tip:** Stream keys are never logged or returned by the server; the browser only stores them if you tick “remember in this browser”.

> 💡 **Tip:** Real platform ingest and the RTMPS handshake have not been verified in this repository yet; do a test stream first.

<a name="community"></a>

## 🤝 Community, announcements and sponsors

Join the channels, announce your stream, manage sponsors and supporters.

1. On /community join our WhatsApp, LinkedIn, Instagram, YouTube, Slack and X channels.
2. Use “Yayın duyurusu” (stream announcement) to build a ready text from a title, time and link; share via WhatsApp, Telegram, LinkedIn, Facebook, X or e-mail (no API key needed).
3. In Studio → Sponsorlar add a sponsor: logo, tier, show on air.
4. Add the rotating “Sponsorlar” layer to a scene; download the on-screen-time report as CSV.
5. To become a supporter or get the sponsor kit see the packages and application drafts on /community.

> 💡 **Tip:** Time means time on screen, not audience size.

> 💡 **Tip:** Sponsor data travels with your project (.pptdz); nothing goes to a server.

<a name="install"></a>

## ⬇️ Install as an app

An app on Windows, macOS, Linux, Android and iOS that opens in its own window and updates itself.

1. Open /download; if your browser supports it an “Install the app” button appears.
2. Chrome / Edge (Windows, macOS, Linux): click the “Install” icon in the address bar.
3. Android: menu (⋮) → “Install app” or “Add to Home screen”.
4. iPhone / iPad: in Safari tap Share → “Add to Home Screen”.
5. macOS Safari 17+: File → “Add to Dock…”.

> 💡 **Tip:** To open it on your phone scan the QR on the /download page.

> 💡 **Tip:** Store and native installers are separate builds; they appear on /download once published (docs/DOWNLOADS.md).

<a name="customize"></a>

## 🎨 Customize brand and look

Name, slogan, “Early access” label, colors, corner radius, scale, logo and share metadata.

1. Settings → “Marka ve görünüm (bu tarayıcı)” (brand and look, this browser): name, slogan, label under the logo, accent colors, corner radius, interface scale and logo; changes apply instantly and stay in this browser.
2. To make it permanent for everybody: Settings → “Site, meta ve paylaşım” (site, metadata and sharing): fill in description, share image, icons, site URL, X handle, language and search-engine settings.
3. Check the preview and the advisory warnings, then copy / download the output as .env, JSON or config.ts.
4. Put the output into the server environment (BRAND_* variables) or src/studio/branding/config.ts and restart.

> 💡 **Tip:** Leave the label under the logo empty to hide the “Early access” badge.

> 💡 **Tip:** Details: docs/BRANDING.md.

<a name="privacy"></a>

## 🔒 Privacy and data

No accounts, no database; your settings and projects stay on your device.

1. Settings live in browser storage (localStorage / IndexedDB).
2. Camera, microphone and screen only reach the other side through the direct (P2P) connections you open.
3. Public STUN (stun.l.google.com) only sees your IP address; you can turn it off in Settings.
4. The room relay keeps names and connection codes briefly in memory and never writes to disk.
5. If you go live, the program output passes through your own server to the platform you chose.

> 💡 **Tip:** Full list and exceptions: README.md → Security & Privacy.

<a name="shortcuts"></a>

## ⌨️ Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Shift+R` | Start / stop recording |
| `M` | Add chapter marker |
| `Space` | Prompter start / pause |
| `↑` | Prompter faster |
| `↓` | Prompter slower |
| `R` | Prompter rewind |
| `Shift+M` | Mute microphone |
| `]` | Next scene |
| `[` | Previous scene |
| `1–9` | Switch to scene (scene number) |

Shortcuts can be changed on the Settings page.

<a name="faq"></a>

## ❓ Frequently asked questions

### The camera or microphone permission never appears.

Make sure the site is opened over HTTPS (browsers expose devices on plain http only for localhost). Check the site permissions behind the lock icon and make sure no other app is using the camera.

### A guest cannot connect (“başarısız” / failed).

There is no TURN server; guests behind symmetric NAT or strict corporate firewalls may fail. Ask them to try mobile data or another network. Use “Röleyi sına” (test relay) in Settings to confirm the relay works.

### There is echo or feedback.

Everybody should wear headphones. Guest audio is part of the program mix and there is no mix-minus, so speaker sound flows back into a microphone.

### The recording is WebM instead of MP4.

Your browser does not support MP4 recording (e.g. Firefox). Chrome, Edge and Safari record MP4; you can convert WebM with any tool.

### /live says “Sunucu köprüsü hazır değil” (server bridge not ready).

ffmpeg must be installed and LIVE_ADMIN_TOKEN (at least 16 characters) set on the server; serverless hosting cannot run the bridge. Steps are in docs/LIVE.md.

### My prototype page does not show on the stage.

Cross-origin iframe content cannot be drawn to the canvas. Use “Başka sekmeyi yakala” (capture another tab) for screen / tab capture; Chrome and Edge also support region cropping.

### I cannot share my screen from an iPhone.

iOS browsers do not support screen sharing (getDisplayMedia). The phone works as a guest camera and a remote; use a computer for screen sharing.

### How do I back up or move my project?

Export it as “.pptdz” from the project menu and import it in another browser. Audio and effect files are not included; add them again.

### The room says there is no relay.

Room mode needs one long-lived Node process on the server (docs/ROOM.md). Serverless platforms such as Cloudflare have no relay; the interface falls back to manual connection automatically.

<a name="resources"></a>

## 📎 PDF, videos and links

### Links

- [YouTube — Teknodoz](https://www.youtube.com/@teknodoz) — Eğitim videoları ve yayın kayıtları / Tutorials and recordings
- [GitHub — kaynak kod, sorunlar, tartışmalar](https://github.com/izmgamestudios/Teknodoz-Stream-Studio) — Hata bildirimi ve katkı / Bug reports and contributions

<a name="more"></a>

## More

- [Room mode, chat and the security model](ROOM.md)
- [Live bridge setup](LIVE.md)
- [Community channel setup guide](COMMUNITY.md)
- [Brand and look customization](BRANDING.md)
- [Installing as an app and native installers](DOWNLOADS.md)
- [Device and browser test guide](DEVICE-TESTING.md)
- [Bibliography](KAYNAKCA.md)
