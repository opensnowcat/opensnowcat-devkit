import type { ResolverDoc } from '../../utils/resolver'
import type { FolderEntry } from '../../utils/folders'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ doc?: ResolverDoc, folders?: FolderEntry[], restart?: boolean }>(event)
  if (!body?.doc) throw createError({ statusCode: 400, statusMessage: 'Missing resolver document' })
  if (Array.isArray(body.folders)) await writeFolders(body.folders)
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
  return { ...saved, restarted, restartError, folders: await allFolders() }
})
