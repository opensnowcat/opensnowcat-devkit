import { consoleConfig } from './config'
import { containerLogs, dockerSocketPresent, getDocker } from './docker'

export interface TunnelStatus {
  available: boolean
  running: boolean
  url: string | null
  target: string
  containerName: string
  image: string
  error: string | null
  logs: string
}

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/g

export function findTunnelUrl(logs: string): string | null {
  const all = logs.match(URL_RE)
  return all && all.length ? all[all.length - 1]! : null
}

export async function tunnelStatus(): Promise<TunnelStatus> {
  const cfg = consoleConfig()
  const base: TunnelStatus = { available: dockerSocketPresent(), running: false, url: null, target: cfg.tunnelTarget, containerName: cfg.containers.tunnel, image: cfg.tunnelImage, error: null, logs: '' }
  if (!base.available) { base.error = `Docker socket not found at ${cfg.dockerSocket}`; return base }
  try {
    const info = await getDocker().getContainer(cfg.containers.tunnel).inspect()
    base.running = !!info.State?.Running
    if (base.running) {
      base.logs = await containerLogs('tunnel', 80)
      base.url = findTunnelUrl(base.logs)
    }
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    if (status !== 404) base.error = (e as Error).message ?? String(e)
  }
  return base
}

async function ensureImage(image: string): Promise<void> {
  const docker = getDocker()
  try {
    await docker.getImage(image).inspect()
    return
  } catch { /* pull below */ }
  await new Promise<void>((resolve, reject) => {
    docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) return reject(err)
      docker.modem.followProgress(stream, (e: Error | null) => e ? reject(e) : resolve())
    })
  })
}

export async function startTunnel(): Promise<TunnelStatus> {
  const cfg = consoleConfig()
  if (!dockerSocketPresent()) throw createError({ statusCode: 503, statusMessage: `Docker socket not found at ${cfg.dockerSocket}` })
  const docker = getDocker()
  const existing = await tunnelStatus()
  if (existing.running) return existing
  try {
    await docker.getContainer(cfg.containers.tunnel).remove({ force: true })
  } catch { /* not there */ }
  await ensureImage(cfg.tunnelImage)
  const container = await docker.createContainer({
    name: cfg.containers.tunnel,
    Image: cfg.tunnelImage,
    Cmd: ['tunnel', '--no-autoupdate', '--url', cfg.tunnelTarget],
    HostConfig: { NetworkMode: cfg.dockerNetwork, AutoRemove: true },
    Labels: { 'io.opensnowcat.console': 'tunnel' }
  })
  await container.start()
  // give cloudflared a moment to print the URL
  const deadline = Date.now() + 20_000
  let status = await tunnelStatus()
  while (!status.url && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1_000))
    status = await tunnelStatus()
  }
  return status
}

export async function stopTunnel(): Promise<TunnelStatus> {
  const cfg = consoleConfig()
  try {
    await getDocker().getContainer(cfg.containers.tunnel).stop({ t: 5 })
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    if (status !== 404 && status !== 304) throw createError({ statusCode: 502, statusMessage: (e as Error).message ?? String(e) })
  }
  try {
    await getDocker().getContainer(cfg.containers.tunnel).remove({ force: true })
  } catch { /* auto-removed */ }
  return tunnelStatus()
}
