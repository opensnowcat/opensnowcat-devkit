export interface ConsoleInfo {
  version: string
  kafkaBrokers: string[]
  topics: Record<'collectedGood' | 'collectedBad' | 'enrichedGood' | 'enrichedBad' | 'enrichedJson', string>
  schemasDir: string
  schemasRoot: string
  resolverPath: string
  collectorUrl: string
  collectorPublicUrl: string
  consolePublicUrl: string
  consoleRegistryUrl: string
  dockerAvailable: boolean
  containers: Record<'enrich' | 'collector' | 'bento' | 'kafka' | 'tunnel', string>
}

export interface TunnelInfo {
  available: boolean
  running: boolean
  url: string | null
  target: string
  containerName: string
  image: string
  error: string | null
  logs: string
  qr: string | null
}
