<script setup lang="ts">
useHead({ title: 'Schema registries · OpenSnowcat Console' })

interface Registry { name: string, priority: number, vendorPrefixes: string[], connection: { http?: { uri: string, apikey?: string }, embedded?: { path: string } } }
interface ResolverDoc { schema: string, data: { cacheSize: number, cacheTtl?: number, repositories: Registry[] } }
interface FolderInfo { id: string, path: string, root: string, url: string, primary: boolean, exists: boolean, display: string }
interface Attempt { registry: string, uri: string | null, kind: string, status: 'found' | 'not-found' | 'error' | 'skipped', httpStatus?: number, durationMs?: number, message?: string, matchedPrefix: boolean }
interface FolderCheck { exists: boolean, isDirectory: boolean, root: string, count: number, sample: string[], message: string, display: string }
type Kind = 'folder' | 'snowcatcloud' | 'http' | 'embedded'
interface KeyCheck { ok: boolean, authorized: boolean, pulled: boolean, status: number | null, count: number, vendors: string[], sample: string[], pulledUri: string | null, message: string, durationMs: number }
interface Row { name: string, priority: number, vendorPrefixes: string[], kind: Kind, folderId: string, path: string, display?: string, uri: string, apikey: string, embeddedPath: string, check?: FolderCheck | null, checking?: boolean, keyCheck?: KeyCheck | null, keyChecking?: boolean, showKey?: boolean, keySaved?: boolean }

const toast = useToast()
const hydrated = useHydrated()
const runtime = useRuntimeConfig()
const snowcatUrl = String(runtime.public.snowcatRegistryUrl).replace(/\/+$/, '')
const snowcatSignup = String(runtime.public.snowcatSignupUrl)
const snowcatProxy = computed(() => data.value?.snowcat.proxyUrl ?? '')
const snowcatHost = (() => { try { return new URL(snowcatUrl).host } catch { return '' } })()
/** Proxy entry written by this console, or a legacy direct entry someone typed by hand. */
function snowcatKind(uri: string): 'proxy' | 'direct' | null {
  const clean = uri.replace(/\/+$/, '')
  if (snowcatProxy.value && clean === snowcatProxy.value) return 'proxy'
  try {
    if (new URL(clean).host === snowcatHost) return 'direct'
  } catch { /* not a url */ }
  return null
}
interface SnowcatInfo { proxyUrl: string, upstream: string, configured: boolean }
const { data, refresh, pending } = await useFetch<{ doc: ResolverDoc, path: string, consoleRegistryUrl: string, folders: FolderInfo[], snowcat: SnowcatInfo }>('/api/resolver', { server: false, lazy: true })

const form = reactive<{ cacheSize: number, cacheTtl: number | null, rows: Row[] }>({ cacheSize: 0, cacheTtl: null, rows: [] })
const original = ref('')
const base = computed(() => data.value?.consoleRegistryUrl ?? 'http://console:3000/iglu')

function folderIdFromUrl(uri: string): string | null {
  const clean = uri.replace(/\/+$/, '')
  if (clean === base.value) return 'local'
  if (clean.startsWith(`${base.value}/f/`)) return clean.slice(base.value.length + 3)
  return null
}
function folderUrl(id: string): string {
  return id === 'local' ? base.value : `${base.value}/f/${id}`
}
function slug(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'folder'
  let id = s
  let n = 2
  while (form.rows.some(r => r.kind === 'folder' && r.folderId === id) || id === 'local') id = `${s}-${n++}`
  return id
}

function load() {
  if (!data.value) return
  const folders = data.value.folders
  form.cacheSize = data.value.doc.data.cacheSize
  form.cacheTtl = data.value.doc.data.cacheTtl ?? null
  form.rows = data.value.doc.data.repositories.map((r): Row => {
    const fid = r.connection.http ? folderIdFromUrl(r.connection.http.uri) : null
    if (fid) {
      const f = folders.find(x => x.id === fid)
      return { name: r.name, priority: r.priority, vendorPrefixes: [...r.vendorPrefixes], kind: 'folder', folderId: fid, path: f?.path ?? '', display: f?.display, uri: '', apikey: '', embeddedPath: '', check: null }
    }
    const sc = r.connection.http ? snowcatKind(r.connection.http.uri) : null
    if (sc) {
      // Legacy direct entries carry the key in resolver.json; it moves into the console store on the next save.
      return { name: r.name, priority: r.priority, vendorPrefixes: [...r.vendorPrefixes], kind: 'snowcatcloud', folderId: '', path: '', uri: snowcatUrl, apikey: sc === 'direct' ? (r.connection.http?.apikey ?? '') : '', keySaved: sc === 'proxy' && !!data.value?.snowcat.configured, embeddedPath: '', keyCheck: null }
    }
    if (r.connection.http) return { name: r.name, priority: r.priority, vendorPrefixes: [...r.vendorPrefixes], kind: 'http', folderId: '', path: '', uri: r.connection.http.uri, apikey: r.connection.http.apikey ?? '', embeddedPath: '' }
    return { name: r.name, priority: r.priority, vendorPrefixes: [...r.vendorPrefixes], kind: 'embedded', folderId: '', path: '', uri: '', apikey: '', embeddedPath: r.connection.embedded?.path ?? '' }
  })
  original.value = JSON.stringify(payload())
}
watch(data, load, { immediate: true })

function payload() {
  const doc: ResolverDoc = {
    schema: data.value?.doc.schema ?? 'iglu:com.snowplowanalytics.iglu/resolver-config/jsonschema/1-0-3',
    data: {
      cacheSize: Number(form.cacheSize) || 0,
      ...(form.cacheTtl != null && String(form.cacheTtl) !== '' ? { cacheTtl: Number(form.cacheTtl) } : {}),
      repositories: form.rows.map((r): Registry => ({
        name: r.name,
        priority: Number(r.priority) || 0,
        vendorPrefixes: r.vendorPrefixes,
        connection: r.kind === 'folder'
          ? { http: { uri: folderUrl(r.folderId) } }
          : r.kind === 'snowcatcloud'
            ? { http: { uri: snowcatProxy.value } }
            : r.kind === 'http'
              ? { http: { uri: r.uri, ...(r.apikey ? { apikey: r.apikey } : {}) } }
              : { embedded: { path: r.embeddedPath } }
      }))
    }
  }
  const folders = form.rows.filter(r => r.kind === 'folder' && r.folderId !== 'local').map(r => ({ id: r.folderId, path: r.path }))
  const snowcatRow = form.rows.find(r => r.kind === 'snowcatcloud')
  // undefined keeps the stored key, '' clears it when the registry is gone, a string replaces it
  const snowcatApiKey = snowcatRow ? (snowcatRow.apikey.trim() ? snowcatRow.apikey.trim() : undefined) : (data.value?.snowcat.configured ? '' : undefined)
  return { doc, folders, snowcatApiKey }
}
const dirty = computed(() => JSON.stringify(payload()) !== original.value)
const hasLocal = computed(() => form.rows.some(r => r.kind === 'folder' && r.folderId === 'local'))
const localFolder = computed(() => data.value?.folders.find(f => f.primary))

function add(preset: 'local' | 'folder' | 'snowcatcloud' | 'iglu-central' | 'http' | 'embedded') {
  const empty: Row = { name: '', priority: 0, vendorPrefixes: [], kind: 'http', folderId: '', path: '', uri: '', apikey: '', embeddedPath: '', check: null }
  switch (preset) {
    case 'local':
      form.rows.unshift({ ...empty, name: 'Linked directory (this console)', kind: 'folder', folderId: 'local', path: localFolder.value?.path ?? '/schemas' })
      break
    case 'folder': {
      const name = 'Extra schema folder'
      form.rows.unshift({ ...empty, name, kind: 'folder', folderId: slug(name), path: '' })
      browseFor(form.rows[0]!)
      break
    }
    case 'snowcatcloud':
      if (form.rows.some(r => r.kind === 'snowcatcloud')) return toast.add({ title: 'SnowcatCloud is already listed', color: 'neutral' })
      form.rows.splice(hasLocal.value ? 1 : 0, 0, { ...empty, name: 'SnowcatCloud Schema Registry', priority: 5, kind: 'snowcatcloud', uri: snowcatUrl, keyCheck: null, keySaved: !!data.value?.snowcat.configured })
      break
    case 'iglu-central':
      form.rows.push({ ...empty, name: 'Iglu Central', priority: 10, vendorPrefixes: ['com.snowplowanalytics'], kind: 'http', uri: 'http://iglucentral.com' })
      break
    case 'embedded':
      form.rows.push({ ...empty, name: 'Embedded (inside enrich)', priority: 100, kind: 'embedded', embeddedPath: '/iglu-client-embedded' })
      break
    default:
      form.rows.push({ ...empty, name: 'My Iglu Server', priority: 5, kind: 'http', uri: 'https://iglu.example.com' })
  }
}
function remove(i: number) {
  form.rows.splice(i, 1)
}
function onKindChange(r: Row) {
  if (r.kind === 'snowcatcloud') {
    r.uri = snowcatUrl
    r.keyCheck = null
    if (!r.name.trim() || r.name === 'My Iglu Server') r.name = 'SnowcatCloud Schema Registry'
  }
  if (r.kind === 'folder' && !r.folderId) r.folderId = slug(r.name || 'folder')
  if (r.kind === 'folder' && !r.path) browseFor(r)
}
function onNameChange(r: Row) {
  if (r.kind === 'folder' && r.folderId !== 'local' && !r.path.trim()) r.folderId = slug(r.name)
}
const browseOpen = ref(false)
const browseTarget = ref<Row | null>(null)
function browseFor(r: Row) {
  browseTarget.value = r
  browseOpen.value = true
}
function onPicked(path: string, display: string) {
  const r = browseTarget.value
  if (!r) return
  r.path = path
  r.display = display
  r.check = null
  if (!r.name.trim() || r.name === 'Extra schema folder') {
    r.name = display.split(/[\\/]/).filter(Boolean).pop() ?? 'Schema folder'
    r.folderId = slug(r.name)
  }
  check(r)
}

async function checkKey(r: Row) {
  r.keyChecking = true
  try {
    r.keyCheck = await $fetch<KeyCheck>('/api/registries/snowcatcloud/test', { method: 'POST', body: { apikey: r.apikey } })
  } catch (e) {
    r.keyCheck = { ok: false, authorized: false, pulled: false, status: null, count: 0, vendors: [], sample: [], pulledUri: null, message: (e as Error).message ?? String(e), durationMs: 0 }
  } finally {
    r.keyChecking = false
  }
}
function useVendors(r: Row) {
  if (!r.keyCheck?.vendors.length) return
  r.vendorPrefixes = [...new Set([...r.vendorPrefixes, ...r.keyCheck.vendors])]
}

async function check(r: Row) {
  r.checking = true
  try {
    r.check = await $fetch<FolderCheck>('/api/folders/check', { query: { path: r.path } })
  } finally {
    r.checking = false
  }
}

const saving = ref(false)
const restartState = ref<'idle' | 'restarting' | 'done' | 'failed'>('idle')
const restartMessage = ref('')
async function save(restart = true) {
  for (const r of form.rows) {
    if (!r.name.trim()) return toast.add({ title: 'Every registry needs a name', color: 'error', icon: 'i-lucide-x' })
    if (r.kind === 'http' && !/^https?:\/\//.test(r.uri)) return toast.add({ title: `"${r.name}" needs an http(s) URI`, color: 'error', icon: 'i-lucide-x' })
    if (r.kind === 'snowcatcloud' && !r.apikey.trim() && !r.keySaved) return toast.add({ title: `"${r.name}" needs your SnowcatCloud API key`, color: 'error', icon: 'i-lucide-x' })
    if (r.kind === 'folder' && r.folderId !== 'local' && !r.path.trim()) return toast.add({ title: `"${r.name}" needs a folder path`, color: 'error', icon: 'i-lucide-x' })
  }
  saving.value = true
  restartState.value = restart ? 'restarting' : 'idle'
  try {
    const res = await $fetch<{ restarted: { name: string } | null, restartError: string | null }>('/api/resolver', { method: 'PUT', body: { ...payload(), restart } })
    await refresh()
    if (restart) {
      if (res.restarted) {
        restartState.value = 'done'
        restartMessage.value = `${res.restarted.name} restarted. It takes a few seconds to rejoin Kafka.`
        toast.add({ title: 'Saved and enrich restarted', description: restartMessage.value, color: 'success', icon: 'i-lucide-refresh-cw' })
      } else {
        restartState.value = 'failed'
        restartMessage.value = res.restartError ?? 'Unknown error'
        toast.add({ title: 'Saved, but enrich did not restart', description: restartMessage.value, color: 'warning', icon: 'i-lucide-triangle-alert' })
      }
    } else {
      toast.add({ title: 'Saved', description: 'Restart enrich from the Pipeline page to apply.', color: 'success', icon: 'i-lucide-save' })
    }
  } catch (e) {
    restartState.value = 'failed'
    const msg = (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? (e as Error).message
    toast.add({ title: 'Save failed', description: msg, color: 'error', icon: 'i-lucide-x' })
  } finally {
    saving.value = false
  }
}

// ---- resolve tester
const testUri = ref('iglu:com.opensnowcat.example/product_view/jsonschema/1-0-0')
const testing = ref(false)
const result = ref<{ found: boolean, resolvedBy: string | null, attempts: Attempt[] } | null>(null)
async function runTest() {
  testing.value = true
  try {
    result.value = await $fetch('/api/resolver/test', { query: { uri: testUri.value } })
  } catch (e) {
    const msg = (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? (e as Error).message
    toast.add({ title: 'Resolve failed', description: msg, color: 'error' })
  } finally {
    testing.value = false
  }
}
const statusColor = (s: Attempt['status']) => s === 'found' ? 'success' : s === 'not-found' ? 'warning' : s === 'error' ? 'error' : 'neutral'

const previewVendor = ref('com.opensnowcat.example')
const ordered = computed(() => {
  const v = previewVendor.value.trim()
  const matches = (r: Row) => r.vendorPrefixes.some(p => v.startsWith(p))
  const byP = (a: Row, b: Row) => a.priority - b.priority
  return [...form.rows.filter(matches).sort(byP), ...form.rows.filter(r => !matches(r)).sort(byP)]
})
const kindItems = [
  { label: 'Folder served by this console', value: 'folder', icon: 'i-lucide-folder-open' },
  { label: 'SnowcatCloud Schema Registry', value: 'snowcatcloud', icon: 'i-lucide-cloud' },
  { label: 'HTTP registry', value: 'http', icon: 'i-lucide-globe' },
  { label: 'Embedded in enrich', value: 'embedded', icon: 'i-lucide-package' }
]
const KIND_ICON: Record<Kind, string> = { folder: 'i-lucide-folder-open', snowcatcloud: 'i-lucide-cloud', http: 'i-lucide-globe', embedded: 'i-lucide-package' }
</script>

<template>
  <UDashboardPanel id="registries">
    <template #header>
      <UDashboardNavbar
        title="Schema registries"
        icon="i-lucide-library"
      >
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            :loading="hydrated && pending"
            @click="refresh()"
          />
          <UButton
            color="neutral"
            variant="subtle"
            label="Save only"
            :disabled="!dirty"
            :loading="saving"
            @click="save(false)"
          />
          <UButton
            icon="i-lucide-refresh-cw"
            label="Save & restart enrich"
            :disabled="!dirty"
            :loading="saving"
            @click="save(true)"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-5">
        <div class="flex flex-col xl:flex-row xl:items-center gap-3">
          <p class="text-sm text-muted flex-1">
            Where enrich looks up schemas, in order. Folders are served by this console and edited on the Schemas page; edits there are live. Changing the list below restarts enrich on save.
          </p>
          <UAlert
            v-if="restartState === 'restarting'"
            color="warning"
            variant="subtle"
            icon="i-lucide-loader-circle"
            title="Restarting enrich…"
            class="xl:w-auto"
          />
          <UAlert
            v-else-if="restartState === 'failed'"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Enrich restart failed"
            :description="restartMessage"
            class="xl:w-auto"
          />
        </div>

        <UAlert
          v-if="data && !hasLocal"
          color="warning"
          variant="subtle"
          icon="i-lucide-unlink"
          title="The linked directory is not a registry yet"
          description="Enrich cannot see the schemas you edit here until this console is listed."
          :actions="[{ label: 'Add the linked directory', icon: 'i-lucide-plus', onClick: () => add('local') }]"
        />

        <div class="grid gap-5 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
          <UCard variant="subtle">
            <template #header>
              <h3 class="font-semibold">
                Cache
              </h3>
              <p class="text-xs text-muted">
                The devkit ships with no cache so schema edits are live. Turn it on only for load tests.
              </p>
            </template>
            <div class="grid gap-3 sm:grid-cols-2">
              <UFormField
                label="Cache size"
                help="0 = fetch on every lookup"
                size="sm"
              >
                <UInputNumber
                  v-model="form.cacheSize"
                  :min="0"
                  size="sm"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="TTL (seconds)"
                help="Only used when the cache is on"
                size="sm"
              >
                <UInputNumber
                  v-model="form.cacheTtl"
                  :min="0"
                  size="sm"
                  class="w-full"
                />
              </UFormField>
            </div>
          </UCard>

          <UCard variant="subtle">
            <template #header>
              <h3 class="font-semibold">
                Lookup order
              </h3>
              <p class="text-xs text-muted">
                Prefix matches first, then everything else, each by priority.
              </p>
            </template>
            <UFormField
              label="For vendor"
              size="sm"
            >
              <UInput
                v-model="previewVendor"
                size="sm"
                class="w-full font-mono"
              />
            </UFormField>
            <ol class="mt-3 flex flex-col gap-1.5 text-sm">
              <li
                v-for="(r, i) in ordered"
                :key="i"
                class="flex items-center gap-2"
              >
                <UBadge
                  color="neutral"
                  variant="outline"
                  size="sm"
                  :label="String(i + 1)"
                />
                <UIcon
                  :name="KIND_ICON[r.kind]"
                  class="text-muted shrink-0"
                />
                <span class="truncate">{{ r.name || '(unnamed)' }}</span>
                <UBadge
                  v-if="r.vendorPrefixes.some(p => previewVendor.startsWith(p))"
                  color="primary"
                  variant="subtle"
                  size="sm"
                  label="prefix match"
                />
                <span class="text-xs text-muted ml-auto">p{{ r.priority }}</span>
              </li>
            </ol>
          </UCard>

          <UCard variant="subtle">
            <template #header>
              <h3 class="font-semibold">
                Resolve tester
              </h3>
              <p class="text-xs text-muted">
                Walks the saved registries exactly like enrich would and shows who answers.
              </p>
            </template>
            <div class="flex gap-2">
              <UInput
                v-model="testUri"
                size="sm"
                class="w-full font-mono"
                placeholder="iglu:com.acme/my_event/jsonschema/1-0-0"
                @keydown.enter="runTest"
              />
              <UButton
                icon="i-lucide-search"
                size="sm"
                label="Resolve"
                :loading="testing"
                @click="runTest"
              />
            </div>
            <div
              v-if="result"
              class="mt-3 flex flex-col gap-2"
            >
              <UAlert
                :color="result.found ? 'success' : 'error'"
                variant="subtle"
                :icon="result.found ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
                :title="result.found ? `Resolved by ${result.resolvedBy}` : 'Not found in any registry'"
              />
              <div
                v-for="(a, i) in result.attempts"
                :key="i"
                class="rounded-md border border-default p-2 text-xs flex flex-col gap-1"
              >
                <div class="flex items-center gap-2">
                  <UBadge
                    :color="statusColor(a.status)"
                    variant="subtle"
                    size="sm"
                    :label="a.status"
                  />
                  <span class="font-medium">{{ a.registry }}</span>
                  <span
                    v-if="a.httpStatus"
                    class="text-muted"
                  >HTTP {{ a.httpStatus }}</span>
                  <span
                    v-if="a.durationMs != null"
                    class="text-muted ml-auto"
                  >{{ a.durationMs }} ms</span>
                </div>
                <span
                  v-if="a.uri"
                  class="font-mono text-muted break-all"
                >{{ a.uri }}</span>
                <span
                  v-if="a.message"
                  class="text-muted"
                >{{ a.message }}</span>
              </div>
            </div>
          </UCard>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="font-semibold">
            Registries
          </h3>
          <span class="text-xs text-muted font-mono">{{ data?.path }}</span>
          <UDropdownMenu
            class="ml-auto"
            :items="[
              { label: 'Linked directory (this console)', icon: 'i-lucide-folder-open', disabled: hasLocal, onSelect: () => add('local') },
              { label: 'Another folder', icon: 'i-lucide-folder-plus', onSelect: () => add('folder') },
              { label: 'SnowcatCloud Schema Registry (API key)', icon: 'i-lucide-cloud', disabled: form.rows.some(r => r.kind === 'snowcatcloud'), onSelect: () => add('snowcatcloud') },
              { label: 'Iglu Central', icon: 'i-lucide-globe', onSelect: () => add('iglu-central') },
              { label: 'Custom HTTP registry', icon: 'i-lucide-server', onSelect: () => add('http') },
              { label: 'Embedded (inside enrich)', icon: 'i-lucide-package', onSelect: () => add('embedded') }
            ]"
          >
            <UButton
              icon="i-lucide-plus"
              label="Add registry"
              size="sm"
            />
          </UDropdownMenu>
        </div>

        <div class="flex flex-col gap-3">
          <UCard
            v-for="(r, i) in form.rows"
            :key="i"
            variant="subtle"
            :ui="{ body: 'p-4 sm:p-4' }"
          >
            <div class="grid gap-4 items-start md:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_minmax(0,1.2fr)_8rem_2.5rem]">
              <div class="flex flex-col gap-3">
                <UFormField
                  label="Name"
                  size="sm"
                >
                  <UInput
                    v-model="r.name"
                    size="sm"
                    class="w-full"
                    @update:model-value="onNameChange(r)"
                  />
                </UFormField>
                <UFormField
                  label="Type"
                  size="sm"
                >
                  <USelect
                    v-model="r.kind"
                    :items="kindItems"
                    :icon="KIND_ICON[r.kind]"
                    size="sm"
                    class="w-full"
                    :disabled="r.kind === 'folder' && r.folderId === 'local'"
                    @update:model-value="onKindChange(r)"
                  />
                </UFormField>
              </div>

              <div class="flex flex-col gap-3 min-w-0">
                <template v-if="r.kind === 'folder'">
                  <UFormField
                    label="Folder"
                    size="sm"
                    :help="r.folderId === 'local' ? 'The devkit schema directory (SCHEMAS_DIR in .env).' : 'Any folder under your home directory. Browse to pick it.'"
                  >
                    <div class="flex gap-1.5">
                      <UInput
                        :model-value="r.folderId === 'local' ? (r.display ?? r.path) : (r.display ?? r.path)"
                        size="sm"
                        class="w-full font-mono"
                        readonly
                        :placeholder="r.folderId === 'local' ? '' : 'Pick a folder…'"
                      />
                      <UButton
                        v-if="r.folderId !== 'local'"
                        size="sm"
                        color="neutral"
                        variant="subtle"
                        icon="i-lucide-folder-search"
                        label="Browse"
                        @click="browseFor(r)"
                      />
                      <UButton
                        size="sm"
                        color="neutral"
                        variant="subtle"
                        icon="i-lucide-scan-search"
                        label="Check"
                        :loading="r.checking"
                        :disabled="!r.path"
                        @click="check(r)"
                      />
                    </div>
                  </UFormField>
                  <p class="text-[11px] font-mono text-muted break-all">
                    Served at {{ folderUrl(r.folderId) }}
                  </p>
                  <UAlert
                    v-if="r.check"
                    :color="r.check.count ? 'success' : r.check.exists ? 'warning' : 'error'"
                    variant="subtle"
                    :icon="r.check.count ? 'i-lucide-circle-check' : 'i-lucide-triangle-alert'"
                    :title="r.check.message"
                    :description="r.check.sample.length ? r.check.sample.join('\n') : undefined"
                    :ui="{ description: 'font-mono text-[11px] whitespace-pre-line' }"
                  />
                </template>
                <template v-else-if="r.kind === 'snowcatcloud'">
                  <UFormField
                    label="API key"
                    size="sm"
                  >
                    <div class="flex gap-1.5">
                      <UInput
                        v-model="r.apikey"
                        size="sm"
                        class="w-full font-mono"
                        :type="r.showKey ? 'text' : 'password'"
                        :placeholder="r.keySaved ? 'Key saved in the console. Paste a new one to replace it.' : 'Paste the key from your SnowcatCloud account'"
                        @keydown.enter="checkKey(r)"
                      >
                        <template #trailing>
                          <UButton
                            :icon="r.showKey ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                            size="xs"
                            color="neutral"
                            variant="link"
                            :aria-label="r.showKey ? 'Hide key' : 'Show key'"
                            @click="r.showKey = !r.showKey"
                          />
                        </template>
                      </UInput>
                      <UButton
                        size="sm"
                        color="neutral"
                        variant="subtle"
                        icon="i-lucide-shield-check"
                        label="Check key"
                        :loading="r.keyChecking"
                        :disabled="!r.apikey.trim() && !r.keySaved"
                        @click="checkKey(r)"
                      />
                    </div>
                  </UFormField>
                  <p class="text-[11px] text-muted">
                    Enrich reaches <span class="font-mono">{{ snowcatUrl }}</span> through this console, and the key stays in the console's local store, never in resolver.json. No account yet?
                    <a
                      :href="snowcatSignup"
                      target="_blank"
                      class="text-primary hover:underline"
                    >Get one at SnowcatCloud</a>.
                  </p>
                  <UAlert
                    v-if="r.keyCheck"
                    :color="r.keyCheck.ok ? 'success' : r.keyCheck.authorized ? 'warning' : 'error'"
                    variant="subtle"
                    :icon="r.keyCheck.ok ? 'i-lucide-shield-check' : r.keyCheck.authorized ? 'i-lucide-triangle-alert' : 'i-lucide-shield-x'"
                    :title="r.keyCheck.message"
                    :description="r.keyCheck.sample.length ? r.keyCheck.sample.join('\n') : undefined"
                    :ui="{ description: 'font-mono text-[11px] whitespace-pre-line' }"
                    :actions="r.keyCheck.vendors.length ? [{ label: `Use ${r.keyCheck.vendors.length === 1 ? 'vendor' : 'vendors'} as prefixes`, icon: 'i-lucide-tags', color: 'neutral', variant: 'subtle', onClick: () => useVendors(r) }] : undefined"
                  />
                </template>
                <template v-else-if="r.kind === 'http'">
                  <UFormField
                    label="Registry URI"
                    size="sm"
                    help="Enrich requests {uri}/schemas/{vendor}/{name}/jsonschema/{version}"
                  >
                    <UInput
                      v-model="r.uri"
                      size="sm"
                      class="w-full font-mono"
                      placeholder="https://iglu.example.com/api"
                    />
                  </UFormField>
                  <UFormField
                    label="API key (optional)"
                    size="sm"
                  >
                    <UInput
                      v-model="r.apikey"
                      size="sm"
                      class="w-full font-mono"
                      type="password"
                      placeholder="Sent as the apikey header"
                    />
                  </UFormField>
                </template>
                <template v-else>
                  <UFormField
                    label="Classpath"
                    size="sm"
                    help="Schemas bundled inside the enrich JAR. Nothing to check from here."
                  >
                    <UInput
                      v-model="r.embeddedPath"
                      size="sm"
                      class="w-full font-mono"
                      placeholder="/iglu-client-embedded"
                    />
                  </UFormField>
                </template>
              </div>

              <UFormField
                label="Vendor prefixes"
                size="sm"
                help="Tried first for schemas whose vendor starts with one of these. Leave empty to be a fallback for every vendor."
              >
                <UInputTags
                  v-model="r.vendorPrefixes"
                  size="sm"
                  class="w-full"
                  placeholder="com.acme"
                />
              </UFormField>

              <UFormField
                label="Priority"
                size="sm"
                help="Lower wins"
              >
                <UInputNumber
                  v-model="r.priority"
                  size="sm"
                  :min="0"
                  class="w-full"
                />
              </UFormField>

              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="sm"
                class="xl:mt-6 justify-self-end"
                aria-label="Remove registry"
                @click="remove(i)"
              />
            </div>
          </UCard>
          <UEmpty
            v-if="!form.rows.length && data"
            icon="i-lucide-library"
            title="No registries"
            description="Enrich would reject every self-describing event. Add the linked directory and Iglu Central."
          />
        </div>
      </div>
      <FolderBrowser
        v-model:open="browseOpen"
        :start="browseTarget?.path"
        @select="onPicked"
      />
    </template>
  </UDashboardPanel>
</template>
