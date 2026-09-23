import type { ContainerRole } from '../../utils/docker'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ role?: ContainerRole }>(event)
  if (!body?.role) throw createError({ statusCode: 400, statusMessage: 'Missing role' })
  return restartContainer(body.role)
})
