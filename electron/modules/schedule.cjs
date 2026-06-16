// electron/modules/schedule.cjs
const { safeLower, normalizePlannerText, isExcludedJobName } = require('./utils.cjs')

function tagVal(xml, tag) {
  const m = String(xml || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return m ? m[1].trim() : null
}

function blockContent(xml, tag) {
  const m = String(xml || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return m ? m[1] : null
}

function isEnabled(block) {
  if (!block) return false
  return safeLower(tagVal(block, 'Enabled')) === 'true'
}

function parseTime(block) {
  const t = tagVal(block, 'Time') || tagVal(block, 'StartTime') || tagVal(block, 'TimeOfDay')
    || tagVal(block, 'DailyTime') || tagVal(block, 'StartDateTime') || ''
  const m = t.match(/T(\d{2}):(\d{2})/) || t.match(/(\d{2}):(\d{2})/)
  return m ? { h: parseInt(m[1], 10), m: parseInt(m[2], 10) } : { h: 22, m: 0 }
}

function parseIntSafe(value, fallback) {
  const n = parseInt(String(value ?? ''), 10)
  return Number.isFinite(n) ? n : fallback
}

const DOW_MAP = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 }
const MONTH_MAP = {
  January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
  July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
}
const NTH_MAP = { First: 1, Second: 2, Third: 3, Fourth: 4, Last: -1 }

function nthWeekdayOfMonth(year, month, dow, nth) {
  if (nth === -1) {
    const lastDay = new Date(year, month + 1, 0)
    let d = lastDay.getDate()
    while (new Date(year, month, d).getDay() !== dow) d--
    return new Date(year, month, d)
  }
  let count = 0
  for (let d = 1; d <= 31; d++) {
    const candidate = new Date(year, month, d)
    if (candidate.getMonth() !== month) break
    if (candidate.getDay() === dow) { count++; if (count === nth) return candidate }
  }
  return null
}

function extractWeekDays(block) {
  const days = [
    ...String(block || '').matchAll(/<DayOfWeek[^>]*>([\s\S]*?)<\/DayOfWeek>/gi),
    ...String(block || '').matchAll(/<EWeekDay[^>]*>([\s\S]*?)<\/EWeekDay>/gi),
  ].map((x) => String(x[1] || '').trim()).map((x) => DOW_MAP[x]).filter((x) => x !== undefined)
  return Array.from(new Set(days))
}

function extractMonths(block) {
  const months = [
    ...String(block || '').matchAll(/<EMonth[^>]*>([\s\S]*?)<\/EMonth>/gi),
    ...String(block || '').matchAll(
      /<Month[^>]*>(January|February|March|April|May|June|July|August|September|October|November|December)<\/Month>/gi
    ),
  ].map((x) => String(x[1] || '').trim()).map((x) => MONTH_MAP[x]).filter((x) => x !== undefined)
  return Array.from(new Set(months))
}

function parseScheduleXml(xml, jobName = '') {
  if (!xml) return null

  // Monthly
  const monthlyBlock = blockContent(xml, 'OptionsMonthly')
  if (monthlyBlock && isEnabled(monthlyBlock)) {
    const tm = parseTime(monthlyBlock)
    const dayNumberInMonth = tagVal(monthlyBlock, 'DayNumberInMonth') || tagVal(monthlyBlock, 'WeekNumberInMonth') || 'OnDay'
    const months = extractMonths(monthlyBlock)
    if (dayNumberInMonth === 'OnDay') {
      const domBlock = blockContent(monthlyBlock, 'DayOfMonth') || monthlyBlock
      const dom = parseIntSafe(tagVal(domBlock, 'Day'), NaN) || parseIntSafe(tagVal(monthlyBlock, 'Day'), 1)
      return { type: 'monthly', hour: tm.h, minute: tm.m, dayOfMonth: Number.isNaN(dom) ? 1 : dom,
        months: months.length ? months : [0,1,2,3,4,5,6,7,8,9,10,11] }
    }
    const nth = NTH_MAP[dayNumberInMonth] ?? 1
    const dowStr = tagVal(monthlyBlock, 'DayOfWeek') || tagVal(monthlyBlock, 'WeekDay') || 'Monday'
    return { type: 'monthly-nth', hour: tm.h, minute: tm.m, nth, dow: DOW_MAP[dowStr] ?? 1,
      months: months.length ? months : [0,1,2,3,4,5,6,7,8,9,10,11] }
  }

  // Daily
  const dailyBlock = blockContent(xml, 'OptionsDaily')
  if (dailyBlock && isEnabled(dailyBlock)) {
    const tm = parseTime(dailyBlock)
    const kind = tagVal(dailyBlock, 'Kind') || 'Everyday'
    if (kind === 'SelectedDays') {
      return { type: 'weekly', hour: tm.h, minute: tm.m,
        weekDays: extractWeekDays(dailyBlock).length ? extractWeekDays(dailyBlock) : [1] }
    }
    if (kind === 'Weekdays') return { type: 'weekly', hour: tm.h, minute: tm.m, weekDays: [1,2,3,4,5] }
    return { type: 'daily', hour: tm.h, minute: tm.m }
  }

  // Weekly
  const weeklyBlock = blockContent(xml, 'OptionsWeekly')
  if (weeklyBlock && isEnabled(weeklyBlock)) {
    const tm = parseTime(weeklyBlock)
    return { type: 'weekly', hour: tm.h, minute: tm.m,
      weekDays: extractWeekDays(weeklyBlock).length ? extractWeekDays(weeklyBlock) : [1] }
  }

  // Periodically
  const periodicBlock = blockContent(xml, 'OptionsPeriodically')
  if (periodicBlock && isEnabled(periodicBlock)) {
    return { type: 'periodically', intervalMs: parseIntSafe(tagVal(periodicBlock, 'FullPeriod'), 3600) * 1000 }
  }

  // Continuous
  const continuousBlock = blockContent(xml, 'OptionsContinuous')
  if (continuousBlock && isEnabled(continuousBlock)) {
    return { type: 'periodically', intervalMs:
      (parseIntSafe(tagVal(continuousBlock, 'FullPeriod'), NaN) ||
       parseIntSafe(tagVal(continuousBlock, 'Period'), NaN) || 3600) * 1000 }
  }

  // Fallback heurístico
  const rawXml = String(xml || '')
  const fallbackTime = parseTime(rawXml)
  const weekdays = []
  if (/<Monday>true<\/Monday>/i.test(rawXml)) weekdays.push(1)
  if (/<Tuesday>true<\/Tuesday>/i.test(rawXml)) weekdays.push(2)
  if (/<Wednesday>true<\/Wednesday>/i.test(rawXml)) weekdays.push(3)
  if (/<Thursday>true<\/Thursday>/i.test(rawXml)) weekdays.push(4)
  if (/<Friday>true<\/Friday>/i.test(rawXml)) weekdays.push(5)
  if (/<Saturday>true<\/Saturday>/i.test(rawXml)) weekdays.push(6)
  if (/<Sunday>true<\/Sunday>/i.test(rawXml)) weekdays.push(0)

  const nameMonthly = String(jobName).match(/\bDIA\s*0?(\d{1,2})\b/i)
    || String(jobName).match(/\bD[IÍ]A\s*0?(\d{1,2})\b/i)

  const xmlMonthlyCandidates = [
    tagVal(rawXml, 'DayOfMonth'), tagVal(rawXml, 'MonthDay'),
    tagVal(rawXml, 'DayNumberInMonth'), tagVal(rawXml, 'Day'), tagVal(rawXml, 'DayOfWeekInMonth'),
  ].map((v) => { const m = String(v || '').match(/\b(\d{1,2})\b/); return m ? Number(m[1]) : null })
    .filter((v) => Number.isInteger(v) && v >= 1 && v <= 31)

  const monthlyDay = xmlMonthlyCandidates.length > 0 ? xmlMonthlyCandidates[0]
    : nameMonthly ? Number(nameMonthly[1]) : null

  if ((/<Monthly/i.test(rawXml) || /\bMENSUAL\b/i.test(jobName)) && monthlyDay) {
    return { type: 'monthly', hour: fallbackTime.h, minute: fallbackTime.m, dayOfMonth: monthlyDay,
      months: [0,1,2,3,4,5,6,7,8,9,10,11] }
  }
  if (/<Weekly/i.test(rawXml) || weekdays.length > 0) {
    return { type: 'weekly', hour: fallbackTime.h, minute: fallbackTime.m, weekDays: weekdays.length ? weekdays : [1] }
  }
  if (/<Daily/i.test(rawXml) || /\bDIARIO\b/i.test(jobName)) {
    return { type: 'daily', hour: fallbackTime.h, minute: fallbackTime.m }
  }
  return null
}

function floorToMinute(d) { const x = new Date(d); x.setSeconds(0, 0); return x }
function startOfToday(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }

function pushIfInRange(result, jobName, candidate, now, limit) {
  if (candidate >= now && candidate <= limit) result.push({ job: jobName, date: new Date(candidate) })
}

function expandSchedule30(jobName, scheduleXml, nowArg = new Date()) {
  try {
    const sched = parseScheduleXml(scheduleXml, jobName)
    if (!sched) return []
    const now = floorToMinute(nowArg)
    const limit = new Date(now.getTime() + 30 * 86400000)
    const result = []

    if (sched.type === 'daily') {
      let d = startOfToday(now)
      while (d <= limit) {
        const c = new Date(d); c.setHours(sched.hour, sched.minute, 0, 0)
        pushIfInRange(result, jobName, c, now, limit); d.setDate(d.getDate() + 1)
      }
      return result
    }
    if (sched.type === 'weekly') {
      let d = startOfToday(now)
      while (d <= limit) {
        if (sched.weekDays.includes(d.getDay())) {
          const c = new Date(d); c.setHours(sched.hour, sched.minute, 0, 0)
          pushIfInRange(result, jobName, c, now, limit)
        }
        d.setDate(d.getDate() + 1)
      }
      return result
    }
    if (sched.type === 'monthly') {
      for (let offset = 0; offset <= 3; offset++) {
        const base = new Date(now.getFullYear(), now.getMonth() + offset, 1)
        if (!sched.months.includes(base.getMonth())) continue
        const maxDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()
        const c = new Date(base.getFullYear(), base.getMonth(), Math.min(sched.dayOfMonth, maxDay), sched.hour, sched.minute, 0, 0)
        pushIfInRange(result, jobName, c, now, limit)
      }
      return result
    }
    if (sched.type === 'monthly-nth') {
      for (let offset = 0; offset <= 3; offset++) {
        const base = new Date(now.getFullYear(), now.getMonth() + offset, 1)
        if (!sched.months.includes(base.getMonth())) continue
        const d = nthWeekdayOfMonth(base.getFullYear(), base.getMonth(), sched.dow, sched.nth)
        if (d) pushIfInRange(result, jobName, new Date(d.getFullYear(), d.getMonth(), d.getDate(), sched.hour, sched.minute, 0, 0), now, limit)
      }
      return result
    }
    if (sched.type === 'periodically') {
      let ts = Math.ceil(now.getTime() / sched.intervalMs) * sched.intervalMs
      let d = new Date(ts)
      while (d <= limit) { result.push({ job: jobName, date: new Date(d) }); ts += sched.intervalMs; d = new Date(ts) }
      return result
    }
    return []
  } catch (e) { return [] }
}

function cloneEntriesWithJobName(entries, newJobName) {
  return (entries || []).map((e) => ({ job: newJobName, date: new Date(e.date) }))
}

// ─── Copy Job Linking ──────────────────────────────────────────────────────
function getCopySourceKey(jobName) {
  if (!jobName || typeof jobName !== 'string') return ''
  const name = normalizePlannerText(jobName)
  if (!name || typeof name !== 'string' || typeof name.indexOf !== 'function') return ''
  const idxDesde = name.indexOf(' desde ')
  if (idxDesde > 0) return name.slice(0, idxDesde).trim()
  const withoutCopySuffix = name.replace(/\s*\(copy\)\s*\d*$/i, '').replace(/\s*copy\s*\d*$/i, '').trim()
  if (withoutCopySuffix !== name) return withoutCopySuffix
  return ''
}

function getPrimaryLinkKeys(jobName) {
  const name = normalizePlannerText(jobName)
  const keys = new Set()
  if (!name || typeof name !== 'string' || name.trim() === '') return []
  keys.add(name)
  if (typeof name.split === 'function') {
    const parts = name.split(' - ')
    const firstDash = parts[0] ? parts[0].trim() : null
    if (firstDash) keys.add(firstDash)
  }
  return [...keys].filter(Boolean)
}

function isBackupCopyJob(job) {
  if (!job) return false
  const name = String(job.name || '')
  const normalizedName = normalizePlannerText(name)
  const options = String(job.options_xml || '')
  return (
    Number(job.type) === 65 ||
    /BackupCopyOptions\b/i.test(options) ||
    /IsBackupCopySimpleMode>/i.test(options) ||
    /\(copy\)\s*\d*$/i.test(name) ||
    /\bbackup copy\b/i.test(normalizedName)
  )
}

function pickBestPrimaryMatch(sourceKey, candidates) {
  if (!sourceKey || !Array.isArray(candidates) || !candidates.length) return null
  const valid = candidates.filter((c) => c && c.name)
  if (!valid.length) return null
  return [...valid].sort((a, b) => String(a.name).length - String(b.name).length)[0] || null
}

function findParentJobForCopy(copyJob, primaryJobs, primaryIndex) {
  if (!copyJob || !copyJob.name) return null
  const sourceKey = getCopySourceKey(copyJob.name)
  if (!sourceKey) return null
  const directCandidates = primaryIndex && typeof primaryIndex.get === 'function'
    ? primaryIndex.get(sourceKey) || [] : []
  const direct = pickBestPrimaryMatch(sourceKey, directCandidates)
  if (direct) return direct
  const safePrimary = Array.isArray(primaryJobs) ? primaryJobs : []
  const fuzzy = safePrimary.filter((p) => {
    if (!p || !p.name) return false
    const full = normalizePlannerText(p.name)
    const keys = getPrimaryLinkKeys(p.name)
    return full.startsWith(sourceKey) || keys.includes(sourceKey)
  })
  return pickBestPrimaryMatch(sourceKey, fuzzy)
}

function buildPrimaryJobIndex(primaryJobs) {
  const index = new Map()
  for (const p of primaryJobs) {
    if (!p || !p.name) continue
    for (const k of getPrimaryLinkKeys(p.name)) {
      if (!index.has(k)) index.set(k, [])
      index.get(k).push(p)
    }
  }
  return index
}

module.exports = {
  parseScheduleXml, expandSchedule30, cloneEntriesWithJobName,
  isBackupCopyJob, findParentJobForCopy, buildPrimaryJobIndex,
}