import { resolve } from 'node:path'

export interface ConsoleConfig {
  kafkaBrokers: string[]
  topics: {
    collectedGood: string
    collectedBad: string
    enrichedGood: string
    enrichedBad: string
    enrichedJson: string
  }
  schemasDir: string
  opensnowcatDir: string
  collectorUrl: string
  collectorPublicUrl: string
  consolePublicUrl: string
  consoleRegistryUrl: string
  dockerSocket: string
  dockerNetwork: string
  containers: {
    enrich: string
    collector: string
    bento: string
    kafka: string
    tunnel: string
  }
  tunnelTarget: string
  tunnelImage: string
  hostHomeMount: string
  hostHomePath: string
  enrichGroupId: string
}

function str(v: unknown, fallback: string): string {
  const s = v == null ? '' : String(v).trim()
  return s.length ? s : fallback
}

export function consoleConfig(): ConsoleConfig {
  const c = useRuntimeConfig() as Record<string, unknown> & { public: Record<string, unknown> }
  return {
    kafkaBrokers: str(c.kafkaBrokers, 'localhost:9092').split(',').map(s => s.trim()).filter(Boolean),
    topics: {
      collectedGood: str(c.topicCollectedGood, 'collected-good'),
      collectedBad: str(c.topicCollectedBad, 'collected-bad'),
      enrichedGood: str(c.topicEnrichedGood, 'enriched-good'),
      enrichedBad: str(c.topicEnrichedBad, 'enriched-bad'),
      enrichedJson: str(c.topicEnrichedJson, 'enriched-good-json')
    },
    schemasDir: resolve(str(c.schemasDir, '../schemas')),
    opensnowcatDir: resolve(str(c.opensnowcatDir, '../opensnowcat')),
    collectorUrl: str(c.collectorUrl, 'http://localhost:8080').replace(/\/+$/, ''),
    collectorPublicUrl: str(c.public?.collectorPublicUrl, 'http://localhost:8080').replace(/\/+$/, ''),
    consolePublicUrl: str(c.public?.consolePublicUrl, 'http://localhost:3000').replace(/\/+$/, ''),
    consoleRegistryUrl: str(c.consoleRegistryUrl, 'http://console:3000/iglu').replace(/\/+$/, ''),
    dockerSocket: str(c.dockerSocket, '/var/run/docker.sock'),
    dockerNetwork: str(c.dockerNetwork, 'opensnowcat'),
    containers: {
      enrich: str(c.containerEnrich, 'opensnowcat_enrich'),
      collector: str(c.containerCollector, 'opensnowcat_collector'),
      bento: str(c.containerBento, 'bento'),
      kafka: str(c.containerKafka, 'warp'),
      tunnel: str(c.containerTunnel, 'opensnowcat_tunnel')
    },
    tunnelTarget: str(c.tunnelTarget, 'http://opensnowcat_collector:8080'),
    tunnelImage: str(c.tunnelImage, 'cloudflare/cloudflared:latest'),
    hostHomeMount: str(c.hostHomeMount, ''),
    hostHomePath: str(c.hostHomePath, ''),
    enrichGroupId: str(c.enrichGroupId, 'enrich')
  }
}
