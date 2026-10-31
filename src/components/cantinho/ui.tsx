import { useEffect, useId, useRef, type ReactNode } from "react";
import { SWATCHES, type Profile } from "@/lib/cantinho/types";

export async function resizeImage(file: File) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("imagem"));
      img.src = url;
    });
  } catch {
    URL.revokeObjectURL(url);
    return "";
  }
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const side = Math.min(img.width, img.height);
  canvas
    .getContext("2d")
    ?.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 96, 96);
  URL.revokeObjectURL(url);
  return canvas.toDataURL("image/jpeg", 0.8);
}

export function Avatar({
  name,
  color,
  avatar,
  speaking,
  dot,
  className = "size-8 text-sm",
}: {
  name: string;
  color: string;
  avatar?: string;
  speaking?: boolean;
  dot?: boolean;
  className?: string;
}) {
  const safe = avatar && avatar.startsWith("data:image/") ? avatar : "";
  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-on ${speaking ? "ring-2 ring-ok" : ""} ${className}`}
      style={{ background: color }}
    >
      {safe ? <img src={safe} alt="" className="size-full object-cover" /> : (name.trim()[0] || "?").toUpperCase()}
      {dot ? (
        <span className="absolute right-0 bottom-0 size-2.5 rounded-full border-2 border-panel bg-ok" />
      ) : null}
    </span>
  );
}

export function ProfileFields({
  value,
  onChange,
}: {
  value: Profile;
  onChange: (next: Profile) => void;
}) {
  const photoId = useId();
  return (
    <div className="grid gap-4">
      <div className="flex items-start gap-4">
        <Avatar name={value.name || "?"} color={value.color} avatar={value.avatar} className="size-16 text-2xl" />
        <div className="grid min-w-0 flex-1 gap-3">
          <Field label="Nome de exibição">
            <input
              value={value.name}
              maxLength={24}
              autoComplete="nickname"
              placeholder="Como a turma te chama"
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              className="field"
            />
          </Field>
          <Field label="Status">
            <input
              value={value.status}
              maxLength={60}
              placeholder="O que você está fazendo?"
              onChange={(e) => onChange({ ...value, status: e.target.value })}
              className="field"
            />
          </Field>
        </div>
      </div>
      <div>
        <span className="mb-2 block text-xs font-semibold text-muted">Cor do avatar</span>
        <div className="flex flex-wrap items-center gap-2">
          {SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Cor ${color}`}
              className={`size-8 rounded-full ${value.color === color ? "ring-2 ring-head ring-offset-2 ring-offset-bg" : ""}`}
              style={{ background: color }}
              onClick={() => onChange({ ...value, color })}
            />
          ))}
          <input
            type="color"
            aria-label="Cor personalizada"
            value={/^#[0-9a-fA-F]{6}$/.test(value.color) ? value.color : "#5865f2"}
            onChange={(e) => onChange({ ...value, color: e.target.value })}
            className="size-8 cursor-pointer rounded-md border-0 bg-rail p-0.5"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <label
          htmlFor={photoId}
          className="inline-flex h-11 cursor-pointer items-center rounded-sm bg-brand px-4 text-sm font-semibold text-on hover:bg-brand-h"
        >
          Enviar foto
        </label>
        <input
          id={photoId}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            void resizeImage(file).then((avatar) => {
              if (avatar) onChange({ ...value, avatar });
            });
          }}
        />
        {value.avatar ? (
          <button
            type="button"
            className="h-11 rounded-sm px-3 text-sm font-medium text-muted hover:text-head hover:underline"
            onClick={() => onChange({ ...value, avatar: "" })}
          >
            Remover foto
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold text-muted">
      {label}
      {children}
    </label>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="text-fg"
      aria-labelledby="modal-title"
    >
      <div className="px-6 pt-6 pb-4">
        <h2 id="modal-title" className="mb-4 text-xl font-semibold text-head">
          {title}
        </h2>
        {children}
      </div>
      {footer ? <div className="flex justify-end gap-2 rounded-b-md bg-side px-6 py-4">{footer}</div> : null}
    </dialog>
  );
}

export function Btn({
  children,
  onClick,
  tone = "brand",
  type = "button",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "brand" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const tones = {
    brand: "bg-brand text-on hover:bg-brand-h",
    ghost: "bg-transparent text-head hover:underline",
    danger: "bg-bad text-on hover:opacity-90",
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-11 items-center justify-center rounded-sm px-4 text-sm font-semibold disabled:opacity-50 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

const IMG = /\.(gif|png|jpe?g|webp)(\?[^\s]*)?$/i;

export function RichText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<]+)/g);
  return (
    <div className="break-words whitespace-pre-wrap">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i}>
            <a href={part} target="_blank" rel="noreferrer" className="text-link hover:underline">
              {part}
            </a>
            {IMG.test(part) ? (
              <img src={part} alt="" className="mt-2 max-h-80 max-w-full rounded-md" />
            ) : null}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </div>
  );
}

export function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function fmtDay(ts: number) {
  return new Date(ts).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
}
