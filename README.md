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

## Package desktop app locally

```bash
npm run dist
```

Output artifacts are generated in `release/`.

## Publish installers to GitHub Releases

A workflow is included at `.github/workflows/release.yml`.

### Option 1: Recommended (tag push)

```bash
git tag v0.1.1
git push origin v0.1.1
```

This triggers a multi-platform build on GitHub Actions and publishes installers to Releases.

### Option 2: Manual trigger

- Go to **Actions** -> **Release Installers**
- Click **Run workflow**
- Set `tag` (example: `v0.1.1`)
- Run

After completion, users download from:

- `https://github.com/Rorogogogo/clawdbot-studio/releases`

## End-user setup guide

See `docs/USER_SETUP.md`.

## License

This project is **dual-licensed**:

- 🆓 **AGPL-3.0** — free for personal use, open-source forks, and projects themselves open-sourced under a compatible license. See [LICENSE](LICENSE).
- 💼 **Commercial license** — required for closed-source products, proprietary internal tools, or paid / hosted services where AGPL-3.0's copyleft and network-use obligations don't fit. See [COMMERCIAL.md](COMMERCIAL.md).

### Do I need a commercial license?

| Use case | License |
|---|---|
| Personal use / running locally | AGPL-3.0 (free) |
| Forking and publishing under AGPL-3.0 | AGPL-3.0 (free) |
| Bundling into a closed-source product | **Commercial** |
| Hosting a modified version as a SaaS without publishing source | **Commercial** |
| Internal company tool not open-sourced | **Commercial** |

For a commercial license, contact **Robert Wang** at **xwang.robert@gmail.com** — see [COMMERCIAL.md](COMMERCIAL.md) for what to include in your request.
