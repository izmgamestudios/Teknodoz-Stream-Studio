// src/studio/community/links.ts
// >>> The project owner edits THIS file after creating each channel (see docs/COMMUNITY.md). <<<
// Leave a value empty ("") until the channel exists: only valid https links on the platform's own
// domain become buttons (see channels.ts); everything else is ignored and reported in the
// "Kurulum durumu" list of /community.
import { CREDITS } from "../credits";
import type { ChannelLinks } from "./channels";

export const COMMUNITY_LINKS: ChannelLinks = {
  github: CREDITS.repo,
  // WhatsApp Kanalı, e.g. "https://whatsapp.com/channel/XXXXXXXXXXXX"
  whatsapp: "",
  // Telegram kanalı / grubu, e.g. "https://t.me/teknodoz"
  telegram: "",
  // Slack davet bağlantısı, e.g. "https://join.slack.com/t/teknodoz/shared_invite/..."
  slack: "",
  // Discord kalıcı davet, e.g. "https://discord.gg/XXXXXXX"
  discord: "",
  // Facebook grubu, e.g. "https://www.facebook.com/groups/teknodoz"
  facebook: "",
  // LinkedIn SAYFASI (kişisel profil değil), e.g. "https://www.linkedin.com/company/teknodoz/"
  linkedin: "",
  youtube: "",
  instagram: "",
  tiktok: "",
  x: "",
};
