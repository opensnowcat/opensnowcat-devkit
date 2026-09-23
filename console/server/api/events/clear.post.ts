export default defineEventHandler(() => {
  eventBuffer.clear()
  return { ok: true }
})
