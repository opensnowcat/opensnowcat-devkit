import type { SendRequest } from '../utils/collector'

export default defineEventHandler(async (event) => {
  const body = await readBody<Partial<SendRequest>>(event)
  const kind = body?.kind ?? 'good'
  if (!['good', 'bad_schema', 'bad_payload', 'custom'].includes(kind)) throw createError({ statusCode: 400, statusMessage: 'Unknown kind' })
  return sendEvents({
    kind,
    count: Number(body?.count ?? 10),
    concurrency: Number(body?.concurrency ?? 4),
    target: body?.target ?? 'internal',
    appId: body?.appId,
    custom: body?.custom
  })
})
