export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const ref = validateRef({ vendor: String(q.vendor ?? ''), name: String(q.name ?? ''), format: String(q.format ?? 'jsonschema'), version: String(q.version ?? '') })
  const file = await readSchema(ref)
  return { ref, uri: igluUri(ref), ...file, lint: lintSchema(ref, file.content) }
})
