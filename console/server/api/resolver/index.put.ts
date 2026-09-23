import type { ResolverDoc } from '../../utils/resolver'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ doc?: ResolverDoc, restart?: boolean }>(event)
  if (!body?.doc) throw createError({ statusCode: 400, statusMessage: 'Missing resolver document' })
  const saved = await writeResolver(body.doc)
  let restarted: { name: string } | null = null
  let restartError: string | null = null
  if (body.restart !== false) {
    try {
      restarted = await restartContainer('enrich')
    } catch (e) {
      restartError = (e as { statusMessage?: string, message?: string }).statusMessage ?? (e as Error).message ?? String(e)
    }
  }
  return { ...saved, restarted, restartError }
})
