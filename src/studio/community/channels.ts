// src/studio/community/channels.ts
// The project's community channels (WhatsApp channel, LinkedIn page, Facebook group, Telegram,
// Slack, Discord, GitHub…). Definitions are static; the URLs live in `links.ts` and are
// validated against the platform's own domains so a typo or a malicious edit cannot turn the
// "join" buttons into arbitrary links.

export type ChannelId =
  | "whatsapp"
  | "telegram"
  | "slack"
  | "discord"
  | "facebook"
  | "linkedin"
  | "github"
  | "youtube"
  | "instagram"
  | "tiktok"
  | "x";

export type ChannelGroup = "community" | "social";

export interface ChannelDef {
  id: ChannelId;
  name: string;
  icon: string;
  group: ChannelGroup;
  /** what to create on the platform (shown in the setup status) */
  create: string;
  /** one line for the visitor */
  blurb: string;
  /** allowed hostnames; `*.x.com` matches subdomains only */
  hosts: readonly string[];
  /** optional path prefixes the URL must start with (any when empty) */
  paths?: readonly string[];
}

export const CHANNELS: readonly ChannelDef[] = [
  {
    id: "whatsapp",
    name: "WhatsApp Kanalı",
    icon: "🟢",
    group: "community",
    create: "WhatsApp → Güncellemeler → Kanallar → Kanal oluştur",
    blurb: "Sürüm notları ve yayın duyuruları (tek yönlü).",
    hosts: ["whatsapp.com", "www.whatsapp.com", "chat.whatsapp.com", "wa.me"],
  },
  {
    id: "telegram",
    name: "Telegram",
    icon: "✈️",
    group: "community",
    create: "Telegram → Yeni Kanal (+ bağlı tartışma grubu)",
    blurb: "Duyuru kanalı ve tartışma grubu.",
    hosts: ["t.me", "telegram.me"],
  },
  {
    id: "slack",
    name: "Slack",
    icon: "💬",
    group: "community",
    create: "slack.com → çalışma alanı oluştur → davet bağlantısı",
    blurb: "Geliştiriciler, ortaklar ve sponsorlar için çalışma alanı.",
    hosts: ["slack.com", "*.slack.com"],
  },
  {
    id: "discord",
    name: "Discord",
    icon: "🎧",
    group: "community",
    create: "Discord → sunucu oluştur → kalıcı davet bağlantısı",
    blurb: "Topluluk sohbeti ve canlı yayın odaları.",
    hosts: ["discord.gg", "discord.com"],
  },
  {
    id: "facebook",
    name: "Facebook Topluluğu",
    icon: "📘",
    group: "community",
    create: "Facebook → Gruplar → Yeni grup (marka için ayrıca Sayfa)",
    blurb: "Soru-cevap ve paylaşımlar için Facebook grubu.",
    hosts: [
      "facebook.com",
      "www.facebook.com",
      "m.facebook.com",
      "fb.com",
      "fb.me",
    ],
  },
  {
    id: "linkedin",
    name: "LinkedIn Sayfası",
    icon: "💼",
    group: "community",
    create: "LinkedIn → İş için → Sayfa oluştur (Şirket veya Showcase)",
    blurb: "Kurumsal gelişmeler, ortaklıklar ve iş birlikleri.",
    hosts: ["linkedin.com", "www.linkedin.com", "tr.linkedin.com"],
    paths: ["/company/", "/showcase/"],
  },
  {
    id: "github",
    name: "GitHub",
    icon: "🐙",
    group: "community",
    create: "Depo + Discussions'ı açın (Settings → Features)",
    blurb: "Kaynak kod, hata bildirimleri ve katkılar.",
    hosts: ["github.com"],
  },
  {
    id: "youtube",
    name: "YouTube",
    icon: "▶️",
    group: "social",
    create: "YouTube kanalı (@kullanıcıadı)",
    blurb: "Yayın kayıtları ve eğitim videoları.",
    hosts: ["youtube.com", "www.youtube.com", "youtu.be"],
  },
  {
    id: "instagram",
    name: "Instagram",
    icon: "📸",
    group: "social",
    create: "Instagram profesyonel hesap",
    blurb: "Kısa videolar ve yayın duyuruları.",
    hosts: ["instagram.com", "www.instagram.com"],
  },
  {
    id: "tiktok",
    name: "TikTok",
    icon: "🎵",
    group: "social",
    create: "TikTok hesabı",
    blurb: "Kısa videolar ve canlı yayınlar.",
    hosts: ["tiktok.com", "www.tiktok.com"],
  },
  {
    id: "x",
    name: "X",
    icon: "✖️",
    group: "social",
    create: "X hesabı",
    blurb: "Hızlı duyurular.",
    hosts: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
  },
];

export function getChannel(id: ChannelId): ChannelDef {
  return CHANNELS.find((c) => c.id === id) as ChannelDef;
}

function hostAllowed(host: string, patterns: readonly string[]): boolean {
  const h = host.toLowerCase();
  return patterns.some((p) =>
    p.startsWith("*.")
      ? h.endsWith(p.slice(1)) && h.length > p.length - 1
      : h === p,
  );
}

export type UrlProblem =
  | "empty"
  | "invalid"
  | "not-https"
  | "credentials"
  | "host"
  | "path"
  | "too-long";

export type UrlCheck =
  { ok: true; url: string } | { ok: false; problem: UrlProblem };

/** Accept only an https link on one of the platform's own domains. */
export function validateChannelUrl(id: ChannelId, raw: string): UrlCheck {
  const s = raw.trim();
  if (!s) return { ok: false, problem: "empty" };
  if (s.length > 300) return { ok: false, problem: "too-long" };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { ok: false, problem: "invalid" };
  }
  if (u.protocol !== "https:") return { ok: false, problem: "not-https" };
  if (u.username || u.password) return { ok: false, problem: "credentials" };
  const def = getChannel(id);
  if (!hostAllowed(u.hostname, def.hosts))
    return { ok: false, problem: "host" };
  if (def.paths && !def.paths.some((p) => u.pathname.startsWith(p)))
    return { ok: false, problem: "path" };
  return { ok: true, url: u.toString() };
}

export type ChannelLinks = Partial<Record<ChannelId, string>>;

export interface ChannelStatus {
  def: ChannelDef;
  /** validated link, when configured and valid */
  url: string | null;
  /** configured but rejected */
  problem: UrlProblem | null;
}

/** Resolve the configured links into a per-channel status (invalid links never become buttons). */
export function channelStatuses(links: ChannelLinks): ChannelStatus[] {
  return CHANNELS.map((def) => {
    const raw = links[def.id];
    if (raw === undefined || raw.trim() === "")
      return { def, url: null, problem: null };
    const r = validateChannelUrl(def.id, raw);
    return r.ok
      ? { def, url: r.url, problem: null }
      : { def, url: null, problem: r.problem };
  });
}
