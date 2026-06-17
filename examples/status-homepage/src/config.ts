import type { GuardianTarget } from './statusClient';

const DEFAULT_TARGETS: GuardianTarget[] = [{ name: 'Local', url: 'http://127.0.0.1:3000' }];

/**
 * Reads the configured Guardian list from `VITE_GUARDIAN_URLS`, a
 * comma-separated list of `Name=https://url` entries (the `Name=` prefix
 * is optional; the URL is used as the name when omitted). Falls back to a
 * single local Guardian.
 */
export function getGuardianTargets(): GuardianTarget[] {
  const raw = import.meta.env.VITE_GUARDIAN_URLS as string | undefined;
  if (!raw) return DEFAULT_TARGETS;
  const targets = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const eq = entry.indexOf('=');
      if (eq === -1) return { name: entry, url: entry };
      return { name: entry.slice(0, eq).trim(), url: entry.slice(eq + 1).trim() };
    });
  return targets.length > 0 ? targets : DEFAULT_TARGETS;
}
