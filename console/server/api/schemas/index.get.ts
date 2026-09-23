export default defineEventHandler(async () => {
  const folders = await allFolders()
  let names: Record<string, string> = {}
  try {
    const { doc } = await readResolver()
    names = Object.fromEntries(doc.data.repositories.flatMap((r) => {
      const id = r.connection.http ? folderIdFromUrl(r.connection.http.uri) : null
      return id ? [[id, r.name]] : []
    }))
  } catch { /* resolver optional here */ }
  const out = []
  for (const f of folders) {
    const listing = f.exists ? await listSchemas(f.root) : { root: f.root, vendors: [], count: 0 }
    out.push({ ...f, name: names[f.id] ?? (f.primary ? 'Linked directory' : f.id), listing })
  }
  return { folders: out, count: out.reduce((n, f) => n + f.listing.count, 0) }
})
