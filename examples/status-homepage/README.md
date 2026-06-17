# Guardian Status Homepage

A static React page that polls a configured list of Guardians' public
`GET /status` endpoints and shows which are running and with which version.

## Configure the Guardian list

Set `VITE_GUARDIAN_URLS` to a comma-separated list of `Name=URL` entries
(the `Name=` prefix is optional):

```bash
VITE_GUARDIAN_URLS="Prod=https://guardian.example.com,EU=https://eu.guardian.example.com" npm run dev
```

With no value set, it polls a single local Guardian at
`http://127.0.0.1:3000`.

## Develop / build / test

```bash
npm install
npm run dev        # http://localhost:3004
npm run build      # static output in dist/
npm run test       # vitest
```

The page fetches each `<url>/status` client-side on load and every 15s. A
Guardian that fails to respond is shown as **down** rather than breaking
the page. No backend or peer discovery is involved — the list is static
config.
