const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("studioAPI", {
  getAppMeta: () => ipcRenderer.invoke("app:meta"),
  readConfig: () => ipcRenderer.invoke("config:read"),
  saveConfig: (config) => ipcRenderer.invoke("config:write", config),
  runSetupChecks: (botPath) => ipcRenderer.invoke("setup:runChecks", botPath),
  getSnapshot: () => ipcRenderer.invoke("bot:snapshot"),
  performBotAction: (action) => ipcRenderer.invoke("bot:action", action),
  getLogs: () => ipcRenderer.invoke("logs:get"),
  testConnection: () => ipcRenderer.invoke("connection:test"),
  getConnectionStatus: () => ipcRenderer.invoke("connection:status"),
  connectWebSocket: () => ipcRenderer.invoke("connection:connectWs"),
  disconnectWebSocket: () => ipcRenderer.invoke("connection:disconnectWs"),
  openExternalDocs: (url) => ipcRenderer.invoke("docs:open", url),
})
