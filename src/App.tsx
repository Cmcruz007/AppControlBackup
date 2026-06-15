import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"
import * as XLSX from "xlsx-js-style"
import { exportScheduleExcel } from "./scheduleExcel"
import type { AppConfig, JobRow, RefreshPayload, HistoryPayload } from "./types"
import Settings from "./Settings"
import CriticalityPanel from "./CriticalityPanel"
import VeeamDataCloudPanel from "./VeeamDataCloudPanel"
import BarracudaPanel from "./BarracudaPanel"
import As400Panel from "./As400Panel"

const JOB_CATEGORIES = [
	{ id: 'all', label: 'TODOS' },
	{ id: 'veeam', label: 'VEEAM BACKUP' },
	{ id: 'vdc', label: 'VDC' },
	{ id: 'barracuda', label: 'BARRACUDA' },
	{ id: 'as400', label: 'AS400' },
	{ id: 'nok', label: 'NOK' }
] as const;

type CategoryFilter = typeof JOB_CATEGORIES[number]['id'];
type Tab = "dashboard" | "history" | "executions"
type SortKey = "status" | "jobName" | "nextRun" | "source" | "duration" | "reason"
type SortDir = "asc" | "desc"
type ConfigTab = "general" | "criticality" | "veeamDataCloud" | "barracuda" | "as400"
type DashboardKpiFilter = "all" | "success" | "warning" | "failed" | "running" | "pending"

interface ManualOverride {
	status: string
	comment?: string
}

type JobRowUi = JobRow & {
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

interface KpiProps {
	label: string
	value: number
	accentColor?: string
	active?: boolean
	onClick?: () => void
}

interface JobExecutionItem {
	id: string
	start: string | null
	end: string | null
	startDisplay: string | null
	endDisplay: string | null
	duration: string | null
	status: string
	result: number | null
}

interface JobExecutionsResponse {
	ok: boolean
	jobName: string
	totalExecutions: number
	finalStatus: string
	hasSuccess: boolean
	executions: JobExecutionItem[]
	error?: string
}

type Api = {
	getConfig: () => Promise<AppConfig | null>
	saveConfig: (cfg: AppConfig) => Promise<boolean>
	refresh: () => Promise<RefreshPayload | null>
	getHistoryDays: () => Promise<any>
	getHistoryDay: (dateStr: string) => Promise<HistoryPayload | any>
	getSchedule30: () => Promise<any>
	sendEmail: (payload: any) => Promise<any>
	getJobExecutions: (jobName: string, limit?: number) => Promise<any>
	listJobs: () => Promise<any>
	onAutoUpdate?: (cb: (payload: RefreshPayload) => void) => (() => void) | void
}

const api = () => (window as any).api as Api

function safeLower(value: unknown) {
	return String(value ?? "").toLowerCase()
}

function normalizeCriticality(value?: string | null) {
	if (value === "high" || value === "medium" || value === "low") return value
	return "low"
}

function criticalityLabel(value?: string | null) {
	const v = normalizeCriticality(value)
	if (v === "high") return "Alta"
	if (v === "medium") return "Media"
	return "Baja"
}

function pad2(n: number) {
	return String(n).padStart(2, "0");
}

function formatLocal(iso?: string | null | undefined): string {
	if (!iso) return "—";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "—";
	return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatDuration(ms?: number | null) {
	if (ms == null || Number.isNaN(ms)) return "—"
	const totalMin = Math.max(0, Math.round(ms / 60000))
	const hh = String(Math.floor(totalMin / 60)).padStart(2, "0")
	const mm = String(totalMin % 60).padStart(2, "0")
	return `${hh}:${mm}`
}

function sourceLabel(source?: JobRowUi["source"] | "both") {
	if (source === "both") return "SQL + Email"
	if (source === "email") return "Email"
	if (source === "sql") return "SQL"
	return "—"
}

function buildKpis(rows: JobRowUi[]) {
	const total = rows.length
	const success = rows.filter((r) => r.status === "success").length
	const warning = rows.filter((r) => r.status === "warning").length
	const failed = rows.filter((r) => r.status === "failed").length
	const running = rows.filter((r) => r.status === "running").length
	const pending = rows.filter((r) => r.status === "pending").length

	return { total, success, warning, failed, running, pending }
}

function getWindowParts(start: string | null, end: string | null) {
	if (!start || !end) return { day: "", range: "" }

	const s = new Date(start)
	const e = new Date(end)

	const day = s
		.toLocaleDateString("es-ES", {
			day: "numeric",
			month: "long",
			year: "numeric",
		})
		.toUpperCase()

	const range = `Ventana ${s.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} ${s.toLocaleDateString("es-ES")} - ${e.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} ${e.toLocaleDateString("es-ES")}`

	return { day, range }
}

function statusOrder(status: string) {
	const map: Record<string, number> = {
		failed: 0,
		warning: 1,
		running: 2,
		pending: 3,
		missing: 4,
		success: 5,
	}
	return map[status] ?? 99
}

function normalizeManualStatusUi(status: string) {
	const s = safeLower(status).trim()
	if (["success", "ok", "éxito", "exito"].includes(s)) return "success"
	if (["warning", "warn", "aviso"].includes(s)) return "warning"
	if (["failed", "fail", "error", "fallido"].includes(s)) return "failed"
	if (["running", "ejecutando", "en curso"].includes(s)) return "running"
	if (["pending", "pendiente"].includes(s)) return "pending"
	return s || "success"
}

function sourceRank(source?: JobRowUi["source"] | "both") {
	if (source === "both") return 3
	if (source === "email") return 2
	if (source === "sql") return 1
	return 0
}

function escapeHtml(value: any): string {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function buildEmailHtml(
	rows: JobRowUi[],
	kpis: ReturnType<typeof buildKpis>,
	day: string,
	range: string
): string {
	const total = kpis.total ?? 0;
	const success = kpis.success ?? 0;
	const warning = kpis.warning ?? 0;
	const failed = kpis.failed ?? 0;
	const running = (kpis.running ?? 0) + (kpis.pending ?? 0);

	const statusOrderFn = (s: string) => (s === "failed" ? 0 : s === "warning" ? 1 : s === "running" ? 2 : s === "pending" ? 3 : 4);

	const emailRows = [...rows].sort((a, b) => {
		const aStatus = safeLower(a.status);
		const bStatus = safeLower(b.status);
		const aIsSuccess = aStatus === "success";
		const bIsSuccess = bStatus === "success";

		if (!aIsSuccess && bIsSuccess) return -1;
		if (aIsSuccess && !bIsSuccess) return 1;

		if (!aIsSuccess && !bIsSuccess) {
			const diff = statusOrderFn(aStatus) - statusOrderFn(bStatus);
			if (diff !== 0) return diff;
		}

		const tA = a.nextRun ? new Date(a.nextRun).getTime() : 0;
		const tB = b.nextRun ? new Date(b.nextRun).getTime() : 0;
		return tA - tB;
	});

	const kpiCards = [
		{ label: "TOTAL", value: total, bg: "1E3A5F", accent: "60A5FA" },
		{ label: "ÉXITOS", value: success, bg: "14532D", accent: "4ADE80" },
		{ label: "AVISOS", value: warning, bg: "78350F", accent: "FBBF24" },
		{ label: "ERRORES", value: failed, bg: "7F1D1D", accent: "F87171" },
		{ label: "EN CURSO", value: running, bg: "0C4A6E", accent: "38BDF8" },
	].map(k => `
		<td width="20%" style="padding:0 5px">
			<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#${k.bg}" style="border:2px solid #${k.accent};border-radius:8px">
				<tr>
					<td align="center" style="padding:14px 10px">
						<p style="margin:0;color:#${k.accent};font-size:30px;font-weight:800;font-family:Arial,sans-serif;line-height:1">${k.value}</p>
						<p style="margin:4px 0 0 0;color:#${k.accent};font-size:10px;font-weight:700;font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:1px">${k.label}</p>
					</td>
				</tr>
			</table>
		</td>`
	).join("");

	const tableRows = emailRows.map((r, i) => {
		const bg = i % 2 === 0 ? "0F172A" : "1E293B";
		const crit = r.criticality === "high" ? "#ef4444" : r.criticality === "medium" ? "#f59e0b" : "#22c55e";
		
		const s = safeLower(r.status);
		const statusColors: any = { 
			success: ["166534", "22C55E", "DCFCE7"], 
			warning: ["854D0E", "EAB308", "FEF9C3"], 
			failed: ["7F1D1D", "EF4444", "FECACA"],
			running: ["075985", "06B6D4", "E0F2FE"],
			pending: ["1E3A8A", "3B82F6", "DBEAFE"]
		};
		const sc = statusColors[s] || ["1E293B", "64748B", "F1F5F9"];
		
		const badge = r.relaunched
			? `&nbsp;&nbsp;<span style="background:#422006;color:#fbbf24;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;font-family:Arial,sans-serif;border:1px solid #d97706">↺ Relanzado</span>`
			: "";
			
		return `
			<tr bgcolor="#${bg}">
				<td style="padding:10px 12px; border-top:1px solid #1e3a5f;">
					<table cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#${sc[0]}" style="padding:4px 10px;border:1px solid #${sc[1]};border-radius:12px">
						<span style="color:#${sc[2]}; font-size:11px; font-weight:700; font-family:Arial,sans-serif; white-space:nowrap;">${escapeHtml(s.toUpperCase())}</span>
					</td></tr></table>
				</td>
				<td style="padding:10px 12px; border-top:1px solid #1e3a5f; font-size:13px; color:#f1f5f9; font-family:Arial,sans-serif;">
					<table cellpadding="0" cellspacing="0" border="0"><tr>
						<td width="14" valign="middle"><span style="display:inline-block; width:10px; height:10px; background:${crit}; border-radius:2px;"></span></td>
						<td valign="middle" style="font-size:13px; color:#f1f5f9; font-family:Arial,sans-serif;">${escapeHtml(r.jobName)}${badge}</td>
					</tr></table>
				</td>
				<td style="padding:10px 12px; border-top:1px solid #1e3a5f; font-size:12px; color:#94a3b8; font-family:Arial,sans-serif; min-width:120px; white-space:nowrap;">${escapeHtml(sourceLabel(r.source))}</td>
				<td style="padding:10px 12px; border-top:1px solid #1e3a5f; font-size:12px; color:#e2e8f0; font-family:'Courier New',monospace; min-width:140px; white-space:nowrap;">${escapeHtml(formatLocal(r.nextRun))}</td>
				<td style="padding:10px 12px; border-top:1px solid #1e3a5f; font-size:12px; color:#e2e8f0; font-family:'Courier New',monospace; text-align:center;">${escapeHtml(formatDuration(r.durationMs))}</td>
				<td style="padding:10px 12px; border-top:1px solid #1e3a5f; font-size:12px; color:#cbd5e1; font-family:Arial,sans-serif;">${escapeHtml(r.reason)}</td>
			</tr>`;
	}).join("");

	const hasIncidents = failed > 0 || warning > 0;
	const bannerBgColor = hasIncidents ? "DC2626" : "16A34A";
	const bannerText = hasIncidents ? "HAY INCIDENCIAS EN EL BACKUP DEL DÍA" : "TODOS LOS BACKUPS DEL DÍA SON CORRECTOS";
	const pct = total > 0 ? Math.round((success / total) * 100) : 0;
	const pctColor = pct === 100 ? "4ADE80" : pct >= 80 ? "FBBF24" : "F87171";

	return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background-color:#0a0f1e">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a0f1e">
	<tr>
	  <td align="center" style="padding:24px 16px">
		<table width="820" cellpadding="0" cellspacing="0" border="0" bgcolor="#0f172a" style="border:1px solid #1e3a5f;border-radius:14px;max-width:820px">
		  <tr>
			<td bgcolor="#1e3a5f" style="padding:30px 36px;border-radius:14px 14px 0 0">
			  <table width="100%" cellpadding="0" cellspacing="0" border="0">
				<tr>
				  <td>
					<p style="margin:0 0 6px 0;color:#60a5fa;font-size:10px;text-transform:uppercase;letter-spacing:2px;font-weight:700;font-family:Arial,sans-serif">🛡 BACKUP MONITOR PRO</p>
					<p style="margin:0;color:#ffffff;font-size:22px;font-weight:800;font-family:Arial,sans-serif">Informe de Backups</p>
					<p style="margin:4px 0 0 0;color:#fbbf24;font-size:15px;font-weight:700;font-family:Arial,sans-serif">${escapeHtml(day)}</p>
					<p style="margin:6px 0 0 0;color:#94a3b8;font-size:11px;font-family:Arial,sans-serif">${escapeHtml(range)}</p>
				  </td>
				  <td align="right" valign="top">
					<table cellpadding="0" cellspacing="0" border="0">
					  <tr>
						<td bgcolor="#0f172a" width="64" align="center" style="border:2px solid #${pctColor};border-radius:32px;padding:12px 8px">
						  <p style="margin:0;color:#${pctColor};font-size:18px;font-weight:800;font-family:Arial,sans-serif;line-height:1">${pct}%</p>
						  <p style="margin:2px 0 0 0;color:#94a3b8;font-size:9px;text-transform:uppercase;font-family:Arial,sans-serif">Éxito</p>
						</td>
					  </tr>
					</table>
				  </td>
				</tr>
			  </table>
			</td>
		  </tr>

		  <tr>
			<td bgcolor="#${bannerBgColor}" style="padding:18px 36px;">
			  <p style="margin:0;color:#ffffff;font-size:18px;font-weight:800;font-family:Arial,sans-serif;text-align:center;">${bannerText}</p>
			</td>
		  </tr>

		  <tr>
			<td bgcolor="#0a0f1e" style="padding:24px 36px;">
			  <table cellpadding="0" cellspacing="0" border="0" width="100%">
				<tr>${kpiCards}</tr>
			  </table>
			</td>
		  </tr>

		  <tr>
			<td style="padding:24px 36px">
			  <p style="margin:0 0 12px 0;color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;font-family:Arial,sans-serif">DETALLE DE JOBS</p>
			  <table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0f172a" style="border:1px solid #1e3a5f;border-radius:8px">
				<thead>
				  <tr bgcolor="#1e3a5f">
					<th align="left" style="padding:11px 12px;color:#60a5fa;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;font-family:Arial,sans-serif;white-space:nowrap">Estado</th>
					<th align="left" style="padding:11px 12px;color:#60a5fa;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;font-family:Arial,sans-serif">Job</th>
					<th align="left" style="padding:11px 12px;color:#60a5fa;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;font-family:Arial,sans-serif;white-space:nowrap">Fuente</th>
					<th align="left" style="padding:11px 12px;color:#60a5fa;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;font-family:Arial,sans-serif;white-space:nowrap">Inicio</th>
					<th align="center" style="padding:11px 12px;color:#60a5fa;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;font-family:Arial,sans-serif">Dur.</th>
					<th align="left" style="padding:11px 12px;color:#60a5fa;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;font-family:Arial,sans-serif">Detalle</th>
				  </tr>
				</thead>
				<tbody>${tableRows}</tbody>
			  </table>
			</td>
		  </tr>

		  <tr>
			<td bgcolor="#0a0f1e" style="padding:16px 36px;border-top:1px solid #1e3a5f;border-radius:0 0 14px 14px">
			  <table width="100%" cellpadding="0" cellspacing="0" border="0">
				<tr>
				  <td style="color:#475569;font-size:11px;font-family:Arial,sans-serif">Generado automáticamente · Backup Monitor Pro</td>
				  <td align="right" style="color:#475569;font-size:11px;font-family:Arial,sans-serif">${escapeHtml(new Date().toLocaleString("es-ES"))}</td>
				</tr>
			  </table>
			</td>
		  </tr>
		</table>
	  </td>
	</tr>
  </table>
</body>
</html>`;
}

function WhiteGearIcon({ size = 22 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<circle cx="12" cy="12" r="3" />
			<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.67 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.67 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.67a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1.51 1H15a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
			<path d="M21 7V5m-2 2h2m-2-2l1.5-1.5M17.5 3.5L16 2" opacity="0.6" />
		</svg>
	)
}

function SqlSourceIcon({ size = 16 }: { size?: number }) {
	const width = Math.round(size * 2.1)

	return (
		<svg width={width} height={size} viewBox="0 0 64 32" aria-label="SQL" role="img" style={{ display: "block" }}>
			<ellipse cx="16" cy="7" rx="10" ry="4" fill="none" stroke="currentColor" strokeWidth="2" />
			<path d="M6 7v12c0 2.2 4.5 4 10 4s10-1.8 10-4V7" fill="none" stroke="currentColor" strokeWidth="2" />
			<path d="M6 13c0 2.2 4.5 4 10 4s10-1.8 10-4" fill="none" stroke="currentColor" strokeWidth="2" />
			<path d="M6 19c0 2.2 4.5 4 10 4s10-1.8 10-4" fill="none" stroke="currentColor" strokeWidth="2" />
			<text x="31" y="22" fontSize="14" fontWeight="700" fontFamily="Arial, sans-serif" fill="currentColor">
				SQL
			</text>
		</svg>
	)
}

function SourceIcon({ source }: { source?: JobRowUi["source"] | "both" }) {
	const sqlIcon = (
		<span
			title="SQL"
			style={{ color: "#ffffff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
		>
			<SqlSourceIcon size={16} />
		</span>
	)

	const emailIcon = <span title="Email" style={{ color: "#ffffff", fontSize: 15 }}>✉</span>

	if (source === "both") {
		return (
			<div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
				{sqlIcon}
				{emailIcon}
			</div>
		)
	}

	if (source === "email") return emailIcon
	if (source === "sql") return sqlIcon

	return <span style={{ color: "#64748b" }}>—</span>
}

function Kpi({ label, value, accentColor, active = false, onClick }: KpiProps) {
	const style = {
		"--accent": accentColor || "var(--border)",
		cursor: onClick ? "pointer" : "default",
		borderColor: active ? accentColor || "var(--primary)" : undefined,
		boxShadow: active ? `0 0 0 1px ${accentColor || "#60a5fa"} inset` : undefined,
		background: active ? "rgba(15,23,42,.72)" : undefined,
		transform: active ? "translateY(-1px)" : undefined,
		transition: "transform .15s ease, box-shadow .15s ease, border-color .15s ease, background .15s ease",
	} as CSSProperties

	const content = (
		<>
			<div className="label">{label}</div>
			<div className="value">{value}</div>
			<div className="accent-bar" />
		</>
	)

	if (!onClick) {
		return (
			<div className="kpi-card" style={style}>
				{content}
			</div>
		)
	}

	return (
		<div
			className="kpi-card"
			role="button"
			tabIndex={0}
			aria-pressed={active}
			title={`Filtrar por ${label}`}
			onClick={onClick}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault()
					onClick()
				}
			}}
			style={style}
		>
			{content}
		</div>
	)
}

function buildExcelWorkbook(rows: JobRowUi[], kpis: ReturnType<typeof buildKpis>, day: string, range: string) {
	// 1. Ordenar filas igual que en el correo (Fallos primero)
	const statusOrderFn = (s: string) => (s === "failed" ? 0 : s === "warning" ? 1 : s === "running" ? 2 : s === "pending" ? 3 : 4);
	const sortedRows = [...rows].sort((a, b) => {
		const pA = statusOrderFn(safeLower(a.status));
		const pB = statusOrderFn(safeLower(b.status));
		if (pA !== pB) return pA - pB;
		return (a.jobName || "").localeCompare(b.jobName || "");
	});

	// 2. Definición de estilos (xlsx-js-style usa hex sin el '#' y requiere rellenar las celdas combinadas)
	const headerBg = "1E3A5F";
	const titleStyle = { font: { bold: true, color: { rgb: "FFFFFF" }, sz: 18 }, fill: { fgColor: { rgb: headerBg } }, alignment: { horizontal: "center", vertical: "center" } };
	const subtitleStyle = { font: { bold: true, color: { rgb: "FBBF24" }, sz: 12 }, fill: { fgColor: { rgb: headerBg } }, alignment: { horizontal: "center", vertical: "center" } };
	const rangeStyle = { font: { color: { rgb: "94A3B8" }, sz: 10 }, fill: { fgColor: { rgb: headerBg } }, alignment: { horizontal: "center", vertical: "center" } };

	const hasIncidents = kpis.failed > 0 || kpis.warning > 0;
	const bannerStyle = {
		font: { bold: true, color: { rgb: "FFFFFF" }, sz: 14 },
		fill: { fgColor: { rgb: hasIncidents ? "DC2626" : "16A34A" } },
		alignment: { horizontal: "center", vertical: "center" }
	};
	const bannerText = hasIncidents ? "HAY INCIDENCIAS EN EL BACKUP DEL DÍA" : "TODOS LOS BACKUPS DEL DÍA SON CORRECTOS";

	const kpiHeaderStyle = { font: { bold: true, color: { rgb: "94A3B8" }, sz: 10 }, fill: { fgColor: { rgb: "0F172A" } }, alignment: { horizontal: "center" } };
	const kpiValueStyle = (color: string) => ({ font: { bold: true, color: { rgb: color }, sz: 18 }, fill: { fgColor: { rgb: "0F172A" } }, alignment: { horizontal: "center" } });

	const thStyle = { font: { bold: true, color: { rgb: "60A5FA" }, sz: 11 }, fill: { fgColor: { rgb: "182241" } }, alignment: { vertical: "center" }, border: { bottom: { style: "medium", color: { rgb: "60A5FA" } } } };
	const tdStyle = { font: { color: { rgb: "000000" }, sz: 11 }, alignment: { vertical: "center" }, border: { bottom: { style: "thin", color: { rgb: "E2E8F0" } } } };

	const getStatusStyle = (status: string) => {
		const s = safeLower(status);
		if (s === 'success') return { font: { bold: true, color: { rgb: "166534" } }, fill: { fgColor: { rgb: "DCFCE7" } }, alignment: { horizontal: "center", vertical: "center" }, border: tdStyle.border };
		if (s === 'warning') return { font: { bold: true, color: { rgb: "92400E" } }, fill: { fgColor: { rgb: "FEF3C7" } }, alignment: { horizontal: "center", vertical: "center" }, border: tdStyle.border };
		if (s === 'failed') return { font: { bold: true, color: { rgb: "991B1B" } }, fill: { fgColor: { rgb: "FEE2E2" } }, alignment: { horizontal: "center", vertical: "center" }, border: tdStyle.border };
		if (s === 'running' || s === 'pending') return { font: { bold: true, color: { rgb: "075985" } }, fill: { fgColor: { rgb: "E0F2FE" } }, alignment: { horizontal: "center", vertical: "center" }, border: tdStyle.border };
		return { font: { bold: true, color: { rgb: "475569" } }, fill: { fgColor: { rgb: "F1F5F9" } }, alignment: { horizontal: "center", vertical: "center" }, border: tdStyle.border };
	};

	// 3. Estructurar matriz del Excel
	const wsData = [
		// Cabecera Principal (Ocupa de A a F)
		[{ v: "Informe de Backups", s: titleStyle }, { v: "", s: titleStyle }, { v: "", s: titleStyle }, { v: "", s: titleStyle }, { v: "", s: titleStyle }, { v: "", s: titleStyle }],
		[{ v: day, s: subtitleStyle }, { v: "", s: subtitleStyle }, { v: "", s: subtitleStyle }, { v: "", s: subtitleStyle }, { v: "", s: subtitleStyle }, { v: "", s: subtitleStyle }],
		[{ v: range, s: rangeStyle }, { v: "", s: rangeStyle }, { v: "", s: rangeStyle }, { v: "", s: rangeStyle }, { v: "", s: rangeStyle }, { v: "", s: rangeStyle }],
		[], // Espaciador
		
		// Banner de estado
		[{ v: bannerText, s: bannerStyle }, { v: "", s: bannerStyle }, { v: "", s: bannerStyle }, { v: "", s: bannerStyle }, { v: "", s: bannerStyle }, { v: "", s: bannerStyle }],
		[], // Espaciador

		// Headers de KPIs
		[
			{ v: "TOTAL", s: kpiHeaderStyle },
			{ v: "ÉXITOS", s: kpiHeaderStyle },
			{ v: "AVISOS", s: kpiHeaderStyle },
			{ v: "ERRORES", s: kpiHeaderStyle },
			{ v: "EN CURSO/PEND.", s: kpiHeaderStyle },
			{ v: "", s: kpiHeaderStyle }
		],
		// Valores de KPIs
		[
			{ v: kpis.total, s: kpiValueStyle("3B82F6") },
			{ v: kpis.success, s: kpiValueStyle("22C55E") },
			{ v: kpis.warning, s: kpiValueStyle("F59E0B") },
			{ v: kpis.failed, s: kpiValueStyle("EF4444") },
			{ v: kpis.running + kpis.pending, s: kpiValueStyle("06B6D4") },
			{ v: "", s: kpiValueStyle("0F172A") }
		],
		[], // Espaciador

		// Cabeceras de la Tabla de Datos
		[
			{ v: "ESTADO", s: thStyle },
			{ v: "JOB", s: thStyle },
			{ v: "FUENTE", s: thStyle },
			{ v: "INICIO", s: thStyle },
			{ v: "DURACIÓN", s: thStyle },
			{ v: "DETALLE", s: thStyle }
		],
		
		// Filas de Datos
		...sortedRows.map((r) => [
			{ v: String(r.status ?? "").toUpperCase(), s: getStatusStyle(r.status) },
			{ v: r.jobName ?? "", s: tdStyle },
			{ v: sourceLabel(r.source), s: tdStyle },
			{ v: formatLocal(r.nextRun), s: tdStyle },
			{ v: formatDuration(r.durationMs), s: tdStyle },
			{ v: r.reason ?? "", s: tdStyle }
		])
	];

	// 4. Generar hoja de cálculo
	const ws = XLSX.utils.aoa_to_sheet(wsData);

	// 5. Configurar ancho de columnas
	ws['!cols'] = [
		{ wch: 15 }, // Estado
		{ wch: 45 }, // Job
		{ wch: 15 }, // Fuente
		{ wch: 20 }, // Inicio
		{ wch: 12 }, // Duración
		{ wch: 70 }  // Detalle
	];

	// 6. Configurar combinaciones de celdas (Merges)
	ws['!merges'] = [
		{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }, // Combinar Título
		{ s: { r: 1, c: 0 }, e: { r: 1, c: 5 } }, // Combinar Fecha
		{ s: { r: 2, c: 0 }, e: { r: 2, c: 5 } }, // Combinar Rango
		{ s: { r: 4, c: 0 }, e: { r: 4, c: 5 } }, // Combinar Banner
	];

	// 7. Configurar alto de filas para dar "aire" al diseño
	ws['!rows'] = [
		{ hpt: 35 }, // Título
		{ hpt: 20 }, // Fecha
		{ hpt: 20 }, // Rango
		{ hpt: 10 }, // Espaciador
		{ hpt: 35 }, // Banner
		{ hpt: 15 }, // Espaciador
		{ hpt: 20 }, // KPI Headers
		{ hpt: 35 }, // KPI Values
		{ hpt: 20 }, // Espaciador
		{ hpt: 25 }  // Tabla Headers
	];

	const wb = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wb, ws, "Backups");
	return wb;
}

async function handleExportScheduleExcel() {
	try {
		const res = await api().getSchedule30()
		await exportScheduleExcel(async () => res as any)
	} catch (e) {
		alert(`Error getSchedule30: ${String(e)}`)
	}
}

function BackupsIcon({ size = 20 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<rect x="3" y="4" width="18" height="4" rx="1" />
			<rect x="3" y="10" width="18" height="4" rx="1" />
			<rect x="3" y="16" width="18" height="4" rx="1" />
		</svg>
	)
}

function JobTable({
	rows,
	onEditComment,
	onOpenExecutions,
	onOpenLog,
	sortKey,
	sortDir,
	onSort,
	readOnly,
}: {
	rows: JobRow[]
	onEditComment?: (id: string) => void
	onOpenExecutions?: (jobName: string) => void
	onOpenLog?: (jobName: string) => void
	sortKey: SortKey
	sortDir: SortDir
	onSort: (k: SortKey) => void
	readOnly?: boolean
}) {
	return (
		<table className="compact-table">
			<thead>
				<tr>
					<th className="sortable" onClick={() => onSort("jobName")}>
						Job {sortKey === "jobName" ? (sortDir === "asc" ? "▲" : "▼") : ""}
					</th>
					<th className="sortable" onClick={() => onSort("status")}>
						Estado {sortKey === "status" ? (sortDir === "asc" ? "▲" : "▼") : ""}
					</th>
					<th className="sortable" onClick={() => onSort("source")}>
						Fuente {sortKey === "source" ? (sortDir === "asc" ? "▲" : "▼") : ""}
					</th>
					<th className="sortable" onClick={() => onSort("nextRun")}>
						Inicio {sortKey === "nextRun" ? (sortDir === "asc" ? "▲" : "▼") : ""}
					</th>
					<th>Duración</th>
					<th className="sortable" onClick={() => onSort("reason")}>
						Detalle {sortKey === "reason" ? (sortDir === "asc" ? "▲" : "▼") : ""}
					</th>
					{!readOnly && <th>Acción</th>}
				</tr>
			</thead>
			<tbody>
				{rows.map((r) => {
					const displayStatus = r.status
					const displayReason = r.reason ?? ""
					const rowClass = `compact-row row-${displayStatus}`

					return (
						<tr key={r.jobId} className={rowClass}>
							<td>
								<div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
									<span
										title={`Criticidad: ${r.criticality ?? "low"}`}
										style={{
											width: 10,
											height: 10,
											borderRadius: 2,
											flex: "0 0 auto",
											background:
												r.criticality === "high"
													? "#ef4444"
													: r.criticality === "medium"
														? "#f59e0b"
														: "#22c55e",
											boxShadow: "0 0 0 1px rgba(255,255,255,.08) inset",
										}}
									/>
									<span
										style={{
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
										}}
									>
										{r.jobName}
									</span>
									{r.relaunched && (
										<span
											title="Relanzado"
											style={{
												fontSize: 10,
												lineHeight: 1,
												padding: "3px 6px",
												borderRadius: 999,
												background: "rgba(96,165,250,.14)",
												border: "1px solid rgba(96,165,250,.35)",
												color: "#93c5fd",
												fontWeight: 700,
												textTransform: "uppercase",
												flex: "0 0 auto",
											}}
										>
											REL
										</span>
									)}
									{(r as any).as400LogContent && (
										<button
											title="Ver log AS/400"
											style={{
												background: "none",
												border: "none",
												padding: "0 2px",
												cursor: "pointer",
												fontSize: 15,
												lineHeight: 1,
												flex: "0 0 auto",
												color: "#34d399",
												filter: "drop-shadow(0 0 3px rgba(52,211,153,.5))",
											}}
											onClick={() => onOpenLog?.(r.jobName)}
										>
											📋
										</button>
									)}
								</div>
							</td>

							<td>
								<span className={`badge ${displayStatus}`}>
									{displayStatus === "success" ? "SUCCESS"
									: displayStatus === "warning" ? "WARNING"
									: displayStatus === "failed"  ? "ERROR"
									: displayStatus === "running" ? "RUNNING"
									: displayStatus === "pending" ? "PENDING"
									: String(displayStatus).toUpperCase()}
								</span>
							</td>

							<td style={{ textAlign: "center" }}>
								<SourceIcon source={r.source} />
							</td>

							<td className="tabular" style={{ width: 180, minWidth: 180, whiteSpace: "nowrap" }}>
								{(() => {
									const val = r.nextRun ?? r.startTime
									if (!val) return "—"
									const d = new Date(val)
									return isNaN(d.getTime())
										? String(val)
										: d.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
								})()}
							</td>

							<td className="tabular">
								<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
									<span style={{ minWidth: "45px" }}>{r.duration ?? "—"}</span>

									{r.durationTrend === "up" && (
										<span
											title="Tardó >20% más que el anterior del mismo tipo"
											style={{ color: "#ef4444", fontSize: 16, cursor: "help" }}
										>
											▲
										</span>
									)}

									{r.durationTrend === "down" && (
										<span
											title="Tardó >20% menos que el anterior del mismo tipo"
											style={{ color: "#22c55e", fontSize: 16, cursor: "help" }}
										>
											▼
										</span>
									)}

									{r.durationTrend === "same" && (
										<span
											title="Duración estable (variación <20%)"
											style={{ color: "#f59e0b", fontSize: 18, fontWeight: "bold", cursor: "help" }}
										>
											=
										</span>
									)}
								</div>
							</td>

							<td>{displayReason}</td>

							{!readOnly && (
								<td style={{ whiteSpace: "nowrap" }}>
									<button
										className="secondary"
										style={{ padding: "4px 8px", fontSize: 12, marginRight: 6 }}
										onClick={() => onOpenExecutions?.(r.jobName)}
									>
										Backups
									</button>
									<button
										className="secondary"
										style={{ padding: "4px 8px", fontSize: 12 }}
										onClick={() => onEditComment?.(r.jobId)}
									>
										Editar
									</button>
								</td>
							)}
						</tr>
					)
				})}
			</tbody>
		</table>
	)
}

function HistoryCalendar({
	availableDays,
	selectedDay,
	onSelect,
}: {
	availableDays: string[]
	selectedDay: string | null
	onSelect: (day: string) => void
}) {
	const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
	const weekDays = ["L", "M", "X", "J", "V", "S", "D"]

	const parseLocalDay = (value: string) => {
		const [y, m, d] = value.split("-").map(Number)
		return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0)
	}

	const toDayKey = (date: Date) => {
		const y = date.getFullYear()
		const m = String(date.getMonth() + 1).padStart(2, "0")
		const d = String(date.getDate()).padStart(2, "0")
		return `${y}-${m}-${d}`
	}

	const availableSet = useMemo(() => new Set(availableDays), [availableDays])

	const latestAvailable = useMemo(() => {
		if (!availableDays.length) return null
		return [...availableDays].sort().slice(-1)[0] ?? null
	}, [availableDays])

	const initialBaseDay = selectedDay || latestAvailable
	const initialBaseDate = initialBaseDay ? parseLocalDay(initialBaseDay) : new Date()

	const [viewYear, setViewYear] = useState(initialBaseDate.getFullYear())
	const [viewMonth, setViewMonth] = useState(initialBaseDate.getMonth())

	useEffect(() => {
		const baseDay = selectedDay || latestAvailable
		if (!baseDay) return
		const d = parseLocalDay(baseDay)
		setViewYear(d.getFullYear())
		setViewMonth(d.getMonth())
	}, [selectedDay, latestAvailable])

	const changeMonth = (delta: number) => {
		const next = new Date(viewYear, viewMonth + delta, 1)
		setViewYear(next.getFullYear())
		setViewMonth(next.getMonth())
	}

	const firstDayOfMonth = new Date(viewYear, viewMonth, 1)
	const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
	const mondayBasedOffset = (firstDayOfMonth.getDay() + 6) % 7

	const cells: any[] = []

	for (let i = 0; i < mondayBasedOffset; i++) {
		cells.push({ key: `empty-start-${i}`, dayNumber: null, fullDate: null, isAvailable: false, isSelected: false, isToday: false })
	}

	const todayKey = toDayKey(new Date())

	for (let day = 1; day <= daysInMonth; day++) {
		const current = new Date(viewYear, viewMonth, day, 12, 0, 0, 0)
		const key = toDayKey(current)

		cells.push({
			key,
			dayNumber: day,
			fullDate: key,
			isAvailable: availableSet.has(key),
			isSelected: selectedDay === key,
			isToday: todayKey === key,
		})
	}

	while (cells.length % 7 !== 0) {
		const idx = cells.length
		cells.push({ key: `empty-end-${idx}`, dayNumber: null, fullDate: null, isAvailable: false, isSelected: false, isToday: false })
	}

	return (
		<div
			style={{
				width: "min(100%, 320px)",
				minWidth: 280,
				background: "var(--panel)",
				border: "1px solid var(--border)",
				borderRadius: 10,
				padding: 12,
				boxSizing: "border-box",
			}}
		>
			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 8 }}>
				<button type="button" className="secondary" onClick={() => changeMonth(-1)} style={{ padding: "4px 10px", fontSize: 12, flex: "0 0 auto" }}>
					◀
				</button>

				<div style={{ textAlign: "center", minWidth: 0, flex: 1 }}>
					<div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
						{monthNames[viewMonth]} {viewYear}
					</div>
					<div style={{ fontSize: 11, color: "var(--muted)" }}>
						{availableDays.length} día{availableDays.length === 1 ? "" : "s"} con datos
					</div>
				</div>

				<button type="button" className="secondary" onClick={() => changeMonth(1)} style={{ padding: "4px 10px", fontSize: 12, flex: "0 0 auto" }}>
					▶
				</button>
			</div>

			<div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6, marginBottom: 8 }}>
				{weekDays.map((wd) => (
					<div key={wd} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--muted)", padding: "4px 0" }}>
						{wd}
					</div>
				))}
			</div>

			<div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
				{cells.map((cell) => {
					if (!cell.dayNumber || !cell.fullDate) return <div key={cell.key} style={{ minHeight: 36 }} />

					const bg = cell.isSelected ? "var(--primary)" : cell.isAvailable ? "rgba(96,165,250,.16)" : "transparent"
					const border = cell.isSelected ? "1px solid var(--primary)" : cell.isToday ? "1px solid rgba(148,163,184,.45)" : "1px solid var(--border)"
					const color = cell.isSelected ? "#fff" : cell.isAvailable ? "var(--text)" : "var(--muted)"

					return (
						<button
							key={cell.key}
							type="button"
							disabled={!cell.isAvailable}
							title={cell.isAvailable ? `Ver ${cell.fullDate}` : "Sin datos"}
							onClick={() => cell.isAvailable && onSelect(cell.fullDate)}
							style={{
								minHeight: 36,
								height: 36,
								borderRadius: 8,
								border,
								background: bg,
								color,
								cursor: cell.isAvailable ? "pointer" : "default",
								fontSize: 13,
								fontWeight: cell.isSelected ? 700 : 500,
								opacity: cell.isAvailable ? 1 : 0.35,
								width: "100%",
								padding: 0,
							}}
						>
							{cell.dayNumber}
						</button>
					)
				})}
			</div>

			<div style={{ marginTop: 10, fontSize: 11, color: "var(--muted)", lineHeight: 1.4 }}>
				Azul = día con datos. Seleccionado = cargado.
			</div>
		</div>
	)
}

function CommentEditor({
	jobName,
	currentComment,
	currentStatus,
	autoReason,
	onSave,
	onClose,
}: {
	jobName: string
	currentComment: string
	currentStatus: string
	autoReason?: string
	onSave: (jobName: string, override: ManualOverride | null) => Promise<void>
	onClose: () => void
}) {
	const [comment, setComment] = useState(currentComment)
	const [status, setStatus] = useState(currentStatus)

	return (
		<div className="email-modal-overlay" onClick={onClose}>
			<div className="email-modal-panel" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
				<div className="email-modal-header">
					<h2>Ajuste manual: {jobName}</h2>
					<button className="email-modal-close" onClick={onClose}>×</button>
				</div>

				<div className="email-modal-fields" style={{ gridTemplateColumns: "1fr", gap: 10 }}>
					<label>Estado</label>
					<select
						value={status}
						onChange={(e) => setStatus(e.target.value)}
						style={{ background: "var(--panel-2)", border: "1px solid var(--border)", color: "var(--text)", padding: 8, borderRadius: 6 }}
					>
						<option value="success">Success</option>
						<option value="warning">Warning</option>
						<option value="failed">Failed</option>
						<option value="running">Running</option>
						<option value="pending">Pending</option>
					</select>

					<label>Comentario / Detalle</label>
					<textarea
						value={comment}
						onChange={(e) => setComment(e.target.value)}
						rows={4}
						style={{ background: "var(--panel-2)", border: "1px solid var(--border)", color: "var(--text)", padding: 8, borderRadius: 6, resize: "vertical" }}
					/>

					{autoReason && <div style={{ fontSize: 12, color: "var(--muted)" }}>Motivo: {autoReason}</div>}
				</div>

				<div className="email-modal-actions">
					<button className="secondary" onClick={onClose}>Cancelar</button>
					<button onClick={() => onSave(jobName, { status, ...(comment.trim() ? { comment: comment.trim() } : {}) }).then(onClose)}>
						Guardar
					</button>
					<button
						className="secondary"
						style={{ background: "rgba(239,68,68,.15)", color: "#fca5a5" }}
						onClick={() => onSave(jobName, null).then(onClose)}
					>
						Quitar
					</button>
				</div>
			</div>
		</div>
	)
}

function EmailModal({ htmlPreview, day, onClose }: { htmlPreview: string; day: string; onClose: () => void }) {
	const [to, setTo] = useState("")
	const [cc, setCc] = useState("")
	const [cco, setCco] = useState("")
	const [sending, setSending] = useState(false)

	async function handleSend() {
		const recipients = to.split(",").map((s) => s.trim()).filter(Boolean)
		if (recipients.length === 0) return alert("Introduce destinatario")

		setSending(true)

		try {
			const res = await api().sendEmail({
				bodyHtml: htmlPreview,
				to: recipients,
				cc: cc.split(",").map((s) => s.trim()).filter(Boolean),
				bcc: cco.split(",").map((s) => s.trim()).filter(Boolean),
				subject: `Informe Backup ${day}`,
			})

			if (!res?.ok) throw new Error(res?.error ?? "Error")

			alert("Enviado")
			onClose()
		} catch (e: any) {
			alert(`Error: ${e?.message ?? e}`)
		} finally {
			setSending(false)
		}
	}

	return (
		<div className="email-modal-overlay" onClick={onClose}>
			<div className="email-modal-panel" onClick={(e) => e.stopPropagation()}>
				<div className="email-modal-header">
					<h2>Enviar Informe {day}</h2>
					<button className="email-modal-close" onClick={onClose}>×</button>
				</div>

				<div className="email-modal-fields">
					<label>Para</label>
					<input value={to} onChange={(e) => setTo(e.target.value)} />

					<label>CC</label>
					<input value={cc} onChange={(e) => setCc(e.target.value)} />

					<label>CCO</label>
					<input value={cco} onChange={(e) => setCco(e.target.value)} />
				</div>

				<div className="email-modal-preview" dangerouslySetInnerHTML={{ __html: htmlPreview }} />

				<div className="email-modal-actions">
					<button onClick={handleSend} disabled={sending}>
						{sending ? "Enviando..." : "Enviar"}
					</button>
				</div>
			</div>
		</div>
	)
}

function ExecutionsTab({
	jobName,
	data,
	loading,
	error,
	allJobNames,
	onSelectJob,
	onBack,
	activeCategory,
}: {
	jobName: string | null
	data: JobExecutionsResponse | null
	loading: boolean
	error: string | null
	allJobNames?: string[]
	onSelectJob?: (job: string) => void
	onBack?: () => void
	activeCategory: CategoryFilter
}) {
	const [filter, setFilter] = useState("")

	const filteredJobs = useMemo(() => {
		const base = allJobNames ?? [];
		return base.filter(j => {
			if (filter && !safeLower(j).includes(safeLower(filter))) return false;
			if (activeCategory === 'all' || activeCategory === 'nok') return true;
			const name = safeLower(j);
			if (activeCategory === 'veeam') return !name.includes('barracuda') && !name.includes('as400') && !name.includes('exchange') && !name.includes('sharepoint') && !name.includes('onedrive') && !name.includes('vdc');
			if (activeCategory === 'vdc') return name.includes('veeam') && (name.includes('exchange') || name.includes('sharepoint') || name.includes('onedrive') || name.includes('vdc'));
			if (activeCategory === 'barracuda') return name.includes('barracuda');
			if (activeCategory === 'as400') return name.includes('as400');
			return true;
		});
	}, [allJobNames, filter, activeCategory]);

	function formatExecutionDate(value: string | null) {
		if (!value) return "—"
		const d = new Date(value)
		if (Number.isNaN(d.getTime())) return "—"
		return d.toLocaleDateString("es-ES")
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", paddingBottom: 40 }}>
			<div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
				{jobName && onBack && (
					<button className="secondary" onClick={onBack} style={{ padding: "6px 12px", fontSize: 14 }}>
						← Volver
					</button>
				)}

				<h2 style={{ margin: 0, fontSize: 20 }}>{jobName ? `Historial: ${jobName}` : "Directorio de Jobs"}</h2>

				{!jobName && (
					<span
						style={{
							background: "rgba(99, 102, 241, 0.15)",
							color: "#818cf8",
							padding: "4px 10px",
							borderRadius: 20,
							fontSize: 13,
							fontWeight: 600,
							border: "1px solid rgba(99, 102, 241, 0.3)",
							marginLeft: 8,
						}}
					>
						{filteredJobs.length || 0} jobs
					</span>
				)}
			</div>

			{!jobName && (
				 <div style={{ display: "flex", flexDirection: "column", maxWidth: 860, margin: "0 auto", width: "100%" }}>
					<input
						placeholder="Buscar..."
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
						style={{
							marginBottom: 16,
							padding: "10px 14px",
							background: "var(--panel-2)",
							border: "1px solid var(--border)",
							color: "var(--text)",
							borderRadius: 6,
							fontSize: 14,
							maxWidth: 400,
						}}
					/>

					<div style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--panel)", overflow: "hidden" }}>
						<table className="compact-table" style={{ border: "none", margin: 0 }}>
							<tbody>
								{filteredJobs.map((j) => (
									<tr key={j} className="compact-row" style={{ cursor: "pointer" }} onClick={() => onSelectJob?.(j)}>
										<td style={{ padding: "12px 16px", fontWeight: 600, fontSize: 13 }}>{j}</td>
										<td style={{ width: 40, textAlign: "center", color: "var(--muted)" }}>▶</td>
									</tr>
								))}

								{filteredJobs.length === 0 && (
									<tr>
										<td colSpan={2} style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>
											No hay jobs
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
				</div>
			)}

			{jobName && (
				<div style={{ display: "flex", flexDirection: "column" }}>
					{loading && <div style={{ color: "var(--muted)", padding: 20 }}>Consultando...</div>}

					{!loading && error && (
						<div
							style={{
								color: "#fca5a5",
								background: "rgba(239,68,68,.10)",
								border: "1px solid rgba(239,68,68,.30)",
								borderRadius: 8,
								padding: 12,
								marginBottom: 16,
							}}
						>
							{error}
						</div>
					)}

					{!loading && !error && (
						<>
							<div
								style={{
									marginBottom: 16,
									color: "var(--text)",
									fontSize: 13,
									background: "var(--panel-2)",
									padding: "12px 16px",
									borderRadius: 6,
									border: "1px solid var(--border)",
									display: "inline-block",
									alignSelf: "flex-start",
								}}
							>
								Total: <strong style={{ color: "var(--primary)", fontSize: 15 }}>{data?.executions?.length || 0}</strong>
							</div>

							<div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
								<table className="compact-table" style={{ border: "none", margin: 0 }}>
									<thead style={{ background: "var(--panel-2)" }}>
										<tr>
											<th>Fecha</th>
											<th style={{ width: 180, minWidth: 180, whiteSpace: "nowrap" }}>Inicio</th>
											<th>Duración</th>
											<th>Estado</th>
										</tr>
									</thead>

									<tbody>
										{(data?.executions ?? []).map((x: any) => (
											<tr key={x.id} className={`compact-row row-${safeLower(x.status)}`}>
												<td className="tabular">{formatExecutionDate(x.start)}</td>
												<td className="tabular">{x.startDisplay ?? "—"}</td>
												<td className="tabular">{x.duration ?? "—"}</td>
												<td>
													<span className={`badge ${safeLower(x.status)}`}>{String(x.status ?? "").toUpperCase()}</span>
												</td>
											</tr>
										))}

										{(data?.executions?.length ?? 0) === 0 && (
											<tr>
												<td colSpan={4} style={{ textAlign: "center", color: "var(--muted)", padding: "30px 0" }}>
													No hay ejecuciones.
												</td>
											</tr>
										)}
									</tbody>
								</table>
							</div>
						</>
					)}
				</div>
			)}
		</div>
	)
}

function ConfigurationPanel({
	open,
	onClose,
	config,
	onSaved,
	pinLocked,
	pinInput,
	setPinInput,
	onUnlock,
	allJobNames,
}: {
	open: boolean
	onClose: () => void
	config: AppConfig | null
	onSaved: (cfg: AppConfig) => void
	pinLocked: boolean
	pinInput: string
	setPinInput: (v: string) => void
	onUnlock: () => void
	allJobNames: string[]
}) {
	const [activeConfigTab, setActiveConfigTab] = useState<ConfigTab>("general")

	if (!open) return null

	if (pinLocked) {
		return (
			<div className="email-modal-overlay" onClick={onClose}>
				<div className="email-modal-panel" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
					<div className="email-modal-header">
						<h2>Bloqueado</h2>
						<button className="email-modal-close" onClick={onClose}>×</button>
					</div>

					<div className="pin-section" style={{ margin: "20px auto" }}>
						<h2>Introduce PIN</h2>
						<input
							type="password"
							value={pinInput}
							onChange={(e) => setPinInput(e.target.value)}
							placeholder="PIN"
							maxLength={8}
						/>
						<button onClick={onUnlock}>Desbloquear</button>
					</div>
				</div>
			</div>
		)
	}

	return (
		<div className="email-modal-overlay" onClick={onClose}>
			<div
				className="email-modal-panel"
				style={{ maxWidth: 1120, width: "96%", padding: 0, overflow: "hidden" }}
				onClick={(e) => e.stopPropagation()}
			>
				<div className="email-modal-header" style={{ marginBottom: 0, borderBottom: "1px solid var(--border)" }}>
					<h2>Configuración</h2>
					<button className="email-modal-close" onClick={onClose}>×</button>
				</div>

				<div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
					<button type="button" onClick={() => setActiveConfigTab("general")} className={`config-panel-tab ${activeConfigTab === "general" ? "active" : ""}`}>General</button>
					<button type="button" onClick={() => setActiveConfigTab("criticality")} className={`config-panel-tab ${activeConfigTab === "criticality" ? "active" : ""}`}>Criticidades</button>
					<button type="button" onClick={() => setActiveConfigTab("veeamDataCloud")} className={`config-panel-tab ${activeConfigTab === "veeamDataCloud" ? "active" : ""}`}>VEEAM DATA CLOUD</button>
					<button type="button" onClick={() => setActiveConfigTab("barracuda")} className={`config-panel-tab ${activeConfigTab === "barracuda" ? "active" : ""}`}>BARRACUDA</button>
					<button type="button" onClick={() => setActiveConfigTab("as400")} className={`config-panel-tab ${activeConfigTab === "as400" ? "active" : ""}`}>AS400</button>
				</div>

				<div style={{ padding: 16, maxHeight: "80vh", overflow: "auto" }}>
					{activeConfigTab === "general" && <Settings config={config} onSaved={onSaved} />}
					{activeConfigTab === "criticality" && <CriticalityPanel config={config} onSaved={onSaved} jobNames={allJobNames} />}
					{activeConfigTab === "veeamDataCloud" && <VeeamDataCloudPanel config={config} onSaved={onSaved} />}
					{activeConfigTab === "barracuda" && <BarracudaPanel config={config} onSaved={onSaved} />}
					{activeConfigTab === "as400" && <As400Panel config={config} onSaved={onSaved} />}
				</div>
			</div>
		</div>
	)
}

function HistoryTab({
	onWindowChange,
	config,
	onManualOverrideSaved,
	onOpenExecutions,
	activeCategory,
}: {
	onWindowChange: (start: string | null, end: string | null) => void
	config: AppConfig | null
	onManualOverrideSaved: (cfg: AppConfig) => Promise<void>
	onOpenExecutions: (jobName: string) => void
	activeCategory: CategoryFilter
}) {
	const [availableDays, setAvailableDays] = useState<string[]>([])
	const [loadingDays, setLoadingDays] = useState(true)
	const [daysError, setDaysError] = useState<string | null>(null)
	const [selectedDay, setSelectedDay] = useState<string | null>(null)
	const [histFull, setHistFull] = useState<JobRowUi[]>([])
	const [histRows, setHistRows] = useState<JobRowUi[]>([])
	const [histWindow, setHistWindow] = useState<{ start: string | null; end: string | null } | null>(null)
	const [loadingDay, setLoadingDay] = useState(false)
	const [dayError, setDayError] = useState<string | null>(null)
	const [filter, setFilter] = useState("")
	const [statusFilter, setStatusFilter] = useState("all")
	const [showAll, setShowAll] = useState(true)
	const [sortKey, setSortKey] = useState<SortKey>("nextRun")
	const [sortDir, setSortDir] = useState<SortDir>("asc")
	const [editingJobId, setEditingJobId] = useState<string | null>(null)
	const [emailModal, setEmailModal] = useState(false)

	useEffect(() => {
		setLoadingDays(true)

		api()
			.getHistoryDays()
			.then((res: any) => {
				setLoadingDays(false)
				if (res?.ok) setAvailableDays(res.days ?? [])
				else setDaysError(res?.error ?? "Error al cargar días")
			})
			.catch((e: any) => {
				setLoadingDays(false)
				setDaysError(e?.message ?? String(e))
			})
	}, [])

	const loadDay = useCallback(
		async (dateStr: string) => {
			setSelectedDay(dateStr)
			setLoadingDay(true)
			setDayError(null)
			setHistFull([])
			setHistRows([])
			setHistWindow(null)
			onWindowChange(null, null)

			try {
				const res = (await api().getHistoryDay(dateStr)) as HistoryPayload
				setLoadingDay(false)

				if ((res as any)?.ok) {
					setHistFull(((res as any).fullRows ?? []) as JobRowUi[])
					setHistRows(((res as any).rows ?? []) as JobRowUi[])

					if ((res as any).windowStart || (res as any).windowEnd) {
						setHistWindow({
							start: (res as any).windowStart ?? null,
							end: (res as any).windowEnd ?? null,
						})

						onWindowChange((res as any).windowStart ?? null, (res as any).windowEnd ?? null)
					}
				} else {
					setDayError((res as any)?.error ?? "Error al cargar el día")
				}
			} catch (e: any) {
				setLoadingDay(false)
				setDayError(e?.message ?? String(e))
			}
		},
		[onWindowChange]
	)

	const kpis = useMemo(() => buildKpis(histFull), [histFull])
	const { day, range } = getWindowParts(histWindow?.start ?? null, histWindow?.end ?? null)


const filtered = useMemo(() => {
		let source = showAll ? histFull : histRows

		// Se ha eliminado el filtro de 'activeCategory' para asegurar 
		// que el histórico muestre absolutamente todos los jobs del día.

		const base = source.filter((r) => {
			if (statusFilter !== "all") {
				if (statusFilter === "running") {
					if (r.status !== "running" && r.status !== "pending") return false
				} else {
					if (r.status !== statusFilter) return false
				}
			}
			if (filter && !safeLower(r.jobName).includes(safeLower(filter))) return false
			return true
		})

		const dir = sortDir === "asc" ? 1 : -1

		return [...base].sort((a, b) => {
			const get = (r: JobRowUi): string | number => {
				switch (sortKey) {
					case "status": return statusOrder(r.status)
					case "jobName": return safeLower(r.jobName)
					case "nextRun": return r.nextRun ? new Date(r.nextRun).getTime() : 0
					case "source": return sourceRank(r.source)
					case "duration": return r.durationMs ?? -1
					case "reason": return safeLower(r.reason)
					default: return 0
				}
			}

			const va = get(a)
			const vb = get(b)
			return va < vb ? -1 * dir : va > vb ? 1 * dir : 0
		})
	}, [histFull, histRows, showAll, filter, statusFilter, sortKey, sortDir])


	const emailPreviewHtml = useMemo(() => buildEmailHtml(histFull, kpis, day, range), [histFull, kpis, day, range])

	function toggleSort(k: SortKey) {
		if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
		else {
			setSortKey(k)
			setSortDir("asc")
		}
	}

	function exportExcel() {
		if (!selectedDay || histFull.length === 0) return
		const wb = buildExcelWorkbook(histFull, kpis, day, range)
		XLSX.writeFile(wb, `BackupsHistorico_${selectedDay}.xlsx`)
	}

	const editingJob = editingJobId
		? histFull.find((r) => r.jobId === editingJobId) ?? histRows.find((r) => r.jobId === editingJobId) ?? null
		: null

	const editingOverride = editingJob ? (config as any)?.manualOverrides?.[editingJob.jobName] : undefined

	async function saveManualOverride(jobName: string, override: ManualOverride | null) {
		const currentCfg = ((await api().getConfig()) as AppConfig | null) ?? config
		if (!currentCfg) return

		const nextOverrides = { ...((currentCfg as any).manualOverrides ?? {}) }

		if (!override) {
			delete nextOverrides[jobName]
		} else {
			nextOverrides[jobName] = {
				status: normalizeManualStatusUi(override.status),
				...(override.comment?.trim() ? { comment: override.comment.trim() } : {}),
			}
		}

		const nextCfg = { ...(currentCfg as any), manualOverrides: nextOverrides } as AppConfig
		const ok = await api().saveConfig(nextCfg)

		if (!ok) {
			alert("No se pudo guardar.")
			return
		}

		await onManualOverrideSaved(nextCfg)
	}

	return (
		<div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
			<div style={{ flex: "0 1 320px", minWidth: 280, width: "100%", maxWidth: 320 }}>
				<div style={{ marginBottom: 8, fontSize: 12, color: "#64748b", minHeight: 16 }}>
					{loadingDays ? "Cargando días..." : daysError ? <span style={{ color: "#ef4444" }}>{daysError}</span> : `${availableDays.length} días con datos`}
				</div>
				<HistoryCalendar availableDays={availableDays} selectedDay={selectedDay} onSelect={loadDay} />
			</div>

			<div style={{ flex: "1 1 640px", minWidth: 0 }}>
				{!selectedDay && (
					<div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 280, color: "#475569", flexDirection: "column", gap: 14, padding: "16px 12px", textAlign: "center" }}>
						<span style={{ fontSize: 40 }}>🗓️</span>
						<span style={{ fontSize: 14, color: "#64748b" }}>Selecciona un día en el calendario</span>
					</div>
				)}

				{selectedDay && loadingDay && (
					<div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 200, color: "#64748b", fontSize: 13 }}>
						Cargando {String(selectedDay)}...
					</div>
				)}

				{selectedDay && dayError && (
					<div style={{ color: "#ef4444", padding: "10px 14px", background: "rgba(239,68,68,.1)", borderRadius: 6, border: "1px solid rgba(239,68,68,.3)", marginBottom: 12 }}>
						{dayError}
					</div>
				)}

				{selectedDay && !loadingDay && !dayError && histFull.length > 0 && (
					<>
						<div style={{ marginBottom: 14 }}>
							<div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0" }}>{String(day)}</div>
							<div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{String(range)}</div>
						</div>

						<div className="kpis" style={{ marginBottom: 14 }}>
							<Kpi label="Jobs" value={kpis.total} />
							<Kpi label="Éxitos" value={kpis.success} />
							<Kpi label="Avisos" value={kpis.warning} />
							<Kpi label="Errores" value={kpis.failed} />
							<Kpi label="En curso / Pend." value={kpis.running + kpis.pending} />
						</div>

						<div className="toolbar" style={{ marginBottom: 10 }}>
							<input placeholder="Buscar job" value={filter} onChange={(e) => setFilter(e.target.value)} className="search-input" />

							<select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="status-select">
								<option value="all">Todos</option>
								<option value="success">Success</option>
								<option value="warning">Warning</option>
								<option value="failed">Failed</option>
							</select>

							<div className="flex-spacer" />

							<button onClick={handleExportScheduleExcel} style={{ background: "#1e3a5f", color: "#f1f5f9", border: "1px solid #60a5fa", borderRadius: 6, padding: "7px 14px", fontSize: 13, fontWeight: 600 }}>
								Planificador
							</button>

							<button onClick={() => setEmailModal(true)} style={{ background: "#059669", color: "white", borderRadius: 6, padding: "7px 14px", fontSize: 13, fontWeight: 600 }}>
								Enviar
							</button>

							<button onClick={exportExcel} style={{ background: "#2563eb", color: "white" }}>
								Exportar
							</button>
						</div>

						<JobTable
							rows={filtered}
							onEditComment={setEditingJobId}
							onOpenExecutions={onOpenExecutions}
							sortKey={sortKey}
							sortDir={sortDir}
							onSort={toggleSort}
						/>
					</>
				)}
			</div>

			{editingJobId && editingJob && (
				<CommentEditor
					jobName={editingJob.jobName}
					currentComment={editingOverride?.comment ?? ""}
					currentStatus={editingOverride?.status ?? normalizeManualStatusUi(editingJob.status)}
					autoReason={editingJob.reason ?? ""}
					onSave={saveManualOverride}
					onClose={() => setEditingJobId(null)}
				/>
			)}

			{emailModal && <EmailModal htmlPreview={emailPreviewHtml} day={day} onClose={() => setEmailModal(false)} />}
		</div>
	)
}

export default function App() {
	const [tab, setTab] = useState<Tab>("dashboard")
	const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all')
	const [config, setConfig] = useState<AppConfig | null>(null)
	const [rows, setRows] = useState<JobRowUi[]>([])
	const [fullRows, setFullRows] = useState<JobRowUi[]>([])
	const [showAll, setShowAll] = useState(true)
	const [lastRun, setLastRun] = useState<string | null>(null)
	const [windowStart, setWindowStart] = useState<string | null>(null)
	const [windowEnd, setWindowEnd] = useState<string | null>(null)
	const [displayWindowStart, setDisplayWindowStart] = useState<string | null>(null)
	const [displayWindowEnd, setDisplayWindowEnd] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)
	const [err, setErr] = useState<string | null>(null)
	const [filter, setFilter] = useState("")
	const [statusFilter, setStatusFilter] = useState<DashboardKpiFilter>("all")
	const [sortKey, setSortKey] = useState<SortKey>("nextRun")
	const [sortDir, setSortDir] = useState<SortDir>("desc")
	const [pinUnlocked, setPinUnlocked] = useState(false)
	const [pinInput, setPinInput] = useState("")
	const [emailModal, setEmailModal] = useState(false)
	const [editingJobId, setEditingJobId] = useState<string | null>(null)
	const [configPanelOpen, setConfigPanelOpen] = useState(false)
	const [selectedJobName, setSelectedJobName] = useState<string | null>(null)
	const [executionsData, setExecutionsData] = useState<JobExecutionsResponse | null>(null)
	const [executionsLoading, setExecutionsLoading] = useState(false)
	const [executionsError, setExecutionsError] = useState<string | null>(null)
	const [dbJobs, setDbJobs] = useState<string[]>([])
	const [logModalData, setLogModalData] = useState<{ jobName: string; content: string } | null>(null)

	const refresh = useCallback(async () => {
		setLoading(true)
		setErr(null)

		try {
			const p = ((await api().refresh()) as RefreshPayload | null) ?? null

			if ((p as any)?.ok) {
				setRows((((p as any).rows ?? []) as JobRowUi[]))
				setFullRows((((p as any).fullRows ?? []) as JobRowUi[]))
				setLastRun((p as any).ts ?? null)

				if ((p as any).windowStart) {
					setWindowStart((p as any).windowStart)
					if (tab === "dashboard") setDisplayWindowStart((p as any).windowStart)
				}

				if ((p as any).windowEnd) {
					setWindowEnd((p as any).windowEnd)
					if (tab === "dashboard") setDisplayWindowEnd((p as any).windowEnd)
				}
			} else {
				setErr((p as any)?.error ?? "Error desconocido")
			}
		} catch (e: any) {
			setErr(e?.message ?? String(e))
		} finally {
			setLoading(false)
		}
	}, [tab])

	useEffect(() => {
		if (configPanelOpen || editingJobId || emailModal || logModalData) {
			return
		}

		api().getConfig().then((c: AppConfig | null) => {
			setConfig(c)
			if (!(c as any)?.pin) setPinUnlocked(true)
		})

		api()
			.listJobs()
			.then((res: any) => {
				if (res?.ok && Array.isArray(res.jobs)) setDbJobs(res.jobs.filter(Boolean))
			})
			.catch(console.error)

		const maybeCleanup = api().onAutoUpdate?.((p: RefreshPayload) => {
			if ((p as any)?.ok) {
				setRows((((p as any).rows ?? []) as JobRowUi[]))
				setFullRows((((p as any).fullRows ?? []) as JobRowUi[]))
				if ((p as any).ts) setLastRun((p as any).ts)
				if ((p as any).windowStart) setWindowStart((p as any).windowStart)
				if ((p as any).windowEnd) setWindowEnd((p as any).windowEnd)
			} else {
				refresh()
			}
		})

		refresh()

		return () => {
			if (typeof maybeCleanup === "function") maybeCleanup()
		}
	}, [refresh, configPanelOpen, editingJobId, emailModal, logModalData])

	useEffect(() => {
		if (tab === "dashboard") {
			setDisplayWindowStart(windowStart)
			setDisplayWindowEnd(windowEnd)
		}
	}, [tab, windowStart, windowEnd])

	const handleHistoryWindowChange = useCallback((start: string | Date | null, end: string | Date | null) => {
		setDisplayWindowStart(start instanceof Date ? start.toISOString() : start)
		setDisplayWindowEnd(end instanceof Date ? end.toISOString() : end)
	}, [])

	function unlockWithPin() {
		if (pinInput === (config as any)?.pin) setPinUnlocked(true)
		else alert("PIN incorrecto")
	}

	const allJobNames = useMemo(() => {
		const names = new Set<string>(dbJobs.filter(Boolean))
		fullRows.forEach((r) => { if (r?.jobName) names.add(r.jobName) })
		rows.forEach((r) => { if (r?.jobName) names.add(r.jobName) })
		return Array.from(names).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }))
	}, [dbJobs, fullRows, rows])

	const { rowsCalendario, fullRowsCalendario } = useMemo(() => {
		const ahora = new Date()
		const diaActual = ahora.getDay()
		const esFinDeSemana = diaActual === 0 || diaActual === 6

		if (!esFinDeSemana) return { rowsCalendario: rows, fullRowsCalendario: fullRows }

		const filtrarJob = (r: JobRowUi) => {
			if (!r.jobName) return true
			const name = safeLower(r.jobName)
			if (name.includes("pr") || name.includes("rr")) return false
			return true
		}

		return {
			rowsCalendario: rows.filter(filtrarJob),
			fullRowsCalendario: fullRows.filter(filtrarJob),
		}
	}, [rows, fullRows])

	const kpis = useMemo(() => buildKpis(fullRowsCalendario), [fullRowsCalendario])
	const { day, range } = getWindowParts(windowStart, windowEnd)
	const { day: displayDay, range: displayRange } = getWindowParts(displayWindowStart, displayWindowEnd)

	const filtered = useMemo(() => {
		let source = showAll ? fullRowsCalendario : rowsCalendario

		// PRIORIDAD ABSOLUTA AL FILTRO DEL KPI DE ESTADO SI ESTÁ ACTIVADO
		if (statusFilter !== "all") {
			source = source.filter((r) => {
				if (statusFilter === "running") {
					return r.status === "running" || r.status === "pending"
				}
				return r.status === statusFilter
			})
		} else if (activeCategory !== 'all') {
			// Solo aplica el filtro de la barra de categorías si NO hay un KPI de estado seleccionado
			source = source.filter(r => {
				const name = safeLower(r.jobName || "");
				if (activeCategory === 'nok') return r.status !== 'success';
				if (activeCategory === 'veeam') {
					return (r.source === 'sql' || r.source === 'both') && !name.includes('exchange') && !name.includes('sharepoint') && !name.includes('onedrive') && !name.includes('vdc') && !name.includes('barracuda') && !name.includes('as400');
				}
				if (activeCategory === 'vdc') {
					return name.includes('veeam') && (name.includes('exchange') || name.includes('sharepoint') || name.includes('onedrive') || name.includes('vdc'));
				}
				if (activeCategory === 'barracuda') return name.includes('barracuda');
				if (activeCategory === 'as400') {
					return name.includes('as400') || (r.source === 'email' && !name.includes('barracuda') && !name.includes('veeam'));
				}
				return true;
			});
		}

		// Filtro secundario de texto de búsqueda
		const base = source.filter((r) => {
			if (filter && !safeLower(r.jobName).includes(safeLower(filter))) return false
			return true
		})

		const dir = sortDir === "asc" ? 1 : -1

		return [...base].sort((a, b) => {
			const get = (r: JobRowUi): string | number => {
				switch (sortKey) {
					case "status": return statusOrder(r.status)
					case "jobName": return safeLower(r.jobName)
					case "nextRun": return r.nextRun ? new Date(r.nextRun).getTime() : 0
					case "source": return sourceRank(r.source)
					case "duration": return r.durationMs ?? -1
					case "reason": return safeLower(r.reason)
					default: return 0
				}
			}

			const va = get(a)
			const vb = get(b)
			return va < vb ? -1 * dir : va > vb ? 1 * dir : 0
		})
	}, [rowsCalendario, fullRowsCalendario, showAll, filter, statusFilter, sortKey, sortDir, activeCategory])

	const emailPreviewHtml = useMemo(() => buildEmailHtml(fullRowsCalendario, kpis, day, range), [fullRowsCalendario, kpis, day, range])

	function exportToExcel() {
		const wb = buildExcelWorkbook(fullRowsCalendario, kpis, day, range)
		XLSX.writeFile(wb, `Backups_${(day || "sin_fecha").replace(/\s+/g, "_")}.xlsx`)
	}

	function toggleSort(key: SortKey) {
		if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
		else {
			setSortKey(key)
			setSortDir("asc")
		}
	}

	function handleDashboardKpiClick(next: DashboardKpiFilter) {
		setStatusFilter(next)
		setShowAll(true)
		setActiveCategory('all')
	}

	const editingJob = editingJobId
		? fullRows.find((r) => r.jobId === editingJobId) ?? rows.find((r) => r.jobId === editingJobId) ?? null
		: null

	const editingOverride = editingJob ? (config as any)?.manualOverrides?.[editingJob.jobName] : undefined

	async function handleConfigUpdated(nextCfg: AppConfig) {
		const fresh = ((await api().getConfig()) as AppConfig | null) ?? nextCfg
		setConfig(fresh)
		await refresh()
	}

	async function handleManualOverrideSaved(nextCfg: AppConfig) {
		const fresh = ((await api().getConfig()) as AppConfig | null) ?? nextCfg
		setConfig(fresh)
		await refresh()
	}

	async function saveManualOverride(jobName: string, override: ManualOverride | null) {
		const currentCfg = ((await api().getConfig()) as AppConfig | null) ?? config
		if (!currentCfg) return

		const nextOverrides = { ...((currentCfg as any).manualOverrides ?? {}) }

		if (!override) {
			delete nextOverrides[jobName]
		} else {
			nextOverrides[jobName] = {
				status: normalizeManualStatusUi(override.status),
				...(override.comment?.trim() ? { comment: override.comment.trim() } : {}),
			}
		}

		const nextCfg = { ...(currentCfg as any), manualOverrides: nextOverrides } as AppConfig
		const ok = await api().saveConfig(nextCfg)

		if (!ok) {
			alert("No se pudo guardar.")
			return
		}

		await handleManualOverrideSaved(nextCfg)
	}

	async function loadExecutions(jobName: string | null) {
		setExecutionsError(null)
		setExecutionsLoading(true)
		setExecutionsData(null)

		try {
			const res = (await api().getJobExecutions(jobName || "", 200)) as JobExecutionsResponse
			if (res?.ok) setExecutionsData(res)
			else setExecutionsError(res?.error ?? "Error al cargar")
		} catch (e: any) {
			setExecutionsError(e?.message ?? "Error")
		} finally {
			setExecutionsLoading(false)
		}
	}

	async function openExecutionsView(jobName?: any) {
		const targetJob = typeof jobName === "string" && jobName.trim() ? jobName.trim() : null
		setTab("executions")
		setSelectedJobName(targetJob)
		setExecutionsError(null)
		setExecutionsData(null)

		if (targetJob) await loadExecutions(targetJob)
	}

	return (
		<div className="app compact-mode">
			<div className="topbar">
				<h1>Backup Monitor Pro</h1>
				<div className="meta">
					{lastRun ? `Actualizado ${new Date(lastRun).toLocaleTimeString("es-ES")}` : "Cargando..."}
				</div>
			</div>

			<div className="tabs">
				<div className={`tab ${tab === "dashboard" ? "active" : ""}`} onClick={() => setTab("dashboard")}>
					Dashboard
				</div>

				<div className={`tab ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>
					Histórico
				</div>

				{tab !== "executions" && (
					<div className="window-title">
						<span className="window-title-main">
							SITUACIÓN BACKUP DEL DÍA {typeof displayDay === "string" ? displayDay : ""}
						</span>
						{displayRange && (
							<span className="window-title-range">
								{typeof displayRange === "string" ? displayRange : ""}
							</span>
						)}
					</div>
				)}

				<div className="flex-spacer" />

				<button type="button" className="tabs-config-btn" onClick={() => openExecutionsView()} title="Backups">
					<BackupsIcon size={20} />
				</button>

				<button type="button" className="tabs-config-btn white-icon" onClick={() => setConfigPanelOpen(true)} title="Configuración">
					<WhiteGearIcon size={20} />
				</button>
			</div>

			<div className="content">
				{tab === "dashboard" && (
					<>
						<div className="kpis">
							<Kpi
								label="Jobs hoy"
								value={kpis.total}
								accentColor="#94a3b8"
								active={statusFilter === "all"}
								onClick={() => handleDashboardKpiClick("all")}
							/>
							<Kpi
								label="Éxitos"
								value={kpis.success}
								accentColor="#22c55e"
								active={statusFilter === "success"}
								onClick={() => handleDashboardKpiClick("success")}
							/>
							<Kpi
								label="Avisos"
								value={kpis.warning}
								accentColor="#f59e0b"
								active={statusFilter === "warning"}
								onClick={() => handleDashboardKpiClick("warning")}
							/>
							<Kpi
								label="Errores"
								value={kpis.failed}
								accentColor="#ef4444"
								active={statusFilter === "failed"}
								onClick={() => handleDashboardKpiClick("failed")}
							/>
							<Kpi
								label="En curso"
								value={kpis.running + kpis.pending}
								accentColor="#60a5fa"
								active={statusFilter === "running"}
								onClick={() => handleDashboardKpiClick("running")}
							/>
						</div>


<div className="toolbar" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "12px" }}>
							<div style={{ display: "flex", width: "100%", alignItems: "center", gap: "10px" }}>
								<input placeholder="Buscar..." value={filter} onChange={(e) => setFilter(e.target.value)} className="search-input" />
								
								<div className="flex-spacer" />

								<button onClick={() => setEmailModal(true)} style={{ background: "#059669", color: "white" }}>
									Enviar
								</button>

								<button onClick={exportToExcel} disabled={fullRows.length === 0} style={{ background: "#2563eb", color: "white" }}>
									Exportar
								</button>

								<button onClick={handleExportScheduleExcel} style={{ background: "#1e3a5f", color: "#f1f5f9", border: "1px solid #60a5fa", borderRadius: 6, padding: "7px 14px", fontSize: 13, fontWeight: 600 }}>
									Planificador
								</button>

								<button onClick={refresh} disabled={loading} style={{ background: loading ? "#334155" : "#475569", color: "white" }}>
									{loading ? "Refrescando..." : "Refrescar"}
								</button>
							</div>

							<div className="category-tabs" style={{ display: "flex", gap: "6px", width: "100%", padding: "4px 0" }}>
								{JOB_CATEGORIES.map(cat => {
									const isNok = cat.id === 'nok';
									const isActive = activeCategory === cat.id;

									let btnStyle: CSSProperties = {
										border: "1px solid var(--border)",
										padding: "6px 14px",
										borderRadius: "6px",
										fontSize: "12px",
										fontWeight: 600,
										cursor: "pointer",
										transition: "all 0.15s ease"
									};

									if (isNok) {
										btnStyle.marginLeft = "14px";
										btnStyle.background = isActive ? "#e28704" : "rgba(245, 158, 11, 0.2)";
										btnStyle.color = isActive ? "#ffffff" : "#f59e0b";
										btnStyle.borderColor = "#f59e0b";
									} else {
										btnStyle.background = isActive ? "#2563eb" : "var(--panel-2)";
										btnStyle.color = isActive ? "#ffffff" : "var(--text)";
									}

									return (
										<button
											key={cat.id}
											onClick={() => {
												setActiveCategory(cat.id);
												setStatusFilter("all");
											}}
											style={btnStyle}
										>
											{cat.label}
										</button>
									);
								})}
							</div>
						</div>



						{err && <span className="error-badge">{err}</span>}

						<JobTable
							rows={filtered}
							onEditComment={setEditingJobId}
							onOpenExecutions={openExecutionsView}
							onOpenLog={(jobName) => {
								const row = fullRows.find((r) => r.jobName === jobName)
								const content = (row as any)?.as400LogContent ?? null
								setLogModalData({ jobName, content })
							}}
							sortKey={sortKey}
							sortDir={sortDir}
							onSort={toggleSort}
						/>
					</>
				)}

				{tab === "history" && (
					<HistoryTab
						onWindowChange={handleHistoryWindowChange}
						config={config}
						onManualOverrideSaved={handleManualOverrideSaved}
						onOpenExecutions={openExecutionsView}
						activeCategory={activeCategory}
					/>
				)}

				{tab === "executions" && (
					<ExecutionsTab
						jobName={selectedJobName}
						data={executionsData}
						loading={executionsLoading}
						error={executionsError}
						allJobNames={allJobNames}
						onSelectJob={async (j) => {
							setSelectedJobName(j)
							await loadExecutions(j)
						}}
						onBack={() => {
							setSelectedJobName(null)
							setExecutionsData(null)
						}}
						activeCategory={activeCategory}
					/>
				)}
			</div>

			<ConfigurationPanel
				open={configPanelOpen}
				onClose={() => setConfigPanelOpen(false)}
				config={config}
				onSaved={handleConfigUpdated}
				pinLocked={!pinUnlocked}
				pinInput={pinInput}
				setPinInput={setPinInput}
				onUnlock={unlockWithPin}
				allJobNames={allJobNames}
			/>

			{editingJobId && editingJob && (
				<CommentEditor
					jobName={editingJob.jobName}
					currentComment={editingOverride?.comment ?? ""}
					currentStatus={editingOverride?.status ?? normalizeManualStatusUi(editingJob.status)}
					autoReason={editingJob.reason ?? ""}
					onSave={saveManualOverride}
					onClose={() => setEditingJobId(null)}
				/>
			)}

			{emailModal && <EmailModal htmlPreview={emailPreviewHtml} day={day} onClose={() => setEmailModal(false)} />}

			{logModalData && (
				<div className="email-modal-overlay" onClick={() => setLogModalData(null)} style={{ zIndex: 9999 }}>
					<div className="email-modal-panel" style={{ maxWidth: 900 }} onClick={(e) => e.stopPropagation()}>
						<div className="email-modal-header">
							<h2>LOG AS/400 - {String(logModalData?.jobName || "Desconocido")}</h2>
							<button className="email-modal-close" onClick={() => setLogModalData(null)}>×</button>
						</div>
						<div style={{ padding: 16, overflowY: "auto", maxHeight: "65vh" }}>
							<pre style={{ background: "#000", color: "#0f0", padding: 16, borderRadius: 6, fontFamily: "monospace", fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
								{logModalData?.content ? String(logModalData.content) : "⚠️ No hay contenido o no se pudo extraer."}
							</pre>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}