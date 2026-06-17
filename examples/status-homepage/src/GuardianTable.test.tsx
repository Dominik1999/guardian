import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GuardianTable, formatUptime } from './GuardianTable';
import type { GuardianRow } from './statusClient';

const rows: GuardianRow[] = [
  {
    target: { name: 'Alpha', url: 'https://a.example' },
    online: true,
    status: {
      status: 'ok',
      version: '0.1.0',
      gitCommit: 'abc123',
      network: 'MidenDevnet',
      startedAt: '2026-06-17T10:00:00Z',
      uptimeSeconds: 3661,
    },
  },
  {
    target: { name: 'Beta', url: 'https://b.example' },
    online: false,
    error: 'HTTP 503',
  },
];

describe('GuardianTable', () => {
  it('renders one row per guardian and marks the down one', () => {
    render(<GuardianTable rows={rows} />);
    expect(screen.getAllByTestId('guardian-row')).toHaveLength(2);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('0.1.0')).toBeInTheDocument();
    expect(screen.getByText('up')).toBeInTheDocument();
    expect(screen.getByText('down')).toBeInTheDocument();
  });
});

describe('formatUptime', () => {
  it('formats seconds as h m s', () => {
    expect(formatUptime(3661)).toBe('1h 1m 1s');
  });
});
