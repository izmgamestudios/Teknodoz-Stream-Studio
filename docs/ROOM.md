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
| `POST /api/room/:code/host/editor` / `DELETE` | host | issue / rotate / revoke the chat **editor key** |
| `POST /api/room/:code/host/chat-mode` | host | `moderated` (default) · `open` · `off` |
| `GET /api/room/:code/chat?since=N&wait=20` | host **or** editor | long-poll the whole chat (queue included) |
| `POST /api/room/:code/chat` | host or editor | post as "Reji" / "Editör" (published at once) |
| `POST /api/room/:code/chat/:id` | host or editor | `approve` · `reject` · `edit`; `onair` / `offair` are **host only** |
| `GET /api/room/:code/guest/:id/chat?since=N&wait=20` | guest | approved messages + the guest's own |
| `POST /api/room/:code/guest/:id/chat` | guest | post a message (goes to the approval queue) |

## Moderated chat (director / editor desk)

Connected participants (guests and viewers; phone remotes get no chat) can write in the room. Nothing
reaches the other participants or the stream without a human decision:

```
participant ──post──▶ [pending] ──editor/director approve──▶ [approved] ──director "Yayına al"──▶ on air (overlay)
                         │                                       └─ "Gizle" / reject: removed again, also from the overlay
                         └─ reject (never shown to others)
```

| Seat | Credential | Can |
|---|---|---|
| **Reji / director** | the room's host token (the `/room` page) | everything: approve, reject, edit, **put on air**, chat mode, issue/rotate/revoke the editor link |
| **Editör / editor** | rotatable editor key in a link `/chat/<CODE>#k=<key>` (open it on another device) | approve, reject, edit, post announcements. **Cannot** put a message on air or change the mode |
| **Participant** | its guest token | post (queue), read approved messages and its own status |

**Chat-only audience** (`/r/<CODE>?as=chat`, 4th link on `/room`): for events/webinars where people watch the stream
elsewhere (YouTube, a hall screen) and only want to write. They join **without approval and without WebRTC**
(no pool entry, no video/audio, not limited by the 8-person mesh): every message still goes through the moderation
queue. Caps: 300 per room (separate from the 60 guests / 25 waiting), a roomier join bucket (200 / 10 min / IP, since an
audience often shares one NAT) and a 10-minute idle window instead of 2 minutes. The desk shows `👥 n` people in the chat.
The sidebar "Oda" entry and the tab title show waiting requests (`n`) and chat messages awaiting moderation (`💬 n`).

- **Modes:** `moderated` (default: every participant message waits for approval), `open` (auto-approved, still
  rate-limited and still hideable), `off` (participants cannot post; moderators can).
- **Overlay:** add a **Sohbet (oda)** layer (layer panel). `spotlight` draws only the message the director put on
  air (author tag + text card); `feed` draws the latest approved messages. With no message the layer is empty.
- **Limits:** 280 chars (control/zero-width characters stripped, rendered as plain text), at most 1 message per
  1.5 s and 15/min per participant, 5 pending per participant, 100 pending per room, 400 messages kept per room.
- **Privacy:** pending/rejected texts are visible only to moderators and their author; a message hidden after it
  was published is removed from participants' feeds (clients receive it without text). The editor key lives in
  the URL fragment (not sent to the server by the browser) and only travels as a bearer token to the chat API;
  "Yenile" invalidates the old link, "İptal et" removes the editor seat. Chat is in memory only and disappears
  with the room (closing the room clears it).
- **Out of scope (by design, MVP):** a chat-only audience role without a WebRTC slot, and persistent chat history.
  Moderation actions are not written to the activity log, only editor-link changes and mode switches are.

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
