export interface GuardianTarget {
  name: string;
  url: string;
}

export interface GuardianStatus {
  status: string;
  version: string;
  gitCommit: string;
  network: string;
  startedAt: string;
  uptimeSeconds: number;
}

export interface GuardianRow {
  target: GuardianTarget;
  online: boolean;
  status?: GuardianStatus;
  error?: string;
}

interface ServerStatusResponse {
  status: string;
  version: string;
  git_commit: string;
  network: string;
  started_at: string;
  uptime_seconds: number;
}

export async function fetchStatus(target: GuardianTarget): Promise<GuardianRow> {
  const base = target.url.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/status`);
    if (!res.ok) {
      return { target, online: false, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as ServerStatusResponse;
    return {
      target,
      online: true,
      status: {
        status: data.status,
        version: data.version,
        gitCommit: data.git_commit,
        network: data.network,
        startedAt: data.started_at,
        uptimeSeconds: data.uptime_seconds,
      },
    };
  } catch (err) {
    return {
      target,
      online: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function fetchAllStatuses(targets: GuardianTarget[]): Promise<GuardianRow[]> {
  return Promise.all(targets.map(fetchStatus));
}
