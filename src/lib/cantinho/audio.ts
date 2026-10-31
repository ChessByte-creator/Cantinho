import type { AudioSettings } from "./types";

function rms(an: AnalyserNode, buf: Float32Array<ArrayBufferLike>) {
  an.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>);
  let s = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const v = buf[i] ?? 0;
    s += v * v;
  }
  const db = 20 * Math.log10(Math.sqrt(s / buf.length) || 1e-8);
  return Math.min(1, Math.max(0, (db + 70) / 70));
}

/** Mic capture with a noise gate. The outbound track never changes; only the source does. */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private an: AnalyserNode | null = null;
  private gate: GainNode | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private mic: MediaStream | null = null;
  private buf: Float32Array<ArrayBufferLike> | null = null;
  private levelNow = 0;
  private lastAbove = 0;
  private settings: AudioSettings | null = null;
  private wantMute = false;

  outputTrack(): MediaStreamTrack | null {
    return this.dest?.stream.getAudioTracks()[0] ?? null;
  }

  outputStream(): MediaStream | null {
    return this.dest?.stream ?? null;
  }

  level() {
    return this.levelNow;
  }

  async ensure(settings: AudioSettings) {
    this.settings = settings;
    if (this.ctx) {
      // Navegadores (Android, iPhone) deixam o audio "suspenso" ate um toque: tenta de novo.
      if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.an = this.ctx.createAnalyser();
    this.an.fftSize = 1024;
    this.buf = new Float32Array(this.an.fftSize);
    this.gate = this.ctx.createGain();
    this.gate.gain.value = 0;
    this.dest = this.ctx.createMediaStreamDestination();
    this.an.connect(this.gate);
    this.gate.connect(this.dest);
    await this.ctx.resume();
  }

  async startMic(settings: AudioSettings) {
    this.settings = settings;
    await this.ensure(settings);
    if (!this.ctx || !this.an) return;
    this.mic?.getTracks().forEach((t) => t.stop());
    this.src?.disconnect();
    const audio: MediaTrackConstraints = {
      echoCancellation: settings.echo,
      noiseSuppression: settings.noise,
      autoGainControl: settings.agc,
    };
    if (settings.deviceId) audio.deviceId = { exact: settings.deviceId };
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio });
    } catch {
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: settings.echo,
          noiseSuppression: settings.noise,
          autoGainControl: settings.agc,
        },
      });
    }
    this.src = this.ctx.createMediaStreamSource(this.mic);
    this.src.connect(this.an);
  }

  setMuted(muted: boolean) {
    this.wantMute = muted;
  }

  /** Returns whether the gate is open (used for the speaking ring). */
  tick(settings: AudioSettings): boolean {
    this.settings = settings;
    if (!this.an || !this.buf || !this.gate || !this.ctx) return false;
    this.levelNow = rms(this.an, this.buf);
    const now = performance.now();
    if (this.levelNow >= settings.gate / 100) this.lastAbove = now;
    const open = !!this.mic && !this.wantMute && (settings.gate === 0 || now - this.lastAbove < 350);
    this.gate.gain.setTargetAtTime(open ? 1 : 0, this.ctx.currentTime, 0.015);
    return open && this.levelNow > 0.05;
  }

  tapRemote(track: MediaStreamTrack) {
    if (!this.ctx) return null;
    try {
      const an = this.ctx.createAnalyser();
      an.fftSize = 1024;
      const buf = new Float32Array(an.fftSize);
      this.ctx.createMediaStreamSource(new MediaStream([track])).connect(an);
      return {
        speaking: () => rms(an, buf) > 0.32,
      };
    } catch {
      return null;
    }
  }

  blip(freq = 660) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g);
    g.connect(this.ctx.destination);
    o.start(t);
    o.stop(t + 0.2);
  }

  async devices() {
    const list = await navigator.mediaDevices.enumerateDevices();
    return list.filter((d) => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default");
  }
}

export const audio = new AudioEngine();
