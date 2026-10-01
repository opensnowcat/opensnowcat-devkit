import { eventBuffer } from './buffer'
import { parseEnrichedTsv } from './enriched'
import { summarizeBadRow } from './badrows'
import { consoleConfig } from './config'

export const PROBE_APP_ID = 'console-probe'

function tstampToMs(v: string | null | undefined): number | null {
  if (!v) return null
  // enriched timestamps look like "2026-09-23 08:01:02.123"
  const iso = v.includes('T') ? v : v.replace(' ', 'T') + 'Z'
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

/** One record read from Kafka or Kinesis: the enriched TSV or a bad row JSON. */
export interface SourceRecord {
  /** Topic or stream name */
  stream: string
  /** Partition, or the shard's position in the stream */
  partition: number
  /** Offset, or the Kinesis sequence number */
  offset: string
  /** Broker or arrival timestamp in ms, used when the payload has none */
  timestamp: number
  value: string
}

export function ingestRecord(msg: SourceRecord) {
  const cfg = consoleConfig()
  const t = cfg.topics
  const baseTs = Number.isFinite(msg.timestamp) && msg.timestamp > 0 ? msg.timestamp : Date.now()
  const value = msg.value
  const common = { topic: msg.stream, partition: msg.partition, offset: msg.offset, raw: value }

  if (msg.stream === t.enrichedGood) {
    const parsed = parseEnrichedTsv(value)
    const a = parsed.atomic
    if (a.app_id === PROBE_APP_ID) {
      if (!eventBuffer.pipeline.verified) console.info('[console] pipeline verified: probe event came back enriched')
      eventBuffer.pipeline = { ...eventBuffer.pipeline, verified: true, verifiedAt: Date.now() }
      return
    }
    const eventName = a.event_name ?? a.event ?? null
    const schemaKeys = [
      ...(parsed.unstruct ? [parsed.unstruct.schema] : []),
      ...parsed.contexts.map(c => c.schema),
      ...parsed.derivedContexts.map(c => c.schema)
    ]
    const where = a.page_url ?? a.se_action ?? ''
    eventBuffer.push({
      ...common,
      kind: 'good',
      ts: tstampToMs(a.collector_tstamp) ?? baseTs,
      appId: a.app_id ?? null,
      platform: a.platform ?? null,
      eventName,
      eventId: a.event_id ?? null,
      schema: parsed.unstruct?.schema ?? null,
      schemaKeys,
      userId: a.user_id ?? null,
      domainUserId: a.domain_userid ?? null,
      badType: null,
      summary: [eventName ?? 'event', where].filter(Boolean).join(' · '),
      detail: parsed
    })
    return
  }

  const bad = summarizeBadRow(value)
  if (bad.appId === PROBE_APP_ID) {
    eventBuffer.pipeline = { ...eventBuffer.pipeline, verified: true, verifiedAt: Date.now() }
    return
  }
  eventBuffer.push({
    ...common,
    kind: 'bad',
    ts: bad.timestamp ?? baseTs,
    appId: bad.appId,
    platform: bad.platform,
    eventName: bad.eventName,
    eventId: bad.eventId,
    schema: bad.schemaKeys[0] ?? null,
    schemaKeys: bad.schemaKeys,
    userId: null,
    domainUserId: null,
    badType: bad.badType,
    summary: bad.summary,
    detail: bad
  })
}
