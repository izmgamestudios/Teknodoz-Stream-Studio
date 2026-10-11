# Device and browser testing

## What has been verified (automatically)

| Check | Environment | Result |
|---|---|---|
| Unit tests (1800+) | Node 22 + jsdom | pass |
| Studio, prompter, recording (MP4 + chapters/SRT), `.pptdz` export | headless Chromium 140-class, fake camera/mic | pass |
| Room flow: short link → waiting pool → approve → auto-connect → video | 2–3 Chromium pages | pass |
| Phone remote (scene switch, record start) | Chromium with iPhone 13 / Pixel 7 / 320 px Android *emulation* (touch, viewport, UA) | pass, no horizontal overflow, tap targets ≥ 66 px |
| QR scan → auto-connect | Chromium with an *injected* `BarcodeDetector` | pass (wiring only) |
| Third-party requests | all pages | none (fonts self-hosted) |

## What has NOT been verified (no such browsers/devices in the CI sandbox)

Real Safari (macOS/iOS), Firefox, Chrome on Android/Windows, real phones and cameras, microphones,
speech recognition, screen/tab capture, networks with NAT/firewalls, 1080p60 performance on real hardware,
long recordings, background-tab behaviour.

## Expected support (from API availability — treat as hypotheses until tested)

| Feature | Chrome/Edge desktop | Firefox | Safari macOS | Safari iOS | Chrome Android |
|---|---|---|---|---|---|
| Studio, scenes, layers, recording | ✅ | ✅ WebM only | ✅ MP4 (14.1+) | ⚠️ camera ok, heavy | ⚠️ heavy |
| Canvas CSS filters (layer effects) | ✅ | ✅ | ❌ ignored (no `ctx.filter`) | ❌ ignored | ✅ |
| Chroma key (WebGL2, CPU fallback) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Screen / tab capture (`getDisplayMedia`) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Prototype crop capture (`CropTarget`) | ✅ | ❌ (use "pick tab") | ❌ | ❌ | ❌ |
| Voice follow (Web Speech) | ✅ (sends audio to Google) | ❌ | ⚠️ limited | ⚠️ limited | ✅ |
| Guest / viewer / remote via `/r/CODE` | ✅ | ✅ | ✅ | ✅ (tap to start video/audio) | ✅ |
| QR scan (`BarcodeDetector`) | macOS/ChromeOS/Android only | ❌ | ❌ | ❌ | ✅ |
| `.docx` import | ✅ | ✅ | ✅ | ✅ | ✅ |

## Manual test script (≈ 20 minutes per device)

Run against the deployed HTTPS site. Note browser + version + OS for every failure.

**A. Guest on a phone (Safari iOS / Chrome Android)**
1. Studio: open `/room`, create the room, show the QR of the **Konuk** link.
2. Phone: scan with the camera app → page opens in the language of the phone.
3. Enter a name → "Send join request". Expect: "Waiting for approval" and a new row + badge on the studio.
4. Studio: **Onayla**. Expect: phone shows the live program within ~10 s, with sound after tapping "Turn sound on" if blocked.
5. Phone: "Test camera and microphone" → level bar moves → "Enter the green room".
6. Studio: live panel → **Yayına al**. Expect: guest tile on the program canvas and audible guest voice; mute/gain work.
7. Lock the phone for 20 s and unlock: connection still alive? (record result)

**B. Phone remote**
1. `/room` → **Telefon kumandası** QR → approve.
2. Tap scenes, ▶ prompter, ＋/−, ● record, 🔖 marker, mic mute. Every tap must act on the studio within 1 s.

**C. Firefox desktop**
1. `/studio`: camera on, record 10 s → file is `.webm`, chapters/SRT download.
2. `/room` with a second profile as guest.
3. Prototype layer: use "Başka sekmeyi yakala" (region crop is Chromium-only).

**D. Safari macOS**
1. Same as C; confirm MP4 plays in QuickTime and layer effects (filters) are ignored without errors.

**E. Voice follow (Chrome)**
1. `/` paste a script, enable "Konuştukça kaydır", read it aloud, then improvise and stay silent: scrolling must follow, hold on silence.

**F. Network**
1. Guest on mobile data (not Wi-Fi) with STUN on → expect connection; with STUN off → expect it to fail and show "başarısız".
2. Guest behind a corporate/guest Wi-Fi (symmetric NAT) → record whether it connects.

Report results in an issue with the table above filled in.
