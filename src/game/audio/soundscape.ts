import type { BiomeTheme } from "../types";

type ManifestSound = { key: string; files: string[]; playbackRandom: { pitch: number; volume: number } };

type LoadedSound = { buffers: AudioBuffer[]; random: ManifestSound["playbackRandom"] };

/** 階層ごとの持続音の根音（Hz）と和音の構成。暗い短調の響きで統一する。 */
const BIOME_TONES: Record<BiomeTheme, { root: number; intervals: number[]; filter: number }> = {
  blackstone: { root: 55, intervals: [1, 1.5, 2.4], filter: 520 },
  crypt: { root: 49, intervals: [1, 1.189, 1.5], filter: 440 },
  furnace: { root: 46.25, intervals: [1, 1.335, 2], filter: 680 },
  "black-candle": { root: 41.2, intervals: [1, 1.414, 1.888], filter: 380 },
};

const BELL_STEPS = [1, 1.2, 1.335, 1.5, 1.8, 2];

/**
 * 効果音と環境音楽をまとめて扱う。
 * AudioContext はユーザー操作の後でしか鳴らせないため、最初の操作で unlock() を呼ぶ。
 */
export class Soundscape {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private readonly sounds = new Map<string, LoadedSound>();
  private drone: { oscillators: OscillatorNode[]; filter: BiquadFilterNode; gain: GainNode; biome: BiomeTheme } | null = null;
  private bellTimer: number | null = null;
  private tension = 0;
  private recent = new Map<string, number>();
  private enabled: boolean;
  private loading: Promise<void> | null = null;

  constructor(private readonly base: string, enabled: boolean) {
    this.enabled = enabled;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** 最初のクリックやキー入力で呼ぶ。以後は何度呼んでもよい。 */
  unlock(): void {
    if (!this.enabled) return;
    if (!this.context) {
      const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.context.destination);
      this.sfxBus = this.context.createGain();
      this.sfxBus.gain.value = 0.8;
      this.sfxBus.connect(this.master);
      this.musicBus = this.context.createGain();
      this.musicBus.gain.value = 0.32;
      this.musicBus.connect(this.master);
      this.loading = this.loadSounds();
    }
    if (this.context.state === "suspended") void this.context.resume();
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    if (!this.context || !this.master) {
      if (value) this.unlock();
      return;
    }
    this.master.gain.setTargetAtTime(value ? 0.9 : 0, this.context.currentTime, 0.08);
    if (value && this.context.state === "suspended") void this.context.resume();
  }

  play(key: string, volume = 1): void {
    if (!this.enabled || !this.context || !this.sfxBus) return;
    const sound = this.sounds.get(key);
    if (!sound || sound.buffers.length === 0) return;
    // 同じ音が同時に重なって濁らないよう、短い間隔の連打は間引く
    const now = this.context.currentTime;
    if (now - (this.recent.get(key) ?? -1) < 0.06) return;
    this.recent.set(key, now);
    const source = this.context.createBufferSource();
    source.buffer = sound.buffers[Math.floor(Math.random() * sound.buffers.length)];
    source.playbackRate.value = 1 + (Math.random() * 2 - 1) * sound.random.pitch;
    const gain = this.context.createGain();
    gain.gain.value = volume * (1 + (Math.random() * 2 - 1) * sound.random.volume);
    source.connect(gain).connect(this.sfxBus);
    source.start();
  }

  /** 階層の環境音楽を切り替える。同じ階層なら何もしない。 */
  setBiome(biome: BiomeTheme | null): void {
    if (!this.context || !this.musicBus) return;
    if (!biome) {
      this.stopDrone();
      return;
    }
    if (this.drone?.biome === biome) return;
    this.stopDrone();
    const tone = BIOME_TONES[biome];
    const context = this.context;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = tone.filter;
    filter.Q.value = 0.7;
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.5, context.currentTime, 2.5);
    filter.connect(gain).connect(this.musicBus);
    const oscillators = tone.intervals.flatMap((interval, index) => [-4, 4].map((detune) => {
      const oscillator = context.createOscillator();
      oscillator.type = index === 0 ? "sawtooth" : "triangle";
      oscillator.frequency.value = tone.root * interval;
      oscillator.detune.value = detune + index * 2;
      const voice = context.createGain();
      voice.gain.value = index === 0 ? 0.16 : 0.1;
      oscillator.connect(voice).connect(filter);
      oscillator.start();
      return oscillator;
    }));
    // ゆっくり呼吸するようにフィルターを揺らす
    const lfo = context.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoDepth = context.createGain();
    lfoDepth.gain.value = tone.filter * 0.35;
    lfo.connect(lfoDepth).connect(filter.frequency);
    lfo.start();
    oscillators.push(lfo);
    this.drone = { oscillators, filter, gain, biome };
    this.scheduleBell();
  }

  /** 戦闘や危機の度合い（0〜1）。高いほど持続音が明るく荒くなる。 */
  setTension(value: number): void {
    const clamped = Math.max(0, Math.min(1, value));
    if (!this.context || !this.drone || Math.abs(clamped - this.tension) < 0.05) return;
    this.tension = clamped;
    const tone = BIOME_TONES[this.drone.biome];
    this.drone.filter.frequency.setTargetAtTime(tone.filter * (1 + clamped * 1.6), this.context.currentTime, 0.6);
    this.drone.filter.Q.setTargetAtTime(0.7 + clamped * 5, this.context.currentTime, 0.6);
  }

  private scheduleBell(): void {
    if (this.bellTimer !== null) window.clearTimeout(this.bellTimer);
    this.bellTimer = window.setTimeout(() => {
      this.ringBell();
      this.scheduleBell();
    }, 5200 + Math.random() * 7000);
  }

  /** 遠くで鳴る鐘のような短い音。深い残響代わりに遅延の繰り返しで余韻を作る。 */
  private ringBell(): void {
    if (!this.enabled || !this.context || !this.musicBus || !this.drone) return;
    const context = this.context;
    const tone = BIOME_TONES[this.drone.biome];
    const frequency = tone.root * 8 * BELL_STEPS[Math.floor(Math.random() * BELL_STEPS.length)];
    const now = context.currentTime;
    const output = context.createGain();
    output.gain.value = 0.14;
    const delay = context.createDelay(2);
    delay.delayTime.value = 0.42;
    const feedback = context.createGain();
    feedback.gain.value = 0.42;
    const damp = context.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 1800;
    delay.connect(damp).connect(feedback).connect(delay);
    delay.connect(output);
    output.connect(this.musicBus);
    for (const [ratio, level] of [[1, 0.5], [2.76, 0.18], [5.4, 0.08]] as const) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency * ratio;
      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0, now);
      envelope.gain.linearRampToValueAtTime(level, now + 0.01);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);
      oscillator.connect(envelope);
      envelope.connect(output);
      envelope.connect(delay);
      oscillator.start(now);
      oscillator.stop(now + 3.3);
    }
    window.setTimeout(() => output.disconnect(), 9000);
  }

  private stopDrone(): void {
    if (!this.drone || !this.context) return;
    const { oscillators, gain } = this.drone;
    gain.gain.setTargetAtTime(0, this.context.currentTime, 0.8);
    window.setTimeout(() => {
      for (const oscillator of oscillators) oscillator.stop();
      gain.disconnect();
    }, 4000);
    this.drone = null;
    if (this.bellTimer !== null) window.clearTimeout(this.bellTimer);
    this.bellTimer = null;
  }

  private async loadSounds(): Promise<void> {
    if (!this.context) return;
    const context = this.context;
    try {
      const manifest = await (await fetch(`${this.base}sfx-manifest.json`)).json() as { sounds: ManifestSound[] };
      await Promise.all(manifest.sounds.map(async (sound) => {
        const buffers = await Promise.all(sound.files.map(async (file) => context.decodeAudioData(await (await fetch(`${this.base}${file}`)).arrayBuffer())));
        this.sounds.set(sound.key, { buffers, random: sound.playbackRandom });
      }));
    } catch (error) {
      console.warn("効果音を読み込めませんでした。音なしで続行します。", error);
    }
  }

  get ready(): Promise<void> {
    return this.loading ?? Promise.resolve();
  }
}
