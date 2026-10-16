import { clamp } from './util';

export type Source = { read(): Promise<string> };

/** Runs sources and keeps the last result. */
export class Engine {
  private last = '';
  constructor(private sources: Source[]) {}
  async run() {
    for (const s of this.sources) this.last = await s.read();
    return this.size();
  }
  size() {
    return clamp(this.last.length, 0, 1000);
  }
}
