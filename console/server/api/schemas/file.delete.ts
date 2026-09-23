export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const folder = String(q.folder ?? LOCAL_FOLDER_ID)
  const ref = validateRef({ vendor: String(q.vendor ?? ''), name: String(q.name ?? ''), format: String(q.format ?? 'jsonschema'), version: String(q.version ?? '') })
  await deleteSchema(await folderRoot(folder), ref)
  return { ok: true, uri: igluUri(ref) }
})
