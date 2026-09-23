import type { ContainerRole } from '../../utils/docker'

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const role = String(q.role ?? 'enrich') as ContainerRole
  if (!['enrich', 'collector', 'bento', 'kafka', 'tunnel'].includes(role)) throw createError({ statusCode: 400, statusMessage: 'Unknown role' })
  const tail = Math.max(10, Math.min(2000, Number(q.tail ?? 200)))
  return { role, name: containerName(role), logs: await containerLogs(role, tail) }
})
