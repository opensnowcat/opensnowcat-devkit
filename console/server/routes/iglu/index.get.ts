export default defineEventHandler(async () => {
  const listing = await listSchemas()
  return {
    registry: 'OpenSnowcat Console local schema registry',
    layout: '/iglu/schemas/{vendor}/{name}/{format}/{version}',
    root: listing.root,
    count: listing.count,
    schemas: listing.vendors.flatMap(v => v.names.flatMap(n => n.versions.map(x => x.uri)))
  }
})
