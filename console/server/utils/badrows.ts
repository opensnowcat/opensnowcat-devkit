/**
 * Best-effort summariser for Snowplow / OpenSnowcat bad rows.
 * Bad rows are self-describing JSON: { schema: "iglu:com.snowplowanalytics.snowplow.badrows/<type>/jsonschema/x-y-z", data: {...} }
 */
import { parseIgluUri } from './enriched'

export interface BadRowMessage {
  title: string
  detail?: string
  schemaKey?: string
}

export interface BadRowSummary {
  badType: string
  badRowSchema: string
  summary: string
  messages: BadRowMessage[]
  schemaKeys: string[]
  appId: string | null
  eventName: string | null
  eventId: string | null
  platform: string | null
  timestamp: number | null
  processor: string | null
  payload: unknown
  failure: unknown
  parseError?: string
}

type AnyRecord = Record<string, unknown>
const isObj = (v: unknown): v is AnyRecord => !!v && typeof v === 'object' && !Array.isArray(v)

function findIgluKeys(value: unknown): string[] {
  const out = new Set<string>()
  const walk = (v: unknown, depth: number) => {
    if (depth > 12 || v == null) return
    if (typeof v === 'string') {
      if (v.startsWith('iglu:') && parseIgluUri(v)) out.add(v)
      return
    }
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return }
    if (isObj(v)) for (const x of Object.values(v)) walk(x, depth + 1)
  }
  walk(value, 0)
  return [...out]
}

function describeError(err: unknown): string {
  if (!isObj(err)) return typeof err === 'string' ? err : JSON.stringify(err)
  const kind = typeof err.error === 'string' ? err.error : null
  switch (kind) {
    case 'ResolutionError': {
      const hist = Array.isArray(err.lookupHistory) ? err.lookupHistory as AnyRecord[] : []
      const repos = hist.map((h) => {
        const errs = Array.isArray(h.errors) ? (h.errors as AnyRecord[]).map(e => typeof e.error === 'string' ? e.error : 'error') : []
        return `${String(h.repository ?? 'registry')}: ${errs.join(', ') || 'no answer'}`
      })
      return `Schema not found in any registry (${repos.join('; ') || 'no lookups recorded'})`
    }
    case 'ValidationError': {
      const reports = Array.isArray(err.dataReports) ? err.dataReports as AnyRecord[] : []
      return reports.map(r => `${String(r.path ?? '$')} ${String(r.message ?? r.keyword ?? 'invalid')}`).join('; ') || 'Validation failed'
    }
    case 'NotJson':
      return `Field ${String(err.field ?? '?')} is not valid JSON: ${String(err.error ?? '')}`.trim()
    case 'NotIglu':
      return `Not a self-describing JSON: ${String(err.error ?? '')}`.trim()
    case 'CriterionMismatch':
      return `Schema ${String(err.schemaKey ?? '?')} does not match criterion ${String(err.schemaCriterion ?? '?')}`
    case 'InputData':
      return `${String(err.field ?? 'input')}=${String(err.value ?? '')}: ${String(err.expectation ?? 'invalid')}`
    case 'Simple':
      return String(err.error ?? err.message ?? 'Enrichment failure')
    default:
      break
  }
  if (typeof err.message === 'string') return err.message
  if (typeof err.expectation === 'string') return `${String(err.field ?? 'input')}: ${err.expectation}`
  return JSON.stringify(err)
}

function messagesFor(badType: string, failure: unknown): BadRowMessage[] {
  const out: BadRowMessage[] = []
  if (!isObj(failure)) return out
  const messages = Array.isArray(failure.messages) ? failure.messages as unknown[] : null
  if (messages) {
    for (const m of messages) {
      if (!isObj(m)) { out.push({ title: String(m) }); continue }
      if (badType === 'enrichment_failures') {
        const enrichment = isObj(m.enrichment) ? m.enrichment : null
        const id = enrichment ? String(enrichment.identifier ?? enrichment.schemaKey ?? 'enrichment') : 'enrichment'
        out.push({ title: `${id}: ${describeError(m.message)}`, schemaKey: enrichment ? String(enrichment.schemaKey ?? '') : undefined })
        continue
      }
      const schemaKey = typeof m.schemaKey === 'string' ? m.schemaKey : undefined
      const inner = m.error ?? m
      const text = describeError(inner)
      out.push({ title: schemaKey ? `${schemaKey}: ${text}` : text, schemaKey })
    }
    return out
  }
  if (badType === 'size_violation') {
    out.push({ title: `Payload of ${String(failure.actualSizeBytes ?? '?')} bytes exceeds ${String(failure.maximumAllowedSizeBytes ?? '?')} bytes`, detail: typeof failure.expectation === 'string' ? failure.expectation : undefined })
    return out
  }
  if (isObj(failure.message)) { out.push({ title: describeError(failure.message) }); return out }
  if (typeof failure.message === 'string') { out.push({ title: failure.message }); return out }
  out.push({ title: describeError(failure) })
  return out
}

function param(list: unknown, name: string): string | null {
  if (!Array.isArray(list)) return null
  for (const p of list) if (isObj(p) && p.name === name && typeof p.value === 'string') return p.value
  return null
}

function unstructNameFromJson(text: string | null): string | null {
  if (!text) return null
  try {
    const json = JSON.parse(text)
    const inner = isObj(json) && isObj(json.data) ? json.data : null
    const schema = inner && typeof inner.schema === 'string' ? inner.schema : null
    return schema ? parseIgluUri(schema)?.name ?? null : null
  } catch {
    return null
  }
}

function decodeUePx(b64: string | null): string | null {
  if (!b64) return null
  try {
    return unstructNameFromJson(Buffer.from(b64, 'base64').toString('utf8'))
  } catch {
    return null
  }
}

const EVENT_CODES: Record<string, string> = { pv: 'page_view', pp: 'page_ping', se: 'struct', ue: 'unstruct', tr: 'transaction', ti: 'transaction_item' }

export function summarizeBadRow(raw: string): BadRowSummary {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (e) {
    return {
      badType: 'unparseable', badRowSchema: '', summary: 'Bad row is not valid JSON', messages: [{ title: String(e) }],
      schemaKeys: [], appId: null, eventName: null, eventId: null, platform: null, timestamp: null, processor: null,
      payload: raw, failure: null, parseError: String(e)
    }
  }
  const root = isObj(json) ? json : {}
  const badRowSchema = typeof root.schema === 'string' ? root.schema : ''
  const badType = parseIgluUri(badRowSchema)?.name ?? 'unknown'
  const data = isObj(root.data) ? root.data : {}
  const failure = data.failure
  const payload = data.payload
  const processorObj = isObj(data.processor) ? data.processor : null
  const processor = processorObj ? `${String(processorObj.artifact ?? '')} ${String(processorObj.version ?? '')}`.trim() : null

  const messages = messagesFor(badType, failure)
  const schemaKeys = new Set<string>(findIgluKeys(failure))
  for (const m of messages) if (m.schemaKey) schemaKeys.add(m.schemaKey)

  let appId: string | null = null
  let eventName: string | null = null
  let eventId: string | null = null
  let platform: string | null = null
  const enriched = isObj(payload) && isObj(payload.enriched) ? payload.enriched : null
  const rawPayload = isObj(payload) && isObj(payload.raw) ? payload.raw : (isObj(payload) && Array.isArray(payload.parameters) ? payload : null)
  if (enriched) {
    appId = typeof enriched.app_id === 'string' ? enriched.app_id : null
    eventName = typeof enriched.event_name === 'string' ? enriched.event_name : (typeof enriched.event === 'string' ? enriched.event : null)
    eventId = typeof enriched.event_id === 'string' ? enriched.event_id : null
    platform = typeof enriched.platform === 'string' ? enriched.platform : null
    if ((!eventName || eventName === 'unstruct') && typeof enriched.unstruct_event === 'string') {
      eventName = unstructNameFromJson(enriched.unstruct_event) ?? eventName
    }
  }
  if (rawPayload) {
    const params = rawPayload.parameters
    appId = appId ?? param(params, 'aid')
    platform = platform ?? param(params, 'p')
    eventId = eventId ?? param(params, 'eid')
    const e = param(params, 'e')
    if ((!eventName || eventName === 'unstruct') && e) eventName = e === 'ue' ? (unstructNameFromJson(param(params, 'ue_pr')) ?? decodeUePx(param(params, 'ue_px')) ?? 'unstruct') : (EVENT_CODES[e] ?? e)
    if (!eventName && typeof rawPayload.vendor === 'string') eventName = `${rawPayload.vendor}/${String(rawPayload.version ?? '')}`
  }
  const ts = isObj(failure) && typeof failure.timestamp === 'string' ? Date.parse(failure.timestamp) : NaN

  const first = messages[0]
  const summary = first
    ? (first.schemaKey && first.title.startsWith(`${first.schemaKey}: `) ? first.title.slice(first.schemaKey.length + 2) : first.title)
    : badType.replace(/_/g, ' ')
  return {
    badType, badRowSchema, summary, messages, schemaKeys: [...schemaKeys], appId, eventName, eventId, platform,
    timestamp: Number.isFinite(ts) ? ts : null, processor, payload, failure
  }
}
