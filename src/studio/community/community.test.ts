import { describe, expect, it } from "vitest";

import { CHANNELS, channelStatuses, validateChannelUrl } from "./channels";
import { COMMUNITY_LINKS } from "./links";
import {
  SHARE_TARGETS,
  announcementText,
  formatWhen,
  isHttpUrl,
  parseHashtags,
  shareUrl,
} from "./share";

describe("validateChannelUrl", () => {
  it.each([
    ["whatsapp", "https://whatsapp.com/channel/0029VaXYZ"],
    ["whatsapp", "https://chat.whatsapp.com/AbCdEf123"],
    ["telegram", "https://t.me/teknodoz"],
    ["telegram", "https://t.me/+AbCdEf"],
    ["slack", "https://join.slack.com/t/teknodoz/shared_invite/zt-1"],
    ["slack", "https://teknodoz.slack.com/"],
    ["discord", "https://discord.gg/abcdef"],
    ["discord", "https://discord.com/invite/abcdef"],
    ["facebook", "https://www.facebook.com/groups/teknodoz"],
    ["linkedin", "https://www.linkedin.com/company/teknodoz/"],
    ["linkedin", "https://www.linkedin.com/showcase/teknodoz-studio/"],
    ["github", "https://github.com/izmgamestudios/Teknodoz-Stream-Studio"],
    ["youtube", "https://www.youtube.com/@teknodoz"],
    ["x", "https://x.com/teknodoz"],
  ] as const)("accepts %s %s", (id, url) => {
    expect(validateChannelUrl(id, url).ok).toBe(true);
  });

  it.each([
    ["whatsapp", "", "empty"],
    ["whatsapp", "not a url", "invalid"],
    ["whatsapp", "http://whatsapp.com/channel/x", "not-https"],
    ["whatsapp", "javascript:alert(1)", "not-https"],
    ["whatsapp", "https://user:pw@whatsapp.com/channel/x", "credentials"],
    ["whatsapp", "https://whatsapp.com.evil.io/channel/x", "host"],
    ["telegram", "https://evil.example/t.me/x", "host"],
    ["slack", "https://slack.com.evil.io/", "host"],
    ["slack", "https://evilslack.com/", "host"],
    [
      "linkedin",
      "https://www.linkedin.com/in/huseyin-bayer-izmgamestudios",
      "path",
    ],
    ["github", `https://github.com/${"a".repeat(400)}`, "too-long"],
  ] as const)("rejects %s %s (%s)", (id, url, problem) => {
    expect(validateChannelUrl(id, url)).toEqual({ ok: false, problem });
  });

  it("keeps only valid links as active and reports the rest", () => {
    const st = channelStatuses({
      github: "https://github.com/x/y",
      whatsapp: "https://evil.io/channel/1",
      telegram: "",
    });
    const by = Object.fromEntries(st.map((s) => [s.def.id, s]));
    expect(by["github"]?.url).toBe("https://github.com/x/y");
    expect(by["whatsapp"]).toMatchObject({ url: null, problem: "host" });
    expect(by["telegram"]).toMatchObject({ url: null, problem: null });
    expect(st).toHaveLength(CHANNELS.length);
  });

  it("the shipped links file is valid (only what exists is configured)", () => {
    const st = channelStatuses(COMMUNITY_LINKS);
    expect(st.filter((s) => s.problem)).toEqual([]);
    expect(st.find((s) => s.def.id === "github")?.url).toContain("github.com/");
  });

  it("publishes the project's own channels", () => {
    const url = (id: string) =>
      channelStatuses(COMMUNITY_LINKS).find((s) => s.def.id === id)?.url;
    expect(url("linkedin")).toBe("https://www.linkedin.com/showcase/teknodoz");
    expect(url("instagram")).toBe("https://www.instagram.com/teknodoz");
    expect(url("whatsapp")).toBe(
      "https://whatsapp.com/channel/0029VbE4O60FnSz2cQgj9U0A",
    );
    expect(url("youtube")).toBe("https://www.youtube.com/@teknodoz");
    expect(url("slack")).toContain("teknodozproje-dfg7355.slack.com");
    expect(url("x")).toBe("https://x.com/infoteknodoz");
  });
});

describe("share urls", () => {
  const input = {
    url: "https://youtu.be/abc?t=1&x=2",
    text: "🔴 Canlı & güzel #yayın",
    title: "Yayın",
  };
  it("builds the official share intents with everything encoded", () => {
    const u = (t: Parameters<typeof shareUrl>[0]) =>
      new URL(shareUrl(t, input) as string);
    expect(u("whatsapp").origin + u("whatsapp").pathname).toBe(
      "https://wa.me/",
    );
    expect(u("whatsapp").searchParams.get("text")).toBe(input.text);
    expect(u("telegram").searchParams.get("url")).toBe(input.url);
    expect(u("telegram").searchParams.get("text")).toBe(input.text);
    expect(u("linkedin").searchParams.get("url")).toBe(input.url);
    expect(u("facebook").searchParams.get("u")).toBe(input.url);
    expect(u("x").searchParams.get("url")).toBe(input.url);
    const mail = shareUrl("email", input) as string;
    expect(mail.startsWith("mailto:?subject=")).toBe(true);
    expect(decodeURIComponent(mail.split("body=")[1] as string)).toBe(
      input.text,
    );
    expect(SHARE_TARGETS.map((t) => t.id).sort()).toEqual([
      "email",
      "facebook",
      "linkedin",
      "telegram",
      "whatsapp",
      "x",
    ]);
  });
  it("refuses non-http(s) links and caps long text", () => {
    for (const t of SHARE_TARGETS)
      for (const bad of [
        "javascript:alert(1)",
        "data:text/html,x",
        "ftp://x.org",
        "not a url",
        "",
        "https://u:p@x.org/",
      ])
        expect(
          shareUrl(t.id, { ...input, url: bad }),
          `${t.id} ${bad}`,
        ).toBeNull();
    const long = shareUrl("whatsapp", {
      ...input,
      text: "a".repeat(5000),
    }) as string;
    expect(decodeURIComponent(long.split("text=")[1] as string).length).toBe(
      1000,
    );
    expect(isHttpUrl("https://x.org")).toBe(true);
  });
});

describe("announcement text", () => {
  it("renders TR and EN, with and without a date", () => {
    const tr = announcementText({
      title: "Haftalık Demo",
      url: "https://x.org/live",
      lang: "tr",
      hashtags: "teknodoz, #canlıyayın  yayın",
    });
    expect(tr).toBe(
      "🔴 CANLI YAYIN: Haftalık Demo\n🗓 Şimdi canlıyız!\n▶ İzle / katıl: https://x.org/live\n#teknodoz #canlıyayın #yayın",
    );
    const en = announcementText({
      title: "Weekly demo",
      url: "https://x.org/live",
      lang: "en",
      when: "2026-11-05T20:30",
    });
    expect(en).toContain("🔴 LIVE: Weekly demo");
    expect(en).toContain("2026");
    expect(en).toContain("▶ Watch / join: https://x.org/live");
    expect(
      announcementText({ title: "  \n ", url: "https://x.org", lang: "tr" }),
    ).toContain("CANLI YAYIN: Canlı yayın");
  });
  it("sanitises titles and hashtags", () => {
    expect(
      announcementText({
        title: "a\nb​c ".repeat(80),
        url: "https://x.org",
        lang: "tr",
      }).split("\n")[0]?.length,
    ).toBeLessThan(170);
    expect(parseHashtags("a b #c <script> #c, x-y 😀")).toEqual([
      "#a",
      "#b",
      "#c",
    ]);
    expect(formatWhen("nonsense", "tr")).toBe("");
    expect(formatWhen("2026-02-31T25:99", "tr")).toBe("");
  });
});
