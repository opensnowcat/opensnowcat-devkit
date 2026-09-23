<script setup lang="ts">
import type { RegistryContext, RegistryKind, RegistryRow } from '~/types/registries'
import { KIND_ICON, KIND_LABEL, emptyRow } from '~/types/registries'

useHead({ title: 'Schema Registry · OpenSnowcat Console' })

interface Registry { name: string, priority: number, vendorPrefixes: string[], connection: { http?: { uri: string, apikey?: string }, embedded?: { path: string } } }
interface ResolverDoc { schema: string, data: { cacheSize: number, cacheTtl?: number, repositories: Registry[] } }
interface FolderInfo { id: string, path: string, root: string, url: string, primary: boolean, exists: boolean, display: string, count: number }
interface SnowcatInfo { proxyUrl: string, upstream: string, configured: boolean }
interface Attempt { registry: string, uri: string | null, kind: string, status: 'found' | 'not-found' | 'error' | 'skipped', httpStatus?: number, durationMs?: number, message?: string, matchedPrefix: boolean }

const toast = useToast()
const hydrated = useHydrated()
const runtime = useRuntimeConfig()
const snowcatUrl = String(runtime.public.snowcatRegistryUrl).replace(/\/+$/, '')
const snowcatSignup = String(runtime.public.snowcatSignupUrl)
const snowcatHost = (() => {
  try {
    return new URL(snowcatUrl).host
  } catch {
    return ''
  }
})()

const { data, refresh, pending } = await useFetch<{ doc: ResolverDoc, path: string, consoleRegistryUrl: string, folders: FolderInfo[], snowcat: SnowcatInfo }>('/api/resolver', { server: false, lazy: true })

const base = computed(() => data.value?.consoleRegistryUrl ?? 'http://console:3000/iglu')
const snowcatProxy = computed(() => data.value?.snowcat.proxyUrl ?? '')
const form = reactive<{ cacheSize: number, cacheTtl: number | null, rows: RegistryRow[] }>({ cacheSize: 0, cacheTtl: null, rows: [] })
const original = ref('')
const needsMigration = ref(false)

function folderIdFromUrl(uri: string): string | null {
  const clean = uri.replace(/\/+$/, '')
  if (clean === base.value) return 'local'
  if (clean.startsWith(`${base.value}/f/`)) return clean.slice(base.value.length + 3)
  return null
}
function folderUrl(id: string): string {
  return id === 'local' ? base.value : `${base.value}/f/${id}`
}
function snowcatKind(uri: string): 'proxy' | 'direct' | null {
  const clean = uri.replace(/\/+$/, '')
  if (snowcatProxy.value && clean === snowcatProxy.value) return 'proxy'
  try {
    if (new URL(clean).host === snowcatHost) return 'direct'
  } catch { /* not a url */ }
  return null
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
  needsMigration.value = data.value.doc.data.repositories.some(r => !!r.connection.http && snowcatKind(r.connection.http.uri) === 'direct')
  const repos = [...data.value.doc.data.repositories].sort((a, b) => a.priority - b.priority)
  form.rows = repos.map((r): RegistryRow => {
    const common = { ...emptyRow(), isNew: false, name: r.name, priority: r.priority, vendorPrefixes: [...r.vendorPrefixes] }
    const fid = r.connection.http ? folderIdFromUrl(r.connection.http.uri) : null
    if (fid) {
      const f = folders.find(x => x.id === fid)
      return { ...common, kind: 'folder', folderId: fid, path: f?.path ?? '', display: f?.display }
    }
    const sc = r.connection.http ? snowcatKind(r.connection.http.uri) : null
    if (sc) return { ...common, kind: 'snowcatcloud', uri: snowcatUrl, apikey: sc === 'direct' ? (r.connection.http?.apikey ?? '') : '', keySaved: sc === 'proxy' && !!data.value?.snowcat.configured }
    if (r.connection.http) return { ...common, kind: 'http', uri: r.connection.http.uri, apikey: r.connection.http.apikey ?? '' }
    return { ...common, kind: 'embedded', embeddedPath: r.connection.embedded?.path ?? '' }
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
      repositories: form.rows.map((r, index): Registry => ({
        name: r.name,
        priority: index,
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
  const snowcatApiKey = snowcatRow ? (snowcatRow.apikey.trim() ? snowcatRow.apikey.trim() : undefined) : (data.value?.snowcat.configured ? '' : undefined)
  return { doc, folders, snowcatApiKey }
}
const dirty = computed(() => needsMigration.value || JSON.stringify(payload()) !== original.value)
const hasLocal = computed(() => form.rows.some(r => r.kind === 'folder' && r.folderId === 'local'))
const hasSnowcat = computed(() => form.rows.some(r => r.kind === 'snowcatcloud'))
const localFolder = computed(() => data.value?.folders.find(f => f.primary))

const context = computed<RegistryContext>(() => ({
  snowcatUrl,
  snowcatSignup,
  snowcatConfigured: !!data.value?.snowcat.configured,
  localPath: localFolder.value?.path ?? '/schemas',
  hasLocal: hasLocal.value,
  hasSnowcat: hasSnowcat.value,
  folderUrl,
  slug
}))

// ---- editor
const editorOpen = ref(false)
const editing = ref<RegistryRow | null>(null)
function edit(row: RegistryRow) {
  editing.value = row
  editorOpen.value = true
}
function add(preset: 'local' | 'folder' | 'snowcatcloud' | 'iglu-central' | 'http' | 'embedded') {
  let row: RegistryRow
  switch (preset) {
    case 'local':
      row = { ...emptyRow('folder'), name: 'Local schemas (this console)', folderId: 'local', path: localFolder.value?.path ?? '/schemas', display: localFolder.value?.display }
      break
    case 'folder':
      row = { ...emptyRow('folder'), name: 'Extra schema folder', folderId: slug('folder') }
      break
    case 'snowcatcloud':
      row = { ...emptyRow('snowcatcloud'), name: 'SnowcatCloud Schema Registry', priority: 5, uri: snowcatUrl, keySaved: !!data.value?.snowcat.configured }
      break
    case 'iglu-central':
      row = { ...emptyRow('http'), name: 'Iglu Central', priority: 10, vendorPrefixes: ['com.snowplowanalytics'], uri: 'http://iglucentral.com' }
      break
    case 'embedded':
      row = { ...emptyRow('embedded'), name: 'Embedded (inside enrich)', priority: 100, embeddedPath: '/iglu-client-embedded' }
      break
    default:
      row = { ...emptyRow('http'), name: '', priority: 5, uri: 'https://' }
  }
  edit(row)
}
function onApply(row: RegistryRow) {
  const i = form.rows.findIndex(r => r.uid === row.uid)
  if (i >= 0) form.rows.splice(i, 1, row)
  else if (row.kind === 'folder' && row.folderId === 'local') form.rows.unshift(row)
  else form.rows.push(row)
}
function onRemove(uid: string) {
  const i = form.rows.findIndex(r => r.uid === uid)
  if (i >= 0) form.rows.splice(i, 1)
}

// ---- list + drag to reorder (order = priority)
const dragging = ref<string | null>(null)
const dragOver = ref<string | null>(null)
function onDragStart(uid: string, e: DragEvent) {
  dragging.value = uid
  e.dataTransfer?.setData('text/plain', uid)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onDrop(targetUid: string) {
  const from = form.rows.findIndex(r => r.uid === dragging.value)
  const to = form.rows.findIndex(r => r.uid === targetUid)
  dragging.value = null
  dragOver.value = null
  if (from < 0 || to < 0 || from === to) return
  const [row] = form.rows.splice(from, 1)
  form.rows.splice(to, 0, row!)
}
function move(uid: string, delta: number) {
  const from = form.rows.findIndex(r => r.uid === uid)
  const to = from + delta
  if (from < 0 || to < 0 || to >= form.rows.length) return
  const [row] = form.rows.splice(from, 1)
  form.rows.splice(to, 0, row!)
}
function sourceOf(r: RegistryRow): string {
  if (r.kind === 'folder') return r.folderId === 'local' ? 'Linked directory (schemas/)' : (r.display ?? r.path ?? '')
  if (r.kind === 'snowcatcloud') return snowcatUrl.replace(/^https?:\/\//, '')
  if (r.kind === 'http') return r.uri.replace(/^https?:\/\//, '')
  return r.embeddedPath
}
type Status = { label: string, color: 'success' | 'error' | 'warning' | 'neutral', icon?: string }
function statusOf(r: RegistryRow): Status {
  if (r.kind === 'folder') {
    if (r.check) return r.check.count ? { label: `${r.check.count} schemas`, color: 'success', icon: 'i-lucide-circle-check' } : { label: r.check.exists ? 'Empty' : 'Missing', color: r.check.exists ? 'warning' : 'error', icon: 'i-lucide-triangle-alert' }
    const f = data.value?.folders.find(x => x.id === r.folderId)
    if (!f) return { label: 'Unsaved', color: 'neutral', icon: 'i-lucide-clock' }
    if (!f.exists) return { label: 'Folder missing', color: 'error', icon: 'i-lucide-triangle-alert' }
    return { label: `${f.count} schema${f.count === 1 ? '' : 's'}`, color: f.count ? 'success' : 'warning', icon: f.count ? 'i-lucide-circle-check' : 'i-lucide-triangle-alert' }
  }
  if (r.kind === 'snowcatcloud') {
    if (r.keyCheck) return r.keyCheck.ok ? { label: `Authorized · ${r.keyCheck.count} schemas`, color: 'success', icon: 'i-lucide-shield-check' } : { label: r.keyCheck.authorized ? 'Authorized, pull failed' : 'Not authorized', color: r.keyCheck.authorized ? 'warning' : 'error', icon: 'i-lucide-shield-x' }
    if (r.apikey.trim()) return { label: 'Key entered, not checked', color: 'neutral', icon: 'i-lucide-key-round' }
    return r.keySaved ? { label: 'Key saved', color: 'success', icon: 'i-lucide-key-round' } : { label: 'No key yet', color: 'error', icon: 'i-lucide-key-round' }
  }
  if (r.kind === 'http') return { label: r.apikey ? 'With API key' : 'Public', color: 'neutral', icon: 'i-lucide-globe' }
  return { label: 'Inside enrich', color: 'neutral', icon: 'i-lucide-package' }
}

// ---- save
const saving = ref(false)
const restartState = ref<'idle' | 'restarting' | 'done' | 'failed'>('idle')
const restartMessage = ref('')
async function save(restart = true) {
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

// ---- resolve tester + lookup order
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
  const matches = (r: RegistryRow) => r.vendorPrefixes.some(p => v.startsWith(p))
  const byP = (a: RegistryRow, b: RegistryRow) => a.priority - b.priority
  return [...form.rows.filter(matches).sort(byP), ...form.rows.filter(r => !matches(r)).sort(byP)]
})
const kindLabel = (k: RegistryKind) => KIND_LABEL[k]
</script>

<template>
  <UDashboardPanel id="registries">
    <template #header>
      <UDashboardNavbar
        title="Schema Registry"
        icon="i-lucide-library"
      >
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UBadge
            v-if="dirty"
            color="warning"
            variant="subtle"
            label="Unsaved changes"
            class="mr-1"
          />
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
        <UAlert
          v-if="restartState === 'restarting'"
          color="warning"
          variant="subtle"
          icon="i-lucide-loader-circle"
          title="Restarting enrich…"
        />
        <UAlert
          v-else-if="restartState === 'failed'"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Enrich restart failed"
          :description="restartMessage"
        />
        <UAlert
          v-if="needsMigration"
          color="warning"
          variant="subtle"
          icon="i-lucide-key-round"
          title="Your SnowcatCloud key is sitting in resolver.json, which is tracked in git"
          description="Save to move it into the console's local store. Enrich will then reach SnowcatCloud through the console."
        />
        <UAlert
          v-if="data && !hasLocal"
          color="warning"
          variant="subtle"
          icon="i-lucide-unlink"
          title="The linked directory is not a registry yet"
          description="Enrich cannot see the schemas you edit here until this console is listed."
          :actions="[{ label: 'Add the linked directory', icon: 'i-lucide-plus', onClick: () => add('local') }]"
        />

        <UCard
          variant="subtle"
          :ui="{ body: 'p-0 sm:p-0', header: 'py-3' }"
        >
          <template #header>
            <div class="flex flex-wrap items-center gap-3">
              <div>
                <h3 class="font-semibold leading-tight">
                  Registries
                </h3>
                <p class="text-xs text-muted">
                  Drag to set the order enrich tries them in. Click a row to edit. Changing this list restarts enrich on save.
                </p>
              </div>
              <UDropdownMenu
                class="ml-auto"
                :items="[
                  { label: 'Folder', description: 'A directory this console serves', icon: 'i-lucide-folder-plus', onSelect: () => add('folder') },
                  { label: 'SnowcatCloud', description: 'Your hosted registry, API key only', icon: 'i-lucide-cloud', disabled: hasSnowcat, onSelect: () => add('snowcatcloud') },
                  { label: 'Iglu Central', description: 'Snowplow public schemas', icon: 'i-lucide-globe', onSelect: () => add('iglu-central') },
                  { label: 'HTTP registry', description: 'Iglu Server or static host', icon: 'i-lucide-server', onSelect: () => add('http') },
                  { label: 'Embedded', description: 'Inside the enrich JAR', icon: 'i-lucide-package', onSelect: () => add('embedded') },
                  ...(!hasLocal ? [{ label: 'Linked directory', description: 'This console\'s schemas/', icon: 'i-lucide-folder-open', onSelect: () => add('local') }] : [])
                ]"
                :ui="{ content: 'w-64' }"
              >
                <UButton
                  icon="i-lucide-plus"
                  label="Add registry"
                  size="sm"
                  trailing-icon="i-lucide-chevron-down"
                />
              </UDropdownMenu>
            </div>
          </template>
          <div class="divide-y divide-default">
            <div class="grid items-center gap-3 px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted grid-cols-[1.25rem_1.5rem_minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,1fr)_10rem_4rem]">
              <span /><span>#</span><span>Registry</span><span>Source</span><span>Vendor prefixes</span><span>Status</span><span />
            </div>
            <div
              v-for="(r, i) in form.rows"
              :key="r.uid"
              class="grid items-center gap-3 px-3 py-2 text-sm cursor-pointer transition-colors grid-cols-[1.25rem_1.5rem_minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,1fr)_10rem_4rem] hover:bg-elevated/50"
              :class="{ 'opacity-40': dragging === r.uid, 'border-t-2 border-primary': dragOver === r.uid && dragging !== r.uid }"
              draggable="true"
              @dragstart="onDragStart(r.uid, $event)"
              @dragover.prevent="dragOver = r.uid"
              @dragleave="dragOver === r.uid && (dragOver = null)"
              @drop.prevent="onDrop(r.uid)"
              @dragend="dragging = null; dragOver = null"
              @click="edit(r)"
            >
              <UIcon
                name="i-lucide-grip-vertical"
                class="text-muted cursor-grab active:cursor-grabbing size-4"
                aria-label="Drag to reorder"
              />
              <span class="font-mono text-xs text-muted">{{ i + 1 }}</span>
              <div class="flex items-center gap-2 min-w-0">
                <UTooltip :text="kindLabel(r.kind)">
                  <UIcon
                    :name="KIND_ICON[r.kind]"
                    class="size-4 shrink-0"
                    :class="r.kind === 'snowcatcloud' ? 'text-primary' : 'text-muted'"
                  />
                </UTooltip>
                <span class="font-medium text-highlighted truncate">{{ r.name || '(unnamed)' }}</span>
                <UBadge
                  v-if="r.isNew"
                  color="warning"
                  variant="subtle"
                  size="sm"
                  label="new"
                />
              </div>
              <span class="font-mono text-xs text-muted truncate">{{ sourceOf(r) }}</span>
              <div class="flex flex-wrap gap-1 min-w-0">
                <UBadge
                  v-for="p in r.vendorPrefixes"
                  :key="p"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  :label="p"
                  class="font-mono"
                />
                <span
                  v-if="!r.vendorPrefixes.length"
                  class="text-xs text-muted"
                >any vendor</span>
              </div>
              <UBadge
                :color="statusOf(r).color"
                variant="subtle"
                size="sm"
                :icon="statusOf(r).icon"
                :label="statusOf(r).label"
                class="justify-self-start max-w-full"
                :ui="{ label: 'truncate' }"
              />
              <div class="flex justify-end gap-0.5">
                <UButton
                  icon="i-lucide-chevron-up"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  aria-label="Move up"
                  :disabled="i === 0"
                  @click.stop="move(r.uid, -1)"
                />
                <UButton
                  icon="i-lucide-chevron-down"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  aria-label="Move down"
                  :disabled="i === form.rows.length - 1"
                  @click.stop="move(r.uid, 1)"
                />
                <UButton
                  v-if="!(r.kind === 'folder' && r.folderId === 'local')"
                  icon="i-lucide-trash-2"
                  size="xs"
                  color="error"
                  variant="ghost"
                  aria-label="Remove"
                  @click.stop="onRemove(r.uid)"
                />
              </div>
            </div>
            <div
              v-if="!form.rows.length"
              class="py-10 text-center text-sm text-muted"
            >
              No registries. Enrich would reject every self-describing event. Add the linked directory and Iglu Central.
            </div>
          </div>
        </UCard>

        <div class="grid gap-5 lg:grid-cols-3">
          <UCard
            variant="subtle"
            :ui="{ header: 'py-3', body: 'py-4' }"
          >
            <template #header>
              <h3 class="font-semibold leading-tight">
                Lookup order
              </h3>
              <p class="text-xs text-muted">
                Prefix matches first, then everything else, each by priority.
              </p>
            </template>
            <UInput
              v-model="previewVendor"
              size="sm"
              class="w-full font-mono"
              icon="i-lucide-building-2"
              placeholder="vendor, e.g. com.acme"
            />
            <ol class="mt-3 flex flex-col gap-1.5 text-sm">
              <li
                v-for="(r, i) in ordered"
                :key="r.uid"
                class="flex items-center gap-2"
              >
                <span class="w-5 text-xs text-muted text-right">{{ i + 1 }}.</span>
                <UIcon
                  :name="KIND_ICON[r.kind]"
                  class="text-muted shrink-0 size-4"
                />
                <span class="truncate">{{ r.name || '(unnamed)' }}</span>
                <UBadge
                  v-if="r.vendorPrefixes.some(p => previewVendor.startsWith(p))"
                  color="primary"
                  variant="subtle"
                  size="sm"
                  label="prefix"
                />
                <span class="text-xs text-muted ml-auto font-mono">#{{ form.rows.indexOf(r) + 1 }}</span>
              </li>
            </ol>
          </UCard>

          <UCard
            variant="subtle"
            :ui="{ header: 'py-3', body: 'py-4' }"
          >
            <template #header>
              <h3 class="font-semibold leading-tight">
                Resolve tester
              </h3>
              <p class="text-xs text-muted">
                Walks the saved registries like enrich does and shows who answers.
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
                :loading="testing"
                @click="runTest"
              />
            </div>
            <div
              v-if="result"
              class="mt-3 flex flex-col gap-1.5"
            >
              <UAlert
                :color="result.found ? 'success' : 'error'"
                variant="subtle"
                :icon="result.found ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
                :title="result.found ? `Resolved by ${result.resolvedBy}` : 'Not found in any registry'"
                :ui="{ root: 'py-2' }"
              />
              <div
                v-for="(a, i) in result.attempts"
                :key="i"
                class="flex items-center gap-2 text-xs"
              >
                <UBadge
                  :color="statusColor(a.status)"
                  variant="subtle"
                  size="sm"
                  :label="a.status"
                  class="w-20 justify-center"
                />
                <span class="truncate">{{ a.registry }}</span>
                <span
                  v-if="a.durationMs != null && a.status !== 'skipped'"
                  class="text-muted ml-auto font-mono"
                >{{ a.durationMs }} ms</span>
              </div>
            </div>
          </UCard>

          <UCard
            variant="subtle"
            :ui="{ header: 'py-3', body: 'py-4' }"
          >
            <template #header>
              <h3 class="font-semibold leading-tight">
                Cache
              </h3>
              <p class="text-xs text-muted">
                Zero keeps schema edits live. Turn it on only for load tests.
              </p>
            </template>
            <div class="grid grid-cols-2 gap-3">
              <UFormField
                label="Cache size"
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
            <p class="text-[11px] text-muted mt-2">
              {{ form.cacheSize ? `Enrich caches up to ${form.cacheSize} lookups${form.cacheTtl ? ` for ${form.cacheTtl}s` : ''}. Schema edits show up only after that.` : 'No cache: every lookup fetches the schema, so edits are picked up on the next event.' }}
            </p>
          </UCard>
        </div>

        <p class="text-[11px] text-muted font-mono">
          {{ data?.path }}
        </p>
      </div>

      <RegistryEditor
        v-model:open="editorOpen"
        :row="editing"
        :context="context"
        @apply="onApply"
        @remove="onRemove"
      />
    </template>
  </UDashboardPanel>
</template>
