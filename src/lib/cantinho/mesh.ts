import { defaultIceServers, type SignalKind } from "@/lib/multiplayer";
import { audio } from "./audio";
import { createSignalLink, type SignalLink } from "./signal-link";
import type { AudioSettings, ChatMsg, PeerSnap, Presence, StageTile } from "./types";
import { MAX_FILE, QUALITY } from "./types";
const CHUNK = 16 * 1024;
const MESH_CAP = 8;

type FileMeta = {
  fid: string;
  name: string;
  size: number;
  mime: string;
  channelId: string;
  msgId: string;
};

type Peer = {
  id: string;
  pc: RTCPeerConnection;
  dc?: RTCDataChannel;
  polite: boolean;
  making: boolean;
  ignore: boolean;
  pending: RTCIceCandidateInit[];
  presence?: Presence;
  presenceV: number;
  rosterName?: string;
  audioEl: HTMLAudioElement;
  audioMix: MediaStream;
  micSender?: RTCRtpSender;
  shareSenders: RTCRtpSender[];
  videoTrack?: MediaStreamTrack;
  speakProbe: { speaking: () => boolean } | null;
  lastVoice: number;
  speaking: boolean;
  rx: { meta: FileMeta; chunks: ArrayBuffer[] } | null;
  connection: RTCPeerConnectionState;
};

export type MeshHooks = {
  onPeers: (snap: { peers: PeerSnap[]; meSpeaking: boolean }) => void;
  onChat: (msg: ChatMsg) => void;
  onHistory: (msgs: ChatMsg[]) => void;
  onTyping: (channelId: string, name: string) => void;
  onFile: (msg: ChatMsg) => void;
  onStage: (tiles: StageTile[]) => void;
  onToast: (text: string) => void;
  onHealth: (ok: boolean) => void;
  onShareEnded: () => void;
  history: () => ChatMsg[];
};

type Wire =
  | { t: "presence"; p: Presence; v?: number }
  | { t: "chat"; m: ChatMsg }
  | { t: "history"; msgs: ChatMsg[] }
  | { t: "typing"; channelId: string; name: string }
  | { t: "file-start"; meta: FileMeta }
  | { t: "file-end"; fid: string };

export class CantinhoMesh {
  private room = "";
  private selfId = "";
  private presence: Presence | null = null;
  private presenceV = 0;
  private settings: AudioSettings | null = null;
  private peers = new Map<string, Peer>();
  private closed = false;
  private link: SignalLink | null = null;
  private roster = new Set<string>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private share: MediaStream | null = null;
  private stageStreams = new Map<string, { track: MediaStreamTrack; stream: MediaStream }>();
  private fileQueue: Promise<void> = Promise.resolve();
  private signalChain: Promise<void> = Promise.resolve();
  private hooks: MeshHooks;
  private meSpeaking = false;

  constructor(hooks: MeshHooks) {
    this.hooks = hooks;
  }

  async join(room: string, selfId: string, presence: Presence, settings: AudioSettings, signalUrl: string | null) {
    this.room = room;
    this.selfId = selfId;
    this.presence = presence;
    this.settings = settings;
    this.closed = false;
    // Nao espera o navegador liberar o audio: a sinalizacao precisa comecar ja.
    void audio.ensure(settings).catch(() => {});
    this.link = createSignalLink({
      room,
      peer: selfId,
      name: () => this.presence?.name ?? "",
      signalUrl,
      handlers: {
        onRoster: (peers) => {
          if (!this.closed) this.reconcile(peers);
        },
        onSignal: (sig) => {
          this.signalChain = this.signalChain
            .then(async () => {
              if (this.closed) return;
              const roster = new Set(this.roster);
              roster.add(sig.from);
              await this.onSignal(sig.from, sig.kind, sig.payload, roster);
            })
            .catch(() => {});
          return this.signalChain;
        },
        onHealth: (ok) => this.hooks.onHealth(ok),
        onToast: (text) => this.hooks.onToast(text),
      },
    });
    this.link.start();
    this.tickTimer = setInterval(() => this.tick(), 80);
  }

  close() {
    this.closed = true;
    this.link?.stop();
    this.link = null;
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.stopShare(true);
    for (const p of this.peers.values()) {
      try {
        p.pc.close();
      } catch {
        /* already gone */
      }
      p.audioEl.srcObject = null;
    }
    this.peers.clear();
  }

  setPresence(presence: Presence) {
    const prevVoice = this.presence?.voiceId ?? null;
    this.presence = presence;
    this.presenceV = Date.now();
    audio.setMuted(presence.muted || presence.deaf || !presence.voiceId);
    for (const p of this.peers.values()) {
      p.audioEl.muted = presence.deaf || !presence.voiceId || p.presence?.voiceId !== presence.voiceId;
      this.syncMedia(p);
    }
    this.broadcast({ t: "presence", p: presence, v: this.presenceV });
    this.link?.rename(presence.name);
    if (prevVoice !== presence.voiceId) this.emitStage();
    this.emitPeers();
  }

  setSettings(settings: AudioSettings) {
    this.settings = settings;
  }

  sendChat(msg: ChatMsg) {
    this.broadcast({ t: "chat", m: stripFile(msg) });
  }

  sendTyping(channelId: string, name: string) {
    this.broadcast({ t: "typing", channelId, name });
  }

  sendFile(file: File, meta: FileMeta) {
    if (file.size > MAX_FILE) {
      this.hooks.onToast(`"${file.name}" passa de 25 MB.`);
      return;
    }
    const open = [...this.peers.values()].some((p) => p.dc?.readyState === "open");
    if (!open) this.hooks.onToast("Ninguém conectado para receber o arquivo ainda.");
    this.fileQueue = this.fileQueue.then(() => this.pushFile(file, meta)).catch(() => {});
  }

  localSpeaking() {
    return this.meSpeaking;
  }

  async startShare() {
    if (!this.settings || this.share) return false;
    const q = QUALITY[this.settings.quality];
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: q.fps }, width: { ideal: q.w }, height: { ideal: q.h } },
        audio: true,
      });
    } catch {
      return false;
    }
    this.share = stream;
    const video = stream.getVideoTracks()[0];
    if (video) {
      video.contentHint = q.hint;
      video.onended = () => {
        this.stopShare(false);
        this.hooks.onShareEnded();
      };
    }
    for (const p of this.peers.values()) this.syncMedia(p);
    this.emitStage();
    return true;
  }

  stopShare(silent = false) {
    if (!this.share) return;
    for (const p of this.peers.values()) {
      for (const s of p.shareSenders) {
        try {
          p.pc.removeTrack(s);
        } catch {
          /* */
        }
      }
      p.shareSenders = [];
    }
    this.share.getTracks().forEach((t) => t.stop());
    this.share = null;
    if (!silent) this.emitStage();
  }

  isSharing() {
    return !!this.share;
  }

  private async pushFile(file: File, meta: FileMeta) {
    const buf = await file.arrayBuffer();
    const targets = [...this.peers.values()].filter((p) => p.dc?.readyState === "open");
    await Promise.all(
      targets.map(async (p) => {
        const dc = p.dc;
        if (!dc) return;
        dc.send(JSON.stringify({ t: "file-start", meta } satisfies Wire));
        for (let o = 0; o < buf.byteLength; o += CHUNK) {
          if (dc.bufferedAmount > 1024 * 1024) {
            await new Promise<void>((resolve) => {
              dc.onbufferedamountlow = () => {
                dc.onbufferedamountlow = null;
                resolve();
              };
            });
          }
          if (dc.readyState !== "open") return;
          dc.send(buf.slice(o, o + CHUNK));
        }
        if (dc.readyState === "open") dc.send(JSON.stringify({ t: "file-end", fid: meta.fid } satisfies Wire));
      }),
    );
  }

  private tick() {
    if (!this.settings || !this.presence) return;
    const speaking = audio.tick(this.settings) && !!this.presence.voiceId && !this.presence.muted && !this.presence.deaf;
    if (speaking !== this.meSpeaking) {
      this.meSpeaking = speaking;
      this.emitPeers();
    }
    let changed = false;
    const now = performance.now();
    for (const p of this.peers.values()) {
      const hot = !!p.speakProbe?.speaking();
      if (hot) p.lastVoice = now;
      const on = now - p.lastVoice < 300 && p.presence?.voiceId === this.presence.voiceId && !!this.presence.voiceId;
      if (on !== p.speaking) {
        p.speaking = on;
        changed = true;
      }
    }
    if (changed) this.emitPeers();
  }

  private emitPeers() {
    const peers: PeerSnap[] = [...this.peers.values()].map((p) => ({
      id: p.id,
      presence: p.presence ?? {
        name: p.rosterName || "Conectando…",
        color: "#4e5058",
        status: "",
        avatar: "",
        voiceId: null,
        muted: false,
        deaf: false,
        sharing: false,
      },
      connection: p.connection,
      speaking: p.speaking,
    }));
    this.hooks.onPeers({ peers, meSpeaking: this.meSpeaking });
  }

  /** Minha presenca atual, para gravar no banco. */
  snapshotPresence(): { presence: Presence; v: number } | null {
    return this.presence ? { presence: this.presence, v: this.presenceV } : null;
  }

  /** Presenca dos outros vinda do banco (garantia caso a conexao direta atrase). */
  applyRemotePresence(list: { id: string; v: number; presence: Presence }[]) {
    if (this.closed) return;
    for (const item of list) {
      const peer = this.peers.get(item.id);
      if (!peer) continue;
      if (item.v && item.v === peer.presenceV) continue;
      this.acceptPresence(peer, item.presence, item.v, true);
    }
  }

  private acceptPresence(peer: Peer, raw: Presence, v: number, fromDb: boolean) {
    if (v && v < peer.presenceV) return;
    if (v) peer.presenceV = v;
    const next = sanitizePresence(raw);
    if (fromDb && !next.avatar && peer.presence?.avatar) next.avatar = peer.presence.avatar;
    peer.presence = next;
    this.syncMedia(peer);
    this.emitPeers();
    this.emitStage();
  }

  private broadcast(msg: Wire) {
    const raw = JSON.stringify(msg);
    for (const p of this.peers.values()) {
      if (p.dc?.readyState === "open") p.dc.send(raw);
    }
  }

  private send(p: Peer, msg: Wire) {
    if (p.dc?.readyState === "open") p.dc.send(JSON.stringify(msg));
  }

  private reconcile(roster: { id: string; name: string }[]) {
    const others = roster.filter((p) => p.id !== this.selfId).sort((a, b) => (a.id < b.id ? -1 : 1));
    const capped = others.length > MESH_CAP - 1;
    const allow = new Set((capped ? others.slice(0, MESH_CAP - 1) : others).map((p) => p.id));
    this.roster = allow;
    const alive = new Set(allow);
    for (const id of allow) {
      if (!this.peers.has(id)) this.connectTo(id, this.selfId > id);
    }
    for (const r of others) {
      const known = this.peers.get(r.id);
      if (known) known.rosterName = r.name;
    }
    for (const [id, peer] of this.peers) {
      if (!alive.has(id)) {
        try {
          peer.pc.close();
        } catch {
          /* */
        }
        peer.audioEl.srcObject = null;
        this.peers.delete(id);
      }
    }
    this.emitPeers();
    this.emitStage();
    const connecting = [...this.peers.values()].some((p) => p.connection !== "connected");
    this.link?.setFast(connecting || this.peers.size === 0);
  }

  private connectTo(id: string, initiator: boolean) {
    const pc = new RTCPeerConnection({ iceServers: defaultIceServers() });
    const audioEl = new Audio();
    audioEl.autoplay = true;
    const peer: Peer = {
      id,
      pc,
      polite: this.selfId < id,
      making: false,
      ignore: false,
      pending: [],
      audioEl,
      audioMix: new MediaStream(),
      shareSenders: [],
      speakProbe: null,
      lastVoice: 0,
      speaking: false,
      rx: null,
      presenceV: 0,
      connection: pc.connectionState,
    };
    this.peers.set(id, peer);
    pc.onicecandidate = (e) => {
      if (e.candidate) void this.sendSignal(id, "ice", e.candidate.toJSON());
    };
    pc.onconnectionstatechange = () => {
      peer.connection = pc.connectionState;
      if (pc.connectionState === "failed") pc.restartIce();
      this.emitPeers();
    };
    pc.onnegotiationneeded = async () => {
      try {
        peer.making = true;
        await pc.setLocalDescription();
        if (pc.localDescription) await this.sendSignal(id, "offer", pc.localDescription.toJSON());
      } catch {
        /* next cycle retries */
      } finally {
        peer.making = false;
      }
    };
    pc.ontrack = (ev) => {
      const track = ev.track;
      if (track.kind === "audio") {
        peer.audioMix.addTrack(track);
        audioEl.srcObject = peer.audioMix;
        void audioEl.play().catch(() => {});
        if (!peer.speakProbe) peer.speakProbe = audio.tapRemote(track);
        this.syncMedia(peer);
      } else {
        peer.videoTrack = track;
        track.onended = () => {
          if (peer.videoTrack === track) peer.videoTrack = undefined;
          this.emitStage();
        };
        this.emitStage();
      }
    };
    pc.ondatachannel = (e) => {
      if (e.channel.label === "cantinho") this.bindDc(peer, e.channel);
    };
    if (initiator) this.bindDc(peer, pc.createDataChannel("cantinho", { ordered: true }));
    return peer;
  }

  private bindDc(peer: Peer, dc: RTCDataChannel) {
    peer.dc = dc;
    dc.binaryType = "arraybuffer";
    dc.bufferedAmountLowThreshold = 512 * 1024;
    dc.onopen = () => {
      if (this.presence) this.send(peer, { t: "presence", p: this.presence, v: this.presenceV });
      const msgs = this.hooks
        .history()
        .filter((m) => m.text && !m.system && !m.file)
        .slice(-40)
        .map(stripFile);
      if (msgs.length) this.send(peer, { t: "history", msgs });
      this.syncMedia(peer);
      this.emitPeers();
    };
    dc.onclose = () => this.emitPeers();
    dc.onmessage = (e) => this.onDc(peer, e.data);
  }

  private onDc(peer: Peer, data: unknown) {
    if (typeof data !== "string") {
      if (peer.rx && data instanceof ArrayBuffer) peer.rx.chunks.push(data);
      return;
    }
    let msg: Wire;
    try {
      msg = JSON.parse(data) as Wire;
    } catch {
      return;
    }
    if (msg.t === "presence") {
      this.acceptPresence(peer, msg.p, Number(msg.v) || 0, false);
    } else if (msg.t === "chat") {
      const m = sanitizeMsg(msg.m);
      if (m) this.hooks.onChat(m);
    } else if (msg.t === "history") {
      const msgs = (Array.isArray(msg.msgs) ? msg.msgs : []).map(sanitizeMsg).filter((m): m is ChatMsg => !!m);
      if (msgs.length) this.hooks.onHistory(msgs);
    } else if (msg.t === "typing") {
      if (typeof msg.channelId === "string" && typeof msg.name === "string") {
        this.hooks.onTyping(msg.channelId.slice(0, 40), msg.name.slice(0, 24));
      }
    } else if (msg.t === "file-start") {
      const meta = msg.meta;
      if (meta && meta.size <= MAX_FILE && meta.size >= 0) peer.rx = { meta, chunks: [] };
    } else if (msg.t === "file-end" && peer.rx && peer.rx.meta.fid === msg.fid) {
      const { meta, chunks } = peer.rx;
      peer.rx = null;
      const url = URL.createObjectURL(new Blob(chunks, { type: meta.mime || "application/octet-stream" }));
      this.hooks.onFile({
        id: meta.msgId || crypto.randomUUID(),
        channelId: meta.channelId,
        authorId: peer.id,
        name: peer.presence?.name || "Alguém",
        color: peer.presence?.color || "#5865f2",
        ts: Date.now(),
        file: { name: String(meta.name).slice(0, 120), mime: String(meta.mime), size: meta.size, url },
      });
    }
  }

  private syncMedia(peer: Peer) {
    const same = !!this.presence?.voiceId && peer.presence?.voiceId === this.presence.voiceId;
    const track = audio.outputTrack();
    const stream = audio.outputStream();
    peer.audioEl.muted = !!this.presence?.deaf || !same;
    if (same && track && stream && track.readyState === "live") {
      if (!peer.micSender) peer.micSender = peer.pc.addTrack(track, stream);
    } else if (peer.micSender) {
      try {
        peer.pc.removeTrack(peer.micSender);
      } catch {
        /* */
      }
      peer.micSender = undefined;
    }
    if (same && this.share) {
      if (peer.shareSenders.length === 0) {
        for (const t of this.share.getTracks()) {
          const sender = peer.pc.addTrack(t, this.share);
          peer.shareSenders.push(sender);
          if (t.kind === "video") this.tune(sender);
        }
      }
    } else if (peer.shareSenders.length) {
      for (const s of peer.shareSenders) {
        try {
          peer.pc.removeTrack(s);
        } catch {
          /* */
        }
      }
      peer.shareSenders = [];
    }
  }

  private async tune(sender: RTCRtpSender) {
    if (!this.settings) return;
    const q = QUALITY[this.settings.quality];
    try {
      const p = sender.getParameters();
      if (!p.encodings?.length) return;
      const enc = p.encodings[0];
      if (!enc) return;
      enc.maxBitrate = q.kbps * 1000;
      enc.maxFramerate = q.fps;
      await sender.setParameters(p);
    } catch {
      /* browser may reject before the sender is live */
    }
  }

  private emitStage() {
    const tiles: StageTile[] = [];
    const keep = new Set<string>();
    const add = (id: string, name: string, track: MediaStreamTrack) => {
      keep.add(id);
      let cur = this.stageStreams.get(id);
      if (!cur || cur.track !== track) {
        cur = { track, stream: new MediaStream([track]) };
        this.stageStreams.set(id, cur);
      }
      tiles.push({ id, name, stream: cur.stream });
    };
    const video = this.share?.getVideoTracks()[0];
    if (video && this.presence?.voiceId) add("me", "Você", video);
    for (const p of this.peers.values()) {
      if (!p.videoTrack || p.videoTrack.readyState !== "live") continue;
      if (!this.presence?.voiceId || p.presence?.voiceId !== this.presence.voiceId) continue;
      add(p.id, p.presence?.name || "Alguém", p.videoTrack);
    }
    for (const id of this.stageStreams.keys()) {
      if (!keep.has(id)) this.stageStreams.delete(id);
    }
    this.hooks.onStage(tiles);
  }

  private async onSignal(from: string, kind: SignalKind, payload: unknown, roster: Set<string>) {
    if (this.closed || from === this.selfId) return;
    let peer = this.peers.get(from);
    if (!peer) {
      if (!roster.has(from)) return;
      peer = this.connectTo(from, false);
    }
    const pc = peer.pc;
    try {
      if (kind === "offer" || kind === "answer") {
        const description = payload as RTCSessionDescriptionInit;
        const collision = kind === "offer" && (peer.making || pc.signalingState !== "stable");
        peer.ignore = !peer.polite && collision;
        if (peer.ignore) return;
        await pc.setRemoteDescription(description);
        while (peer.pending.length) {
          const c = peer.pending.shift();
          if (c) await pc.addIceCandidate(c).catch(() => {});
        }
        if (kind === "offer") {
          await pc.setLocalDescription();
          if (pc.localDescription) await this.sendSignal(from, "answer", pc.localDescription.toJSON());
        }
      } else if (kind === "ice") {
        const candidate = payload as RTCIceCandidateInit;
        if (!pc.remoteDescription) peer.pending.push(candidate);
        else await pc.addIceCandidate(candidate).catch(() => {});
      }
    } catch {
      /* next offer cycle */
    }
  }

  private sendSignal(to: string, kind: "offer" | "answer" | "ice", payload: unknown) {
    return this.link?.send(to, kind, payload) ?? Promise.resolve();
  }
}

function stripFile(m: ChatMsg): ChatMsg {
  return {
    id: String(m.id).slice(0, 40),
    channelId: String(m.channelId).slice(0, 40),
    authorId: String(m.authorId).slice(0, 40),
    name: String(m.name).slice(0, 24),
    color: /^#[0-9a-fA-F]{6}$/.test(m.color) ? m.color : "#5865f2",
    text: m.text ? String(m.text).slice(0, 2000) : undefined,
    ts: Number(m.ts) || Date.now(),
  };
}

function sanitizeMsg(input: ChatMsg | undefined): ChatMsg | null {
  if (!input || typeof input !== "object") return null;
  if (typeof input.id !== "string" || typeof input.channelId !== "string") return null;
  if (!input.text) return null;
  return stripFile(input);
}

function sanitizePresence(p: Presence): Presence {
  return {
    name: String(p?.name || "Anônimo").slice(0, 24),
    color: /^#[0-9a-fA-F]{6}$/.test(p?.color || "") ? p.color : "#5865f2",
    status: String(p?.status || "").slice(0, 60),
    avatar: typeof p?.avatar === "string" && p.avatar.startsWith("data:image/") && p.avatar.length < 60000 ? p.avatar : "",
    voiceId: typeof p?.voiceId === "string" ? p.voiceId.slice(0, 40) : null,
    muted: !!p?.muted,
    deaf: !!p?.deaf,
    sharing: !!p?.sharing,
  };
}

export type { Peer };
