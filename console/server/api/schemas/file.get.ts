export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const folder = String(q.folder ?? LOCAL_FOLDER_ID)
  const ref = validateRef({ vendor: String(q.vendor ?? ''), name: String(q.name ?? ''), format: String(q.format ?? 'jsonschema'), version: String(q.version ?? '') })
  const root = await folderRoot(folder)
  const file = await readSchema(root, ref)
  return { folder, ref, uri: igluUri(ref), servedAt: `${folderRegistryUrl(folder)}/schemas/${ref.vendor}/${ref.name}/${ref.format}/${ref.version}`, ...file, lint: lintSchema(ref, file.content) }
})
