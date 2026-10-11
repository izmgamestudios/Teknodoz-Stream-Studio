# Room mode (short links, waiting pool, approve-to-connect)

Room mode removes the copy/paste of long offer/answer codes. Participants open a **short link or QR**
(`/r/K7M2QX`), type a name and wait in a **waiting pool**; the operator approves from `/room` (or the
Studio's live panel) and the WebRTC handshake completes automatically.

```
Guest browser                  Relay (/api/room, in memory)               Studio browser
     | POST /join {name,role}  ->  waiting pool  ->  long-poll "join" event  -> pool row appears
     |                                                                    <- [Approve] creates WebRTC offer
     | long-poll "offer"      <-  POST /host/offer {guestId, offer}  <-----'
     | acceptOffer -> answer  ->  POST /guest/answer                 -> long-poll "answer" -> connect
     '====================== direct WebRTC (P2P): video / audio / data ======================'
```

The relay carries only small JSON messages (names, roles, SDP codes). **Media never touches the server.**
Nothing is written to disk and there is no database: restarting the process drops every room.

## What the relay sees and keeps (in memory only)

| Data | Why | Lifetime |
|---|---|---|
| room code (6 chars, no `0/O/1/I`) and a secret host token | find the room / authorise the host | idle room: 6 h; closed room: 2 min |
| guest display name + requested role | shown to the host in the pool | until approved/left; stale (no poll for 90 s): removed |
| SDP offer/answer codes (contain ICE candidates, i.e. IP addresses) | complete the handshake | removed 2 min after the answer |
| client IP (last `X-Forwarded-For` entry) | rate limiting only | counters expire after ≤ 1 h |

The activity log shown on `/room` is stored **only in the host's browser** (IndexedDB) and can be exported as CSV.

## Security model

- Anyone with the link can **ask** to join; nobody connects without the operator's approval
  (optional per-role auto-approve exists and defaults to off).
- Host actions need the secret `hostToken` (kept in the host browser's `localStorage`), guests use a per-guest token.
  Tokens are 144/192-bit random values compared in constant time.
- Rate limits per IP: 10 rooms/hour, 30 joins/10 min. Caps: 200 rooms, 60 guests and 25 waiting per room,
  16 KB request bodies, 12 KB per SDP code, 40-char names (control/zero-width characters stripped).
- SDP codes must match `TKZ…\.[A-Za-z0-9_-]+`; every body is validated with `zod`.
- "New code" in `/room` closes the old room, so old links and QR codes stop working.
- Names are rendered as text by React (never as HTML); the CSV export neutralises spreadsheet formulas.

## API (`src/server/rooms.ts`)

| Method + path | Auth | Purpose |
|---|---|---|
| `GET /api/room/health` | – | relay available? |
| `POST /api/room` | – | create room → `{code, hostToken}` |
| `GET /api/room/:code` | – | `{exists, open, hostOnline}` |
| `DELETE /api/room/:code` | host | close room |
| `POST /api/room/:code/join` | – | guest asks to join → `{guestId, guestToken}` |
| `GET /api/room/:code/host/events?since=N&wait=20` | host | long-poll `join` / `answer` / `leave` events |
| `POST /api/room/:code/host/offer` | host | approve: deliver the offer to a guest |
| `POST /api/room/:code/host/reject` | host | reject a guest |
| `GET /api/room/:code/guest/:id/events?since=N&wait=20` | guest | long-poll `offer` / `rejected` / `closed` |
| `POST /api/room/:code/guest/:id/answer` | guest | send the answer code |
| `POST /api/room/:code/guest/:id/leave` | guest | leave the pool |

## Deployment requirements

- **One long-lived Node process** (the `node-server` Nitro preset behind a reverse proxy, e.g. CloudPanel + pm2 in
  fork mode with a single instance). State is in memory, so several instances or per-request serverless isolates
  (Cloudflare Workers, Lovable preview hosting) do **not** share rooms. The UI detects a missing relay and falls
  back to the manual code exchange (Studio → "Manuel bağlantı").
- Long-poll requests are held up to 25 s. Keep the proxy read timeout above that (nginx default 60 s is fine).
- The reverse proxy must set `X-Forwarded-For` (CloudPanel does). The app only trusts the **last** entry.
- HTTPS is mandatory: browsers only expose camera, microphone and screen capture on secure origins.
- Test the relay from the Settings page ("Röleyi sına") or `curl https://<host>/api/room/health`.

## Known limits

- No TURN server: guests behind symmetric NAT / strict corporate firewalls may fail to connect (the pool entry then
  shows "başarısız" after 60 s).
- Mesh topology: the studio encodes the program once per peer; keep it to ≈ 8 simultaneous people.
- Approving takes a few seconds (ICE gathering, up to 4 s).
