import type { StreamEvent } from '../utils/buffer'

export default defineEventHandler((event) => {
  const stream = createEventStream(event)
  const q = getQuery(event)
  const limit = Math.max(0, Math.min(3000, Number(q.limit ?? 500)))

  const send = (type: string, data: unknown) => stream.push({ event: type, data: JSON.stringify(data) }).catch(() => undefined)

  const onBatch = (batch: StreamEvent[]) => { void send('batch', batch) }
  const onCleared = () => { void send('cleared', {}) }
  eventBuffer.on('batch', onBatch)
  eventBuffer.on('cleared', onCleared)
  const statsTimer = setInterval(() => { void send('stats', eventBuffer.stats()) }, 1000)

  stream.onClosed(async () => {
    eventBuffer.off('batch', onBatch)
    eventBuffer.off('cleared', onCleared)
    clearInterval(statsTimer)
    await stream.close()
  })

  // Do not await: the writer only drains once the response is being consumed.
  void send('snapshot', { events: eventBuffer.snapshot(limit), stats: eventBuffer.stats() })
  return stream.send()
})
