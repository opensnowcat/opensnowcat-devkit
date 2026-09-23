import { randomUUID } from 'node:crypto'
import { consoleConfig } from './config'
import { tunnelStatus } from './tunnel'

export type SendKind = 'good' | 'bad_schema' | 'bad_payload' | 'custom'
export type SendTarget = 'internal' | 'public' | 'tunnel' | string

export interface CustomEvent {
  schema: string
  data: unknown
  contexts?: Array<{ schema: string, data: unknown }>
}

export interface SendRequest {
  kind: SendKind
  count: number
  concurrency: number
  target: SendTarget
  appId?: string
  custom?: CustomEvent
}

export interface SendResult {
  endpoint: string
  requested: number
  ok: number
  failed: number
  statusCodes: Record<string, number>
  durationMs: number
  errors: string[]
}

const PAYLOAD_SCHEMA = 'iglu:com.snowplowanalytics.snowplow/payload_data/jsonschema/1-0-4'
const BAD_PAYLOAD_SCHEMA = 'iglu:com.snowplowanalytics.snowplow/non_existent/jsonschema/1-0-4'
const UNSTRUCT_SCHEMA = 'iglu:com.snowplowanalytics.snowplow/unstruct_event/jsonschema/1-0-0'
const CONTEXTS_SCHEMA = 'iglu:com.snowplowanalytics.snowplow/contexts/jsonschema/1-0-1'
const MISSING_EVENT_SCHEMA = 'iglu:com.example/does_not_exist/jsonschema/1-0-0'

export async function resolveTarget(target: SendTarget): Promise<string> {
  const cfg = consoleConfig()
  if (target === 'internal') return cfg.collectorUrl
  if (target === 'public') return cfg.collectorPublicUrl
  if (target === 'tunnel') {
    const t = await tunnelStatus()
    if (!t.url) throw createError({ statusCode: 400, statusMessage: 'No tunnel is running. Start one on the Expose page first.' })
    return t.url
  }
  if (/^https?:\/\//.test(target)) return target.replace(/\/+$/, '')
  throw createError({ statusCode: 400, statusMessage: `Unknown target "${target}"` })
}

interface Session {
  sid: string
  duid: string
  vid: string
}

function baseEvent(session: Session, appId: string): Record<string, string> {
  const now = String(Date.now())
  return {
    tv: 'js-3.24.0',
    tna: 'console',
    aid: appId,
    p: 'web',
    tz: 'Europe/Lisbon',
    lang: 'en-US',
    cs: 'UTF-8',
    res: '1920x1200',
    cd: '24',
    cookie: '1',
    eid: randomUUID(),
    dtm: now,
    stm: now,
    vp: '1920x484',
    ds: '1920x6277',
    vid: session.vid,
    sid: session.sid,
    duid: session.duid
  }
}

function pageView(session: Session, appId: string, i: number): Record<string, string> {
  const pages = ['/', '/pricing', '/docs', '/blog/opensnowcat-console', '/about']
  const path = pages[i % pages.length]!
  return {
    ...baseEvent(session, appId),
    e: 'pv',
    url: `https://www.example.com${path}?utm_source=console&utm_medium=devkit&utm_campaign=test`,
    page: `Example ${path === '/' ? 'Home' : path.slice(1)}`,
    refr: i % 3 === 0 ? 'https://www.google.com/' : ''
  }
}

function unstructEvent(session: Session, appId: string, custom: CustomEvent): Record<string, string> {
  const ev: Record<string, string> = {
    ...baseEvent(session, appId),
    e: 'ue',
    url: 'https://www.example.com/',
    page: 'Example Home',
    ue_pr: JSON.stringify({ schema: UNSTRUCT_SCHEMA, data: { schema: custom.schema, data: custom.data } })
  }
  if (custom.contexts?.length) ev.co = JSON.stringify({ schema: CONTEXTS_SCHEMA, data: custom.contexts })
  return ev
}

export function buildEvents(req: SendRequest): { schema: string, events: Record<string, string>[] } {
  const session: Session = { sid: randomUUID(), duid: randomUUID(), vid: String((Math.floor(Math.random() * 20)) + 1) }
  const appId = req.appId?.trim() || 'console'
  const events: Record<string, string>[] = []
  for (let i = 0; i < req.count; i++) {
    switch (req.kind) {
      case 'good':
        events.push(pageView(session, appId, i))
        break
      case 'bad_payload':
        events.push(pageView(session, appId, i))
        break
      case 'bad_schema':
        events.push(unstructEvent(session, appId, { schema: MISSING_EVENT_SCHEMA, data: { reason: 'this schema does not exist in any registry', index: i } }))
        break
      case 'custom':
        if (!req.custom?.schema) throw createError({ statusCode: 400, statusMessage: 'Custom events need a schema and data' })
        events.push(unstructEvent(session, appId, req.custom))
        break
    }
  }
  return { schema: req.kind === 'bad_payload' ? BAD_PAYLOAD_SCHEMA : PAYLOAD_SCHEMA, events }
}

export async function sendEvents(req: SendRequest): Promise<SendResult> {
  const count = Math.max(1, Math.min(5000, Math.floor(req.count || 1)))
  const concurrency = Math.max(1, Math.min(50, Math.floor(req.concurrency || 4)))
  const base = await resolveTarget(req.target)
  const endpoint = `${base}/com.snowplowanalytics.snowplow/tp2`
  const { schema, events } = buildEvents({ ...req, count })
  const started = Date.now()
  const statusCodes: Record<string, number> = {}
  const errors: string[] = []
  let ok = 0
  let failed = 0
  let cursor = 0
  const worker = async () => {
    while (cursor < events.length) {
      const ev = events[cursor++]!
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'user-agent': 'OpenSnowcat Console/0.1 (+devkit)' },
          body: JSON.stringify({ schema, data: [ev] }),
          signal: AbortSignal.timeout(15_000)
        })
        statusCodes[String(res.status)] = (statusCodes[String(res.status)] ?? 0) + 1
        if (res.ok) ok++
        else failed++
        await res.arrayBuffer().catch(() => undefined)
      } catch (e) {
        failed++
        const msg = (e as Error).message ?? String(e)
        if (errors.length < 5 && !errors.includes(msg)) errors.push(msg)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, events.length) }, () => worker()))
  return { endpoint, requested: count, ok, failed, statusCodes, durationMs: Date.now() - started, errors }
}
