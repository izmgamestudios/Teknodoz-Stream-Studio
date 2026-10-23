// src/server/seo/text.ts
// Chrome strings of the public pages (the app's own i18n bundle is client-side and much larger).
import { LOCALES, type Locale } from "../../shared/schema-registry";

type Key =
  | "skip"
  | "library"
  | "stories"
  | "videos"
  | "podcasts"
  | "docs"
  | "app"
  | "summary"
  | "transcript"
  | "faq"
  | "tags"
  | "published"
  | "updated"
  | "by"
  | "related"
  | "share"
  | "embed"
  | "embedCode"
  | "mdVersion"
  | "poster"
  | "oembed"
  | "locked"
  | "lockedBody"
  | "password"
  | "unlock"
  | "wrong"
  | "tooMany"
  | "fail"
  | "empty"
  | "next"
  | "prev"
  | "page"
  | "notFound"
  | "notFoundBody"
  | "home"
  | "indexTitle"
  | "indexDesc"
  | "docsTitle"
  | "docsDesc"
  | "manage"
  | "listDesc"
  | "pressKit"
  | "footer"
  | "kind.article"
  | "kind.book"
  | "kind.video"
  | "kind.podcast"
  | "kind.website"
  | "kind.other";

type Dict = Record<Key, string>;

const tr: Dict = {
  skip: "İçeriğe geç",
  library: "Kütüphane",
  stories: "Hikayeler",
  videos: "Videolar",
  podcasts: "Podcastler",
  docs: "Kaynaklar",
  app: "Stüdyo",
  summary: "Özet",
  transcript: "Dökümü",
  faq: "Sık sorulan sorular",
  tags: "Etiketler",
  published: "Yayın",
  updated: "Güncelleme",
  by: "Yayıncı",
  related: "İlgili içerikler",
  share: "Paylaş ve göm",
  embed: "Gömme sayfası",
  embedCode: "Gömme kodu",
  mdVersion: "Markdown sürümü",
  poster: "Kapak görseli",
  oembed: "oEmbed",
  locked: "Bu içerik şifreli",
  lockedBody: "İçeriği görmek için şifreyi girin.",
  password: "Şifre",
  unlock: "Aç",
  wrong: "Şifre yanlış.",
  tooMany: "Çok fazla deneme. Daha sonra tekrar deneyin.",
  fail: "Açılamadı. Lütfen tekrar deneyin.",
  empty: "Henüz yayınlanmış içerik yok.",
  next: "Sonraki",
  prev: "Önceki",
  page: "Sayfa",
  notFound: "Sayfa bulunamadı",
  notFoundBody:
    "Aradığınız içerik yayından kaldırılmış ya da hiç var olmamış olabilir.",
  home: "Ana sayfa",
  indexTitle: "Yayın kütüphanesi",
  indexDesc:
    "Teknodoz Studio yapımlarının herkese açık hikaye, video ve podcast kütüphanesi.",
  docsTitle: "Kaynaklar ve kaynakça",
  docsDesc:
    "Yapımlarda kullanılan kaynakların APA 7 biçiminde herkese açık listesi.",
  manage: "Yönet",
  listDesc: "{site} yapımlarından herkese açık {type} listesi.",
  pressKit: "Basın kiti",
  footer: "Tüm içerikler anonim ve herkese açık olarak izlenebilir.",
  "kind.article": "Makaleler",
  "kind.book": "Kitaplar",
  "kind.video": "Videolar",
  "kind.podcast": "Podcastler",
  "kind.website": "Web siteleri",
  "kind.other": "Diğer",
};
const en: Dict = {
  skip: "Skip to content",
  library: "Library",
  stories: "Stories",
  videos: "Videos",
  podcasts: "Podcasts",
  docs: "Sources",
  app: "Studio",
  summary: "Summary",
  transcript: "Transcript",
  faq: "Frequently asked questions",
  tags: "Tags",
  published: "Published",
  updated: "Updated",
  by: "Publisher",
  related: "Related",
  share: "Share and embed",
  embed: "Embed page",
  embedCode: "Embed code",
  mdVersion: "Markdown version",
  poster: "Cover image",
  oembed: "oEmbed",
  locked: "This item is password protected",
  lockedBody: "Enter the password to see the content.",
  password: "Password",
  unlock: "Unlock",
  wrong: "Wrong password.",
  tooMany: "Too many attempts. Try again later.",
  fail: "Could not unlock. Please try again.",
  empty: "Nothing published yet.",
  next: "Next",
  prev: "Previous",
  page: "Page",
  notFound: "Page not found",
  notFoundBody: "The content may have been unpublished or never existed.",
  home: "Home",
  indexTitle: "Publishing library",
  indexDesc:
    "Public library of stories, videos and podcasts from Teknodoz Studio productions.",
  docsTitle: "Sources and references",
  docsDesc:
    "Public list of the sources used in our productions, in APA 7 style.",
  manage: "Manage",
  listDesc: "Public {type} from {site} productions.",
  pressKit: "Press kit",
  footer: "All content can be watched anonymously and publicly.",
  "kind.article": "Articles",
  "kind.book": "Books",
  "kind.video": "Videos",
  "kind.podcast": "Podcasts",
  "kind.website": "Websites",
  "kind.other": "Other",
};
const de: Dict = {
  skip: "Zum Inhalt springen",
  library: "Bibliothek",
  stories: "Stories",
  videos: "Videos",
  podcasts: "Podcasts",
  docs: "Quellen",
  app: "Studio",
  summary: "Zusammenfassung",
  transcript: "Transkript",
  faq: "Häufige Fragen",
  tags: "Tags",
  published: "Veröffentlicht",
  updated: "Aktualisiert",
  by: "Herausgeber",
  related: "Ähnliche Inhalte",
  share: "Teilen und einbetten",
  embed: "Einbettungsseite",
  embedCode: "Einbettungscode",
  mdVersion: "Markdown-Version",
  poster: "Titelbild",
  oembed: "oEmbed",
  locked: "Dieser Inhalt ist passwortgeschützt",
  lockedBody: "Passwort eingeben, um den Inhalt zu sehen.",
  password: "Passwort",
  unlock: "Öffnen",
  wrong: "Falsches Passwort.",
  tooMany: "Zu viele Versuche. Später erneut versuchen.",
  fail: "Öffnen fehlgeschlagen. Bitte erneut versuchen.",
  empty: "Noch nichts veröffentlicht.",
  next: "Weiter",
  prev: "Zurück",
  page: "Seite",
  notFound: "Seite nicht gefunden",
  notFoundBody:
    "Der Inhalt wurde möglicherweise zurückgezogen oder existierte nie.",
  home: "Startseite",
  indexTitle: "Veröffentlichungsbibliothek",
  indexDesc:
    "Öffentliche Bibliothek mit Stories, Videos und Podcasts aus Teknodoz-Studio-Produktionen.",
  docsTitle: "Quellen und Literatur",
  docsDesc:
    "Öffentliche Liste der in unseren Produktionen verwendeten Quellen im APA-7-Stil.",
  manage: "Verwalten",
  listDesc: "Öffentliche {type} aus {site}-Produktionen.",
  pressKit: "Pressekit",
  footer: "Alle Inhalte sind anonym und öffentlich abrufbar.",
  "kind.article": "Artikel",
  "kind.book": "Bücher",
  "kind.video": "Videos",
  "kind.podcast": "Podcasts",
  "kind.website": "Websites",
  "kind.other": "Sonstiges",
};
const es: Dict = {
  skip: "Saltar al contenido",
  library: "Biblioteca",
  stories: "Historias",
  videos: "Vídeos",
  podcasts: "Pódcast",
  docs: "Fuentes",
  app: "Estudio",
  summary: "Resumen",
  transcript: "Transcripción",
  faq: "Preguntas frecuentes",
  tags: "Etiquetas",
  published: "Publicado",
  updated: "Actualizado",
  by: "Editor",
  related: "Contenido relacionado",
  share: "Compartir e incrustar",
  embed: "Página de inserción",
  embedCode: "Código de inserción",
  mdVersion: "Versión Markdown",
  poster: "Imagen de portada",
  oembed: "oEmbed",
  locked: "Este contenido está protegido con contraseña",
  lockedBody: "Introduce la contraseña para ver el contenido.",
  password: "Contraseña",
  unlock: "Abrir",
  wrong: "Contraseña incorrecta.",
  tooMany: "Demasiados intentos. Inténtalo más tarde.",
  fail: "No se pudo abrir. Inténtalo de nuevo.",
  empty: "Aún no hay nada publicado.",
  next: "Siguiente",
  prev: "Anterior",
  page: "Página",
  notFound: "Página no encontrada",
  notFoundBody:
    "El contenido puede haberse retirado o no haber existido nunca.",
  home: "Inicio",
  indexTitle: "Biblioteca de publicaciones",
  indexDesc:
    "Biblioteca pública de historias, vídeos y pódcast de las producciones de Teknodoz Studio.",
  docsTitle: "Fuentes y referencias",
  docsDesc:
    "Lista pública de las fuentes usadas en nuestras producciones, en estilo APA 7.",
  manage: "Gestionar",
  listDesc: "{type} públicos de producciones de {site}.",
  pressKit: "Kit de prensa",
  footer: "Todo el contenido se puede ver de forma anónima y pública.",
  "kind.article": "Artículos",
  "kind.book": "Libros",
  "kind.video": "Vídeos",
  "kind.podcast": "Pódcast",
  "kind.website": "Sitios web",
  "kind.other": "Otros",
};

const DICTS: Record<Locale, Dict> = { tr, en, de, es };
export type TextKey = Key;

export const normalizeLocale = (l: string | null | undefined): Locale =>
  (LOCALES as readonly string[]).includes(l ?? "") ? (l as Locale) : "tr";

export function tx(
  locale: Locale,
  key: Key,
  params: Record<string, string> = {},
): string {
  return DICTS[locale][key].replace(
    /\{(\w+)\}/g,
    (_, k: string) => params[k] ?? "",
  );
}

export const DICT_KEYS = Object.keys(tr) as Key[];
export { DICTS };
