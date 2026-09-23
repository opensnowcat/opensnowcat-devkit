/**
 * Snowplow / OpenSnowcat canonical enriched event: 131 tab-separated columns.
 * Order matters and matches the atomic event definition used by every analytics SDK.
 */
export const ENRICHED_FIELDS = [
  'app_id', 'platform', 'etl_tstamp', 'collector_tstamp', 'dvce_created_tstamp', 'event', 'event_id', 'txn_id',
  'name_tracker', 'v_tracker', 'v_collector', 'v_etl', 'user_id', 'user_ipaddress', 'user_fingerprint',
  'domain_userid', 'domain_sessionidx', 'network_userid', 'geo_country', 'geo_region', 'geo_city', 'geo_zipcode',
  'geo_latitude', 'geo_longitude', 'geo_region_name', 'ip_isp', 'ip_organization', 'ip_domain', 'ip_netspeed',
  'page_url', 'page_title', 'page_referrer', 'page_urlscheme', 'page_urlhost', 'page_urlport', 'page_urlpath',
  'page_urlquery', 'page_urlfragment', 'refr_urlscheme', 'refr_urlhost', 'refr_urlport', 'refr_urlpath',
  'refr_urlquery', 'refr_urlfragment', 'refr_medium', 'refr_source', 'refr_term', 'mkt_medium', 'mkt_source',
  'mkt_term', 'mkt_content', 'mkt_campaign', 'contexts', 'se_category', 'se_action', 'se_label', 'se_property',
  'se_value', 'unstruct_event', 'tr_orderid', 'tr_affiliation', 'tr_total', 'tr_tax', 'tr_shipping', 'tr_city',
  'tr_state', 'tr_country', 'ti_orderid', 'ti_sku', 'ti_name', 'ti_category', 'ti_price', 'ti_quantity',
  'pp_xoffset_min', 'pp_xoffset_max', 'pp_yoffset_min', 'pp_yoffset_max', 'useragent', 'br_name', 'br_family',
  'br_version', 'br_type', 'br_renderengine', 'br_lang', 'br_features_pdf', 'br_features_flash',
  'br_features_java', 'br_features_director', 'br_features_quicktime', 'br_features_realplayer',
  'br_features_windowsmedia', 'br_features_gears', 'br_features_silverlight', 'br_cookies', 'br_colordepth',
  'br_viewwidth', 'br_viewheight', 'os_name', 'os_family', 'os_manufacturer', 'os_timezone', 'dvce_type',
  'dvce_ismobile', 'dvce_screenwidth', 'dvce_screenheight', 'doc_charset', 'doc_width', 'doc_height',
  'tr_currency', 'tr_total_base', 'tr_tax_base', 'tr_shipping_base', 'ti_currency', 'ti_price_base',
  'base_currency', 'geo_timezone', 'mkt_clickid', 'mkt_network', 'etl_tags', 'dvce_sent_tstamp',
  'refr_domain_userid', 'refr_dvce_tstamp', 'derived_contexts', 'domain_sessionid', 'derived_tstamp',
  'event_vendor', 'event_name', 'event_format', 'event_version', 'event_fingerprint', 'true_tstamp'
] as const

const JSON_FIELDS = new Set(['contexts', 'unstruct_event', 'derived_contexts'])

export interface SelfDescribingJson {
  schema: string
  data: unknown
}

export interface ParsedEnrichedEvent {
  atomic: Record<string, string | null>
  unstruct: SelfDescribingJson | null
  contexts: SelfDescribingJson[]
  derivedContexts: SelfDescribingJson[]
  columnCount: number
}

function parseSdj(raw: string | null): SelfDescribingJson | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && typeof parsed.schema === 'string') return parsed as SelfDescribingJson
    return null
  } catch {
    return null
  }
}

function sdjList(raw: string | null): SelfDescribingJson[] {
  const wrapper = parseSdj(raw)
  if (!wrapper || !Array.isArray(wrapper.data)) return []
  return (wrapper.data as unknown[]).filter((d): d is SelfDescribingJson =>
    !!d && typeof d === 'object' && typeof (d as SelfDescribingJson).schema === 'string')
}

export function parseEnrichedTsv(line: string): ParsedEnrichedEvent {
  const cols = line.replace(/\r?\n$/, '').split('\t')
  const atomic: Record<string, string | null> = {}
  const jsonCols: Record<string, string | null> = {}
  ENRICHED_FIELDS.forEach((field, i) => {
    const v = cols[i]
    const value = v == null || v === '' ? null : v
    if (JSON_FIELDS.has(field)) jsonCols[field] = value
    else atomic[field] = value
  })
  const unstructWrapper = parseSdj(jsonCols.unstruct_event ?? null)
  const unstruct = unstructWrapper && unstructWrapper.data && typeof unstructWrapper.data === 'object'
    && typeof (unstructWrapper.data as SelfDescribingJson).schema === 'string'
    ? unstructWrapper.data as SelfDescribingJson
    : null
  const contexts = sdjList(jsonCols.contexts ?? null)
  const derivedContexts = sdjList(jsonCols.derived_contexts ?? null)
  return { atomic, unstruct, contexts, derivedContexts, columnCount: cols.length }
}

const IGLU_RE = /^iglu:([^/]+)\/([^/]+)\/([^/]+)\/(\d+-\d+-\d+)$/

export interface IgluKey {
  vendor: string
  name: string
  format: string
  version: string
}

export function parseIgluUri(uri: string): IgluKey | null {
  const m = IGLU_RE.exec(uri.trim())
  if (!m) return null
  return { vendor: m[1]!, name: m[2]!, format: m[3]!, version: m[4]! }
}

export function igluShortName(uri: string): string {
  const k = parseIgluUri(uri)
  return k ? `${k.name} ${k.version}` : uri
}
