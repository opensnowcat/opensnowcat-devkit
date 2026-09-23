import { EventEmitter } from 'node:events'

export type EventKind = 'good' | 'bad'

export interface StreamEvent {
  id: string
  seq: number
  ts: number
  receivedAt: number
  topic: string
  partition: number
  offset: string
  kind: EventKind
  appId: string | null
  platform: string | null
  eventName: string | null
  eventId: string | null
  schema: string | null
  schemaKeys: string[]
  userId: string | null
  domainUserId: string | null
  badType: string | null
  summary: string
  /** Kind-specific parsed payload: ParsedEnrichedEvent for good, BadRowSummary for bad */
  detail: unknown
  raw: string
}

export interface StreamStats {
  totalGood: number
  totalBad: number
  buffered: number
  capacity: number
  goodPerSecond: number
  badPerSecond: number
  lastEventAt: number | null
  startedAt: number
  kafka: { connected: boolean, error: string | null, brokers: string[], topics: string[] }
  collector: { ready: boolean, error: string | null, checkedAt: number | null }
  ready: boolean
}

const CAPACITY = 3000
const RATE_WINDOW_MS = 10_000

class EventBuffer extends EventEmitter {
  private events: StreamEvent[] = []
  private pending: StreamEvent[] = []
  private seq = 0
  private flushTimer: NodeJS.Timeout | null = null
  private recent: Array<{ ts: number, kind: EventKind }> = []
  totalGood = 0
  totalBad = 0
  lastEventAt: number | null = null
  readonly startedAt = Date.now()
  kafka: StreamStats['kafka'] = { connected: false, error: null, brokers: [], topics: [] }
  collector: StreamStats['collector'] = { ready: false, error: null, checkedAt: null }

  push(partial: Omit<StreamEvent, 'seq' | 'id' | 'receivedAt'>) {
    const seq = ++this.seq
    const ev: StreamEvent = { ...partial, seq, id: `${partial.topic}:${partial.partition}:${partial.offset}:${seq}`, receivedAt: Date.now() }
    this.events.push(ev)
    if (this.events.length > CAPACITY) this.events.splice(0, this.events.length - CAPACITY)
    if (ev.kind === 'good') this.totalGood++
    else this.totalBad++
    this.lastEventAt = ev.receivedAt
    this.recent.push({ ts: ev.receivedAt, kind: ev.kind })
    this.pending.push(ev)
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 200)
  }

  private flush() {
    this.flushTimer = null
    if (!this.pending.length) return
    const batch = this.pending
    this.pending = []
    this.emit('batch', batch)
  }

  snapshot(limit = 500): StreamEvent[] {
    return this.events.slice(-limit)
  }

  clear() {
    this.events = []
    this.pending = []
    this.emit('cleared')
  }

  stats(): StreamStats {
    const now = Date.now()
    const cutoff = now - RATE_WINDOW_MS
    while (this.recent.length && this.recent[0]!.ts < cutoff) this.recent.shift()
    let g = 0
    let b = 0
    for (const r of this.recent) {
      if (r.kind === 'good') g++
      else b++
    }
    return {
      totalGood: this.totalGood,
      totalBad: this.totalBad,
      buffered: this.events.length,
      capacity: CAPACITY,
      goodPerSecond: Math.round((g / (RATE_WINDOW_MS / 1000)) * 10) / 10,
      badPerSecond: Math.round((b / (RATE_WINDOW_MS / 1000)) * 10) / 10,
      lastEventAt: this.lastEventAt,
      startedAt: this.startedAt,
      kafka: this.kafka,
      collector: this.collector,
      ready: this.kafka.connected && this.collector.ready
    }
  }
}

const g = globalThis as unknown as { __osc_buffer?: EventBuffer }
export const eventBuffer: EventBuffer = g.__osc_buffer ?? (g.__osc_buffer = new EventBuffer())
