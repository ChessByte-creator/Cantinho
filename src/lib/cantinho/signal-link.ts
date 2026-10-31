import type { SignalKind } from "@/lib/multiplayer";
import { previewPathPrefix } from "@/lib/preview-path-prefix";

export type RosterPeer = { id: string; name: string };
export type InSignal = { id: number; from: string; kind: SignalKind; payload: unknown };

type Handlers = {
  onRoster: (peers: RosterPeer[]) => void;
  onSignal: (sig: InSignal) => void | Promise<void>;
  onHealth: (ok: boolean) => void;
  onToast?: (text: string) => void;
};

export type SignalLink = {
  start: () => void;
  stop: () => void;
  send: (to: string, kind: SignalKind, payload: unknown) => Promise<void>;
  rename: (name: string) => void;
  setFast: (fast: boolean) => void;
};

export function apiPath(path: string) {
  if (typeof window === "undefined") return path;
  const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
  return `${prefix}${path}`;
}

/** Empty string clears the override. https:// on Render becomes wss://…/ws */
export function normalizeSignalUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Endereço inválido.");
  }
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol !== "wss:" && url.protocol !== "ws:") {
    throw new Error("Cole o endereço do Render (https ou wss).");
  }
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/ws")) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/ws`;
  }
  return url.toString();
}

export function signalHost(url: string | null) {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function createSignalLink(opts: {
  room: string;
  peer: string;
  name: () => string;
  signalUrl: string | null;
  handlers: Handlers;
}): SignalLink {
  return opts.signalUrl ? wsLink(opts.signalUrl, opts) : httpLink(opts);
}

const FAST = 400;
const IDLE = 2000;

function httpLink(opts: {
  room: string;
  peer: string;
  name: () => string;
  handlers: Handlers;
}): SignalLink {
  let stopped = false;
  let cursor = 0;
  let fast = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fails = 0;
  const queues = new Map<string, Promise<void>>();

  const tick = async () => {
    if (stopped) return;
    try {
      const params = new URLSearchParams({
        room: opts.room,
        peer: opts.peer,
        name: opts.name().slice(0, 64),
        since: String(cursor),
      });
      const res = await fetch(`${apiPath("/api/rtc")}?${params}`);
      if (stopped) return;
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { peers: RosterPeer[]; signals: InSignal[] };
      fails = 0;
      opts.handlers.onHealth(true);
      opts.handlers.onRoster(body.peers);
      for (const sig of body.signals) {
        cursor = Math.max(cursor, Number(sig.id));
        await opts.handlers.onSignal(sig);
        if (stopped) return;
      }
    } catch {
      fails += 1;
      if (fails >= 3) opts.handlers.onHealth(false);
    }
    if (!stopped) timer = setTimeout(() => void tick(), fast ? FAST : IDLE);
  };

  return {
    start() {
      void tick();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      void fetch(apiPath("/api/rtc"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "leave", room: opts.room, peer: opts.peer }),
        keepalive: true,
      }).catch(() => {});
    },
    send(to, kind, payload) {
      const prev = queues.get(to) ?? Promise.resolve();
      const next = prev
        .then(async () => {
          if (stopped) return;
          const res = await fetch(apiPath("/api/rtc"), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ op: "signal", room: opts.room, from: opts.peer, to, kind, payload }),
          });
          if (!res.ok) throw new Error(String(res.status));
        })
        .catch(() => {});
      queues.set(to, next);
      return next;
    },
    rename() {
      /* next poll carries the name */
    },
    setFast(next) {
      fast = next;
    },
  };
}

function wsLink(
  signalUrl: string,
  opts: { room: string; peer: string; name: () => string; handlers: Handlers },
): SignalLink {
  let stopped = false;
  let socket: WebSocket | null = null;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pending: string[] = [];
  let seq = 1;

  const pump = () => {
    const ws = socket;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    while (pending.length) {
      const item = pending.shift();
      if (item) ws.send(item);
    }
  };

  const connect = () => {
    if (stopped) return;
    let url: URL;
    try {
      url = new URL(signalUrl);
    } catch {
      opts.handlers.onHealth(false);
      return;
    }
    url.searchParams.set("room", opts.room);
    url.searchParams.set("peer", opts.peer);
    url.searchParams.set("name", opts.name().slice(0, 64));
    const ws = new WebSocket(url.toString());
    socket = ws;
    ws.onopen = () => {
      retry = 0;
      opts.handlers.onHealth(true);
      pump();
    };
    ws.onmessage = (event) => {
      let msg: {
        t?: string;
        peers?: RosterPeer[];
        from?: string;
        kind?: SignalKind;
        payload?: unknown;
        id?: number;
        reason?: string;
      };
      try {
        msg = JSON.parse(String(event.data)) as typeof msg;
      } catch {
        return;
      }
      if (msg.t === "roster" && Array.isArray(msg.peers)) opts.handlers.onRoster(msg.peers);
      else if (msg.t === "signal" && msg.from && msg.kind) {
        opts.handlers.onSignal({
          id: Number(msg.id) || seq++,
          from: msg.from,
          kind: msg.kind,
          payload: msg.payload,
        });
      } else if (msg.t === "denied" && msg.reason) {
        opts.handlers.onToast?.(msg.reason);
      }
    };
    ws.onclose = () => {
      if (socket === ws) socket = null;
      if (stopped) return;
      opts.handlers.onHealth(false);
      const wait = Math.min(8000, 600 * 2 ** retry);
      retry += 1;
      timer = setTimeout(connect, wait);
    };
    ws.onerror = () => {
      opts.handlers.onHealth(false);
    };
  };

  return {
    start() {
      connect();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        /* already gone */
      }
      socket = null;
    },
    send(to, kind, payload) {
      const raw = JSON.stringify({ t: "signal", to, kind, payload });
      if (raw.length > 32_000) return Promise.resolve();
      pending.push(raw);
      pump();
      return Promise.resolve();
    },
    rename(name) {
      const raw = JSON.stringify({ t: "name", name: name.slice(0, 64) });
      pending.push(raw);
      pump();
    },
    setFast() {
      /* push, not poll */
    },
  };
}
