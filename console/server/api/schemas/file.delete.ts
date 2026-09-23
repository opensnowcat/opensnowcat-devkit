export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const ref = validateRef({ vendor: String(q.vendor ?? ''), name: String(q.name ?? ''), format: String(q.format ?? 'jsonschema'), version: String(q.version ?? '') })
  await deleteSchema(ref)
  return { ok: true, uri: igluUri(ref) }
})
