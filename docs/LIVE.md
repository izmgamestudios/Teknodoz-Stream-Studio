# Live streaming to YouTube, Facebook, Twitch, Kick, Instagram, TikTok… (`/live`, RTMP/RTMPS)

Browsers cannot speak RTMP, so going live needs a small server-side bridge. The studio records its program
output (canvas + audio mix) with `MediaRecorder`, uploads the chunks to **your own server**, where **ffmpeg**
re-encodes them (H.264 + AAC) and pushes them to the platform(s) over RTMPS/RTMP. No third-party service is involved.

```
Studio tab ── MediaRecorder (WebM/VP8+Opus, 1 s chunks) ──POST /api/live/session/:id/chunk?seq=N──▶ Node server
                                                                                                        │ stdin
                                                                                                    ffmpeg (x264 + aac, tee)
                                                                                         ┌──────────────┼──────────────┐
                                                                                  rtmps://YouTube   rtmps://Facebook   rtmp(s)://…
```

> **Status:** verified end to end on this repository's CI-less sandbox with real Chromium → built Node server →
> real ffmpeg → a local RTMP listener (captured stream: H.264 Main + AAC stereo, correct resolution/duration).
> **Not verified here:** the TLS handshake of `rtmps://` and real platform ingest (no outbound access / accounts in the
> sandbox), Safari and Firefox `MediaRecorder` paths, real-world CPU/bandwidth on your server.

## Security model (read before enabling)

The bridge makes your server open outbound connections and run `ffmpeg`, so it is **off by default** and gated:

| Control | What it does |
|---|---|
| `LIVE_ADMIN_TOKEN` (≥ 16 chars) | Without it every `/api/live/*` call except `/health` answers *disabled*. All other calls need `Authorization: Bearer <token>` (constant-time compare). 10 wrong tokens per 10 min per IP → 429. |
| Host allowlist | Destinations must be on the built-in platform domains (`*.youtube.com`, `*.facebook.com`, `*.instagram.com`, `*.fbcdn.net`, `*.twitch.tv`, `*.live-video.net`, `*.kick.com`, `*.tiktokcdn.com`, `*.tiktokcdn-us.com`, `*.tiktok.com`) or in `LIVE_ALLOWED_HOSTS`. `LIVE_ALLOW_ANY_HOST=1` opens it to any public host. |
| SSRF guard | The host is resolved and refused if **any** address is loopback / private / link-local / CGNAT / ULA / multicast; ports limited to 80, 443, 1935, 1936, 3443, 8080, 8443. `LIVE_ALLOW_PRIVATE=1` lifts both (self-hosted ingest such as SRS/nginx-rtmp on the same network). Residual risk: ffmpeg resolves the name again (DNS rebinding), acceptable because only the token holder can reach it. |
| Strict URL/key charset | `rtmp(s)://host[:port]/path[?query]` and keys `[A-Za-z0-9._~%+=&?-]` only; no credentials in the URL, no spaces/quotes/`\|`/brackets. ffmpeg is started with an argv array (no shell). |
| Secrets | Stream keys are never logged, never returned by any endpoint and are scrubbed (`***`) from ffmpeg output shown in the UI. The browser keeps keys in memory only unless you tick "keep keys in this browser". |
| Resource limits | one session at a time, ≤ 4 destinations, `LIVE_MAX_VIDEO_KBPS`, `LIVE_MAX_MINUTES`, chunks ≤ 6 MB, auto-stop after `LIVE_IDLE_STOP_SECONDS` without media. |

Whoever holds the operator token can publish to the allowed platforms **with keys they supply**; they cannot run
commands or reach private networks (unless you set `LIVE_ALLOW_PRIVATE=1`). Treat the token like a password and use HTTPS.

## Server setup

1. Install ffmpeg with libx264 + AAC (every distro build has them): `sudo apt install -y ffmpeg`.
   **No root** (CloudPanel site users cannot `sudo`)? Put a static build in the site user's home and point
   `LIVE_FFMPEG_PATH` at it (`~` is expanded by the app):

   ```bash
   mkdir -p ~/bin ~/ffdl && cd ~/ffdl && uname -m          # x86_64 -> "amd64", aarch64 -> "arm64" below
   curl -fsSLO https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
   curl -fsSLO https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz.md5
   md5sum -c ffmpeg-release-amd64-static.tar.xz.md5 && tar -xJf ffmpeg-release-amd64-static.tar.xz
   find . -type f -name ffmpeg -exec cp {} ~/bin/ffmpeg \; && chmod +x ~/bin/ffmpeg && cd ~ && rm -rf ~/ffdl
   ~/bin/ffmpeg -hide_banner -encoders | grep -E "libx264 |aac "    # both must be listed
   ~/bin/ffmpeg -hide_banner -protocols | grep rtmps                # must list rtmps (input and output)
   ```

   It is a third-party binary and the `.md5` file comes from the same site (integrity, not authenticity): a distro
   package installed by an administrator is the more trustworthy route when you can get one.
2. Set the environment of the Node process (pm2 example; keep the **single** instance, state is in memory):

```bash
export LIVE_ADMIN_TOKEN="$(openssl rand -hex 24)"   # keep this value, you type it on /live
NITRO_PORT=3011 NITRO_HOST=127.0.0.1 pm2 start .output/server/index.mjs --name teknodoz-studio --update-env && pm2 save
```

3. Reverse proxy: allow request bodies of **at least 8 MB** (`client_max_body_size 8m;` — nginx's default of 1 MB would
   reject 1080p chunks with HTTP 413) and keep the read timeout > 25 s. HTTPS is mandatory.
4. Open `/live`, enter the token, add a destination, choose a quality, **Canlı yayına çık**.

| Variable | Default | Meaning |
|---|---|---|
| `LIVE_ADMIN_TOKEN` | – (feature off) | operator secret, ≥ 16 chars |
| `LIVE_FFMPEG_PATH` | `ffmpeg` | binary to run; `~/bin/ffmpeg` is expanded with `$HOME` |
| `LIVE_ALLOWED_HOSTS` | – | extra hosts, comma separated, `*.example.com` allowed |
| `LIVE_ALLOW_ANY_HOST` | off | `1` = any public host |
| `LIVE_ALLOW_PRIVATE` | off | `1` = private/loopback targets and any port |
| `LIVE_MAX_MINUTES` | 360 | hard stop |
| `LIVE_MAX_VIDEO_KBPS` | 9000 | ceiling for the requested bit rate |
| `LIVE_X264_PRESET` | `veryfast` | `ultrafast`…`medium` (faster = less CPU, larger/worse video) |
| `LIVE_IDLE_STOP_SECONDS` | 20 | stop when the browser stops sending |

## "API key" = server URL + stream key

Every platform's RTMPS ingest authenticates with a **stream key** (the "API key" you copy from its live dashboard)
plus a **server URL**. Only YouTube and Facebook have a fixed address, the studio prefills those; for the others copy
both values from the platform:

| Platform | Prefilled server | Where to get the key / caveats (check the platform's current help pages) |
|---|---|---|
| YouTube | `rtmps://a.rtmps.youtube.com:443/live2` (backup `b.rtmps…/live2?backup=1`) | YouTube Studio → Create → Go live → Stream settings. Live streaming must be enabled on the channel. |
| Facebook | `rtmps://live-api-s.facebook.com:443/rtmp/` | Live Producer → "Use stream key"; keys are short-lived unless you pick a persistent key. |
| Twitch | copy from the ingest list | Creator Dashboard → Settings → Stream. RTMPS support depends on the endpoint you pick. |
| Kick | copy (`…global-contribute.live-video.net`) | Dashboard → Stream. Account-specific. |
| Instagram | copy | Live Producer on instagram.com; offered only to eligible accounts (commonly ≥ 1000 followers, public). |
| TikTok | copy (often plain `rtmp://`) | LIVE Producer/Studio stream key; offered only to eligible accounts/regions and usually rotated per session. |
| Custom | – | SRS, nginx-rtmp, Restream… add the host to `LIVE_ALLOWED_HOSTS`. |

Creating the broadcast event through each platform's API (YouTube Data API OAuth, Facebook Graph…) is **not**
included: it needs an OAuth app registered by whoever hosts the studio. The stream-key route works for every platform
without any of that.

## Quality and capacity

The server re-encodes, so plan for CPU (x264 `veryfast`) and for your **upload** bandwidth (browser → server needs
roughly 1.5× the output bit rate, server → platform 1×):

| Preset | Output | ≈ server CPU | Browser upload |
|---|---|---|---|
| 480p30 | 1.2 Mbps | ~0.5 core | ~2 Mbps |
| 720p30 (default) | 3 Mbps | ~1 core | ~5 Mbps |
| 1080p30 | 6 Mbps | ~2–3 cores | ~9 Mbps |
| 1080p60 | 9 Mbps | ~4+ cores | ~14 Mbps |

The `/live` page shows the encoder speed (`< 0.93×` = the server cannot keep up) and the upload backlog.
Several destinations share one encode (ffmpeg `tee`), so a second platform costs bandwidth, not CPU.

## API (`src/server/live.ts`)

| Method + path | Auth | Purpose |
|---|---|---|
| `GET /api/live/health` | – | `{enabled}` |
| `GET /api/live/status` | token | ffmpeg version, limits, current session (no keys) |
| `POST /api/live/probe` | token | policy check + TCP reachability of a server URL |
| `POST /api/live/session` | token | start: destinations, video, audio, container → session |
| `POST /api/live/session/:id/chunk?seq=N` | token | next media chunk (strictly sequential, duplicates tolerated) |
| `GET /api/live/session/:id` | token | state + ffmpeg progress |
| `DELETE /api/live/session/:id` | token | stop (graceful, then SIGTERM/SIGKILL) |

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Sunucu köprüsü hazır değil" | no Node server (static hosting) or `LIVE_ADMIN_TOKEN` unset/too short |
| "ffmpeg bulunamadı" | `apt install ffmpeg` (root), or the no-root static build above + `LIVE_FFMPEG_PATH` |
| 413 / upload fails immediately | proxy body limit < chunk size, raise `client_max_body_size` |
| "Bu sunucu adresi izinli değil" | add the host to `LIVE_ALLOWED_HOSTS` |
| session ends at once, tail shows `Connection refused` / `Input/output error` | wrong server URL or key, expired key (Facebook, TikTok), account not eligible, outbound 443/1935 blocked |
| "Sunucu CPU'su yetişemiyor" | lower the quality or use `LIVE_X264_PRESET=ultrafast` |
| stream stops after ~20 s in a background tab | the browser throttled the tab; keep the studio tab visible (the compositor falls back to a worker timer, but some browsers still pause `MediaRecorder`) |

## Known limits (MVP)

- Re-encode only. A "copy" mode for browsers that produce H.264 directly (Safari) would save CPU but needs keyframe
  guarantees the browser cannot give.
- One session per server process; no auto-reconnect if the platform drops the connection (the page shows the error).
- The chat overlay (`Sohbet` layer) is part of the program output, so approved chat also appears on the live stream.
