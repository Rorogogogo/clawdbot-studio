export type CheckStatus = "pass" | "fail" | "warning"

export type BotAction = "start" | "pause" | "resume" | "stop" | "sync"

export type ConnectionMode = "local" | "remote"

export interface StudioConfig {
  botPath: string
  launchCommand: string
  apiEndpoint: string
  wsEndpoint: string
  workspacePath: string
  autostart: boolean
  desktopNotifications: boolean
  safeMode: boolean
  autoReconnect: boolean
  pollingIntervalMs: number
}

export interface SetupCheckResult {
  name: string
  status: CheckStatus
  detail: string
}

export interface BotSnapshot {
  status: "idle" | "running" | "paused" | "stopped"
  queueDepth: number
  jobsProcessed: number
  successRate: number
  activeWorkers: number
  lastHeartbeat: string
}

export interface ActionResult {
  ok: boolean
  message: string
  snapshot: BotSnapshot
}

export interface ConnectionStatus {
  mode: ConnectionMode
  apiReachable: boolean
  apiEndpoint: string
  apiLatencyMs: number | null
  wsConnected: boolean
  wsEndpoint: string
  lastCheck: string | null
  lastEventAt: string | null
  lastError: string | null
}

export interface AppMeta {
  appVersion: string
  electronVersion: string
  nodeVersion: string
  platform: string
}

export interface StudioAPI {
  getAppMeta: () => Promise<AppMeta>
  readConfig: () => Promise<StudioConfig>
  saveConfig: (config: StudioConfig) => Promise<StudioConfig>
  runSetupChecks: (botPath: string) => Promise<SetupCheckResult[]>
  getSnapshot: () => Promise<BotSnapshot>
  performBotAction: (action: BotAction) => Promise<ActionResult>
  getLogs: () => Promise<string[]>
  testConnection: () => Promise<ConnectionStatus>
  getConnectionStatus: () => Promise<ConnectionStatus>
  connectWebSocket: () => Promise<ConnectionStatus>
  disconnectWebSocket: () => Promise<ConnectionStatus>
  openExternalDocs: (url: string) => Promise<{ ok: boolean }>
}
