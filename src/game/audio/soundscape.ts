type ManifestSound = { key: string; files: string[]; playbackRandom: { pitch: number; volume: number } };

type LoadedSound = { buffers: AudioBuffer[]; random: ManifestSound["playbackRandom"] };

/**
 * 効果音を扱う。
 * AudioContext はユーザー操作の後でしか鳴らせないため、最初の操作で unlock() を呼ぶ。
 */
export class Soundscape {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private readonly sounds = new Map<string, LoadedSound>();
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
