import {
  DescribeStreamSummaryCommand,
  GetRecordsCommand,
  GetShardIteratorCommand,
  KinesisClient,
  ListShardsCommand
} from '@aws-sdk/client-kinesis'
import type { Shard, ShardIteratorType } from '@aws-sdk/client-kinesis'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import { eventBuffer } from './buffer'
import { ingestRecord } from './ingest'
import { consoleConfig } from './config'
import { listManagedContainers } from './docker'
import type { StreamStats } from './buffer'

/**
 * Tails Kinesis streams with plain GetRecords polling, one loop per open shard, starting at the tip.
 * No KCL, no DynamoDB lease table: the console is just one more reader next to enrich.
 * Kinesis allows 5 GetRecords calls per second per shard across all readers, so idle shards are polled once a second.
 */

interface Generation { alive: boolean }

interface KinesisState {
  client: KinesisClient | null
  starting: boolean
  stopped: boolean
  generation: Generation | null
  /** MillisBehindLatest per stream/shard, from the console's own reads */
  behind: Map<string, number>
}

const g = globalThis as unknown as { __osc_kinesis?: KinesisState }
const state: KinesisState = g.__osc_kinesis ?? (g.__osc_kinesis = { client: null, starting: false, stopped: false, generation: null, behind: new Map() })

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const decoder = new TextDecoder()

const IDLE_POLL_MS = 1_000
const CATCH_UP_POLL_MS = 250
const THROTTLED_POLL_MS = 2_000
const SHARD_DISCOVERY_MS = 30_000
/** Consecutive failed reads on one shard before the whole tail restarts */
const MAX_SHARD_RETRIES = 5

/** Errors no retry fixes: bad credentials, missing stream, no permission */
const FATAL_ERRORS = new Set(['ResourceNotFoundException', 'AccessDeniedException', 'UnrecognizedClientException', 'ExpiredTokenException', 'CredentialsProviderError', 'InvalidSignatureException'])

export function getKinesis(): KinesisClient {
  // HTTP/1.1: the client defaults to HTTP/2 for SubscribeToShard, which polling does not use
  if (!state.client) state.client = new KinesisClient({ region: consoleConfig().kinesisRegion, requestHandler: new NodeHttpHandler() })
  return state.client
}

function errorName(e: unknown): string {
  return (e as { name?: string })?.name ?? ''
}

function describeError(e: unknown, stream?: string): string {
  const name = errorName(e)
  const region = consoleConfig().kinesisRegion
  if (name === 'ResourceNotFoundException' && stream) return `Stream ${stream} not found in ${region}`
  if (name === 'CredentialsProviderError') return 'No AWS credentials: pass AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY or AWS_PROFILE to the console'
  if (name === 'ExpiredTokenException' || name === 'UnrecognizedClientException') return 'AWS credentials expired or invalid, restart with fresh ones'
  return (e as Error)?.message ?? String(e)
}

/** Retries transient failures of a control call a few times before giving up */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (FATAL_ERRORS.has(errorName(e)) || attempt >= MAX_SHARD_RETRIES) throw e
      await sleep(500 * attempt)
    }
  }
}

async function listOpenShards(stream: string): Promise<Shard[]> {
  const shards: Shard[] = []
  let next: string | undefined
  do {
    const token = next
    const res = await withRetry(() => getKinesis().send(token
      ? new ListShardsCommand({ NextToken: token })
      : new ListShardsCommand({ StreamName: stream, ShardFilter: { Type: 'AT_LATEST' } })))
    shards.push(...(res.Shards ?? []))
    next = res.NextToken
  } while (next)
  return shards
}

async function shardIterator(stream: string, shardId: string, type: ShardIteratorType, after?: string): Promise<string | undefined> {
  const res = await withRetry(() => getKinesis().send(new GetShardIteratorCommand({
    StreamName: stream,
    ShardId: shardId,
    ShardIteratorType: after ? 'AFTER_SEQUENCE_NUMBER' : type,
    StartingSequenceNumber: after
  })))
  return res.ShardIterator
}

/** Reads one shard until it closes (after a reshard) or the generation ends. Throws on errors other than throttling. */
async function tailShard(gen: Generation, stream: string, shardId: string, partition: number, start: ShardIteratorType) {
  const key = `${stream}/${shardId}`
  let lastSeq: string | undefined
  let failures = 0
  let iterator = await shardIterator(stream, shardId, start)
  while (gen.alive && iterator) {
    try {
      const res = await getKinesis().send(new GetRecordsCommand({ ShardIterator: iterator, Limit: 1000 }))
      for (const r of res.Records ?? []) {
        lastSeq = r.SequenceNumber
        try {
          ingestRecord({
            stream,
            partition,
            offset: r.SequenceNumber ?? '',
            timestamp: r.ApproximateArrivalTimestamp?.getTime() ?? Date.now(),
            value: r.Data ? decoder.decode(r.Data) : ''
          })
        } catch (e) {
          console.warn('[console] failed to ingest record', e)
        }
      }
      const behind = res.MillisBehindLatest ?? 0
      state.behind.set(key, behind)
      iterator = res.NextShardIterator
      failures = 0
      await sleep((res.Records?.length ?? 0) > 0 && behind > 0 ? CATCH_UP_POLL_MS : IDLE_POLL_MS)
    } catch (e) {
      const name = errorName(e)
      if (name === 'ProvisionedThroughputExceededException' || name === 'LimitExceededException') {
        await sleep(THROTTLED_POLL_MS)
      } else if (name === 'ExpiredIteratorException') {
        iterator = await shardIterator(stream, shardId, 'LATEST', lastSeq)
      } else if (FATAL_ERRORS.has(name) || ++failures > MAX_SHARD_RETRIES) {
        throw e
      } else {
        // Network blips and 5xx: retry the same iterator, keeping the position
        await sleep(IDLE_POLL_MS * failures)
      }
    }
  }
  state.behind.delete(key)
}

/** Keeps one tail per open shard of a stream, picking up new shards after a reshard. */
async function tailStream(gen: Generation, stream: string) {
  const tailed = new Set<string>()
  const failures: unknown[] = []
  let first = true
  while (gen.alive) {
    if (failures.length) throw failures[0]
    const shards = await listOpenShards(stream)
    for (const shard of shards) {
      const id = shard.ShardId!
      if (tailed.has(id)) continue
      tailed.add(id)
      // Shards that appear after start are children of a reshard: read them from their beginning so nothing is skipped
      const start: ShardIteratorType = first ? 'LATEST' : 'TRIM_HORIZON'
      const partition = Number(id.replace(/\D/g, '')) || 0
      tailShard(gen, stream, id, partition, start)
        .catch((e) => { failures.push(e) })
        .finally(() => { tailed.delete(id) })
    }
    first = false
    for (let waited = 0; waited < SHARD_DISCOVERY_MS && gen.alive && !failures.length; waited += 500) await sleep(500)
  }
}

async function runKinesis(streams: string[]) {
  const cfg = consoleConfig()
  for (const stream of streams) {
    try {
      await withRetry(() => getKinesis().send(new DescribeStreamSummaryCommand({ StreamName: stream })))
    } catch (e) {
      throw new Error(describeError(e, stream), { cause: e })
    }
  }
  const gen: Generation = { alive: true }
  state.generation = gen
  eventBuffer.source = { type: 'kinesis', label: 'Kinesis', connected: true, error: null, endpoint: cfg.kinesisRegion, streams }
  console.info(`[console] tailing Kinesis ${streams.join(', ')} in ${cfg.kinesisRegion}`)
  try {
    await Promise.all(streams.map(s => tailStream(gen, s).catch((e) => { throw new Error(describeError(e, s), { cause: e }) })))
  } finally {
    gen.alive = false
    state.behind.clear()
  }
}

export async function startKinesis() {
  if (state.starting) return
  state.starting = true
  const cfg = consoleConfig()
  const streams = [cfg.topics.enrichedGood, cfg.topics.enrichedBad, cfg.topics.collectedBad]
  let attempt = 0
  while (!state.stopped) {
    try {
      await runKinesis(streams)
      attempt = 0
    } catch (e) {
      attempt++
      const message = (e as Error).message ?? String(e)
      eventBuffer.source = { type: 'kinesis', label: 'Kinesis', connected: false, error: message, endpoint: cfg.kinesisRegion, streams }
      console.warn(`[console] kinesis error (attempt ${attempt}): ${message}`)
    }
    await sleep(Math.min(15_000, 2_000 * Math.max(1, attempt)))
  }
}

export function stopKinesis() {
  state.stopped = true
  if (state.generation) state.generation.alive = false
  state.client?.destroy()
  state.client = null
}

/**
 * Kinesis has no consumer groups to inspect, so enrich counts as joined while its container runs.
 * When there is no local enrich container (enrich runs elsewhere, or no Docker socket), the probe event decides.
 */
export async function kinesisEnrichStatus(): Promise<StreamStats['enrich']> {
  const { available, containers } = await listManagedContainers()
  const enrich = containers.find(c => c.role === 'enrich')
  if (!available || !enrich?.found) return { joined: true, state: 'remote', members: 0, lag: 0, error: null }
  return {
    joined: enrich.running,
    state: enrich.state,
    members: enrich.running ? 1 : 0,
    lag: 0,
    error: enrich.running ? null : `Enrich container is ${enrich.state}`
  }
}

export interface StreamInfo {
  name: string
  status: string
  mode: string
  shards: number
  retentionHours: number
  /** How far the console's reader is behind the tip, when the console tails this stream */
  behindMs: number | null
  error: string | null
}

export async function describeStreams(): Promise<StreamInfo[]> {
  const cfg = consoleConfig()
  const t = cfg.topics
  const names = [t.collectedGood, t.collectedBad, t.enrichedGood, t.enrichedBad]
  return Promise.all(names.map(async (name) => {
    try {
      const res = await getKinesis().send(new DescribeStreamSummaryCommand({ StreamName: name }))
      const d = res.StreamDescriptionSummary
      const behind = [...state.behind.entries()].filter(([k]) => k.startsWith(`${name}/`)).map(([, v]) => v)
      return {
        name,
        status: d?.StreamStatus ?? 'UNKNOWN',
        mode: d?.StreamModeDetails?.StreamMode ?? 'PROVISIONED',
        shards: d?.OpenShardCount ?? 0,
        retentionHours: d?.RetentionPeriodHours ?? 0,
        behindMs: behind.length ? Math.max(...behind) : null,
        error: null
      }
    } catch (e) {
      return { name, status: 'MISSING', mode: '', shards: 0, retentionHours: 0, behindMs: null, error: describeError(e, name) }
    }
  }))
}
