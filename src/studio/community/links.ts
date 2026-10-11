// src/studio/community/links.ts
// >>> The project owner edits THIS file after creating each channel (see docs/COMMUNITY.md). <<<
// Leave a value empty ("") until the channel exists: only valid https links on the platform's own
// domain become buttons (see channels.ts); everything else is ignored and reported in the
// "Kurulum durumu" list of /community.
import { CREDITS } from "../credits";
import type { ChannelLinks } from "./channels";

export const COMMUNITY_LINKS: ChannelLinks = {
  github: CREDITS.repo,
  whatsapp: "https://whatsapp.com/channel/0029VbE4O60FnSz2cQgj9U0A",
  // Telegram kanalı / grubu, e.g. "https://t.me/teknodoz"
  telegram: "",
  // NOT: bu bağlantı çalışma alanının bir kanalına gider ve yalnızca üyeler açabilir.
  // Herkese açık katılım için Slack → "Davet bağlantısı" ile `https://join.slack.com/t/…`
  // üretip buraya koy.
  slack: "https://teknodozproje-dfg7355.slack.com/archives/C0C8BR8HHHC",
  // Discord kalıcı davet, e.g. "https://discord.gg/XXXXXXX"
  discord: "",
  // Facebook grubu, e.g. "https://www.facebook.com/groups/teknodoz"
  facebook: "",
  // LinkedIn Showcase sayfası (şirket sayfası için /company/… de kabul edilir)
  linkedin: "https://www.linkedin.com/showcase/teknodoz",
  youtube: "https://www.youtube.com/@teknodoz",
  instagram: "https://www.instagram.com/teknodoz",
  tiktok: "",
  x: "https://x.com/infoteknodoz",
};
