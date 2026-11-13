type Write = () => Promise<unknown>;

// Coalesce rapid typing, serialize persistence, and retain the latest content on failure.
export class PendingWrites {
  private pending = new Map<string, Write>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  constructor(private status: (value: 'saved' | 'pending' | 'saving' | 'error') => void, private onError: (error: unknown) => void) {}

  set(key: string, write: Write) {
    this.pending.set(key, write);
    this.status('pending');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(this.onError); }, 300);
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) {
      await this.running;
      if (this.pending.size) return this.flush();
      return;
    }
    if (!this.pending.size) return;
    this.status('saving');
    this.running = this.drain();
    try { await this.running; this.status('saved'); }
    catch (error) { this.status('error'); throw error; }
    finally { this.running = undefined; }
  }

  private async drain() {
    while (this.pending.size) {
      const [key, write] = this.pending.entries().next().value!;
      this.pending.delete(key);
      try { await write(); }
      catch (error) {
        if (!this.pending.has(key)) this.pending.set(key, write);
        throw error;
      }
    }
  }
}
