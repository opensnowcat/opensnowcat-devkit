export default defineEventHandler((event) => {
  const q = getQuery(event)
  const limit = Math.max(0, Math.min(3000, Number(q.limit ?? 500)))
  return { events: eventBuffer.snapshot(limit), stats: eventBuffer.stats() }
})
