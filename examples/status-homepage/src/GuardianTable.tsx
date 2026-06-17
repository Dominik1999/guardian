import type { GuardianRow } from './statusClient';

export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

export function GuardianTable({ rows }: { rows: GuardianRow[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Guardian</th>
          <th>Status</th>
          <th>Version</th>
          <th>Commit</th>
          <th>Network</th>
          <th>Uptime</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.target.url} data-testid="guardian-row">
            <td>{row.target.name}</td>
            <td>{row.online ? 'up' : 'down'}</td>
            <td>{row.status?.version ?? '—'}</td>
            <td>{row.status?.gitCommit ?? '—'}</td>
            <td>{row.status?.network ?? '—'}</td>
            <td>{row.status ? formatUptime(row.status.uptimeSeconds) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
