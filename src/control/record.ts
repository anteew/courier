import fs from 'fs';

export type Dir = 'in' | 'out';

export class Recorder {
  private stream: fs.WriteStream | null = null;
  constructor(path?: string) {
    if (path) {
      this.stream = fs.createWriteStream(path, { flags: 'a' });
    }
  }
  write(frame: any, dir: Dir) {
    if (!this.stream) return;
    const rec = { ts: new Date().toISOString(), dir, frame };
    this.stream.write(JSON.stringify(rec) + '\n');
  }
  close() { this.stream?.end(); }
}
