async function enrichStartedAt(): Promise<number | null> {
  if (!dockerSocketPresent()) return null
  try {
    const info = await getDocker().getContainer(containerName('enrich')).inspect()
    const t = Date.parse(info.State?.StartedAt ?? '')
    return Number.isFinite(t) && info.State?.Running ? t : null
  } catch {
    return null
  }
}

export default defineEventHandler(async () => {
  const cfg = consoleConfig()
  const r = await readResolver()
  const startedAt = await enrichStartedAt()
  return {
    enrichStartedAt: startedAt,
    // true when the resolver file changed after enrich last started (enrich reads it only at startup)
    restartNeeded: startedAt == null ? null : r.mtimeMs > startedAt + 1000,
    ...r,
    consoleRegistryUrl: cfg.consoleRegistryUrl,
    folders: await allFolders(),
    snowcat: { proxyUrl: snowcatProxyUrl(), upstream: snowcatRegistryUrl(), configured: !!(await readSnowcatKey()) }
  }
})
