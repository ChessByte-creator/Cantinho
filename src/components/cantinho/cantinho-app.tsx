import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, ServerMark } from "./icons";
import { createChannel, createServer, listDirectory, type ChannelRow, type ServerRow } from "@/lib/cantinho/directory";
import { audio } from "@/lib/cantinho/audio";
import { postMessage, syncRoom } from "@/lib/cantinho/messages";
import { CantinhoMesh } from "@/lib/cantinho/mesh";
import { SEED_CHANNELS, SEED_SERVERS } from "@/lib/cantinho/seed";
import { normalizeSignalUrl, signalHost } from "@/lib/cantinho/signal-link";
import { loadJson, saveJson, selfId } from "@/lib/cantinho/storage";
import {
  DEFAULT_PROFILE,
  DEFAULT_SETTINGS,
  MAX_FILE,
  QUALITY,
  type AudioSettings,
  type ChatMsg,
  type PeerSnap,
  type Presence,
  type Profile,
  type StageTile,
} from "@/lib/cantinho/types";
import { Avatar, Btn, Field, Modal, ProfileFields, RichText, fmtDay, fmtSize, fmtTime } from "./ui";

type ModalName = "profile" | "settings" | "server" | "channel" | "invite" | null;

function mergeMsgs(prev: ChatMsg[], incoming: ChatMsg[]) {
  const map = new Map(prev.map((m) => [m.id, m]));
  for (const msg of incoming) {
    if (!map.has(msg.id)) map.set(msg.id, msg);
  }
  return [...map.values()].sort((a, b) => a.ts - b.ts).slice(-200);
}

export function CantinhoApp() {
  const [booted, setBooted] = useState(false);
  const [entered, setEntered] = useState(false);
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [draft, setDraft] = useState<Profile>(DEFAULT_PROFILE);
  const [settings, setSettings] = useState<AudioSettings>(DEFAULT_SETTINGS);
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [serverId, setServerId] = useState("cantinho");
  const [channelId, setChannelId] = useState("c-geral");
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [deaf, setDeaf] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [peers, setPeers] = useState<PeerSnap[]>([]);
  const [meSpeaking, setMeSpeaking] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [typing, setTyping] = useState<{ channelId: string; name: string; until: number }[]>([]);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [tiles, setTiles] = useState<StageTile[]>([]);
  const [online, setOnline] = useState(true);
  const [modal, setModal] = useState<ModalName>(null);
  const [drawer, setDrawer] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [text, setText] = useState("");
  const [serverName, setServerName] = useState("");
  const [serverColor, setServerColor] = useState("#5865f2");
  const [channelName, setChannelName] = useState("");
  const [channelKind, setChannelKind] = useState<"text" | "voice">("text");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [meter, setMeter] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const [signalUrl, setSignalUrl] = useState<string | null>(null);
  const [signalDraft, setSignalDraft] = useState("");
  const [signalError, setSignalError] = useState("");

  const meshRef = useRef<CantinhoMesh | null>(null);
  const messagesRef = useRef<ChatMsg[]>([]);
  const channelRef = useRef(channelId);
  const selfRef = useRef("");
  const settingsRef = useRef(settings);
  const profileRef = useRef(profile);
  const voiceRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const prevVoice = useRef<Record<string, string | null>>({});
  const typingSent = useRef(0);
  const signalRef = useRef<string | null>(null);
  const takeFilesRef = useRef<(files: File[]) => void>(() => {});

  channelRef.current = channelId;
  settingsRef.current = settings;
  profileRef.current = profile;
  voiceRef.current = voiceId;
  messagesRef.current = messages;
  signalRef.current = signalUrl;

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 3600);
  }, []);

  useEffect(() => {
    const savedProfile = loadJson("cantinho-profile", DEFAULT_PROFILE);
    const savedSettings = loadJson("cantinho-settings", DEFAULT_SETTINGS);
    const ui = loadJson("cantinho-ui", { serverId: "cantinho", channelId: "c-geral" });
    setProfile(savedProfile);
    setDraft(savedProfile);
    setSettings(savedSettings);
    setServerId(ui.serverId || "cantinho");
    setChannelId(ui.channelId || "c-geral");
    const invited = new URLSearchParams(location.search).get("s");
    if (invited && /^[a-zA-Z0-9_-]{1,40}$/.test(invited)) setServerId(invited);
    const savedSignal = loadJson("cantinho-signal", { url: "" });
    setSignalUrl(savedSignal.url || null);
    setSignalDraft(savedSignal.url || "");
    selfRef.current = selfId();
    setEntered(!!savedProfile.name.trim());
    setBooted(true);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 820px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!booted) return;
    let stop = false;
    const load = async () => {
      try {
        const dir = await listDirectory();
        if (stop) return;
        setServers(dir.servers.length ? dir.servers : SEED_SERVERS);
        setChannels(dir.channels.length ? dir.channels : SEED_CHANNELS);
      } catch {
        if (stop) return;
        setServers((cur) => (cur.length ? cur : SEED_SERVERS));
        setChannels((cur) => (cur.length ? cur : SEED_CHANNELS));
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [booted, flash]);

  useEffect(() => {
    if (!servers.length) return;
    if (!servers.some((s) => s.id === serverId)) {
      const first = servers[0];
      if (first) setServerId(first.id);
      return;
    }
    const mine = channels.filter((c) => c.serverId === serverId);
    if (!mine.some((c) => c.id === channelId)) {
      const textChannel = mine.find((c) => c.kind === "text") ?? mine[0];
      if (textChannel) setChannelId(textChannel.id);
    }
  }, [servers, channels, serverId, channelId]);

  useEffect(() => {
    if (!booted) return;
    saveJson("cantinho-ui", { serverId, channelId });
  }, [booted, serverId, channelId]);

  useEffect(() => {
    if (!entered) return;
    const saved = loadJson<{ items: ChatMsg[] }>(`cantinho-log:${serverId}`, { items: [] });
    setMessages(Array.isArray(saved.items) ? saved.items : []);
    setUnread({});
    prevVoice.current = {};
  }, [entered, serverId]);

  useEffect(() => {
    if (!entered) return;
    const slim = messages
      .filter((m) => m.text && !m.system)
      .slice(-80)
      .map(({ file: _file, ...rest }) => rest);
    saveJson(`cantinho-log:${serverId}`, { items: slim });
  }, [messages, serverId, entered]);

  const pushMsgs = useCallback((incoming: ChatMsg[], live: boolean) => {
    setMessages((prev) => mergeMsgs(prev, incoming));
    if (!live) return;
    const current = channelRef.current;
    let bumped = false;
    setUnread((prev) => {
      const next = { ...prev };
      for (const msg of incoming) {
        if (msg.channelId !== current && msg.authorId !== selfRef.current && !msg.system) {
          next[msg.channelId] = (next[msg.channelId] ?? 0) + 1;
          bumped = true;
        }
      }
      return bumped ? next : prev;
    });
  }, []);

  // Chat de texto pelo banco: garante a entrega mesmo sem conexao direta (P2P).
  useEffect(() => {
    if (!entered) return;
    let stop = false;
    let since = 0;
    let loaded = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const snap = meshRef.current?.snapshotPresence() ?? null;
        const res = await syncRoom({
          data: {
            serverId,
            peerId: selfRef.current,
            since,
            v: snap?.v ?? 0,
            presence: snap
              ? {
                  name: snap.presence.name.slice(0, 24),
                  color: snap.presence.color,
                  status: snap.presence.status.slice(0, 60),
                  voiceId: snap.presence.voiceId,
                  muted: snap.presence.muted,
                  deaf: snap.presence.deaf,
                  sharing: snap.presence.sharing,
                }
              : undefined,
          },
        });
        if (stop) return;
        meshRef.current?.applyRemotePresence(res.presences);
        if (res.messages.length) {
          since = Math.max(since, ...res.messages.map((r) => r.seq));
          const known = new Set(messagesRef.current.map((m) => m.id));
          const fresh: ChatMsg[] = res.messages
            .filter((r) => !known.has(r.id))
            .map((r) => ({
              id: r.id,
              channelId: r.channelId,
              authorId: r.authorId,
              name: r.name,
              color: r.color,
              text: r.text,
              ts: r.ts,
            }));
          if (fresh.length) pushMsgs(fresh, loaded);
        }
        loaded = true;
      } catch {
        /* tenta de novo no proximo ciclo */
      }
      if (!stop) timer = window.setTimeout(() => void tick(), document.hidden ? 5000 : 1500);
    };
    void tick();
    return () => {
      stop = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [entered, serverId, pushMsgs]);

  useEffect(() => {
    if (!entered || !profile.name.trim()) return;
    const presence = presenceNow(profile, voiceRef.current, muted, deaf, sharing);
    const mesh = new CantinhoMesh({
      onPeers: (snap) => {
        setPeers(snap.peers);
        setMeSpeaking(snap.meSpeaking);
      },
      onChat: (msg) => pushMsgs([msg], true),
      onHistory: (msgs) => pushMsgs(msgs, false),
      onFile: (msg) => pushMsgs([msg], true),
      onTyping: (id, name) => {
        setTyping((prev) => [
          ...prev.filter((t) => !(t.channelId === id && t.name === name)),
          { channelId: id, name, until: Date.now() + 4000 },
        ]);
      },
      onStage: setTiles,
      onToast: flash,
      onHealth: setOnline,
      onShareEnded: () => setSharing(false),
      history: () => messagesRef.current,
    });
    meshRef.current = mesh;
    void mesh.join(serverId, selfRef.current, presence, settingsRef.current, signalRef.current);
    return () => {
      mesh.close();
      if (meshRef.current === mesh) meshRef.current = null;
      setPeers([]);
      setTiles([]);
    };
  }, [entered, serverId, signalUrl, flash, pushMsgs]);

  useEffect(() => {
    if (!entered) return;
    meshRef.current?.setPresence(presenceNow(profile, voiceId, muted, deaf, sharing));
    meshRef.current?.setSettings(settings);
  }, [entered, profile, voiceId, muted, deaf, sharing, settings, serverId]);

  useEffect(() => {
    if (!voiceId) return;
    audio.startMic(settingsRef.current).catch(() => flash("Sem microfone. Chat e tela continuam funcionando."));
  }, [voiceId, settings.deviceId, settings.echo, settings.noise, settings.agc, flash]);

  useEffect(() => {
    const next: Record<string, string | null> = {};
    const events: ChatMsg[] = [];
    for (const peer of peers) {
      const voice = peer.presence.voiceId;
      next[peer.id] = voice;
      const before = prevVoice.current[peer.id];
      if (before === undefined) continue;
      if (before !== voice && voice && peer.presence.name !== "Conectando…") {
        events.push({
          id: `sys-${peer.id}-${voice}-${Date.now()}`,
          channelId: voice,
          authorId: "system",
          name: "",
          color: "",
          system: true,
          text: `${peer.presence.name} entrou na chamada.`,
          ts: Date.now(),
        });
      }
    }
    for (const id of Object.keys(prevVoice.current)) {
      if (!(id in next)) delete prevVoice.current[id];
    }
    prevVoice.current = { ...prevVoice.current, ...next };
    if (events.length) pushMsgs(events, false);
  }, [peers, pushMsgs]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setTyping((prev) => (prev.some((t) => t.until < now) ? prev.filter((t) => t.until >= now) : prev));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (modal !== "settings") return;
    let stop = false;
    audio.devices().then((list) => {
      if (!stop) setDevices(list);
    }).catch(() => {});
    let frame = 0;
    const loop = () => {
      setMeter(audio.level());
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      stop = true;
      cancelAnimationFrame(frame);
    };
  }, [modal]);

  const server = servers.find((s) => s.id === serverId) ?? null;
  const mine = useMemo(
    () => channels.filter((c) => c.serverId === serverId).sort((a, b) => a.position - b.position),
    [channels, serverId],
  );
  const channel = mine.find((c) => c.id === channelId) ?? null;
  const textChannels = mine.filter((c) => c.kind === "text");
  const voiceChannels = mine.filter((c) => c.kind === "voice");
  const visible = messages.filter((m) => m.channelId === channelId);
  const typingHere = typing.filter((t) => t.channelId === channelId).map((t) => t.name);
  const voiceChannel = voiceChannels.find((c) => c.id === voiceId) ?? null;

  const people = useMemo(() => {
    const me: PeerSnap = {
      id: "me",
      connection: "connected",
      speaking: meSpeaking,
      presence: presenceNow(profile, voiceId, muted, deaf, sharing),
    };
    return [me, ...peers];
  }, [deaf, meSpeaking, muted, peers, profile, sharing, voiceId]);

  useEffect(() => {
    const box = listRef.current;
    if (!box || !stickRef.current) return;
    box.scrollTop = box.scrollHeight;
  }, [visible.length, channelId, typingHere.length]);

  function openChannel(ch: ChannelRow) {
    setChannelId(ch.id);
    setDrawer(false);
    setMembersOpen(false);
    setUnread((prev) => ({ ...prev, [ch.id]: 0 }));
    if (ch.kind === "voice" && voiceId !== ch.id) {
      void audio.ensure(settingsRef.current).catch(() => {});
      setVoiceId(ch.id);
      audio.blip(740);
    }
  }

  function leaveVoice() {
    meshRef.current?.stopShare();
    setSharing(false);
    setVoiceId(null);
    audio.blip(440);
  }

  function pickServer(id: string) {
    if (id !== serverId) {
      meshRef.current?.stopShare();
      setSharing(false);
      setVoiceId(null);
      setServerId(id);
    }
    setDrawer(false);
    setMenu(false);
  }

  function sendText() {
    const value = text.trim();
    if (!value || !channel) return;
    const msg: ChatMsg = {
      id: crypto.randomUUID(),
      channelId: channel.id,
      authorId: selfRef.current,
      name: profile.name,
      color: profile.color,
      text: value.slice(0, 2000),
      ts: Date.now(),
    };
    setText("");
    pushMsgs([msg], false);
    meshRef.current?.sendChat(msg);
    void postMessage({
      data: {
        serverId,
        id: msg.id,
        channelId: msg.channelId,
        authorId: msg.authorId,
        name: msg.name.slice(0, 24) || "Anônimo",
        color: msg.color,
        text: msg.text ?? "",
        ts: msg.ts,
      },
    }).catch(() => flash("Não consegui enviar pelo servidor. Tente de novo."));
    stickRef.current = true;
  }

  function onType(value: string) {
    setText(value);
    const now = Date.now();
    if (value.trim() && now - typingSent.current > 2000 && channel) {
      typingSent.current = now;
      meshRef.current?.sendTyping(channel.id, profile.name);
    }
  }

  function takeFiles(files: File[]) {
    if (!channel) return;
    for (const file of files) {
      if (file.size > MAX_FILE) {
        flash(`"${file.name}" passa de 25 MB.`);
        continue;
      }
      const id = crypto.randomUUID();
      pushMsgs(
        [
          {
            id,
            channelId: channel.id,
            authorId: selfRef.current,
            name: profile.name,
            color: profile.color,
            ts: Date.now(),
            file: {
              name: file.name,
              mime: file.type || "application/octet-stream",
              size: file.size,
              url: URL.createObjectURL(file),
            },
          },
        ],
        false,
      );
      meshRef.current?.sendFile(file, {
        fid: id,
        msgId: id,
        name: file.name,
        size: file.size,
        mime: file.type || "application/octet-stream",
        channelId: channel.id,
      });
    }
  }

  async function toggleShare() {
    const mesh = meshRef.current;
    if (!mesh || !voiceId) {
      flash("Entre numa sala de voz para compartilhar a tela.");
      return;
    }
    if (narrow && !sharing) {
      flash("No celular dá para assistir. Transmitir a tela fica no computador.");
      return;
    }
    if (sharing) {
      mesh.stopShare();
      setSharing(false);
      return;
    }
    const ok = await mesh.startShare();
    if (ok) setSharing(true);
  }

  function toggleDeaf() {
    if (deaf) {
      setDeaf(false);
    } else {
      setDeaf(true);
      setMuted(true);
    }
  }

  async function submitServer() {
    setFormError("");
    setBusy(true);
    try {
      const created = await createServer({ data: { name: serverName.trim(), color: serverColor } });
      setModal(null);
      setServerName("");
      setServerId(created.id);
      const dir = await listDirectory();
      setServers(dir.servers);
      setChannels(dir.channels);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Não deu para criar o sistema.");
    } finally {
      setBusy(false);
    }
  }

  async function submitChannel() {
    setFormError("");
    setBusy(true);
    try {
      const created = await createChannel({
        data: { serverId, name: channelName.trim(), kind: channelKind },
      });
      setModal(null);
      setChannelName("");
      const dir = await listDirectory();
      setServers(dir.servers);
      setChannels(dir.channels);
      setChannelId(created.id);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Não deu para criar o canal.");
    } finally {
      setBusy(false);
    }
  }

  function inviteUrl() {
    const url = new URL(location.href);
    url.searchParams.set("s", serverId);
    url.hash = "";
    return url.toString();
  }

  function commitSignal() {
    try {
      const next = normalizeSignalUrl(signalDraft);
      setSignalError("");
      setSignalDraft(next ?? "");
      if (next === signalUrl) return;
      setSignalUrl(next);
      saveJson("cantinho-signal", { url: next ?? "" });
      if (next) flash("Servidor de voz no Render ligado. Reconectando…");
      else flash("Usando o relay do próprio app.");
    } catch (error) {
      setSignalError(error instanceof Error ? error.message : "Endereço inválido.");
    }
  }

  takeFilesRef.current = takeFiles;

  useEffect(() => {
    if (!entered) return;
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])];
      if (!files.length) return;
      event.preventDefault();
      takeFilesRef.current(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [entered]);

  if (!booted) return <div className="h-dvh bg-rail" />;

  if (!entered) {
    return (
      <main className="grid min-h-dvh place-items-center bg-brand p-5">
        <div className="grid w-full max-w-md gap-5 rounded-md bg-bg p-8 shadow-xl">
          <div className="text-center">
            <div className="mx-auto mb-1 grid size-16 place-items-center rounded-2xl bg-rail text-on">
              <Icon name="nook" className="size-8" />
            </div>
            <h1 className="text-2xl font-semibold text-head">Entrar no Cantinho</h1>
            <p className="mt-1 text-sm text-muted">Sistemas, canais, chat e voz. No celular, publique e adicione à tela inicial.</p>
          </div>
          <ProfileFields value={draft} onChange={setDraft} />
          {formError ? <p className="text-sm text-bad">{formError}</p> : null}
          <Btn
            onClick={() => {
              const name = draft.name.trim();
              if (!name) {
                setFormError("Escolhe um nome para entrar.");
                return;
              }
              const next = { ...draft, name };
              setProfile(next);
              saveJson("cantinho-profile", next);
              setFormError("");
              setEntered(true);
            }}
          >
            Entrar
          </Btn>
        </div>
      </main>
    );
  }

  const sidebar = (
    <div className="relative z-10 flex h-full min-h-0 w-full max-w-80">
      <nav className="flex w-16 shrink-0 flex-col items-center gap-2 overflow-y-auto bg-rail py-3" aria-label="Sistemas">
        {servers.map((item) => {
          const active = item.id === serverId;
          return (
            <div key={item.id} className="group relative">
              <span
                className={`absolute top-1/2 left-0 w-1 -translate-y-1/2 rounded-r bg-head transition-[height] duration-150 ${active ? "h-10" : "h-0 group-hover:h-5"}`}
              />
              <button
                type="button"
                title={item.name}
                onClick={() => pickServer(item.id)}
                className={`grid size-12 place-items-center text-sm font-semibold text-on transition-[border-radius] duration-150 ${active ? "rounded-2xl" : "rounded-full hover:rounded-2xl"}`}
                style={{ background: item.color }}
              >
                <ServerMark id={item.id} />
                {item.id === "cantinho" || item.id === "estudos" || item.id === "jogos" ? null : item.initials.slice(0, 2)}
              </button>
            </div>
          );
        })}
        <span className="my-1 h-0.5 w-8 rounded-full bg-line" />
        <button
          type="button"
          title="Criar sistema"
          aria-label="Criar sistema"
          onClick={() => {
            setFormError("");
            setModal("server");
          }}
          className="grid size-12 place-items-center rounded-full bg-side text-ok hover:rounded-lg hover:bg-ok hover:text-on"
        >
          <Icon name="plus" className="size-5" />
        </button>
      </nav>
      <aside className="flex min-w-0 flex-1 flex-col bg-side">
        <div className="relative">
          <button
            type="button"
            className="flex h-12 w-full items-center gap-2 border-b border-line px-4 text-left font-semibold text-head hover:bg-hover"
            onClick={() => setMenu((v) => !v)}
          >
            <span className="min-w-0 flex-1 truncate">{server?.name ?? "Cantinho"}</span>
            <Icon name="chevron" className="size-4 text-muted" />
          </button>
          {menu ? (
            <div className="absolute top-12 right-2 left-2 z-20 grid gap-1 rounded-md bg-rail p-1.5 shadow-xl">
              <button
                type="button"
                className="rounded-sm px-3 py-2 text-left text-sm text-head hover:bg-brand hover:text-on"
                onClick={() => {
                  setMenu(false);
                  setCopied(false);
                  setModal("invite");
                }}
              >
                Convidar amigos
              </button>
              <button
                type="button"
                className="rounded-sm px-3 py-2 text-left text-sm text-head hover:bg-brand hover:text-on"
                onClick={() => {
                  setMenu(false);
                  setFormError("");
                  setChannelKind("text");
                  setModal("channel");
                }}
              >
                Criar canal
              </button>
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          <ChannelGroup
            label="Canais de texto"
            onAdd={() => {
              setFormError("");
              setChannelKind("text");
              setModal("channel");
            }}
          >
            {textChannels.map((ch) => (
              <ChannelButton
                key={ch.id}
                active={ch.id === channelId}
                unread={unread[ch.id] ?? 0}
                icon={<Icon name="hash" className="size-4" />}
                label={ch.name}
                onClick={() => openChannel(ch)}
              />
            ))}
          </ChannelGroup>
          <ChannelGroup
            label="Canais de voz"
            onAdd={() => {
              setFormError("");
              setChannelKind("voice");
              setModal("channel");
            }}
          >
            {voiceChannels.map((ch) => {
              const inHere = people.filter((p) => p.presence.voiceId === ch.id);
              return (
                <div key={ch.id}>
                  <ChannelButton
                    active={ch.id === channelId}
                    unread={unread[ch.id] ?? 0}
                    icon={<Icon name="volume" className="size-4" />}
                    label={ch.name}
                    live={ch.id === voiceId}
                    onClick={() => openChannel(ch)}
                  />
                  {inHere.length ? (
                    <ul className="mt-0.5 mb-1 ml-6 grid gap-0.5">
                      {inHere.map((p) => (
                        <li key={p.id} className="flex items-center gap-2 px-2 py-1 text-sm text-muted">
                          <Avatar
                            name={p.presence.name}
                            color={p.presence.color}
                            avatar={p.presence.avatar}
                            speaking={p.speaking}
                            className="size-6 text-xs"
                          />
                          <span className="truncate">{p.id === "me" ? `${p.presence.name} (você)` : p.presence.name}</span>
                          {p.presence.sharing ? (
                            <span className="rounded-sm bg-bad px-1 text-xs font-bold text-on">AO VIVO</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </ChannelGroup>
        </div>
        {voiceChannel ? (
          <div className="grid gap-2 border-t border-line px-2 py-2">
            <div className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full bg-ok" />
              <div className="min-w-0 flex-1 leading-tight">
                <b className="block text-sm font-semibold text-ok">Voz conectada</b>
                <span className="block truncate text-xs text-muted">{voiceChannel.name}</span>
              </div>
              <IconButton label="Sair da chamada" onClick={leaveVoice}>
                <Icon name="phone" className="size-5" />
              </IconButton>
            </div>
            {narrow ? (
              <p className="px-1 text-xs text-muted">No celular dá para ouvir e ver. Transmitir a tela fica no computador.</p>
            ) : (
              <button
                type="button"
                onClick={() => void toggleShare()}
                className={`flex h-11 items-center justify-center gap-2 rounded-sm text-sm font-semibold ${sharing ? "bg-bad text-on" : "bg-field text-head hover:bg-line"}`}
              >
                <Icon name="screen" className="size-4" />
                {sharing ? "Parar transmissão" : "Compartilhar tela"}
              </button>
            )}
          </div>
        ) : null}
        <div className="flex h-14 items-center gap-1 bg-panel px-2">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1 py-1 text-left hover:bg-hover"
            onClick={() => {
              setDraft(profile);
              setModal("profile");
            }}
          >
            <Avatar
              name={profile.name}
              color={profile.color}
              avatar={profile.avatar}
              speaking={meSpeaking}
              dot
              className="size-8 text-sm"
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-head">{profile.name}</span>
              <span className="block truncate text-xs text-muted">{profile.status || "Online"}</span>
            </span>
          </button>
          <IconButton label={muted ? "Desmutar" : "Mutar"} danger={muted} onClick={() => setMuted((v) => !v)}>
            {muted ? <Icon name="micOff" className="size-5" /> : <Icon name="mic" className="size-5" />}
          </IconButton>
          <IconButton label={deaf ? "Reativar o som" : "Ensurdecer"} danger={deaf} onClick={toggleDeaf}>
            {deaf ? <Icon name="headphonesOff" className="size-5" /> : <Icon name="headphones" className="size-5" />}
          </IconButton>
          <IconButton
            label="Ajustes"
            onClick={() => {
              setModal("settings");
            }}
          >
            <Icon name="sliders" className="size-5" />
          </IconButton>
        </div>
      </aside>
    </div>
  );

  return (
    <div className="app-safe relative flex h-dvh overflow-hidden bg-rail text-fg">
      {narrow ? (
        drawer ? (
          <div className="absolute inset-0 z-30 flex">
            <button type="button" aria-label="Fechar menu" className="absolute inset-0 bg-rail/80" onClick={() => setDrawer(false)} />
            {sidebar}
          </div>
        ) : null
      ) : (
        sidebar
      )}

      <main className="flex min-w-0 flex-1 flex-col bg-bg">
        {!online ? (
          <div className="flex items-center justify-center gap-3 bg-bad px-3 py-2 text-sm text-on">
            Sem contato com {signalHost(signalUrl) || "o relay"}. Tentando de novo…
          </div>
        ) : null}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-2">
          {narrow ? (
            <IconButton label="Canais" onClick={() => setDrawer(true)}>
              <Icon name="menu" className="size-5" />
            </IconButton>
          ) : null}
          <span className="text-muted">{channel?.kind === "voice" ? <Icon name="volume" className="size-5" /> : <Icon name="hash" className="size-5" />}</span>
          <div className="min-w-0 flex-1">
            <b className="block truncate text-base font-semibold text-head">{channel?.name ?? "…"}</b>
          </div>
          {channel?.topic ? <span className="hidden truncate text-sm text-muted md:block">{channel.topic}</span> : null}
          <IconButton label="Membros" onClick={() => setMembersOpen((v) => !v)}>
            <Icon name="users" className="size-5" />
          </IconButton>
        </header>

        {tiles.length ? (
          <section className="grid max-h-64 shrink-0 grid-cols-1 gap-2 overflow-auto bg-rail p-2 sm:max-h-80 sm:grid-cols-2">
            {tiles.map((tile) => (
              <Tile key={tile.id} tile={tile} />
            ))}
          </section>
        ) : null}

        {channel?.kind === "voice" ? <CallStrip people={people.filter((p) => p.presence.voiceId === channel.id)} /> : null}

        <div
          ref={listRef}
          className={`min-h-0 flex-1 overflow-y-auto py-4 ${dragOver ? "ring-2 ring-brand ring-inset" : ""}`}
          onScroll={(e) => {
            const box = e.currentTarget;
            stickRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            takeFiles([...e.dataTransfer.files]);
          }}
        >
          {visible.length === 0 ? (
            <div className="px-4 pt-6 pb-4">
              <span className="grid size-16 place-items-center rounded-full bg-side text-muted">
                {channel?.kind === "voice" ? <Icon name="volume" className="size-8" /> : <Icon name="hash" className="size-8" />}
              </span>
              <h2 className="mt-3 text-3xl font-semibold text-head">
                {channel?.kind === "voice" ? `Bem-vindo a ${channel.name}` : `Bem-vindo a #${channel?.name ?? "canal"}`}
              </h2>
              <p className="mt-1 max-w-lg text-muted">
                {channel?.topic || "Este é o começo da conversa. Quem estiver no servidor recebe na hora."}
              </p>
            </div>
          ) : null}
          {visible.map((msg, index) => {
            const prev = visible[index - 1];
            const dayChanged = !prev || fmtDay(prev.ts) !== fmtDay(msg.ts);
            const compact =
              !dayChanged &&
              !msg.system &&
              prev &&
              !prev.system &&
              prev.authorId === msg.authorId &&
              msg.ts - prev.ts < 5 * 60 * 1000;
            return (
              <div key={msg.id}>
                {dayChanged ? (
                  <div className="mx-4 my-2 flex items-center gap-3 text-xs font-semibold text-muted">
                    <span className="h-px flex-1 bg-line" />
                    {fmtDay(msg.ts)}
                    <span className="h-px flex-1 bg-line" />
                  </div>
                ) : null}
                {msg.system ? (
                  <p className="px-4 py-1 text-center text-sm text-muted">{msg.text}</p>
                ) : (
                  <article className={`flex gap-4 px-4 py-0.5 hover:bg-hover/70 ${compact ? "mt-0" : "mt-3"}`}>
                    {compact ? (
                      <span className="w-10 shrink-0" />
                    ) : (
                      <Avatar name={msg.name} color={msg.color} className="size-10 text-base" />
                    )}
                    <div className="min-w-0">
                      {compact ? null : (
                        <div className="flex items-baseline gap-2">
                          <b className="font-medium" style={{ color: msg.color }}>
                            {msg.name}
                          </b>
                          <time className="text-xs text-muted">{fmtTime(msg.ts)}</time>
                        </div>
                      )}
                      {msg.text ? <RichText text={msg.text} /> : null}
                      {msg.file ? <FileCard file={msg.file} /> : null}
                    </div>
                  </article>
                )}
              </div>
            );
          })}
        </div>

        <form
          className={`shrink-0 px-4 pt-1 ${narrow ? "pb-2" : "pb-5"}`}
          onSubmit={(e) => {
            e.preventDefault();
            sendText();
          }}
        >
          {typingHere.length ? (
            <p className="mb-1 h-4 truncate text-xs text-muted">
              {typingHere.slice(0, 2).join(" e ")} {typingHere.length > 1 ? "estão digitando…" : "está digitando…"}
            </p>
          ) : (
            <p className="mb-1 h-4" />
          )}
          <div className="flex items-center gap-1 rounded-md bg-field px-2">
            <label className="grid size-11 cursor-pointer place-items-center text-muted hover:text-head" title="Anexar arquivo">
              <Icon name="plus" className="size-6" />
              <span className="sr-only">Anexar</span>
              <input
                type="file"
                multiple
                className="sr-only"
                onChange={(e) => {
                  takeFiles([...(e.target.files ?? [])]);
                  e.target.value = "";
                }}
              />
            </label>
            <input
              value={text}
              maxLength={2000}
              onChange={(e) => onType(e.target.value)}
              placeholder={
                channel?.kind === "voice"
                  ? `Conversar em ${channel.name}`
                  : `Conversar em #${channel?.name ?? "canal"}`
              }
              className="h-12 min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-muted"
            />
            <button type="submit" aria-label="Enviar" className="grid size-11 place-items-center text-muted hover:text-head">
              <Icon name="send" className="size-5" />
            </button>
          </div>
        </form>
        {narrow ? (
          <div className="safe-bottom shrink-0 border-t border-line bg-side">
            {voiceChannel ? (
              <div className="flex items-center gap-2 px-3 pt-2">
                <span className="size-2.5 shrink-0 rounded-full bg-ok" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ok">Voz · {voiceChannel.name}</span>
                <button type="button" className="h-11 px-2 text-sm font-semibold text-bad" onClick={leaveVoice}>
                  Sair
                </button>
              </div>
            ) : null}
            <div className="grid grid-cols-4">
              <DockButton label="Sistemas" onClick={() => setDrawer(true)}>
                <Icon name="menu" className="size-5" />
              </DockButton>
              <DockButton label={muted ? "Mudo" : "Micro"} danger={muted} onClick={() => setMuted((v) => !v)}>
                {muted ? <Icon name="micOff" className="size-5" /> : <Icon name="mic" className="size-5" />}
              </DockButton>
              <DockButton label={deaf ? "Surdo" : "Som"} danger={deaf} onClick={toggleDeaf}>
                {deaf ? <Icon name="headphonesOff" className="size-5" /> : <Icon name="headphones" className="size-5" />}
              </DockButton>
              <DockButton label="Gente" onClick={() => setMembersOpen((v) => !v)}>
                <Icon name="users" className="size-5" />
              </DockButton>
            </div>
          </div>
        ) : null}
      </main>

      {narrow && membersOpen ? (
        <button type="button" aria-label="Fechar membros" className="absolute inset-0 z-20 bg-rail/70" onClick={() => setMembersOpen(false)} />
      ) : null}
      {membersOpen || !narrow ? (
        <aside
          className={`w-72 shrink-0 flex-col bg-side ${membersOpen ? "absolute top-0 right-0 z-30 flex h-full shadow-xl" : "hidden xl:flex"}`}
        >
          <div className="flex h-12 items-center gap-2 px-4 text-xs font-semibold tracking-wide text-muted uppercase">
            <span className="min-w-0 flex-1">Online — {people.length}</span>
            {narrow ? (
              <button type="button" className="h-11 px-1 text-sm font-semibold tracking-normal text-head normal-case" onClick={() => setMembersOpen(false)}>
                Fechar
              </button>
            ) : null}
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto px-2">
            {people.map((p) => {
              const where = channels.find((c) => c.id === p.presence.voiceId)?.name;
              return (
                <li key={p.id} className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-hover">
                  <Avatar
                    name={p.presence.name}
                    color={p.presence.color}
                    avatar={p.presence.avatar}
                    speaking={p.speaking}
                    dot={p.id === "me" || p.connection === "connected"}
                    className="size-8 text-sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-head">
                      {p.id === "me" ? `${profile.name} (você)` : p.presence.name}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {p.connection === "failed"
                        ? "Sem caminho direto"
                        : where
                          ? `Em ${where}`
                          : p.presence.status}
                    </span>
                  </span>
                  {p.presence.deaf ? (
                    <Icon name="headphonesOff" className="size-4 text-bad" />
                  ) : p.presence.muted ? (
                    <Icon name="micOff" className="size-4 text-bad" />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </aside>
      ) : null}

      {toast ? (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-md bg-rail px-4 py-2 text-sm text-head shadow-xl">
          {toast}
        </div>
      ) : null}

      <Modal
        open={modal === "profile"}
        title="Editar perfil"
        onClose={() => setModal(null)}
        footer={
          <>
            <Btn tone="ghost" onClick={() => setModal(null)}>
              Cancelar
            </Btn>
            <Btn
              onClick={() => {
                const name = draft.name.trim();
                if (!name) {
                  flash("O nome não pode ficar vazio.");
                  return;
                }
                const next = { ...draft, name };
                setProfile(next);
                saveJson("cantinho-profile", next);
                setModal(null);
              }}
            >
              Salvar
            </Btn>
          </>
        }
      >
        <ProfileFields value={draft} onChange={setDraft} />
      </Modal>

      <Modal open={modal === "settings"} title="Ajustes de áudio e tela" onClose={() => setModal(null)} footer={<Btn onClick={() => setModal(null)}>Concluído</Btn>}>
        <div className="grid gap-4">
          <Field label="Microfone">
            <select
              className="field"
              value={settings.deviceId}
              onChange={(e) => patchSettings(setSettings, { deviceId: e.target.value })}
            >
              <option value="">Padrão do sistema</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || "Microfone"}
                </option>
              ))}
            </select>
          </Field>
          <div>
            <span className="text-xs font-semibold text-muted">Sensibilidade de entrada</span>
            <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-rail">
              <span className="absolute inset-y-0 left-0 bg-ok" style={{ width: `${Math.round(meter * 100)}%` }} />
              <span className="absolute inset-y-0 w-0.5 bg-warn" style={{ left: `${settings.gate}%` }} />
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={settings.gate}
              aria-label="Limite do corte de ruído"
              className="mt-2 w-full accent-brand"
              onChange={(e) => patchSettings(setSettings, { gate: Number(e.target.value) })}
            />
            <p className="mt-1 text-xs font-normal text-muted">
              Fale normal: a barra precisa passar da marca. Abaixo dela o microfone é cortado. Zero desliga o corte.
            </p>
          </div>
          <div className="grid gap-2 text-sm">
            <Check label="Cancelamento de eco" checked={settings.echo} onChange={(echo) => patchSettings(setSettings, { echo })} />
            <Check label="Supressão de ruído do navegador" checked={settings.noise} onChange={(noise) => patchSettings(setSettings, { noise })} />
            <Check label="Volume automático" checked={settings.agc} onChange={(agc) => patchSettings(setSettings, { agc })} />
          </div>
          <Field label="Qualidade da tela">
            <select
              className="field"
              value={settings.quality}
              onChange={(e) =>
                patchSettings(setSettings, { quality: e.target.value as AudioSettings["quality"] })
              }
            >
              {Object.entries(QUALITY).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Servidor de voz (Render)">
            <input
              className="field"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="https://seu-app.onrender.com"
              value={signalDraft}
              onChange={(e) => setSignalDraft(e.target.value)}
              onBlur={() => commitSignal()}
            />
          </Field>
          {signalError ? <p className="text-sm text-bad">{signalError}</p> : null}
          <p className="text-xs font-normal text-muted">
            Vazio usa o relay deste app, que já funciona no celular publicado. Se o servidor estiver no Render,
            cole o endereço aqui. No plano grátis a primeira chamada pode demorar enquanto ele acorda.
            {signalUrl ? ` Ligado em ${signalHost(signalUrl)}.` : ""}
          </p>
        </div>
      </Modal>

      <Modal
        open={modal === "server"}
        title="Criar sistema"
        onClose={() => setModal(null)}
        footer={
          <>
            <Btn tone="ghost" onClick={() => setModal(null)}>
              Cancelar
            </Btn>
            <Btn disabled={busy || serverName.trim().length < 2} onClick={() => void submitServer()}>
              Criar
            </Btn>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Nome do sistema">
            <input className="field" maxLength={32} value={serverName} onChange={(e) => setServerName(e.target.value)} placeholder="Ex.: A turma" />
          </Field>
          <div>
            <span className="mb-2 block text-xs font-semibold text-muted">Cor</span>
            <div className="flex gap-2">
              {["#5865f2", "#23a559", "#f0b132", "#f23f43", "#eb459f", "#00a8fc"].map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Cor ${color}`}
                  className={`size-8 rounded-full ${serverColor === color ? "ring-2 ring-head ring-offset-2 ring-offset-bg" : ""}`}
                  style={{ background: color }}
                  onClick={() => setServerColor(color)}
                />
              ))}
            </div>
          </div>
          {formError ? <p className="text-sm text-bad">{formError}</p> : null}
        </div>
      </Modal>

      <Modal
        open={modal === "channel"}
        title="Criar canal"
        onClose={() => setModal(null)}
        footer={
          <>
            <Btn tone="ghost" onClick={() => setModal(null)}>
              Cancelar
            </Btn>
            <Btn disabled={busy || !channelName.trim()} onClick={() => void submitChannel()}>
              Criar
            </Btn>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Tipo">
            <select className="field" value={channelKind} onChange={(e) => setChannelKind(e.target.value as "text" | "voice")}>
              <option value="text">Texto</option>
              <option value="voice">Voz</option>
            </select>
          </Field>
          <Field label="Nome do canal">
            <input
              className="field"
              maxLength={32}
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              placeholder={channelKind === "text" ? "geral" : "Sala"}
            />
          </Field>
          {formError ? <p className="text-sm text-bad">{formError}</p> : null}
        </div>
      </Modal>

      <Modal
        open={modal === "invite"}
        title={`Convidar para ${server?.name ?? "o servidor"}`}
        onClose={() => setModal(null)}
        footer={<Btn onClick={() => setModal(null)}>Fechar</Btn>}
      >
        <p className="mb-3 text-sm text-muted">Quem abrir o link cai direto neste servidor. Voz e tela pedem o site publicado (https).</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className="field min-w-0 sm:flex-1" readOnly value={modal === "invite" ? inviteUrl() : ""} />
          <Btn
            onClick={() => {
              void navigator.clipboard.writeText(inviteUrl()).then(() => setCopied(true));
            }}
          >
            <Icon name="copy" className="mr-2 size-4" />
            {copied ? "Copiado" : "Copiar"}
          </Btn>
        </div>
      </Modal>
    </div>
  );
}

function presenceNow(profile: Profile, voiceId: string | null, muted: boolean, deaf: boolean, sharing: boolean): Presence {
  return {
    name: profile.name.trim() || "Anônimo",
    color: profile.color,
    status: profile.status,
    avatar: profile.avatar,
    voiceId,
    muted: muted || deaf,
    deaf,
    sharing,
  };
}

function patchSettings(set: (value: AudioSettings | ((prev: AudioSettings) => AudioSettings)) => void, patch: Partial<AudioSettings>) {
  set((prev) => {
    const next = { ...prev, ...patch };
    saveJson("cantinho-settings", next);
    return next;
  });
}

function DockButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`grid h-14 place-items-center gap-0.5 text-xs font-medium ${danger ? "text-bad" : "text-muted"}`}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function IconButton({
  label,
  onClick,
  children,
  danger,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`grid size-11 place-items-center rounded-sm ${danger ? "text-bad hover:bg-bad/15" : "text-muted hover:bg-line hover:text-head"}`}
    >
      {children}
    </button>
  );
}

function ChannelGroup({ label, onAdd, children }: { label: string; onAdd: () => void; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <div className="flex items-center px-2 pb-1">
        <span className="min-w-0 flex-1 text-xs font-semibold tracking-wide text-muted uppercase">{label}</span>
        <button type="button" aria-label={`Criar em ${label}`} title="Criar canal" onClick={onAdd} className="text-muted hover:text-head">
          <Icon name="plus" className="size-4" />
        </button>
      </div>
      <div className="grid gap-0.5">{children}</div>
    </section>
  );
}

function ChannelButton({
  active,
  unread,
  icon,
  label,
  live,
  onClick,
}: {
  active: boolean;
  unread: number;
  icon: React.ReactNode;
  label: string;
  live?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-11 w-full items-center gap-2 rounded-sm px-2 text-left text-sm ${active ? "bg-line text-head" : unread ? "font-semibold text-head hover:bg-hover" : "text-muted hover:bg-hover hover:text-fg"}`}
    >
      <span className={live ? "text-ok" : ""}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {unread > 0 ? (
        <span className="rounded-full bg-bad px-1.5 text-xs font-bold text-on">{unread > 9 ? "9+" : unread}</span>
      ) : null}
    </button>
  );
}

function CallStrip({ people }: { people: PeerSnap[] }) {
  if (!people.length) return null;
  return (
    <div className="flex gap-3 overflow-x-auto border-b border-rail bg-rail/40 px-4 py-3">
      {people.map((p) => (
        <div key={p.id} className="grid w-20 shrink-0 justify-items-center gap-1 text-center">
          <Avatar
            name={p.presence.name}
            color={p.presence.color}
            avatar={p.presence.avatar}
            speaking={p.speaking}
            className="size-14 text-lg"
          />
          <span className="w-full truncate text-xs text-head">{p.id === "me" ? "Você" : p.presence.name}</span>
        </div>
      ))}
    </div>
  );
}

function Tile({ tile }: { tile: StageTile }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = tile.stream;
    void video.play().catch(() => {});
  }, [tile.stream]);
  return (
    <div className="relative min-h-40 overflow-hidden rounded-md bg-rail">
      <video ref={ref} className="h-full w-full object-contain" autoPlay playsInline muted />
      <span className="absolute bottom-2 left-2 rounded-sm bg-rail/80 px-2 py-0.5 text-xs text-head">{tile.name} está compartilhando</span>
      <button
        type="button"
        aria-label="Tela cheia"
        className="absolute top-2 right-2 grid size-9 place-items-center rounded-sm bg-rail/80 text-head"
        onClick={() => void ref.current?.requestFullscreen()}
      >
        <Icon name="expand" className="size-4" />
      </button>
    </div>
  );
}

function FileCard({ file }: { file: NonNullable<ChatMsg["file"]> }) {
  if (file.mime.startsWith("image/")) {
    return <img src={file.url} alt={file.name} className="mt-1 max-h-80 max-w-full rounded-md" />;
  }
  return (
    <a href={file.url} download={file.name} className="mt-1 inline-flex max-w-full items-center gap-3 rounded-md border border-line bg-side px-3 py-2 text-sm text-link hover:bg-panel">
      <Icon name="file" className="size-5" />
      <span className="min-w-0">
        <b className="block text-head">{file.name}</b>
        <small className="text-muted">{fmtSize(file.size)} · baixar</small>
      </span>
    </a>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-fg">
      <input type="checkbox" className="size-4 accent-brand" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
