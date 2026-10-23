// src/server/seo/html.ts
// HTML escaping, JSON-LD embedding and the shared page shell. Static CSS and the one inline
// script are constants, so the CSP can pin them by hash (no nonces, pages stay cacheable).
import { createHash } from "node:crypto";

export const esc = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** JSON for a <script type="application/ld+json"> block: `<` is escaped so `</script>` cannot occur. */
const LS = new RegExp(String.fromCharCode(0x2028), "g");
const PS = new RegExp(String.fromCharCode(0x2029), "g");
export const ldJson = (graph: unknown): string =>
  JSON.stringify(graph)
    .replace(/</g, "\\u003c")
    .replace(LS, "\\u2028")
    .replace(PS, "\\u2029");

export const sha256b64 = (s: string): string =>
  createHash("sha256").update(s).digest("base64");

export const CSS = `
:root{--bg:#faf8f4;--fg:#15202b;--muted:#5b6672;--card:#fff;--line:#e3ddd2;--accent:#0b6b86;--accent2:#b0306d}
@media(prefers-color-scheme:dark){:root{--bg:#10161d;--fg:#e8edf2;--muted:#9aa7b4;--card:#18212b;--line:#2a3541;--accent:#5cc3df;--accent2:#e58bb9}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:var(--accent)}a:hover{text-decoration-thickness:2px}
.skip{position:absolute;left:-999px}.skip:focus{left:8px;top:8px;background:var(--card);padding:8px;z-index:9}
header.site{border-bottom:1px solid var(--line);background:var(--card)}
.wrap{max-width:980px;margin:0 auto;padding:0 16px}
header.site .wrap{display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:10px 16px}
header.site a.brand{font-weight:800;letter-spacing:.04em;text-decoration:none;color:var(--fg)}
header.site nav{display:flex;gap:14px;flex-wrap:wrap;margin-left:auto}
main{padding:24px 0 48px}h1{font-size:clamp(1.6rem,4vw,2.3rem);line-height:1.2;margin:.2em 0 .4em}
h2{font-size:1.25rem;margin:1.6em 0 .5em}
.crumbs{font-size:.85rem;color:var(--muted)}.crumbs a{color:var(--muted)}
.meta{color:var(--muted);font-size:.9rem}
.answer{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:8px;padding:12px 16px;margin:14px 0;font-size:1.05rem}
.player{margin:18px 0;background:#000;border-radius:10px;overflow:hidden;aspect-ratio:16/9}
.player.audio{aspect-ratio:auto;background:var(--card);padding:12px}
.player video,.player iframe{width:100%;height:100%;border:0;display:block}.player audio{width:100%}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px;padding:0;list-style:none}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;height:100%}
.card a.cover{display:block;aspect-ratio:16/9;background:var(--line)}.card img{width:100%;height:100%;object-fit:cover;display:block}
.card .body{padding:10px 12px}.card h3{margin:0 0 4px;font-size:1rem;line-height:1.3}.card h3 a{color:var(--fg);text-decoration:none}
.card p{margin:0;font-size:.88rem;color:var(--muted)}
.tag{display:inline-block;border:1px solid var(--line);border-radius:99px;padding:1px 10px;margin:0 6px 6px 0;font-size:.8rem;color:var(--muted);text-decoration:none}
details.faq{border:1px solid var(--line);border-radius:8px;background:var(--card);padding:8px 14px;margin:8px 0}details.faq summary{cursor:pointer;font-weight:600}
ol.transcript{list-style:none;padding:0;margin:0}ol.transcript li{display:flex;gap:12px;padding:3px 0}ol.transcript time{color:var(--accent);font-variant-numeric:tabular-nums;min-width:4.5em}
.pager{display:flex;gap:12px;margin:24px 0}
.lock{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:18px 0}
.lock input{font:inherit;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
.lock button{font:inherit;padding:8px 14px;border:0;border-radius:6px;background:var(--accent);color:var(--bg);cursor:pointer}
.err{color:#c0392b}.kit{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin:20px 0}
.kit code,pre.embed{display:block;white-space:pre-wrap;word-break:break-all;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:8px;font-size:.82rem}
footer.site{border-top:1px solid var(--line);color:var(--muted);font-size:.85rem;padding:18px 0}
.src li{margin:10px 0}.src h3{margin:1.4em 0 .4em;font-size:1.05rem}
`;

/**
 * Unlock form behaviour (protected items). Uses textContent only, so a hostile body cannot inject
 * markup. Constant string: its hash goes into the CSP.
 */
export const UNLOCK_JS = `
(function(){var f=document.getElementById('unlock');if(!f)return;
function el(t,x){var e=document.createElement(t);if(x)e.textContent=x;return e}
f.addEventListener('submit',function(ev){ev.preventDefault();var m=document.getElementById('unlock-msg');m.textContent='';
var pw=f.elements.password.value;fetch('/api/content/'+f.dataset.id+'/unlock',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:pw}),credentials:'omit'})
.then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})}).then(function(x){
if(x.s===200){var box=document.getElementById('unlocked');box.textContent='';var h=x.j.item;
(h.body_blocks||[]).forEach(function(b){var n;
if(b.type==='heading'){n=el('h'+Math.min(4,Math.max(2,b.level+1)),b.text)}
else if(b.type==='paragraph'){n=el('p',b.text)}
else if(b.type==='list'){n=el(b.ordered?'ol':'ul');b.items.forEach(function(i){n.appendChild(el('li',i))})}
else if(b.type==='link'&&/^https?:/.test(b.url)){n=el('p');var a=el('a',b.text);a.href=b.url;a.rel='noopener nofollow';n.appendChild(a)}
else if(b.type==='image'&&/^https?:/.test(b.url)){n=el('img');n.src=b.url;n.alt=b.alt;n.loading='lazy'}
if(n)box.appendChild(n)});f.hidden=true;box.hidden=false}
else if(x.s===429){m.textContent=f.dataset.locked}else if(x.s===403){m.textContent=f.dataset.wrong}else{m.textContent=f.dataset.fail}
}).catch(function(){m.textContent=f.dataset.fail})})})();
`.trim();

/** Reveals the "manage" link on /docs for a signed-in admin (the page itself stays public + cacheable). */
export const ADMIN_JS = `
fetch('/api/session',{credentials:'same-origin',cache:'no-store'}).then(function(r){return r.json()}).then(function(j){var a=document.getElementById('admin-link');if(a&&j&&j.admin)a.hidden=false}).catch(function(){});
`.trim();

export const CSP = (frameAncestors: string): string =>
  [
    "default-src 'none'",
    "img-src 'self' https: data:",
    "media-src 'self' https:",
    "frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://open.spotify.com",
    `style-src 'sha256-${sha256b64(CSS)}'`,
    `script-src 'sha256-${sha256b64(UNLOCK_JS)}' 'sha256-${sha256b64(ADMIN_JS)}'`,
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
  ].join("; ");

export interface PageHead {
  lang: string;
  title: string;
  description: string;
  canonical: string;
  robots: string;
  ogType: string;
  ogImage: string;
  siteName: string;
  twitter: string;
  /** extra <link>/<meta> lines (already escaped) */
  extra?: string;
  jsonLd?: unknown;
}

export function shell(
  head: PageHead,
  nav: {
    home: string;
    links: { href: string; label: string }[];
    skip: string;
    brand: string;
  },
  body: string,
  footer: string,
  opts: { withScript?: boolean; adminScript?: boolean; chrome?: boolean } = {},
): string {
  const chrome = opts.chrome !== false;
  return `<!doctype html>
<html lang="${esc(head.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(head.title)}</title>
<meta name="description" content="${esc(head.description)}">
<meta name="robots" content="${esc(head.robots)}">
<link rel="canonical" href="${esc(head.canonical)}">
<meta property="og:type" content="${esc(head.ogType)}">
<meta property="og:site_name" content="${esc(head.siteName)}">
<meta property="og:title" content="${esc(head.title)}">
<meta property="og:description" content="${esc(head.description)}">
<meta property="og:url" content="${esc(head.canonical)}">
${head.ogImage ? `<meta property="og:image" content="${esc(head.ogImage)}">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:image" content="${esc(head.ogImage)}">` : `<meta name="twitter:card" content="summary">`}
<meta name="twitter:title" content="${esc(head.title)}">
<meta name="twitter:description" content="${esc(head.description)}">
${head.twitter ? `<meta name="twitter:site" content="${esc(head.twitter)}">` : ""}
<link rel="icon" href="/favicon.ico">
${head.extra ?? ""}
<style>${CSS}</style>
${head.jsonLd ? `<script type="application/ld+json">${ldJson(head.jsonLd)}</script>` : ""}
</head>
<body>
<a class="skip" href="#main">${esc(nav.skip)}</a>
${chrome ? `<header class="site"><div class="wrap"><a class="brand" href="${esc(nav.home)}">${esc(nav.brand)}</a><nav aria-label="${esc(nav.brand)}">${nav.links.map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join("")}</nav></div></header>` : ""}
<main id="main" class="wrap">
${body}
</main>
${chrome ? `<footer class="site"><div class="wrap">${footer}</div></footer>` : ""}
${opts.withScript ? `<script>${UNLOCK_JS}</script>` : ""}
${opts.adminScript ? `<script>${ADMIN_JS}</script>` : ""}
</body>
</html>`;
}
