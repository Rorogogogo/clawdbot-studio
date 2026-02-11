# ClawDBot Studio

Desktop control center for visualizing and operating ClawDBot with Electron + React and shadcn-style UI primitives.

## Included in this starter

- Electron desktop shell with secure preload bridge (`contextIsolation` enabled)
- React + Vite renderer with Tailwind and shadcn-style component setup
- Real backend integration:
  - API health checks + latency
  - Remote snapshot polling
  - WebSocket stream connect/disconnect + auto reconnect
  - Remote log ingestion with local fallback
- Feature modules:
  - Overview dashboard
  - Visualizer charts (throughput + reliability)
  - Runbook controls (start/pause/resume/stop/sync)
  - Setup assistant (environment checks + saved config)
  - Runtime logs viewer
  - Guides and onboarding panel

## Run locally

```bash
npm install
npm run dev
```

## Build renderer

```bash
npm run build
```

## Package desktop app

```bash
npm run dist
```

Output artifacts are generated in `release/`.

## End-user setup guide

See `docs/USER_SETUP.md`.
