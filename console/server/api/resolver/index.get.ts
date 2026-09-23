export default defineEventHandler(async () => {
  const cfg = consoleConfig()
  const r = await readResolver()
  return { ...r, consoleRegistryUrl: cfg.consoleRegistryUrl }
})
