export type Profile = {
  name: string;
  color: string;
  status: string;
  avatar: string;
};

export type AudioSettings = {
  deviceId: string;
  echo: boolean;
  noise: boolean;
  agc: boolean;
  gate: number;
  quality: "game" | "balanced" | "low";
};

export type Presence = {
  name: string;
  color: string;
  status: string;
  avatar: string;
  voiceId: string | null;
  muted: boolean;
  deaf: boolean;
  sharing: boolean;
};

export type ChatMsg = {
  id: string;
  channelId: string;
  authorId: string;
  name: string;
  color: string;
  text?: string;
  ts: number;
  system?: boolean;
  file?: { name: string; mime: string; size: number; url: string };
};

export type StageTile = {
  id: string;
  name: string;
  stream: MediaStream;
};

export type PeerSnap = {
  id: string;
  presence: Presence;
  connection: RTCPeerConnectionState | "offline";
  speaking: boolean;
};

export const SWATCHES = ["#5865f2", "#23a559", "#f0b132", "#f23f43", "#eb459f", "#00a8fc"] as const;

export const DEFAULT_PROFILE: Profile = {
  name: "",
  color: "#5865f2",
  status: "",
  avatar: "",
};

export const DEFAULT_SETTINGS: AudioSettings = {
  deviceId: "",
  echo: true,
  noise: true,
  agc: false,
  gate: 22,
  quality: "balanced",
};

export const QUALITY = {
  game: { label: "Jogo — 1080p 60fps", w: 1920, h: 1080, fps: 60, kbps: 8000, hint: "motion" as const },
  balanced: { label: "Equilibrado — 1080p 30fps", w: 1920, h: 1080, fps: 30, kbps: 4000, hint: "detail" as const },
  low: { label: "Econômico — 720p 30fps", w: 1280, h: 720, fps: 30, kbps: 1800, hint: "motion" as const },
};

export const MAX_FILE = 25 * 1024 * 1024;
