# ClawDBot Studio - End User Setup Guide

This guide is for users who install a packaged desktop build (`.dmg`, `.exe`, or `AppImage`).

## 1. Install the desktop app

- macOS: open the `.dmg` and drag **ClawDBot Studio** into Applications.
- Windows: run the `.exe` installer and complete the setup wizard.
- Linux: download the `AppImage`, make it executable, and run it.

## 2. Open the app and configure setup

In the **Setup** page, fill these fields:

- `Bot source path`: folder where ClawDBot project is located.
- `Workspace path`: optional working folder for outputs/temp files.
- `Launch command`: command used to start the bot (example: `python3 main.py`).
- `API endpoint`: bot backend URL (example: `http://127.0.0.1:5050`).
- `WebSocket endpoint` (optional): stream URL (example: `ws://127.0.0.1:5050/ws`).
- `Polling interval`: refresh cadence in milliseconds.

Then click:

1. **Run environment checks**
2. **Test API**
3. **Save configuration**

## 3. Connect and operate

- In **Overview**, confirm:
  - `API online`
  - `WS live` (optional, if websocket is available)
- In **Controls**, run:
  - `Start`, `Pause`, `Resume`, `Stop`, `Sync now`
- In **Logs**, review real runtime logs from backend (local fallback if unavailable).

## 4. First-run troubleshooting

If API is offline:

1. Check backend is running.
2. Verify API endpoint host/port.
3. Confirm firewall/proxy is not blocking connection.
4. Retry with **Test API**.

If websocket is disconnected:

1. Confirm websocket endpoint path (common: `/ws`).
2. Use **Connect WS** manually.
3. Turn on **Auto reconnect** in Controls.

## 5. Data location (advanced)

Desktop config/log files are stored in the system app-data folder:

- macOS: `~/Library/Application Support/ClawDBot Studio/`
- Windows: `%APPDATA%\ClawDBot Studio\`
- Linux: `~/.config/ClawDBot Studio/`
