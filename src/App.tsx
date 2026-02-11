import { useEffect, useMemo, useRef, useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  Activity,
  Bot,
  Cable,
  ChartNoAxesCombined,
  CircleHelp,
  CloudUpload,
  Cpu,
  Gauge,
  Play,
  PlugZap,
  RefreshCw,
  Square,
  Terminal,
  Unplug,
  Workflow,
} from "lucide-react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Progress,
  Separator,
  Switch,
  Textarea,
} from "@/components/ui"
import type {
  AppMeta,
  BotAction,
  BotSnapshot,
  CheckStatus,
  ConnectionStatus,
  SetupCheckResult,
  StudioConfig,
} from "@/types/studio"

type Section = "overview" | "visualizer" | "controls" | "setup" | "logs" | "guides"

interface NavItem {
  id: Section
  label: string
  description: string
  icon: LucideIcon
}

interface ThroughputPoint {
  time: string
  jobs: number
  success: number
}

const navItems: NavItem[] = [
  { id: "overview", label: "Overview", description: "Runtime health", icon: Gauge },
  { id: "visualizer", label: "Visualizer", description: "Trends and throughput", icon: ChartNoAxesCombined },
  { id: "controls", label: "Controls", description: "Operate bot actions", icon: Workflow },
  { id: "setup", label: "Setup", description: "Configure environment", icon: Cable },
  { id: "logs", label: "Logs", description: "Runtime and setup logs", icon: Terminal },
  { id: "guides", label: "Guides", description: "Onboarding and docs", icon: CircleHelp },
]

const queuePreview = [
  { id: "JOB-4412", type: "Lead scrape", status: "Queued", eta: "03m" },
  { id: "JOB-4413", type: "Email enrichment", status: "Running", eta: "01m" },
  { id: "JOB-4414", type: "Entity dedupe", status: "Queued", eta: "04m" },
  { id: "JOB-4415", type: "CRM sync", status: "Blocked", eta: "n/a" },
]

const defaultConfig: StudioConfig = {
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

const defaultConnection: ConnectionStatus = {
  mode: "local",
  apiReachable: false,
  apiEndpoint: "",
  apiLatencyMs: null,
  wsConnected: false,
  wsEndpoint: "",
  lastCheck: null,
  lastEventAt: null,
  lastError: null,
}

function statusVariant(status: CheckStatus): "success" | "destructive" | "secondary" {
  if (status === "pass") {
    return "success"
  }

  if (status === "fail") {
    return "destructive"
  }

  return "secondary"
}

function toLocalTimeLabel(input?: string) {
  const date = input ? new Date(input) : new Date()

  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function App() {
  const studioAPI = window.studioAPI

  const [activeSection, setActiveSection] = useState<Section>("overview")
  const [config, setConfig] = useState<StudioConfig>(defaultConfig)
  const [setupChecks, setSetupChecks] = useState<SetupCheckResult[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [snapshot, setSnapshot] = useState<BotSnapshot | null>(null)
  const [connection, setConnection] = useState<ConnectionStatus>(defaultConnection)
  const [appMeta, setAppMeta] = useState<AppMeta | null>(null)
  const [throughput, setThroughput] = useState<ThroughputPoint[]>([
    { time: "09:00", jobs: 11, success: 91.8 },
    { time: "09:30", jobs: 14, success: 92.2 },
    { time: "10:00", jobs: 18, success: 93.1 },
    { time: "10:30", jobs: 17, success: 92.4 },
    { time: "11:00", jobs: 20, success: 94.3 },
  ])

  const [statusMessage, setStatusMessage] = useState("Ready")
  const [savingConfig, setSavingConfig] = useState(false)
  const [runningChecks, setRunningChecks] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [togglingWs, setTogglingWs] = useState(false)

  const lastJobsProcessedRef = useRef<number | null>(null)
  const logPollCounterRef = useRef(0)

  useEffect(() => {
    let active = true

    const bootstrap = async () => {
      if (!studioAPI) {
        setStatusMessage("Desktop bridge not detected. Start via npm run dev.")
        return
      }

      const [savedConfig, meta, nextLogs, nextSnapshot, nextConnection] = await Promise.all([
        studioAPI.readConfig(),
        studioAPI.getAppMeta(),
        studioAPI.getLogs(),
        studioAPI.getSnapshot(),
        studioAPI.getConnectionStatus(),
      ])

      if (!active) {
        return
      }

      setConfig(savedConfig)
      setAppMeta(meta)
      setLogs(nextLogs)
      setSnapshot(nextSnapshot)
      setConnection(nextConnection)
      lastJobsProcessedRef.current = nextSnapshot.jobsProcessed

      setThroughput((prev) => [
        ...prev.slice(-11),
        {
          time: toLocalTimeLabel(nextSnapshot.lastHeartbeat),
          jobs: Math.max(1, nextSnapshot.activeWorkers),
          success: Number(nextSnapshot.successRate.toFixed(1)),
        },
      ])
    }

    bootstrap().catch((error) => {
      const detail = error instanceof Error ? error.message : "Unknown bootstrap error"
      setStatusMessage(`Bootstrap failed: ${detail}`)
    })

    return () => {
      active = false
    }
  }, [studioAPI])

  useEffect(() => {
    if (!studioAPI) {
      return
    }

    let active = true

    const tick = async () => {
      try {
        const [nextConnection, nextSnapshot] = await Promise.all([
          studioAPI.getConnectionStatus(),
          studioAPI.getSnapshot(),
        ])

        if (!active) {
          return
        }

        setConnection(nextConnection)
        setSnapshot(nextSnapshot)

        const previousJobs = lastJobsProcessedRef.current
        const jobsDelta = previousJobs === null ? Math.max(1, nextSnapshot.activeWorkers) : Math.max(0, nextSnapshot.jobsProcessed - previousJobs)
        lastJobsProcessedRef.current = nextSnapshot.jobsProcessed

        setThroughput((prev) => [
          ...prev.slice(-11),
          {
            time: toLocalTimeLabel(nextSnapshot.lastHeartbeat),
            jobs: Math.min(40, jobsDelta),
            success: Number(nextSnapshot.successRate.toFixed(1)),
          },
        ])

        logPollCounterRef.current += 1

        if (logPollCounterRef.current % 3 === 0) {
          const nextLogs = await studioAPI.getLogs()

          if (!active) {
            return
          }

          setLogs(nextLogs)
        }
      } catch (error) {
        if (!active) {
          return
        }

        const detail = error instanceof Error ? error.message : "Unknown refresh error"
        setStatusMessage(`Live refresh error: ${detail}`)
      }
    }

    tick()

    const intervalMs = Math.max(2000, config.pollingIntervalMs)
    const intervalId = window.setInterval(tick, intervalMs)

    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [studioAPI, config.pollingIntervalMs])

  const healthScore = useMemo(() => {
    const passCount = setupChecks.filter((check) => check.status === "pass").length
    const checkWeight = setupChecks.length > 0 ? (passCount / setupChecks.length) * 25 : 12
    const runtimeWeight = snapshot ? snapshot.successRate * 0.6 : 50
    const connectivityWeight = connection.apiReachable ? 15 : connection.wsConnected ? 8 : 2

    return Math.min(100, Number((checkWeight + runtimeWeight + connectivityWeight).toFixed(1)))
  }, [setupChecks, snapshot, connection.apiReachable, connection.wsConnected])

  const activeRuns = snapshot?.status === "running" ? snapshot.activeWorkers : 0

  const updateConfig = <K extends keyof StudioConfig>(key: K, value: StudioConfig[K]) => {
    setConfig((current) => ({
      ...current,
      [key]: value,
    }))
  }

  const refreshLogs = async () => {
    if (!studioAPI) {
      setStatusMessage("Desktop bridge not detected. Start via npm run dev.")
      return
    }

    const nextLogs = await studioAPI.getLogs()
    setLogs(nextLogs)
  }

  const refreshConnection = async () => {
    if (!studioAPI) {
      return
    }

    const nextConnection = await studioAPI.getConnectionStatus()
    setConnection(nextConnection)
  }

  const testConnection = async () => {
    if (!studioAPI) {
      setStatusMessage("Desktop bridge not detected. Start via npm run dev.")
      return
    }

    setTestingConnection(true)

    try {
      const nextConnection = await studioAPI.testConnection()
      setConnection(nextConnection)

      if (nextConnection.apiReachable) {
        setStatusMessage(`API reachable (${nextConnection.apiLatencyMs ?? "?"} ms)`)
      } else {
        setStatusMessage(nextConnection.lastError || "API is not reachable")
      }
    } finally {
      setTestingConnection(false)
    }
  }

  const toggleWebSocket = async () => {
    if (!studioAPI) {
      setStatusMessage("Desktop bridge not detected. Start via npm run dev.")
      return
    }

    setTogglingWs(true)

    try {
      const nextConnection = connection.wsConnected
        ? await studioAPI.disconnectWebSocket()
        : await studioAPI.connectWebSocket()

      setConnection(nextConnection)
      setStatusMessage(nextConnection.wsConnected ? "WebSocket connected" : "WebSocket disconnected")
    } finally {
      setTogglingWs(false)
    }
  }

  const runChecks = async () => {
    if (!studioAPI) {
      setStatusMessage("Desktop bridge not detected. Start via npm run dev.")
      return
    }

    setRunningChecks(true)

    try {
      const results = await studioAPI.runSetupChecks(config.botPath)
      setSetupChecks(results)
      setStatusMessage("Setup checks completed")
      await Promise.all([refreshLogs(), refreshConnection()])
    } finally {
      setRunningChecks(false)
    }
  }

  const saveConfiguration = async () => {
    if (!studioAPI) {
      setStatusMessage("Desktop bridge not detected. Start via npm run dev.")
      return
    }

    setSavingConfig(true)

    try {
      const saved = await studioAPI.saveConfig(config)
      setConfig(saved)
      setStatusMessage("Configuration saved")
      await refreshConnection()
    } finally {
      setSavingConfig(false)
    }
  }

  const performAction = async (action: BotAction) => {
    if (!studioAPI) {
      setStatusMessage("Desktop bridge not detected. Start via npm run dev.")
      return
    }

    const result = await studioAPI.performBotAction(action)
    setSnapshot(result.snapshot)
    setStatusMessage(result.message)
    await refreshLogs()
  }

  const openDocs = async (url: string) => {
    if (!studioAPI) {
      setStatusMessage("Desktop bridge not detected. Start via npm run dev.")
      return
    }

    const result = await studioAPI.openExternalDocs(url)

    if (!result.ok) {
      setStatusMessage("Unable to open documentation link")
      return
    }

    setStatusMessage("Documentation opened in your browser")
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-[290px] border-r border-border/80 bg-white/80 px-4 py-6 backdrop-blur-sm lg:block">
        <div className="mb-6 px-2">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm uppercase tracking-[0.25em] text-muted-foreground">Desktop</p>
              <h1 className="text-xl font-bold">ClawDBot Studio</h1>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">Visual control center for live operations, setup, and diagnostics.</p>
        </div>

        <div className="space-y-2">
          {navItems.map(({ id, label, description, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                activeSection === id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-transparent bg-transparent hover:border-border hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Icon className="h-4 w-4" />
                {label}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            </button>
          ))}
        </div>

        <Card className="mt-6 border-primary/30 bg-gradient-to-br from-primary/10 to-secondary/15">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">System Health</CardTitle>
            <CardDescription>Readiness score from setup, connectivity, and runtime reliability.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-2 flex items-end justify-between">
              <span className="text-sm text-muted-foreground">Current</span>
              <span className="text-2xl font-bold">{healthScore}%</span>
            </div>
            <Progress value={healthScore} />
          </CardContent>
        </Card>
      </aside>

      <main className="flex-1 px-4 py-4 sm:px-7 sm:py-6">
        <header className="mb-4 rounded-xl border bg-white/70 p-4 shadow-panel backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold">{navItems.find((item) => item.id === activeSection)?.label}</h2>
              <p className="text-sm text-muted-foreground">{statusMessage}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="muted">
                <Activity className="mr-1 h-3.5 w-3.5" />
                {snapshot?.status ?? "idle"}
              </Badge>
              <Badge variant={connection.apiReachable ? "success" : "secondary"}>
                <Cable className="mr-1 h-3.5 w-3.5" />
                {connection.apiReachable ? "API online" : "API offline"}
              </Badge>
              <Badge variant={connection.wsConnected ? "success" : "secondary"}>
                <PlugZap className="mr-1 h-3.5 w-3.5" />
                {connection.wsConnected ? "WS live" : "WS idle"}
              </Badge>
              <Badge variant="secondary">
                <Cpu className="mr-1 h-3.5 w-3.5" />
                {activeRuns} workers
              </Badge>
            </div>
          </div>
        </header>

        {activeSection === "overview" && (
          <section className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Queue depth</CardDescription>
                  <CardTitle className="text-3xl">{snapshot?.queueDepth ?? 0}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Progress value={Math.min(100, ((snapshot?.queueDepth ?? 0) / 30) * 100)} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Success rate</CardDescription>
                  <CardTitle className="text-3xl">{snapshot ? snapshot.successRate.toFixed(1) : "0.0"}%</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">Target SLA &gt;= 93.0%</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Active workers</CardDescription>
                  <CardTitle className="text-3xl">{snapshot?.activeWorkers ?? 0}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">Autoscale cap: 8 workers</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Desktop runtime</CardDescription>
                  <CardTitle className="text-base">{appMeta ? `${appMeta.platform} · v${appMeta.appVersion}` : "Loading"}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    Electron {appMeta?.electronVersion ?? "--"} / Node {appMeta?.nodeVersion ?? "--"}
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Backend Connection</CardTitle>
                <CardDescription>Live API status, websocket stream, and quick recovery actions.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-md border p-3">
                    <p className="text-sm font-semibold">API Endpoint</p>
                    <p className="mt-1 text-xs text-muted-foreground break-all">{connection.apiEndpoint || "Not configured"}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant={connection.apiReachable ? "success" : "secondary"}>
                        {connection.apiReachable ? "Reachable" : "Unavailable"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{connection.apiLatencyMs ? `${connection.apiLatencyMs} ms` : "--"}</span>
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-sm font-semibold">WebSocket</p>
                    <p className="mt-1 text-xs text-muted-foreground break-all">{connection.wsEndpoint || "Auto: <api>/ws"}</p>
                    <div className="mt-2">
                      <Badge variant={connection.wsConnected ? "success" : "secondary"}>
                        {connection.wsConnected ? "Connected" : "Disconnected"}
                      </Badge>
                    </div>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-sm font-semibold">Last event</p>
                    <p className="mt-1 text-xs text-muted-foreground">{connection.lastEventAt || "No stream event yet"}</p>
                    <p className="mt-2 text-xs text-destructive">{connection.lastError || "No connection errors"}</p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={testConnection} disabled={testingConnection}>
                    <RefreshCw className="h-4 w-4" />
                    {testingConnection ? "Testing..." : "Test API"}
                  </Button>
                  <Button variant="outline" onClick={toggleWebSocket} disabled={togglingWs}>
                    {connection.wsConnected ? <Unplug className="h-4 w-4" /> : <PlugZap className="h-4 w-4" />}
                    {togglingWs ? "Updating..." : connection.wsConnected ? "Disconnect WS" : "Connect WS"}
                  </Button>
                  <Button variant="ghost" onClick={refreshLogs}>
                    <Terminal className="h-4 w-4" />
                    Pull logs
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
              <Card>
                <CardHeader>
                  <CardTitle>Live Throughput</CardTitle>
                  <CardDescription>Jobs processed and rolling success rate over time.</CardDescription>
                </CardHeader>
                <CardContent className="h-[290px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={throughput}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(22,45,74,0.14)" />
                      <XAxis dataKey="time" stroke="rgba(22,45,74,0.65)" tickLine={false} axisLine={false} />
                      <YAxis yAxisId="left" stroke="rgba(22,45,74,0.65)" tickLine={false} axisLine={false} />
                      <YAxis yAxisId="right" orientation="right" domain={[85, 100]} stroke="rgba(22,45,74,0.65)" tickLine={false} axisLine={false} />
                      <Tooltip />
                      <Line yAxisId="left" type="monotone" dataKey="jobs" stroke="hsl(188,79%,30%)" strokeWidth={2.5} dot={false} />
                      <Line yAxisId="right" type="monotone" dataKey="success" stroke="hsl(32,89%,58%)" strokeWidth={2.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Action Center</CardTitle>
                  <CardDescription>Common controls for bot operation.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button className="w-full justify-start" onClick={() => performAction("start")}>
                    <Play className="h-4 w-4" />
                    Start run
                  </Button>
                  <Button className="w-full justify-start" variant="secondary" onClick={() => performAction("pause")}>
                    <RefreshCw className="h-4 w-4" />
                    Pause
                  </Button>
                  <Button className="w-full justify-start" variant="outline" onClick={() => performAction("resume")}>
                    <Workflow className="h-4 w-4" />
                    Resume
                  </Button>
                  <Button className="w-full justify-start" variant="destructive" onClick={() => performAction("stop")}>
                    <Square className="h-4 w-4" />
                    Stop
                  </Button>
                  <Separator className="my-3" />
                  <Button className="w-full justify-start" variant="ghost" onClick={() => performAction("sync")}>
                    <RefreshCw className="h-4 w-4" />
                    Manual sync
                  </Button>
                </CardContent>
              </Card>
            </div>
          </section>
        )}

        {activeSection === "visualizer" && (
          <section className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Reliability Band</CardTitle>
                <CardDescription>Visualizes success rate movement and drift risk.</CardDescription>
              </CardHeader>
              <CardContent className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={throughput}>
                    <defs>
                      <linearGradient id="successGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(160,62%,47%)" stopOpacity={0.6} />
                        <stop offset="95%" stopColor="hsl(160,62%,47%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(22,45,74,0.14)" />
                    <XAxis dataKey="time" stroke="rgba(22,45,74,0.65)" tickLine={false} axisLine={false} />
                    <YAxis domain={[85, 100]} stroke="rgba(22,45,74,0.65)" tickLine={false} axisLine={false} />
                    <Tooltip />
                    <Area type="monotone" dataKey="success" stroke="hsl(160,62%,47%)" fill="url(#successGradient)" strokeWidth={2.5} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle>Failure Predictor</CardTitle>
                  <CardDescription>Early warning signals based on trend slope.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p className="flex items-center justify-between"><span>Retry spikes</span><Badge variant="secondary">Low</Badge></p>
                  <p className="flex items-center justify-between"><span>Queue stalls</span><Badge variant="secondary">Medium</Badge></p>
                  <p className="flex items-center justify-between"><span>API timeout risk</span><Badge variant="success">Stable</Badge></p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Resource Hotspots</CardTitle>
                  <CardDescription>Operational pressure by subsystem.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <div className="mb-1 flex justify-between text-sm"><span>Crawler</span><span>71%</span></div>
                    <Progress value={71} />
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-sm"><span>Parser</span><span>59%</span></div>
                    <Progress value={59} />
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-sm"><span>Exporter</span><span>42%</span></div>
                    <Progress value={42} />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Autopilot Rules</CardTitle>
                  <CardDescription>Smart actions based on runtime indicators.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p>1. If success drops below 90%, switch to safe mode and reduce workers.</p>
                  <p>2. If queue depth is above 25, trigger manual sync every 60s.</p>
                  <p>3. If API checks fail twice, enable reconnect strategy and notify user.</p>
                </CardContent>
              </Card>
            </div>
          </section>
        )}

        {activeSection === "controls" && (
          <section className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Runbook Controls</CardTitle>
                <CardDescription>Operate and tune bot behavior directly from desktop.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => performAction("start")}><Play className="h-4 w-4" />Start</Button>
                  <Button variant="secondary" onClick={() => performAction("pause")}><RefreshCw className="h-4 w-4" />Pause</Button>
                  <Button variant="outline" onClick={() => performAction("resume")}><Workflow className="h-4 w-4" />Resume</Button>
                  <Button variant="destructive" onClick={() => performAction("stop")}><Square className="h-4 w-4" />Stop</Button>
                  <Button variant="ghost" onClick={() => performAction("sync")}><RefreshCw className="h-4 w-4" />Sync now</Button>
                </div>

                <Separator />

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border p-3">
                    <p className="text-sm font-semibold">Safe mode</p>
                    <p className="mb-2 text-xs text-muted-foreground">Limit aggressive actions for safer processing.</p>
                    <Switch checked={config.safeMode} onCheckedChange={(value) => updateConfig("safeMode", value)} />
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-sm font-semibold">Auto reconnect</p>
                    <p className="mb-2 text-xs text-muted-foreground">Reconnect websocket if stream drops.</p>
                    <Switch checked={config.autoReconnect} onCheckedChange={(value) => updateConfig("autoReconnect", value)} />
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-sm font-semibold">Desktop notifications</p>
                    <p className="mb-2 text-xs text-muted-foreground">Receive status updates for run completions and failures.</p>
                    <Switch checked={config.desktopNotifications} onCheckedChange={(value) => updateConfig("desktopNotifications", value)} />
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-sm font-semibold">Autostart on launch</p>
                    <p className="mb-2 text-xs text-muted-foreground">Start bot automatically when desktop app opens.</p>
                    <Switch checked={config.autostart} onCheckedChange={(value) => updateConfig("autostart", value)} />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Queue Preview</CardTitle>
                <CardDescription>Current task list and estimated completion.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {queuePreview.map((item) => (
                  <div key={item.id} className="rounded-md border bg-background/80 p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold">{item.id}</span>
                      <Badge variant={item.status === "Blocked" ? "destructive" : "muted"}>{item.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{item.type}</p>
                    <p className="mt-1 text-xs">ETA: {item.eta}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        )}

        {activeSection === "setup" && (
          <section className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Setup Assistant</CardTitle>
                <CardDescription>Prepare ClawDBot environment and persist desktop configuration.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Bot source path</label>
                    <Input
                      value={config.botPath}
                      onChange={(event) => updateConfig("botPath", event.target.value)}
                      placeholder="/Users/you/projects/clawdbot"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Workspace path</label>
                    <Input
                      value={config.workspacePath}
                      onChange={(event) => updateConfig("workspacePath", event.target.value)}
                      placeholder="/Users/you/workspace"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Launch command</label>
                    <Input
                      value={config.launchCommand}
                      onChange={(event) => updateConfig("launchCommand", event.target.value)}
                      placeholder="python3 main.py"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">API endpoint</label>
                    <Input
                      value={config.apiEndpoint}
                      onChange={(event) => updateConfig("apiEndpoint", event.target.value)}
                      placeholder="http://127.0.0.1:5050"
                    />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-sm font-medium">WebSocket endpoint (optional)</label>
                    <Input
                      value={config.wsEndpoint}
                      onChange={(event) => updateConfig("wsEndpoint", event.target.value)}
                      placeholder="ws://127.0.0.1:5050/ws"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium">Polling interval (ms)</label>
                  <Input
                    type="number"
                    min={1000}
                    step={500}
                    value={config.pollingIntervalMs}
                    onChange={(event) => updateConfig("pollingIntervalMs", Number(event.target.value || "1000"))}
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={runChecks} disabled={runningChecks}>
                    <Activity className="h-4 w-4" />
                    {runningChecks ? "Running checks..." : "Run environment checks"}
                  </Button>
                  <Button variant="secondary" onClick={saveConfiguration} disabled={savingConfig}>
                    <CloudUpload className="h-4 w-4" />
                    {savingConfig ? "Saving..." : "Save configuration"}
                  </Button>
                  <Button variant="outline" onClick={testConnection} disabled={testingConnection}>
                    <RefreshCw className="h-4 w-4" />
                    {testingConnection ? "Testing..." : "Test API"}
                  </Button>
                  <Button variant="ghost" onClick={toggleWebSocket} disabled={togglingWs}>
                    {connection.wsConnected ? <Unplug className="h-4 w-4" /> : <PlugZap className="h-4 w-4" />}
                    {togglingWs ? "Updating..." : connection.wsConnected ? "Disconnect WS" : "Connect WS"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Check Results</CardTitle>
                <CardDescription>Verify local setup and backend reachability before first launch.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {setupChecks.length === 0 && <p className="text-sm text-muted-foreground">No checks yet. Run the assistant to validate prerequisites.</p>}
                {setupChecks.map((check) => (
                  <div key={check.name} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{check.name}</p>
                      <Badge variant={statusVariant(check.status)}>{check.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{check.detail}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        )}

        {activeSection === "logs" && (
          <section className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Runtime Logs</CardTitle>
                <CardDescription>Recent local and remote backend events.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-3 flex gap-2">
                  <Button variant="secondary" onClick={refreshLogs}><RefreshCw className="h-4 w-4" />Refresh</Button>
                </div>
                <Textarea
                  className="min-h-[360px] resize-none bg-slate-950 font-mono text-xs text-slate-100"
                  value={logs.length === 0 ? "No logs yet" : logs.join("\n")}
                  readOnly
                />
              </CardContent>
            </Card>
          </section>
        )}

        {activeSection === "guides" && (
          <section className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>New User Setup Flow</CardTitle>
                <CardDescription>Recommended onboarding order for first-time users.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>1. Clone your ClawDBot repo and set path in Setup Assistant.</p>
                <p>2. Set API endpoint and optional websocket endpoint.</p>
                <p>3. Run environment checks and API test, then save configuration.</p>
                <p>4. Start a dry run from Controls and monitor the Visualizer + Logs.</p>
                <Button variant="outline" onClick={() => openDocs("https://www.electronjs.org/docs/latest")}>Open Electron docs</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Power Features</CardTitle>
                <CardDescription>Capabilities available in this starter.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>1. IPC bridge for config persistence and runtime actions.</p>
                <p>2. Live API health checks with latency tracking.</p>
                <p>3. WebSocket stream support with optional auto-reconnect.</p>
                <p>4. Remote log ingestion with local fallback.</p>
                <p>5. Setup assistant with compatibility and path checks.</p>
                <Button variant="outline" onClick={() => openDocs("https://ui.shadcn.com/docs")}>Open shadcn docs</Button>
              </CardContent>
            </Card>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
