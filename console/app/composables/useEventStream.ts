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

const CAP = 3000
let source: EventSource | null = null

export function useEventStream() {
  const events = useState<StreamEvent[]>('osc-events', () => [])
  const stats = useState<StreamStats | null>('osc-stats', () => null)
  const connected = useState<boolean>('osc-connected', () => false)
  const paused = useState<boolean>('osc-paused', () => false)
  const frozen = useState<StreamEvent[]>('osc-frozen', () => [])
  const pendingWhilePaused = useState<number>('osc-pending', () => 0)

  const visible = computed(() => paused.value ? frozen.value : events.value)
  /** Kafka tailing and the collector both answer: sending events will work. */
  const ready = computed(() => connected.value && !!stats.value?.ready)
  const readiness = computed(() => {
    if (!connected.value) return { label: 'Connecting to the console', detail: null as string | null }
    if (!stats.value?.kafka.connected) return { label: 'Waiting for Kafka', detail: stats.value?.kafka.error ?? null }
    if (!stats.value?.collector.ready) return { label: 'Waiting for the collector', detail: stats.value?.collector.error ?? null }
    return { label: 'Ready', detail: null }
  })

  function append(batch: StreamEvent[]) {
    if (!batch.length) return
    const next = events.value.concat(batch)
    events.value = next.length > CAP ? next.slice(next.length - CAP) : next
    if (paused.value) pendingWhilePaused.value += batch.length
  }

  function connect() {
    if (import.meta.server || source) return
    source = new EventSource('/api/stream?limit=500')
    source.addEventListener('snapshot', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { events: StreamEvent[], stats: StreamStats }
      events.value = data.events
      stats.value = data.stats
      connected.value = true
    })
    source.addEventListener('batch', (e) => {
      append(JSON.parse((e as MessageEvent).data) as StreamEvent[])
    })
    source.addEventListener('stats', (e) => {
      stats.value = JSON.parse((e as MessageEvent).data) as StreamStats
      connected.value = true
    })
    source.addEventListener('cleared', () => {
      events.value = []
      frozen.value = []
      pendingWhilePaused.value = 0
    })
    source.onerror = () => {
      connected.value = false
    }
  }

  function disconnect() {
    source?.close()
    source = null
    connected.value = false
  }

  function pause() {
    frozen.value = events.value.slice()
    pendingWhilePaused.value = 0
    paused.value = true
  }

  function resume() {
    paused.value = false
    frozen.value = []
    pendingWhilePaused.value = 0
  }

  async function clear() {
    events.value = []
    frozen.value = []
    pendingWhilePaused.value = 0
    await $fetch('/api/events/clear', { method: 'POST' })
  }

  return { events, visible, stats, connected, paused, pendingWhilePaused, ready, readiness, connect, disconnect, pause, resume, clear }
}
