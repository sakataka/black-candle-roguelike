export class Rng {
  private state: number;

  constructor(seed: number) {
    // 連続した種でも最初の乱数が似ないよう、種を攪拌してから使う。
    let mixed = seed >>> 0;
    mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);
    mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);
    this.state = (mixed ^ (mixed >>> 16)) >>> 0;
  }

  next(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }
}
