export type JobStatus =
  | 'success'
  | 'warning'
  | 'failed'
  | 'running'
  | 'pending'
  | 'missing'
  | 'unknown'

export type Criticality = 'high' | 'medium' | 'low'

export type SortKey =
  | 'status'
  | 'jobName'
  | 'nextRun'
  | 'email'
  | 'duration'
  | 'reason'
  | 'source'

export type SortDir = 'asc' | 'desc'

export interface SqlConfig {
  host: string
  instance?: string
  port: number
  database: string
  user: string
  password: string
  encrypt: boolean
  trustServerCertificate: boolean
}

export interface GraphConfig {
  tenantId: string
  clientId: string
  clientSecret: string
  mailbox: string
  fromFilter?: string
  sinceHours: number
}

export interface ManualOverride {
  status?: 'success' | 'warning' | 'failed' | 'running' | 'pending'
  comment?: string
  timestamp?: string
}

export interface JobEmailMatch {
  subject: string
  date: string | null
  status?: 'success' | 'failed' | 'warning' | 'unknown'
}

export interface JobRow {
  jobId: string
  jobName: string
  nextRun: string | null
  lastRun: string | null
  lastResult: number | null
  status: JobStatus
  reason: string
  source?: 'email' | 'sql'
  durationMs: number | null
  duration?: string
  startTimeDisplay?: string
  endTimeDisplay?: string
  relaunched: boolean
  email: JobEmailMatch | null
  allEmails: JobEmailMatch[]
  criticality: Criticality
  durationTrend?: 'up' | 'down' | 'same' | null
}

export interface BackupJobExecution {
  id: string
  jobName?: string
  start?: string | null
  end?: string | null
  startDisplay?: string | null
  endDisplay?: string | null
  duration?: string | null
  status: JobStatus | string
  result?: number | string | null
}

export interface BasicOkResponse {
  ok: boolean
  error?: string
}

export interface JobExecutionsResponse extends BasicOkResponse {
  jobName?: string
  totalExecutions?: number
  finalStatus?: JobStatus | string
  hasSuccess?: boolean
  executions?: BackupJobExecution[]
}

export interface VeeamDataCloudRule {
  id: string
  title?: string
  sender: string
  subjectContains: string
  errorWord: string
  successWord: string
  enabled: boolean
}

export interface As400Rule {
  id: string
  title?: string
  sender: string
  subjectContains: string
  errorWord: string
  successWord: string
  enabled: boolean
  notes?: string
}

export interface AppConfig {
  sql?: SqlConfig
  graph?: GraphConfig
  refreshMinutes?: number
  toleranceMinutes?: number
  pin?: string
  manualOverrides?: Record<string, ManualOverride>
  criticalityByJob?: Record<string, Criticality>
  veeamDataCloudRules?: VeeamDataCloudRule[]
  barracudaRules?: VeeamDataCloudRule[]
  as400Rules?: As400Rule[]
}

export interface RefreshPayload {
  ok: boolean
  error?: string
  rows?: JobRow[]
  fullRows?: JobRow[]
  ts?: string
  windowStart?: string | null
  windowEnd?: string | null
}

export interface HistoryPayload {
  ok: boolean
  error?: string
  rows?: JobRow[]
  fullRows?: JobRow[]
  windowStart?: string | null
  windowEnd?: string | null
}

export interface TestSqlResponse extends BasicOkResponse {
  info?: {
    db?: string
    server?: string
  }
}

export interface TestGraphResponse extends BasicOkResponse {
  info?: {
    mailbox?: string
    messages?: number
  }
}

export interface ListDatabasesResponse extends BasicOkResponse {
  databases?: string[]
}

export interface SqlColumnInfo {
  name: string
  type: string
}

export interface SqlTableInfo {
  schema?: string
  name?: string
  full?: string
  type?: string
  columns?: SqlColumnInfo[]
  TABLE_NAME?: string
}

export interface ListTablesResponse extends BasicOkResponse {
  info?:
    | SqlTableInfo[]
    | {
        database?: string
        total?: number
        relevant?: SqlTableInfo[]
        all?: SqlTableInfo[]
      }
}

export interface ListColumnsResponse extends BasicOkResponse {
  columns?: string[]
}

export interface HistoryDaysResponse extends BasicOkResponse {
  days?: string[]
}

export interface ScheduleRow {
  job: string
  date: string
}

export interface Schedule30Response extends BasicOkResponse {
  rows?: ScheduleRow[]
}

export interface JobsListResponse extends BasicOkResponse {
  jobs?: string[]
}

export interface SendEmailPayload {
  to: string[] | string
  cc?: string[] | string
  bcc?: string[] | string
  subject: string
  bodyHtml: string
}

export interface ElectronApi {
  getConfig: () => Promise<AppConfig | null>
  saveConfig: (cfg: AppConfig) => Promise<boolean>
  testSql: (cfg: SqlConfig) => Promise<TestSqlResponse>
  testGraph: (cfg: GraphConfig) => Promise<TestGraphResponse>
  listDatabases: (cfg: SqlConfig) => Promise<ListDatabasesResponse>
  listTables: (cfg: SqlConfig) => Promise<ListTablesResponse>
  listColumns: (cfg: SqlConfig, tableName: string) => Promise<ListColumnsResponse>
  refresh: () => Promise<RefreshPayload>
  sendEmail: (payload: SendEmailPayload) => Promise<BasicOkResponse>
  onAutoUpdate?: (cb: (payload: RefreshPayload) => void) => (() => void) | void
  getHistoryDays: () => Promise<HistoryDaysResponse>
  getHistoryDay: (dateStr: string) => Promise<HistoryPayload>
  getSchedule30: () => Promise<Schedule30Response>
  listJobs: () => Promise<JobsListResponse>
  getJobExecutions: (jobName: string, limit?: number) => Promise<JobExecutionsResponse>
}

declare global {
  interface Window {
    api: ElectronApi
  }
}