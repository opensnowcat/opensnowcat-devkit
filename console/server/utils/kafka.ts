import { Admin, Consumer, stringDeserializers } from '@platformatic/kafka'
import type { Message } from '@platformatic/kafka'
import { eventBuffer } from './buffer'
import { parseEnrichedTsv } from './enriched'
import { summarizeBadRow } from './badrows'
import { consoleConfig } from './config'
import { sendEvents } from './collector'

type StringConsumer = Consumer<string, string, string, string>

interface KafkaState {
  consumer: StringConsumer | null
  admin: Admin | null
  starting: boolean
  stopped: boolean
}

const g = globalThis as unknown as { __osc_kafka?: KafkaState }
const state: KafkaState = g.__osc_kafka ?? (g.__osc_kafka = { consumer: null, admin: null, starting: false, stopped: false })

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function tstampToMs(v: string | null | undefined): number | null {
  if (!v) return null
  // enriched timestamps look like "2026-09-23 08:01:02.123"
  const iso = v.includes('T') ? v : v.replace(' ', 'T') + 'Z'
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

export function getAdmin(): Admin {
  if (!state.admin) {
    const cfg = consoleConfig()
    state.admin = new Admin({ clientId: 'opensnowcat-console-admin', bootstrapBrokers: cfg.kafkaBrokers, retries: 3, timeout: 10_000 })
  }
  return state.admin
}

async function ensureTopics(topics: string[]) {
  const admin = getAdmin()
  const existing = new Set(await admin.listTopics())
  const missing = topics.filter(t => !existing.has(t))
  if (!missing.length) return
  try {
    await admin.createTopics({ topics: missing, partitions: 1, replicas: 1 })
    console.info(`[console] created missing topics: ${missing.join(', ')}`)
  } catch (e) {
    console.warn(`[console] could not create topics ${missing.join(', ')}: ${String(e)}`)
  }
}

function ingest(msg: Message<string, string, string, string>) {
  const cfg = consoleConfig()
  const t = cfg.topics
  const msgTs = Number(msg.timestamp)
  const baseTs = Number.isFinite(msgTs) && msgTs > 0 ? msgTs : Date.now()
  const value = msg.value ?? ''
  const common = { topic: msg.topic, partition: msg.partition, offset: String(msg.offset), raw: value }

  if (msg.topic === t.enrichedGood) {
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

async function runConsumer(topics: string[]) {
  const cfg = consoleConfig()
  const consumer: StringConsumer = new Consumer({
    groupId: `opensnowcat-console-${process.pid}-${Date.now().toString(36)}`,
    clientId: 'opensnowcat-console',
    bootstrapBrokers: cfg.kafkaBrokers,
    deserializers: stringDeserializers,
    retries: 3,
    timeout: 10_000
  })
  state.consumer = consumer
  const stream = await consumer.consume({
    topics,
    mode: 'latest',
    fallbackMode: 'latest',
    autocommit: false,
    maxWaitTime: 500,
    sessionTimeout: 10_000,
    heartbeatInterval: 3_000
  })
  eventBuffer.kafka = { connected: true, error: null, brokers: cfg.kafkaBrokers, topics }
  console.info(`[console] tailing ${topics.join(', ')} from ${cfg.kafkaBrokers.join(',')}`)

  await new Promise<void>((resolve, reject) => {
    stream.on('data', (msg) => {
      try {
        ingest(msg)
      } catch (e) {
        console.warn('[console] failed to ingest message', e)
      }
    })
    stream.on('error', reject)
    stream.on('close', () => resolve())
    stream.on('end', () => resolve())
  })
}

export async function startKafka() {
  if (state.starting) return
  state.starting = true
  const cfg = consoleConfig()
  const topics = [cfg.topics.enrichedGood, cfg.topics.enrichedBad, cfg.topics.collectedBad]
  let attempt = 0
  while (!state.stopped) {
    try {
      await ensureTopics([cfg.topics.collectedGood, ...topics])
      attempt = 0
      await runConsumer(topics)
      eventBuffer.kafka = { ...eventBuffer.kafka, connected: false, error: 'stream closed' }
    } catch (e) {
      attempt++
      const message = e instanceof Error ? e.message : String(e)
      eventBuffer.kafka = { connected: false, error: message, brokers: cfg.kafkaBrokers, topics }
      console.warn(`[console] kafka error (attempt ${attempt}): ${message}`)
    }
    try {
      await state.consumer?.close(true)
    } catch { /* ignore */ }
    state.consumer = null
    await sleep(Math.min(10_000, 2_000 * Math.max(1, attempt)))
  }
}

export const PROBE_APP_ID = 'console-probe'

type LagConsumer = Consumer<string, string, string, string>
const lagState = (globalThis as unknown as { __osc_lag?: { consumer: LagConsumer | null } }).__osc_lag
  ?? ((globalThis as unknown as { __osc_lag?: { consumer: LagConsumer | null } }).__osc_lag = { consumer: null })

/** Committed offset of enrich's consumer group vs the end of the raw topic: how many raw payloads still wait for enrich. */
async function enrichLag(): Promise<number> {
  const cfg = consoleConfig()
  const admin = getAdmin()
  const end = await admin.listOffsets({ topics: [{ name: cfg.topics.collectedGood, partitions: [{ partitionIndex: 0, timestamp: BigInt(-1) }] }] })
  const endOffset = end[0]?.partitions[0]?.offset ?? BigInt(0)
  if (!lagState.consumer) {
    lagState.consumer = new Consumer({ groupId: cfg.enrichGroupId, clientId: 'opensnowcat-console-lag', bootstrapBrokers: cfg.kafkaBrokers, deserializers: stringDeserializers, retries: 1, timeout: 5_000 })
  }
  const committed = await lagState.consumer.listCommittedOffsets({ topics: [{ topic: cfg.topics.collectedGood, partitions: [0] }] })
  const c = committed.get(cfg.topics.collectedGood)?.[0]
  const committedOffset = c == null || c < BigInt(0) ? BigInt(0) : c
  const lag = endOffset - committedOffset
  return lag < BigInt(0) ? 0 : Number(lag)
}

/**
 * Pipeline probe: collector health, enrich group membership and lag, and a hidden end-to-end probe event.
 * "Ready" only once a probe page view sent through the collector comes back enriched.
 */
export function startPipelineProbe(): () => void {
  const cfg = consoleConfig()
  let stopped = false
  let running = false
  const tick = async () => {
    if (stopped || running) return
    running = true
    try {
      try {
        const res = await fetch(`${cfg.collectorUrl}/health`, { signal: AbortSignal.timeout(3_000) })
        eventBuffer.collector = { ready: res.ok, error: res.ok ? null : `Collector answered HTTP ${res.status}`, checkedAt: Date.now() }
      } catch (e) {
        eventBuffer.collector = { ready: false, error: (e as Error).name === 'TimeoutError' ? 'Collector did not answer in 3s' : ((e as Error).message ?? String(e)), checkedAt: Date.now() }
      }

      if (eventBuffer.kafka.connected) {
        try {
          const groups = await getAdmin().describeGroups({ groups: [cfg.enrichGroupId] })
          const g = groups.get(cfg.enrichGroupId) as { state?: unknown, members?: Map<string, unknown> } | undefined
          const members = g?.members instanceof Map ? g.members.size : 0
          const joined = members > 0
          if (!joined && eventBuffer.enrich.joined) eventBuffer.pipeline = { verified: false, probeSentAt: null, verifiedAt: null }
          let lag = eventBuffer.enrich.lag
          try {
            lag = await enrichLag()
          } catch { /* keep the previous value */ }
          eventBuffer.enrich = { joined, state: String(g?.state ?? 'unknown'), members, lag, error: null }
        } catch (e) {
          eventBuffer.enrich = { ...eventBuffer.enrich, joined: false, error: (e as Error).message ?? String(e) }
        }
      } else {
        eventBuffer.enrich = { joined: false, state: 'unknown', members: 0, lag: 0, error: null }
        eventBuffer.pipeline = { verified: false, probeSentAt: null, verifiedAt: null }
      }

      const p = eventBuffer.pipeline
      const canProbe = eventBuffer.kafka.connected && eventBuffer.collector.ready && eventBuffer.enrich.joined && !p.verified
      if (canProbe && (!p.probeSentAt || Date.now() - p.probeSentAt > 20_000)) {
        eventBuffer.pipeline = { ...p, probeSentAt: Date.now() }
        try {
          await sendEvents({ kind: 'good', count: 1, concurrency: 1, target: 'internal', appId: PROBE_APP_ID })
        } catch (e) {
          console.warn('[console] probe event failed', (e as Error).message ?? e)
        }
      }
    } finally {
      running = false
    }
  }
  void tick()
  const timer = setInterval(() => { void tick() }, 3_000)
  return () => {
    stopped = true
    clearInterval(timer)
    void lagState.consumer?.close(true).catch(() => undefined)
    lagState.consumer = null
  }
}

export async function stopKafka() {
  state.stopped = true
  try {
    await state.consumer?.close(true)
  } catch { /* ignore */ }
  try {
    await state.admin?.close()
  } catch { /* ignore */ }
  state.consumer = null
  state.admin = null
}

export interface TopicInfo {
  name: string
  partitions: number
  earliest: string
  latest: string
  messages: string
}

export async function describeTopics(): Promise<TopicInfo[]> {
  const admin = getAdmin()
  const names = (await admin.listTopics()).filter(n => !n.startsWith('__')).sort()
  if (!names.length) return []
  const meta = await admin.metadata({ topics: names })
  const requests = names.map((name) => {
    const t = meta.topics.get(name)
    const partitions = t ? [...t.partitions.keys()] : [0]
    return { name, partitions }
  })
  const latest = await admin.listOffsets({ topics: requests.map(r => ({ name: r.name, partitions: r.partitions.map(p => ({ partitionIndex: p, timestamp: BigInt(-1) })) })) })
  const earliest = await admin.listOffsets({ topics: requests.map(r => ({ name: r.name, partitions: r.partitions.map(p => ({ partitionIndex: p, timestamp: BigInt(-2) })) })) })
  const sum = (list: typeof latest, name: string) => list.filter(t => t.name === name).flatMap(t => t.partitions).reduce((acc, p) => acc + p.offset, BigInt(0))
  return requests.map((r) => {
    const hi = sum(latest, r.name)
    const lo = sum(earliest, r.name)
    return { name: r.name, partitions: r.partitions.length, earliest: lo.toString(), latest: hi.toString(), messages: (hi - lo).toString() }
  })
}

export interface GroupInfo {
  id: string
  state: string
  members: number
  protocolType: string
}

export async function describeGroups(): Promise<GroupInfo[]> {
  const admin = getAdmin()
  const groups = await admin.listGroups()
  const ids = [...groups.keys()].filter(id => !id.startsWith('opensnowcat-console'))
  if (!ids.length) return []
  const described = await admin.describeGroups({ groups: ids })
  return ids.map((id) => {
    const grp = described.get(id) as Record<string, unknown> | undefined
    const members = grp && grp.members instanceof Map ? grp.members.size : (Array.isArray(grp?.members) ? (grp!.members as unknown[]).length : 0)
    return { id, state: String(grp?.state ?? groups.get(id)?.state ?? 'unknown'), members, protocolType: String(grp?.protocolType ?? groups.get(id)?.protocolType ?? '') }
  })
}
