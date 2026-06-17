import { useEffect, useState } from 'react';
import { getGuardianTargets } from './config';
import { fetchAllStatuses, type GuardianRow } from './statusClient';
import { GuardianTable } from './GuardianTable';

const REFRESH_MS = 15000;

export default function App() {
  const [rows, setRows] = useState<GuardianRow[]>([]);

  useEffect(() => {
    const targets = getGuardianTargets();
    let active = true;
    const load = async () => {
      const next = await fetchAllStatuses(targets);
      if (active) setRows(next);
    };
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return (
    <main>
      <h1>Guardians</h1>
      <GuardianTable rows={rows} />
    </main>
  );
}
