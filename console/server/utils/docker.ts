import Docker from 'dockerode'
import { existsSync } from 'node:fs'
import { consoleConfig } from './config'

export type ContainerRole = 'enrich' | 'collector' | 'bento' | 'kafka' | 'tunnel'
export const RESTARTABLE: ContainerRole[] = ['enrich', 'collector', 'bento']

const g = globalThis as unknown as { __osc_docker?: Docker }

export function getDocker(): Docker {
  if (!g.__osc_docker) {
    const socketPath = consoleConfig().dockerSocket
    g.__osc_docker = new Docker({ socketPath })
  }
  return g.__osc_docker
}

export function dockerSocketPresent(): boolean {
  const p = consoleConfig().dockerSocket
  return existsSync(p)
}

export function containerName(role: ContainerRole): string {
  return consoleConfig().containers[role]
}

export interface ContainerStatus {
  role: ContainerRole
  name: string
  found: boolean
  running: boolean
  state: string
  status: string
  image: string
  id: string | null
  startedAt: string | null
}

export async function listManagedContainers(): Promise<{ available: boolean, error: string | null, containers: ContainerStatus[] }> {
  const cfg = consoleConfig()
  const roles: ContainerRole[] = ['collector', 'enrich', 'bento', 'kafka', 'tunnel']
  const base = roles.map(role => ({ role, name: cfg.containers[role], found: false, running: false, state: 'missing', status: 'not created', image: '', id: null, startedAt: null } as ContainerStatus))
  if (!dockerSocketPresent()) return { available: false, error: `Docker socket not found at ${cfg.dockerSocket}`, containers: base }
  try {
    const docker = getDocker()
    const all = await docker.listContainers({ all: true })
    for (const c of all) {
      const names = (c.Names ?? []).map(n => n.replace(/^\//, ''))
      const entry = base.find(b => names.includes(b.name))
      if (!entry) continue
      entry.found = true
      entry.running = c.State === 'running'
      entry.state = c.State ?? 'unknown'
      entry.status = c.Status ?? ''
      entry.image = c.Image ?? ''
      entry.id = c.Id ?? null
    }
    return { available: true, error: null, containers: base }
  } catch (e) {
    return { available: false, error: (e as Error).message ?? String(e), containers: base }
  }
}

export async function restartContainer(role: ContainerRole): Promise<{ name: string }> {
  if (!RESTARTABLE.includes(role)) throw createError({ statusCode: 400, statusMessage: `Container role "${role}" cannot be restarted from the console` })
  const name = containerName(role)
  const docker = getDocker()
  const container = docker.getContainer(name)
  try {
    await container.restart({ t: 10 })
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    if (status === 404) throw createError({ statusCode: 404, statusMessage: `Container ${name} not found. Is the devkit running?` })
    throw createError({ statusCode: 502, statusMessage: `Docker restart failed: ${(e as Error).message ?? String(e)}` })
  }
  return { name }
}

/** Docker multiplexes stdout/stderr with 8-byte frame headers when the container has no TTY. */
export function demuxLogs(buf: Buffer): string {
  let i = 0
  const parts: string[] = []
  let looksMultiplexed = buf.length >= 8 && buf[0]! <= 2 && buf[1] === 0 && buf[2] === 0 && buf[3] === 0
  while (looksMultiplexed && i + 8 <= buf.length) {
    const type = buf[i]!
    const size = buf.readUInt32BE(i + 4)
    if (type > 2 || size > buf.length - i - 8) { looksMultiplexed = false; break }
    parts.push(buf.subarray(i + 8, i + 8 + size).toString('utf8'))
    i += 8 + size
  }
  if (!looksMultiplexed && parts.length === 0) return buf.toString('utf8')
  return parts.join('')
}

export async function containerLogs(role: ContainerRole, tail = 200): Promise<string> {
  const name = containerName(role)
  const docker = getDocker()
  const container = docker.getContainer(name)
  try {
    const out = await container.logs({ stdout: true, stderr: true, tail, follow: false, timestamps: false }) as unknown as Buffer
    return demuxLogs(Buffer.isBuffer(out) ? out : Buffer.from(String(out)))
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    if (status === 404) throw createError({ statusCode: 404, statusMessage: `Container ${name} not found` })
    throw createError({ statusCode: 502, statusMessage: `Docker logs failed: ${(e as Error).message ?? String(e)}` })
  }
}
