const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),

  testSql: (sqlCfg) => ipcRenderer.invoke('test:sql', sqlCfg),
  testGraph: (graphCfg) => ipcRenderer.invoke('test:graph', graphCfg),

  listDatabases: (sqlCfg) => ipcRenderer.invoke('sql:listDatabases', sqlCfg),
  listTables: (sqlCfg) => ipcRenderer.invoke('sql:listTables', sqlCfg),
  listColumns: (sqlCfg, tableName) => ipcRenderer.invoke('sql:listColumns', sqlCfg, tableName),

  sendEmail: (payload) => ipcRenderer.invoke('email:send', payload),

  refresh: () => ipcRenderer.invoke('refresh'),
  getHistoryDays: () => ipcRenderer.invoke('history:getDays'),
  getHistoryDay: (dateStr) => ipcRenderer.invoke('history:getDay', dateStr),
  getSchedule30: () => ipcRenderer.invoke('schedule:get30days'),

  listJobs: () => ipcRenderer.invoke('jobs:list'),
  getJobExecutions: (jobName, limit) => ipcRenderer.invoke('jobs:get-executions', jobName, limit),

  onAutoUpdate: (cb) => {
    const handler = (_event, payload) => cb(payload)
    ipcRenderer.on('auto:update', handler)
    return () => ipcRenderer.removeListener('auto:update', handler)
  },
})