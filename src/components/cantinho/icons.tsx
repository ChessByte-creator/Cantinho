import type { ReactNode } from "react";

export type IconName =
  | "hash"
  | "volume"
  | "mic"
  | "micOff"
  | "headphones"
  | "headphonesOff"
  | "screen"
  | "sliders"
  | "phone"
  | "plus"
  | "send"
  | "file"
  | "expand"
  | "users"
  | "menu"
  | "chevron"
  | "copy"
  | "nook"
  | "book"
  | "game";

export function Icon({ name, className = "size-5" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {glyphs(name)}
    </svg>
  );
}

export function ServerMark({ id }: { id: string }) {
  const name = id === "cantinho" ? "nook" : id === "estudos" ? "book" : id === "jogos" ? "game" : null;
  if (!name) return null;
  return <Icon name={name} className="size-6" />;
}

function glyphs(name: IconName): ReactNode {
  switch (name) {
    case "hash":
      return <path d="M5 9h14M4 15h14M10 4 8 20M16 4l-2 16" />;
    case "volume":
      return (
        <>
          <path d="M4 9v6h4l5 4V5L8 9z" />
          <path d="M16.5 9a4 4 0 0 1 0 6" />
        </>
      );
    case "mic":
      return (
        <>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </>
      );
    case "micOff":
      return (
        <>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3M3 3l18 18" />
        </>
      );
    case "headphones":
      return (
        <>
          <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
          <rect x="3" y="14" width="4" height="6" rx="1.5" />
          <rect x="17" y="14" width="4" height="6" rx="1.5" />
        </>
      );
    case "headphonesOff":
      return (
        <>
          <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
          <rect x="3" y="14" width="4" height="6" rx="1.5" />
          <rect x="17" y="14" width="4" height="6" rx="1.5" />
          <path d="M3 3l18 18" />
        </>
      );
    case "screen":
      return (
        <>
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </>
      );
    case "sliders":
      return (
        <>
          <path d="M4 7h9M19 7h1M4 17h1M11 17h9" />
          <circle cx="16" cy="7" r="2.5" />
          <circle cx="8" cy="17" r="2.5" />
        </>
      );
    case "phone":
      return <path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M16 8l4 4-4 4M20 12H9" />;
    case "plus":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v8M8 12h8" />
        </>
      );
    case "send":
      return <path d="M3 11 21 3l-8 18-2-8z" />;
    case "file":
      return (
        <>
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v4h4" />
        </>
      );
    case "expand":
      return <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />;
    case "users":
      return (
        <>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="3.2" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </>
      );
    case "menu":
      return <path d="M4 7h16M4 12h16M4 17h16" />;
    case "chevron":
      return <path d="m6 9 6 6 6-6" />;
    case "copy":
      return (
        <>
          <rect x="8" y="8" width="11" height="11" rx="1.5" />
          <path d="M5 16V5.5A1.5 1.5 0 0 1 6.5 4H16" />
        </>
      );
    case "nook":
      return <path d="M5 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-5l-3 3v-3H7a2 2 0 0 1-2-2z" />;
    case "book":
      return (
        <>
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v16H6.5A2.5 2.5 0 0 1 4 16.5z" />
          <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v16h5.5A2.5 2.5 0 0 0 20 16.5z" />
        </>
      );
    case "game":
      return (
        <>
          <path d="M6 10h12a3 3 0 0 1 3 3.2l-.6 2.2a2.5 2.5 0 0 1-2.4 1.8h-1.2a2 2 0 0 1-1.6-.8L14 15h-4l-1.2 1.4a2 2 0 0 1-1.6.8H6a2.5 2.5 0 0 1-2.4-1.8L3 13.2A3 3 0 0 1 6 10z" />
          <path d="M8 12v3M6.5 13.5h3M16.2 12.6h.01M18 14.4h.01" />
        </>
      );
    default:
      return null;
  }
}
