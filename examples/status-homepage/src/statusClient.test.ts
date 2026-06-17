import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchStatus } from './statusClient';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('fetchStatus', () => {
  it('maps a successful /status response to a row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          status: 'ok',
          version: '0.1.0',
          git_commit: 'abc',
          network: 'MidenDevnet',
          started_at: '2026-06-17T10:00:00Z',
          uptime_seconds: 10,
        }),
      })),
    );

    const row = await fetchStatus({ name: 'A', url: 'https://a.example/' });

    expect(row.online).toBe(true);
    expect(row.status?.gitCommit).toBe('abc');
    expect(row.status?.network).toBe('MidenDevnet');
    expect(fetch).toHaveBeenCalledWith('https://a.example/status');
  });

  it('marks a guardian down on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503 })),
    );
    const row = await fetchStatus({ name: 'B', url: 'https://b.example' });
    expect(row.online).toBe(false);
    expect(row.error).toContain('503');
  });

  it('marks a guardian down on a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('boom');
      }),
    );
    const row = await fetchStatus({ name: 'C', url: 'https://c.example' });
    expect(row.online).toBe(false);
    expect(row.error).toContain('boom');
  });
});
