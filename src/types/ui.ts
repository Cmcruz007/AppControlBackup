import type { AppConfig, JobRow, RefreshPayload, HistoryPayload } from "../types"

export const JOB_CATEGORIES = [
  { id: 'all', label: 'TODOS' },
  { id: 'veeam', label: 'VEEAM BACKUP' },
  { id: 'vdc', label: 'VDC' },
  { id: 'barracuda', label: 'BARRACUDA' },
  { id: 'as400', label: 'AS400' },
  { id: 'nok', label: 'NOK' }
] as const

export type CategoryFilter = typeof JOB_CATEGORIES[number]['id']
export type Tab = "dashboard" | "history" | "executions"
export type SortKey = "status" | "jobName" | "nextRun" | "source" | "duration" | "reason"
export type SortDir = "asc" | "desc"
export type ConfigTab = "general" | "criticality" | "veeamDataCloud" | "barracuda" | "as400"
export type DashboardKpiFilter = "all" | "success" | "warning" | "failed" | "running" | "pending"

export interface ManualOverride {
  status: string
  comment?: string
}

export type JobRowUi = JobRow & {
  source?: "email" | "sql" | null
  criticality?: "high" | "medium" | "low" | string | null
  relaunched?: boolean
  durationMs?: number | null
  nextRun?: string | null
  lastRun?: string | null
  reason?: string | null
  email?: { subject?: string; date?: string } | null
  durationTrend?: "up" | "down" | "same" | null
}

export interface KpiProps {
  label: string
  value: number
  accentColor?: string
  active?: boolean
  onClick?: () => void
}

export interface JobExecutionItem {
  id: string
  start: string | null
  end: string | null
  startDisplay: string | null
  endDisplay: string | null
  duration: string | null
  status: string
  result: number | null
}

export interface JobExecutionsResponse {
  ok: boolean
  jobName: string
  totalExecutions: number
  finalStatus: string
  hasSuccess: boolean
  executions: JobExecutionItem[]
  error?: string
}

export type Api = {
  getConfig: () => Promise<AppConfig | null>
  saveConfig: (cfg: AppConfig) => Promise<boolean>
  refresh: () => Promise<RefreshPayload | null>
  getHistoryDays: () => Promise<any>
  getHistoryDay: (dateStr: string) => Promise<HistoryPayload | any>
  getSchedule30: () => Promise<any>
  sendEmail: (payload: any) => Promise<any>
  getJobExecutions: (jobName: string, limit?: number) => Promise<any>
  listJobs: () => Promise<any>
  testSql: (sqlCfg: any) => Promise<any>
  testGraph: (graphCfg: any) => Promise<any>
  listDatabases: (sqlCfg: any) => Promise<any>
  listTables: (sqlCfg: any) => Promise<any>
  listColumns: (sqlCfg: any, tableName: string) => Promise<any>
  onAutoUpdate?: (cb: (payload: RefreshPayload) => void) => (() => void) | void
}

export type { AppConfig, JobRow, RefreshPayload, HistoryPayload }