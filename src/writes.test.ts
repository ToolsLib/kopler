import { describe, expect, it, vi } from 'vitest';
import { PendingWrites } from './writes';

describe('pending persistence', () => {
  it('coalesces typing and serializes writes during hide or quit', async () => {
    const order: string[] = [];
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const pending = new PendingWrites(() => {}, () => {});
    pending.set('draft', async () => { order.push('stale'); });
    pending.set('draft', async () => { order.push('start'); await barrier; order.push('saved'); });
    const flush = pending.flush();
    pending.set('draft', async () => { order.push('latest'); });
    release(); await flush;
    expect(order).toEqual(['start', 'saved', 'latest']);
  });

  it('keeps a failed write available for retry', async () => {
    const status = vi.fn();
    const pending = new PendingWrites(status, () => {});
    const write = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    pending.set('item:1', write);
    await expect(pending.flush()).rejects.toThrow('disk full');
    await pending.flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenLastCalledWith('saved');
  });

  it('does not replace a newer draft with an older failed write', async () => {
    let reject!: (error: Error) => void;
    const barrier = new Promise<void>((_, fail) => { reject = fail; });
    const pending = new PendingWrites(() => {}, () => {});
    const latest = vi.fn().mockResolvedValue(undefined);
    pending.set('draft', () => barrier);
    const flush = pending.flush();
    pending.set('draft', latest);
    reject(new Error('storage failed'));
    await expect(flush).rejects.toThrow();
    await pending.flush();
    expect(latest).toHaveBeenCalledOnce();
  });
});
