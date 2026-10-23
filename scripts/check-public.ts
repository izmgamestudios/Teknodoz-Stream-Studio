// scripts/check-public.ts
// Audits the PUBLIC surface of a running site: robots / sitemaps / llms.txt, then every page of
// the sitemap (up to --max, default 50) with the same validator the test suite uses.
//   node --experimental-strip-types scripts/check-public.ts https://teknodoz-studio.ortakofis.org
// Exit code 1 when any error is found. Needs only Node 22.
import { validatePage } from "../src/server/seo/validate.ts";

const origin = (process.argv[2] ?? "").replace(/\/+$/, "");
const max = Number(
  process.argv.find((a) => a.startsWith("--max="))?.slice(6) ?? 50,
);
if (!/^https?:\/\//.test(origin)) {
  console.error("usage: check-public.ts <origin> [--max=50]");
  process.exit(2);
}

let errors = 0;
let warns = 0;
const say = (level: string, where: string, msg: string) => {
  if (level === "error") errors++;
  else warns++;
  console.log(`${level.toUpperCase().padEnd(5)} ${where}  ${msg}`);
};
const get = (path: string) =>
  fetch(path.startsWith("http") ? path : origin + path, { redirect: "manual" });
const locs = (xml: string) =>
  [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
    (m[1] ?? "").replace(/&amp;/g, "&"),
  );

const robots = await get("/robots.txt");
const robotsText = await robots.text();
if (!robots.ok) say("error", "/robots.txt", `status ${robots.status}`);
if (!/^sitemap:/im.test(robotsText))
  say("error", "/robots.txt", "no Sitemap: line");

const llms = await get("/llms.txt");
if (!llms.ok) say("warn", "/llms.txt", `status ${llms.status}`);

const index = await get("/sitemap.xml");
if (!index.ok) {
  say("error", "/sitemap.xml", `status ${index.status}`);
  process.exit(1);
}
const urls: string[] = [];
for (const loc of locs(await index.text())) {
  if (loc.endsWith(".xml")) {
    const sub = await get(new URL(loc).pathname);
    if (!sub.ok) say("error", loc, `status ${sub.status}`);
    else urls.push(...locs(await sub.text()));
  } else urls.push(loc);
}
console.log(
  `sitemap: ${urls.length} URL(s), checking ${Math.min(urls.length, max)}`,
);

for (const url of urls.slice(0, max)) {
  const path = new URL(url).pathname;
  const res = await get(path);
  if (res.status !== 200) {
    say("error", path, `status ${res.status}`);
    continue;
  }
  const html = await res.text();
  for (const i of validatePage(html, res.headers, { origin }))
    say(i.level, path, `${i.code}: ${i.message}`);
  const md = await get(`${path}.md`);
  if (/\/library\/[a-z]+\/[^/]+$/.test(path) && !md.ok)
    say("warn", `${path}.md`, `markdown twin ${md.status}`);
}

console.log(
  errors
    ? `\n${errors} error(s), ${warns} warning(s)`
    : `\nOK (${warns} warning(s))`,
);
process.exit(errors ? 1 : 0);
