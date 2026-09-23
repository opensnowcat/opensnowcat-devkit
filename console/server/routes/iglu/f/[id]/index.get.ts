export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const root = await folderRoot(id)
  const listing = await listSchemas(root)
  return { registry: `OpenSnowcat Console folder registry "${id}"`, layout: `/iglu/f/${id}/schemas/{vendor}/{name}/{format}/{version}`, root, count: listing.count, schemas: listing.vendors.flatMap(v => v.names.flatMap(n => n.versions.map(x => x.uri))) }
})
