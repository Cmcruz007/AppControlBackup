const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (cfg) => ipcRenderer.invoke("config:save", cfg),
  getHistory: () => ipcRenderer.invoke("history:get"),
  testSql: (cfg) => ipcRenderer.invoke("test:sql", cfg),
  testGraph: (cfg) => ipcRenderer.invoke("test:graph", cfg),
  listDatabases: (cfg) => ipcRenderer.invoke("sql:listDatabases", cfg),
  listTables: (cfg) => ipcRenderer.invoke("sql:listTables", cfg),
  refresh: () => ipcRenderer.invoke("refresh"),
  onAutoUpdate: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("auto:update", handler);
    return () => ipcRenderer.removeListener("auto:update", handler);
  },
});
