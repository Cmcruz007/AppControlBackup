declare global {
  interface Window {
    api: {
      getConfig: () => Promise<AppConfig | null>;
      saveConfig: (cfg: AppConfig) => Promise<boolean>;
      getHistory: () => Promise<{ lastRun: string | null; windowStart?: string | null; windowEnd?: string | null; results: JobRow[] }>;
      testSql: (cfg: SqlConfig) => Promise<{ ok: boolean; info?: any; error?: string }>;
      testGraph: (cfg: GraphConfig) => Promise<{ ok: boolean; info?: any; error?: string }>;
      listDatabases: (cfg: SqlConfig) => Promise<{ ok: boolean; databases?: string[]; error?: string }>;
      listTables: (cfg: SqlConfig) => Promise<{ ok: boolean; info?: any; error?: string }>;
      refresh: () => Promise<RefreshPayload>;
      onAutoUpdate: (cb: (p: RefreshPayload) => void) => () => void;
    };
  }
}

export interface SqlConfig {
  host: string;
  instance?: string;
  port?: number;
  database?: string;
  user: string;
  password: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
}
export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mailbox: string;          // p.ej. backup@uci.com
  fromFilter?: string;      // p.ej. veeambackup@uci.com
  sinceHours?: number;      // ventana de búsqueda (default 36)
}
export interface AppConfig {
  pin?: string;
  sql?: SqlConfig;
  graph?: GraphConfig;
  refreshMinutes?: number;
  toleranceMinutes?: number;
}
// Tipo legacy mantenido por compatibilidad de import en otros sitios; no se usa.
export interface ImapConfig {
  host?: string; port?: number; secure?: boolean; user: string; password: string; mailbox?: string; fromFilter?: string;
}
export interface EmailHit {
  uid: number | string;
  date: string;
  subject: string;
  status: "success" | "warning" | "failed";
  jobName: string;
  startTime?: string | null;
  from: string;
}
export interface JobRow {
  jobId: string;
  jobName: string;
  nextRun: string | null;
  lastRun: string | null;
  lastResult: number | null;
  status: string;
  reason: string;
  durationMs: number | null;
  email: EmailHit | null;
  allEmails: EmailHit[];
}
export interface RefreshPayload {
  ok: boolean;
  ts?: string;
  windowStart?: string;
  windowEnd?: string;
  rows?: JobRow[];
  jobsCount?: number;
  emailsCount?: number;
  error?: string;
}
export {};
