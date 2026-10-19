import { describe, expect, it } from "vitest";

import { CREDITS } from "../credits";
import {
  PACKAGES,
  PROJECT_SUPPORTERS,
  applicationLinks,
  applicationText,
  contactWhatsAppNumber,
  validSupporters,
  type ProjectSupporter,
} from "./supporters";

const ok: ProjectSupporter = {
  name: "Acme",
  kind: "sponsor",
  tier: "gold",
  url: "https://acme.example",
  logo: "/sponsors/acme.svg",
  since: "2026-11",
};

describe("supporters wall", () => {
  it("ships empty: no invented sponsors", () => {
    expect(PROJECT_SUPPORTERS).toEqual([]);
  });
  it("shows only well-formed entries", () => {
    const bad: ProjectSupporter[] = [
      { ...ok, name: "  " },
      { ...ok, url: "http://acme.example" },
      { ...ok, url: "javascript:alert(1)" },
      { ...ok, url: "https://u:p@acme.example" },
      { ...ok, logo: "https://evil.example/x.png" },
      { ...ok, logo: "/sponsors/../secret.png" },
      { ...ok, logo: "/sponsors/x.html" },
      { ...ok, since: "2026-13" },
      { ...ok, name: "x".repeat(81) },
    ];
    expect(validSupporters([ok, ...bad])).toEqual([ok]);
    expect(
      validSupporters(
        [{ ...ok, logo: undefined as never }].map(
          ({ logo: _l, ...r }) => r as ProjectSupporter,
        ),
      ),
    ).toHaveLength(1);
  });
  it("packages only promise what exists, one per tier", () => {
    expect(PACKAGES.map((p) => p.tier)).toEqual([
      "supporter",
      "silver",
      "gold",
      "title",
    ]);
    for (const p of PACKAGES) expect(p.benefits.length).toBeGreaterThan(0);
  });
});

describe("application kit", () => {
  const input = {
    kind: "investor" as const,
    name: "Ayşe Yılmaz",
    org: "Örnek Ventures",
    contact: "ayse@example.com",
    message: "Merhaba!\nGörüşmek isteriz.",
  };
  it("builds a mailto and a wa.me link for the project owner", () => {
    const l = applicationLinks(input);
    const m = new URL(l.mailto.replace("mailto:", "mailto://x/"));
    expect(l.mailto.startsWith(`mailto:${CREDITS.email}?subject=`)).toBe(true);
    expect(decodeURIComponent(m.searchParams.get("subject") as string)).toBe(
      "[Teknodoz] Yatırım görüşmesi — Örnek Ventures",
    );
    expect(m.searchParams.get("body")).toContain("Kurum: Örnek Ventures");
    expect(m.searchParams.get("body")).toContain("Görüşmek isteriz.");
    expect(
      l.whatsapp.startsWith(`https://wa.me/${contactWhatsAppNumber()}?text=`),
    ).toBe(true);
    expect(contactWhatsAppNumber()).toBe("905417709205");
  });
  it("cannot inject extra mail headers or control characters", () => {
    const t = applicationText({
      ...input,
      name: "A\r\nBcc: evil@example.com",
      org: "Org\u0000\u200bX",
      message: "x\u0007y\r\nz",
    });
    expect(t.subject).not.toMatch(/[\r\n]/);
    expect(t.subject).toBe("[Teknodoz] Yatırım görüşmesi — Org X");
    expect(t.body).toContain("Ad: A Bcc: evil@example.com");
    expect(
      [...t.body].some((ch) => ch.charCodeAt(0) < 10 || ch === "\u200b"),
    ).toBe(false);
    expect(t.body).toContain("xy\nz");
  });
  it("caps lengths and survives empty input", () => {
    const t = applicationText({
      kind: "sponsor",
      name: "",
      org: "",
      contact: "",
      message: "m".repeat(5000),
    });
    expect(t.subject).toBe("[Teknodoz] Sponsorluk — —");
    expect(t.body.length).toBeLessThan(1500);
    expect(
      applicationText({
        kind: "media",
        name: "",
        org: "",
        contact: "",
        message: "",
      }).body,
    ).toContain("(mesaj yok)");
  });
});
