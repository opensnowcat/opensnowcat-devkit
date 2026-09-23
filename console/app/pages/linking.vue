<script setup lang="ts">
useHead({ title: 'Linking · OpenSnowcat Console' })

interface Registry { name: string, priority: number, vendorPrefixes: string[], connection: { http?: { uri: string, apikey?: string }, embedded?: { path: string } } }
interface ResolverDoc { schema: string, data: { cacheSize: number, cacheTtl?: number, repositories: Registry[] } }
interface Attempt { registry: string, uri: string | null, kind: string, status: 'found' | 'not-found' | 'error' | 'skipped', httpStatus?: number, durationMs?: number, message?: string, matchedPrefix: boolean }

const toast = useToast()
const hydrated = useHydrated()
const { data, refresh, pending } = await useFetch<{ doc: ResolverDoc, path: string, consoleRegistryUrl: string }>('/api/resolver', { server: false, lazy: true })

const form = reactive<{ cacheSize: number, cacheTtl: number | null, registries: Array<Registry & { kind: 'http' | 'embedded', uri: string, apikey: string, path: string }> }>({ cacheSize: 0, cacheTtl: null, registries: [] })
const original = ref('')

function load() {
  if (!data.value) return
  form.cacheSize = data.value.doc.data.cacheSize
  form.cacheTtl = data.value.doc.data.cacheTtl ?? null
  form.registries = data.value.doc.data.repositories.map(r => ({
    ...r,
    kind: r.connection.http ? 'http' : 'embedded',
    uri: r.connection.http?.uri ?? '',
    apikey: r.connection.http?.apikey ?? '',
    path: r.connection.embedded?.path ?? ''
  }))
  original.value = JSON.stringify(toDoc())
}
watch(data, load, { immediate: true })

function toDoc(): ResolverDoc {
  return {
    schema: data.value?.doc.schema ?? 'iglu:com.snowplowanalytics.iglu/resolver-config/jsonschema/1-0-3',
    data: {
      cacheSize: Number(form.cacheSize) || 0,
      ...(form.cacheTtl != null && form.cacheTtl !== ('' as unknown) ? { cacheTtl: Number(form.cacheTtl) } : {}),
      repositories: form.registries.map(r => ({
        name: r.name,
        priority: Number(r.priority) || 0,
        vendorPrefixes: r.vendorPrefixes,
        connection: r.kind === 'http' ? { http: { uri: r.uri, ...(r.apikey ? { apikey: r.apikey } : {}) } } : { embedded: { path: r.path } }
      }))
    }
  }
}
const dirty = computed(() => JSON.stringify(toDoc()) !== original.value)
const hasConsole = computed(() => form.registries.some(r => r.kind === 'http' && data.value && r.uri === data.value.consoleRegistryUrl))

function addRegistry(preset: 'console' | 'iglu-central' | 'custom' | 'embedded') {
  const base = { vendorPrefixes: [] as string[], apikey: '', path: '', uri: '', connection: {} }
  if (preset === 'console') form.registries.unshift({ ...base, name: 'Local schemas (this console)', priority: 0, kind: 'http', uri: data.value?.consoleRegistryUrl ?? 'http://console:3000/iglu' })
  else if (preset === 'iglu-central') form.registries.push({ ...base, name: 'Iglu Central', priority: 10, vendorPrefixes: ['com.snowplowanalytics'], kind: 'http', uri: 'http://iglucentral.com' })
  else if (preset === 'embedded') form.registries.push({ ...base, name: 'Embedded', priority: 100, kind: 'embedded', path: '/iglu-client-embedded' })
  else form.registries.push({ ...base, name: 'My Iglu Server', priority: 5, kind: 'http', uri: 'http://iglu.example.com' })
}
function remove(i: number) {
  form.registries.splice(i, 1)
}

const saving = ref(false)
const restartState = ref<'idle' | 'restarting' | 'done' | 'failed'>('idle')
const restartMessage = ref('')
async function save(restart = true) {
  saving.value = true
  restartState.value = restart ? 'restarting' : 'idle'
  try {
    const res = await $fetch<{ restarted: { name: string } | null, restartError: string | null }>('/api/resolver', { method: 'PUT', body: { doc: toDoc(), restart } })
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

// effective order preview
const previewVendor = ref('com.opensnowcat.example')
const ordered = computed(() => {
  const v = previewVendor.value.trim()
  const matches = (r: Registry) => r.vendorPrefixes.some(p => v.startsWith(p))
  const byP = (a: Registry, b: Registry) => a.priority - b.priority
  return [...form.registries.filter(matches).sort(byP), ...form.registries.filter(r => !matches(r)).sort(byP)]
})
</script>

<template>
  <UDashboardPanel id="linking">
    <template #header>
      <UDashboardNavbar
        title="Linking"
        icon="i-lucide-link"
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
      <div class="flex flex-col gap-6 max-w-5xl">
        <UAlert
          color="primary"
          variant="subtle"
          icon="i-lucide-info"
          title="Schema files are live. Registry changes need an enrich restart."
          description="Enrich reads this resolver once at startup, so saving here restarts it automatically. With the cache at zero it fetches every schema on every lookup, which is what you want while developing."
        />
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
          v-if="data && !hasConsole"
          color="warning"
          variant="subtle"
          icon="i-lucide-unlink"
          title="This console is not a registry yet"
          description="Enrich cannot see your linked schema directory until the console is listed as an HTTP registry."
          :actions="[{ label: 'Add this console', icon: 'i-lucide-plus', onClick: () => addRegistry('console') }]"
        />

        <UCard variant="subtle">
          <template #header>
            <div class="flex items-center justify-between">
              <div>
                <h3 class="font-semibold">
                  Registries
                </h3>
                <p class="text-xs text-muted">
                  {{ data?.path }}
                </p>
              </div>
              <UDropdownMenu
                :items="[
                  { label: 'This console (linked directory)', icon: 'i-lucide-radio', onSelect: () => addRegistry('console') },
                  { label: 'Iglu Central', icon: 'i-lucide-globe', onSelect: () => addRegistry('iglu-central') },
                  { label: 'Custom HTTP registry', icon: 'i-lucide-server', onSelect: () => addRegistry('custom') },
                  { label: 'Embedded (inside enrich JAR)', icon: 'i-lucide-package', onSelect: () => addRegistry('embedded') }
                ]"
              >
                <UButton
                  icon="i-lucide-plus"
                  label="Add registry"
                  size="sm"
                  color="neutral"
                  variant="subtle"
                />
              </UDropdownMenu>
            </div>
          </template>
          <div class="flex flex-col gap-4">
            <div
              v-for="(r, i) in form.registries"
              :key="i"
              class="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_6rem_minmax(0,1.6fr)_minmax(0,1.2fr)_auto] items-end rounded-lg border border-default p-3"
            >
              <UFormField
                label="Name"
                size="sm"
              >
                <UInput
                  v-model="r.name"
                  size="sm"
                  class="w-full"
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
              <UFormField
                :label="r.kind === 'http' ? 'HTTP URI' : 'Embedded path'"
                size="sm"
              >
                <div class="flex gap-1.5">
                  <USelect
                    v-model="r.kind"
                    :items="[{ label: 'http', value: 'http' }, { label: 'embedded', value: 'embedded' }]"
                    size="sm"
                    class="w-28"
                  />
                  <UInput
                    v-if="r.kind === 'http'"
                    v-model="r.uri"
                    size="sm"
                    class="w-full font-mono"
                    placeholder="http://host/path"
                  />
                  <UInput
                    v-else
                    v-model="r.path"
                    size="sm"
                    class="w-full font-mono"
                    placeholder="/iglu-client-embedded"
                  />
                </div>
              </UFormField>
              <UFormField
                label="Vendor prefixes"
                size="sm"
                help="Tried first for matching vendors"
              >
                <UInputTags
                  v-model="r.vendorPrefixes"
                  size="sm"
                  class="w-full"
                  placeholder="com.acme"
                />
              </UFormField>
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="sm"
                aria-label="Remove registry"
                @click="remove(i)"
              />
              <UFormField
                v-if="r.kind === 'http'"
                label="API key (optional)"
                size="sm"
                class="md:col-span-3"
              >
                <UInput
                  v-model="r.apikey"
                  size="sm"
                  class="w-full font-mono"
                  type="password"
                />
              </UFormField>
            </div>
          </div>
          <template #footer>
            <div class="grid gap-3 sm:grid-cols-2 max-w-md">
              <UFormField
                label="Cache size"
                help="0 = no cache, schemas fetched every lookup"
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
                label="Cache TTL (seconds)"
                help="Only matters when the cache is on"
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
          </template>
        </UCard>

        <div class="grid gap-6 lg:grid-cols-2">
          <UCard variant="subtle">
            <template #header>
              <h3 class="font-semibold">
                Lookup order
              </h3>
              <p class="text-xs text-muted">
                Registries whose vendor prefix matches are tried first, then the rest, each by priority.
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
                <span class="truncate">{{ r.name }}</span>
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
                Walks the registries exactly like enrich would and shows who answers.
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
      </div>
    </template>
  </UDashboardPanel>
</template>
