const { app, BrowserWindow, ipcMain, shell } = require("electron")
const fs = require("node:fs/promises")
const path = require("node:path")
const { execFile } = require("node:child_process")
const { WebSocket } = require("ws")

const defaultConfig = {
  botPath: "",
  launchCommand: "python3 main.py",
  apiEndpoint: "http://127.0.0.1:5050",
  wsEndpoint: "",
  workspacePath: "",
  autostart: false,
  desktopNotifications: true,
  safeMode: true,
  autoReconnect: true,
  pollingIntervalMs: 5000,
}

let runtimeState = {
  status: "idle",
  queueDepth: 18,
  jobsProcessed: 1284,
  successRate: 94.3,
  activeWorkers: 4,
  lastHeartbeat: new Date().toISOString(),
}

const connectionState = {
  mode: "local",
  apiReachable: false,
  apiEndpoint: defaultConfig.apiEndpoint,
  apiLatencyMs: null,
  wsConnected: false,
  wsEndpoint: "",
  lastCheck: null,
  lastEventAt: null,
  lastError: null,
}

const remoteCache = {
  snapshot: null,
  logs: [],
}

const botLogSeed = [
  "[BOOT] ClawDBot Studio session initialized",
  "[SYNC] Scheduler synced with 4 worker slots",
  "[QUEUE] Imported 18 tasks from latest profile",
  "[HEALTH] Last heartbeat within threshold",
]

const healthPaths = ["/health", "/api/health", "/status", "/api/status", "/"]
const snapshotPaths = ["/snapshot", "/api/snapshot", "/bot/snapshot", "/status", "/api/status"]
const logsPaths = ["/logs", "/api/logs", "/runtime/logs", "/api/runtime/logs"]
const actionPaths = ["/action", "/api/action", "/control/action", "/api/control/action"]

let wsClient = null
let wsReconnectTimer = null
let manualWsDisconnect = false

function getConfigPath() {
  return path.join(app.getPath("userData"), "studio-config.json")
}

function getLogsPath() {
  return path.join(app.getPath("userData"), "studio-runtime.log")
}

function formatLog(message, level = "INFO") {
  return `[${new Date().toISOString()}] [${level}] ${message}`
}

function copyConnectionState() {
  return {
    ...connectionState,
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function numberOrFallback(value, fallback) {
  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeStatus(value) {
  const normalized = String(value || "idle").toLowerCase()

  if (["running", "paused", "stopped", "idle"].includes(normalized)) {
    return normalized
  }

  if (["active", "busy", "processing"].includes(normalized)) {
    return "running"
  }

  if (["halted", "terminated", "off"].includes(normalized)) {
    return "stopped"
  }

  return "idle"
}

function normalizeHttpEndpoint(endpoint) {
  const raw = String(endpoint || "").trim()

  if (!raw) {
    return ""
  }

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`

  try {
    const parsed = new URL(withProtocol)

    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/+$/, "")
  } catch {
    return ""
  }
}

function joinUrl(base, suffix) {
  return `${base.replace(/\/+$/, "")}${suffix.startsWith("/") ? suffix : `/${suffix}`}`
}

function toWebSocketEndpoint(config) {
  const rawWsEndpoint = String(config?.wsEndpoint || "").trim()

  if (rawWsEndpoint) {
    if (/^wss?:\/\//i.test(rawWsEndpoint)) {
      return rawWsEndpoint
    }

    if (/^https?:\/\//i.test(rawWsEndpoint)) {
      return rawWsEndpoint.replace(/^http/i, "ws")
    }

    return `ws://${rawWsEndpoint.replace(/^\/+/, "")}`
  }

  const apiEndpoint = normalizeHttpEndpoint(config?.apiEndpoint)

  if (!apiEndpoint) {
    return ""
  }

  return `${apiEndpoint.replace(/^http/i, "ws")}/ws`
}

async function fetchEndpoint(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
        ...(options.headers || {}),
      },
      signal: controller.signal,
    })

    const text = await response.text()
    let data = null

    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = null
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      text,
      data,
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: "",
      data: null,
      error: error instanceof Error ? error.message : "Unknown fetch failure",
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

function normalizeSnapshot(payload) {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const source =
    payload.snapshot && typeof payload.snapshot === "object"
      ? payload.snapshot
      : payload.data && typeof payload.data === "object"
        ? payload.data
        : payload

  if (!source || Array.isArray(source) || typeof source !== "object") {
    return null
  }

  const status = normalizeStatus(source.status ?? source.state ?? source.mode ?? runtimeState.status)
  const queueDepth = clamp(numberOrFallback(source.queueDepth ?? source.queue_depth ?? source.queue, runtimeState.queueDepth), 0, 10000)
  const jobsProcessed = clamp(numberOrFallback(source.jobsProcessed ?? source.jobs_processed ?? source.jobs, runtimeState.jobsProcessed), 0, 100000000)
  const successRate = clamp(numberOrFallback(source.successRate ?? source.success_rate ?? source.success, runtimeState.successRate), 0, 100)
  const activeWorkers = clamp(numberOrFallback(source.activeWorkers ?? source.active_workers ?? source.workers, runtimeState.activeWorkers), 0, 1000)
  const heartbeatRaw = source.lastHeartbeat ?? source.last_heartbeat ?? source.heartbeat ?? new Date().toISOString()

  return {
    status,
    queueDepth,
    jobsProcessed,
    successRate,
    activeWorkers,
    lastHeartbeat: String(heartbeatRaw),
  }
}

function extractLogs(payload, text = "") {
  let entries = []

  if (Array.isArray(payload)) {
    entries = payload
  } else if (payload && Array.isArray(payload.logs)) {
    entries = payload.logs
  } else if (payload && Array.isArray(payload.data)) {
    entries = payload.data
  } else if (payload && typeof payload.log === "string") {
    entries = [payload.log]
  } else if (payload && typeof payload.message === "string") {
    entries = [payload.message]
  } else if (typeof text === "string" && text.trim().length > 0) {
    entries = text.split(/\r?\n/)
  }

  const mapped = entries
    .map((entry) => {
      if (typeof entry === "string") {
        if (entry.trim().length === 0) {
          return null
        }

        return /^\[\d{4}-\d{2}-\d{2}T/.test(entry) ? entry : formatLog(`[REMOTE] ${entry}`, "REMOTE")
      }

      if (entry && typeof entry === "object") {
        const message = String(entry.message ?? entry.log ?? entry.msg ?? JSON.stringify(entry))
        const timestamp = String(entry.timestamp ?? entry.time ?? entry.ts ?? new Date().toISOString())
        const level = String(entry.level ?? entry.severity ?? "REMOTE").toUpperCase()
        return `[${timestamp}] [${level}] ${message}`
      }

      return null
    })
    .filter(Boolean)

  return mapped.slice(-500)
}

function clearReconnectTimer() {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer)
    wsReconnectTimer = null
  }
}

function closeWebSocketClient() {
  if (!wsClient) {
    return
  }

  try {
    wsClient.removeAllListeners()
    wsClient.close()
  } catch {
    // noop
  }

  wsClient = null
}

function mergeSnapshot(snapshot) {
  runtimeState = {
    ...runtimeState,
    ...snapshot,
  }

  remoteCache.snapshot = runtimeState

  return runtimeState
}

function maybeScheduleReconnect(config) {
  if (!config.autoReconnect || manualWsDisconnect) {
    return
  }

  clearReconnectTimer()

  const delayMs = clamp(numberOrFallback(config.pollingIntervalMs, 5000), 2000, 30000)

  wsReconnectTimer = setTimeout(async () => {
    await connectWebSocket(config, true)
  }, delayMs)
}

function handleWsPayload(rawMessage) {
  let parsed = null

  if (typeof rawMessage !== "string") {
    return
  }

  try {
    parsed = JSON.parse(rawMessage)
  } catch {
    parsed = rawMessage
  }

  connectionState.lastEventAt = new Date().toISOString()
  connectionState.apiReachable = true
  connectionState.mode = "remote"
  connectionState.lastError = null

  if (typeof parsed === "string") {
    const formatted = extractLogs(null, parsed)

    if (formatted.length > 0) {
      remoteCache.logs = [...remoteCache.logs, ...formatted].slice(-500)
    }

    return
  }

  const snapshot = normalizeSnapshot(parsed)

  if (snapshot) {
    mergeSnapshot(snapshot)
  }

  const messageLogs = extractLogs(parsed)

  if (messageLogs.length > 0) {
    remoteCache.logs = [...remoteCache.logs, ...messageLogs].slice(-500)
  }
}

async function connectWebSocket(config, isReconnect = false) {
  const wsEndpoint = toWebSocketEndpoint(config)

  connectionState.wsEndpoint = wsEndpoint

  if (!wsEndpoint) {
    connectionState.wsConnected = false
    connectionState.lastError = "WebSocket endpoint is not configured"
    return copyConnectionState()
  }

  manualWsDisconnect = false

  clearReconnectTimer()
  closeWebSocketClient()

  return new Promise((resolve) => {
    let resolved = false

    function resolveOnce(value) {
      if (!resolved) {
        resolved = true
        resolve(value)
      }
    }

    try {
      wsClient = new WebSocket(wsEndpoint)
    } catch (error) {
      connectionState.wsConnected = false
      connectionState.lastError = error instanceof Error ? error.message : "Failed to create websocket client"
      resolveOnce(copyConnectionState())
      return
    }

    wsClient.on("open", async () => {
      connectionState.wsConnected = true
      connectionState.mode = "remote"
      connectionState.lastError = null
      connectionState.lastEventAt = new Date().toISOString()

      await appendLog(`WebSocket connected: ${wsEndpoint}`)

      resolveOnce(copyConnectionState())
    })

    wsClient.on("message", (message) => {
      handleWsPayload(message.toString())
    })

    wsClient.on("error", (error) => {
      connectionState.lastError = error instanceof Error ? error.message : "WebSocket error"
      resolveOnce(copyConnectionState())
    })

    wsClient.on("close", async () => {
      const wasConnected = connectionState.wsConnected
      connectionState.wsConnected = false

      if (wasConnected) {
        await appendLog(`WebSocket disconnected: ${wsEndpoint}`, "WARN")
      }

      const latestConfig = await readConfig()

      if (!manualWsDisconnect) {
        maybeScheduleReconnect(latestConfig)
      }

      resolveOnce(copyConnectionState())
    })

    setTimeout(() => {
      resolveOnce(copyConnectionState())
    }, isReconnect ? 1400 : 2200)
  })
}

async function disconnectWebSocket() {
  manualWsDisconnect = true
  clearReconnectTimer()

  closeWebSocketClient()

  connectionState.wsConnected = false

  await appendLog("WebSocket manually disconnected by operator", "WARN")

  return copyConnectionState()
}

async function readConfig() {
  try {
    const raw = await fs.readFile(getConfigPath(), "utf8")
    const parsed = JSON.parse(raw)

    return {
      ...defaultConfig,
      ...parsed,
    }
  } catch {
    return defaultConfig
  }
}

async function saveConfig(nextConfig) {
  const merged = {
    ...defaultConfig,
    ...(nextConfig || {}),
    botPath: String(nextConfig?.botPath || ""),
    launchCommand: String(nextConfig?.launchCommand || defaultConfig.launchCommand),
    apiEndpoint: String(nextConfig?.apiEndpoint || defaultConfig.apiEndpoint),
    wsEndpoint: String(nextConfig?.wsEndpoint || ""),
    workspacePath: String(nextConfig?.workspacePath || ""),
    autostart: Boolean(nextConfig?.autostart),
    desktopNotifications: Boolean(nextConfig?.desktopNotifications),
    safeMode: Boolean(nextConfig?.safeMode),
    autoReconnect: Boolean(nextConfig?.autoReconnect),
    pollingIntervalMs: clamp(numberOrFallback(nextConfig?.pollingIntervalMs, defaultConfig.pollingIntervalMs), 1000, 120000),
  }

  await fs.mkdir(path.dirname(getConfigPath()), { recursive: true })
  await fs.writeFile(getConfigPath(), JSON.stringify(merged, null, 2), "utf8")

  connectionState.apiEndpoint = normalizeHttpEndpoint(merged.apiEndpoint)
  connectionState.wsEndpoint = toWebSocketEndpoint(merged)

  return merged
}

async function ensureLogsFile() {
  const logsPath = getLogsPath()

  try {
    await fs.access(logsPath)
  } catch {
    await fs.mkdir(path.dirname(logsPath), { recursive: true })

    const lines = botLogSeed.map((line) => formatLog(line, "INFO")).join("\n")
    await fs.writeFile(logsPath, `${lines}\n`, "utf8")
  }
}

async function appendLog(message, level = "INFO") {
  await ensureLogsFile()
  await fs.appendFile(getLogsPath(), `${formatLog(message, level)}\n`, "utf8")
}

async function readLocalLogs(limit = 250) {
  await ensureLogsFile()
  const contents = await fs.readFile(getLogsPath(), "utf8")
  const lines = contents.split("\n").filter(Boolean)

  return lines.slice(-limit)
}

function runCommand(command, args = []) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 6000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, output: (stderr || error.message).toString().trim() })
        return
      }

      resolve({ ok: true, output: (stdout || stderr).toString().trim() })
    })
  })
}

async function runVersionCheck(name, commands) {
  for (const entry of commands) {
    const result = await runCommand(entry.command, entry.args)

    if (result.ok) {
      return {
        name,
        status: "pass",
        detail: result.output || `${entry.command} detected`,
      }
    }
  }

  const fallback = commands[0]

  return {
    name,
    status: "fail",
    detail: `${fallback.command} not available on this system`,
  }
}

async function probeApiConnection(config) {
  const apiEndpoint = normalizeHttpEndpoint(config?.apiEndpoint)

  connectionState.apiEndpoint = apiEndpoint
  connectionState.lastCheck = new Date().toISOString()

  if (!apiEndpoint) {
    connectionState.apiReachable = false
    connectionState.apiLatencyMs = null
    connectionState.mode = connectionState.wsConnected ? "remote" : "local"
    connectionState.lastError = "API endpoint is not configured"
    return copyConnectionState()
  }

  const startedAt = Date.now()
  let latestError = "API endpoint did not respond"

  for (const probePath of healthPaths) {
    const response = await fetchEndpoint(joinUrl(apiEndpoint, probePath), {}, 4500)

    if (response.ok || (response.status >= 200 && response.status < 500 && response.status !== 404)) {
      connectionState.apiReachable = true
      connectionState.apiLatencyMs = Date.now() - startedAt
      connectionState.mode = "remote"
      connectionState.lastError = null
      return copyConnectionState()
    }

    if (response.error) {
      latestError = response.error
    }
  }

  connectionState.apiReachable = false
  connectionState.apiLatencyMs = null
  connectionState.mode = connectionState.wsConnected ? "remote" : "local"
  connectionState.lastError = latestError

  return copyConnectionState()
}

function shouldProbeNow() {
  if (!connectionState.lastCheck) {
    return true
  }

  const elapsed = Date.now() - new Date(connectionState.lastCheck).getTime()

  return elapsed > 15000
}

async function fetchRemoteSnapshot(config) {
  const apiEndpoint = normalizeHttpEndpoint(config?.apiEndpoint)

  if (!apiEndpoint) {
    return null
  }

  if (shouldProbeNow()) {
    await probeApiConnection(config)
  }

  for (const snapshotPath of snapshotPaths) {
    const response = await fetchEndpoint(joinUrl(apiEndpoint, snapshotPath), {}, 5000)

    if (!response.ok) {
      continue
    }

    const snapshot = normalizeSnapshot(response.data)

    if (snapshot) {
      connectionState.apiReachable = true
      connectionState.mode = "remote"
      connectionState.lastError = null
      return mergeSnapshot(snapshot)
    }
  }

  if (connectionState.wsConnected && remoteCache.snapshot) {
    return mergeSnapshot(remoteCache.snapshot)
  }

  return null
}

async function fetchRemoteLogs(config) {
  const apiEndpoint = normalizeHttpEndpoint(config?.apiEndpoint)

  if (!apiEndpoint) {
    return []
  }

  for (const logsPath of logsPaths) {
    const response = await fetchEndpoint(joinUrl(apiEndpoint, logsPath), {}, 5000)

    if (!response.ok) {
      continue
    }

    const parsedLogs = extractLogs(response.data, response.text)

    if (parsedLogs.length > 0) {
      remoteCache.logs = parsedLogs
      connectionState.apiReachable = true
      connectionState.mode = "remote"
      connectionState.lastError = null
      return parsedLogs.slice(-250)
    }
  }

  return remoteCache.logs.slice(-250)
}

async function tryRemoteAction(config, action) {
  const apiEndpoint = normalizeHttpEndpoint(config?.apiEndpoint)

  if (!apiEndpoint) {
    return null
  }

  for (const actionPath of actionPaths) {
    const response = await fetchEndpoint(
      joinUrl(apiEndpoint, actionPath),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action }),
      },
      5500,
    )

    if (!response.ok) {
      continue
    }

    const snapshotFromAction = normalizeSnapshot(response.data)
    const snapshot = snapshotFromAction || (await fetchRemoteSnapshot(config)) || getLocalSnapshot()

    await appendLog(`Action '${action}' forwarded to remote API`)

    return {
      ok: true,
      message: `Action '${action}' sent to remote backend`,
      snapshot,
    }
  }

  return null
}

async function runSetupChecks(botPath) {
  const pythonChecks =
    process.platform === "win32"
      ? [
          { command: "python", args: ["--version"] },
          { command: "py", args: ["--version"] },
        ]
      : [
          { command: "python3", args: ["--version"] },
          { command: "python", args: ["--version"] },
        ]

  const commandChecks = await Promise.all([
    runVersionCheck("Node.js", [{ command: "node", args: ["-v"] }]),
    runVersionCheck("npm", [{ command: "npm", args: ["-v"] }]),
    runVersionCheck("Git", [{ command: "git", args: ["--version"] }]),
    runVersionCheck("Python runtime", pythonChecks),
  ])

  let botPathCheck = {
    name: "Bot project path",
    status: "warning",
    detail: "Set a bot path to validate your local source folder",
  }

  if (typeof botPath === "string" && botPath.trim().length > 0) {
    try {
      await fs.access(botPath)
      botPathCheck = {
        name: "Bot project path",
        status: "pass",
        detail: `${botPath} is readable`,
      }
    } catch {
      botPathCheck = {
        name: "Bot project path",
        status: "fail",
        detail: `${botPath} cannot be accessed`,
      }
    }
  }

  const config = await readConfig()
  const connection = await probeApiConnection(config)
  const apiCheck =
    normalizeHttpEndpoint(config.apiEndpoint).length === 0
      ? {
          name: "Bot API endpoint",
          status: "warning",
          detail: "Set API endpoint to enable real backend connectivity",
        }
      : connection.apiReachable
        ? {
            name: "Bot API endpoint",
            status: "pass",
            detail: `Connected in ${connection.apiLatencyMs ?? "?"} ms (${connection.apiEndpoint})`,
          }
        : {
            name: "Bot API endpoint",
            status: "fail",
            detail: connection.lastError || `Unable to reach ${connection.apiEndpoint}`,
          }

  const wsCheck = {
    name: "WebSocket stream",
    status: connection.wsConnected ? "pass" : "warning",
    detail: connection.wsConnected
      ? `Connected to ${connection.wsEndpoint}`
      : `Not connected (will use HTTP polling${config.autoReconnect ? ", auto-reconnect enabled" : ""})`,
  }

  await appendLog("Setup checks executed from desktop UI")

  return [...commandChecks, botPathCheck, apiCheck, wsCheck]
}

function getLocalSnapshot() {
  runtimeState.lastHeartbeat = new Date().toISOString()

  return {
    ...runtimeState,
  }
}

async function getSnapshot() {
  const config = await readConfig()
  const remoteSnapshot = await fetchRemoteSnapshot(config)

  if (remoteSnapshot) {
    return remoteSnapshot
  }

  return getLocalSnapshot()
}

async function performBotAction(action) {
  const config = await readConfig()
  const remoteResult = await tryRemoteAction(config, action)

  if (remoteResult) {
    return remoteResult
  }

  switch (action) {
    case "start":
      runtimeState.status = "running"
      runtimeState.activeWorkers = Math.min(8, runtimeState.activeWorkers + 1)
      await appendLog("Bot run started by operator")
      break
    case "pause":
      runtimeState.status = "paused"
      await appendLog("Bot run paused", "WARN")
      break
    case "resume":
      runtimeState.status = "running"
      await appendLog("Bot resumed")
      break
    case "stop":
      runtimeState.status = "stopped"
      runtimeState.activeWorkers = 0
      await appendLog("Bot stopped by operator", "WARN")
      break
    case "sync":
      runtimeState.queueDepth = Math.max(0, runtimeState.queueDepth - 2)
      runtimeState.jobsProcessed += 3
      runtimeState.successRate = Math.min(99.9, runtimeState.successRate + 0.1)
      await appendLog("Manual sync completed")
      break
    default:
      await appendLog("Unknown action ignored", "WARN")
      break
  }

  runtimeState.lastHeartbeat = new Date().toISOString()

  return {
    ok: true,
    message: `Action '${action}' completed locally (remote endpoint unavailable)`,
    snapshot: getLocalSnapshot(),
  }
}

async function getCombinedLogs() {
  const config = await readConfig()
  const remoteLogs = await fetchRemoteLogs(config)
  const localLogs = await readLocalLogs(120)

  if (remoteLogs.length === 0) {
    return localLogs
  }

  return [...localLogs.slice(-40), ...remoteLogs.slice(-210)]
}

async function getConnectionStatus() {
  const config = await readConfig()

  connectionState.apiEndpoint = normalizeHttpEndpoint(config.apiEndpoint)

  if (!connectionState.wsEndpoint) {
    connectionState.wsEndpoint = toWebSocketEndpoint(config)
  }

  return copyConnectionState()
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 1160,
    minHeight: 720,
    show: false,
    title: "ClawDBot Studio",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  })

  mainWindow.once("ready-to-show", () => {
    mainWindow.show()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"))
  }
}

ipcMain.handle("app:meta", async () => {
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    platform: process.platform,
  }
})

ipcMain.handle("config:read", async () => readConfig())
ipcMain.handle("config:write", async (_event, config) => saveConfig(config))
ipcMain.handle("setup:runChecks", async (_event, botPath) => runSetupChecks(botPath))
ipcMain.handle("bot:snapshot", async () => getSnapshot())
ipcMain.handle("bot:action", async (_event, action) => performBotAction(action))
ipcMain.handle("logs:get", async () => getCombinedLogs())
ipcMain.handle("connection:test", async () => {
  const config = await readConfig()
  const status = await probeApiConnection(config)

  if (status.apiReachable) {
    await fetchRemoteSnapshot(config)
  }

  return status
})
ipcMain.handle("connection:status", async () => getConnectionStatus())
ipcMain.handle("connection:connectWs", async () => {
  const config = await readConfig()
  return connectWebSocket(config)
})
ipcMain.handle("connection:disconnectWs", async () => disconnectWebSocket())
ipcMain.handle("docs:open", async (_event, url) => {
  if (typeof url !== "string" || !url.startsWith("https://")) {
    return { ok: false }
  }

  await shell.openExternal(url)
  await appendLog(`Opened docs link: ${url}`)

  return { ok: true }
})

app.whenReady().then(async () => {
  const savedConfig = await saveConfig(await readConfig())
  await ensureLogsFile()
  await probeApiConnection(savedConfig)

  if (savedConfig.autoReconnect) {
    await connectWebSocket(savedConfig)
  }

  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on("window-all-closed", async () => {
  await disconnectWebSocket()

  if (process.platform !== "darwin") {
    app.quit()
  }
})
