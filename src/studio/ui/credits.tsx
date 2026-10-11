// src/studio/ui/credits.tsx
// Compact credits footer + "Hakkında / Künye" dialog.
import { CREDITS } from "../credits";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { BTN } from "./fields";

const LINK =
  "underline decoration-dotted underline-offset-2 hover:text-foreground";

export function CreditsFooter({ className = "" }: { className?: string }) {
  return (
    <footer
      className={`text-[11px] leading-relaxed text-muted-foreground ${className}`}
    >
      <p>
        <span className="font-semibold text-foreground">{CREDITS.project}</span>
      </p>
      <p>
        Geliştirici: {CREDITS.developer} ·{" "}
        <a className={LINK} href={`mailto:${CREDITS.email}`}>
          {CREDITS.email}
        </a>{" "}
        ·{" "}
        <a className={LINK} href={CREDITS.phoneHref}>
          {CREDITS.phone}
        </a>{" "}
        ·{" "}
        <a
          className={LINK}
          href={CREDITS.linkedin}
          target="_blank"
          rel="noopener noreferrer"
        >
          LinkedIn
        </a>
      </p>
    </footer>
  );
}

export function AboutDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className={BTN}>ⓘ Hakkında / Künye</button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Teknodoz Studio</DialogTitle>
          <DialogDescription>{CREDITS.project}</DialogDescription>
        </DialogHeader>
        <dl className="space-y-2 text-sm">
          <Row k="Geliştirici" v={CREDITS.developer} />
          <Row
            k="E-posta"
            v={
              <a className={LINK} href={`mailto:${CREDITS.email}`}>
                {CREDITS.email}
              </a>
            }
          />
          <Row
            k="Telefon"
            v={
              <a className={LINK} href={CREDITS.phoneHref}>
                {CREDITS.phone}
              </a>
            }
          />
          <Row
            k="LinkedIn"
            v={
              <a
                className={LINK}
                href={CREDITS.linkedin}
                target="_blank"
                rel="noopener noreferrer"
              >
                huseyin-bayer-izmgamestudios
              </a>
            }
          />
          <Row
            k="Kaynak kod"
            v={
              <a
                className={LINK}
                href={CREDITS.repo}
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
            }
          />
          <Row k="Lisans" v={CREDITS.license} />
        </dl>
        <p className="rounded-md bg-secondary p-3 text-xs text-muted-foreground">
          Sunucu yok, veritabanı yok, giriş yok. Kamera, mikrofon ve ekran
          görüntüsü cihazınızdan çıkmaz; ayarlar ve medya dosyaları yalnızca bu
          tarayıcıda (localStorage / IndexedDB) saklanır.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b pb-1.5">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}
