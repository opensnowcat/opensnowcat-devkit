<script setup lang="ts">
import type { TreeItem } from '@nuxt/ui'

useHead({ title: 'Schemas · OpenSnowcat Console' })

interface Ref { vendor: string, name: string, format: string, version: string }
interface Lint { valid: boolean, errors: Array<{ message: string, path?: string }>, warnings: Array<{ message: string, path?: string }> }
interface VersionEntry { version: string, format: string, size: number, mtimeMs: number, uri: string }
interface Listing { root: string, count: number, vendors: Array<{ vendor: string, names: Array<{ name: string, versions: VersionEntry[] }> }> }
interface Folder { id: string, name: string, path: string, display: string, root: string, url: string, primary: boolean, exists: boolean, listing: Listing }

const route = useRoute()
const router = useRouter()
const toast = useToast()
const hydrated = useHydrated()

const { data: folders, refresh: refreshListing, pending: listingPending } = await useFetch<{ folders: Folder[], count: number }>('/api/schemas', { server: false, lazy: true })

const current = ref<(Ref & { folder: string }) | null>(null)
const content = ref('')
const original = ref('')
const mtime = ref<number | null>(null)
const lint = ref<Lint | null>(null)
const servedAt = ref<string | null>(null)
const loading = ref(false)
const saving = ref(false)
const validating = ref(false)
const missingUri = ref<string | null>(null)

const dirty = computed(() => content.value !== original.value)
const uri = computed(() => current.value ? `iglu:${current.value.vendor}/${current.value.name}/${current.value.format}/${current.value.version}` : null)
const currentFolder = computed(() => folders.value?.folders.find(f => f.id === current.value?.folder) ?? null)

function parseUri(u: string): Ref | null {
  const m = /^iglu:([^/]+)\/([^/]+)\/([^/]+)\/(\d+-\d+-\d+)$/.exec(u.trim())
  return m ? { vendor: m[1]!, name: m[2]!, format: m[3]!, version: m[4]! } : null
}

async function open(ref: Ref & { folder: string }) {
  if (dirty.value && !confirm('Discard unsaved changes?')) return
  loading.value = true
  missingUri.value = null
  try {
    const file = await $fetch<{ content: string, mtimeMs: number, lint: Lint, servedAt: string }>('/api/schemas/file', { query: ref })
    current.value = ref
    content.value = file.content
    original.value = file.content
    mtime.value = file.mtimeMs
    lint.value = file.lint
    servedAt.value = file.servedAt
    router.replace({ query: { uri: `iglu:${ref.vendor}/${ref.name}/${ref.format}/${ref.version}`, folder: ref.folder } })
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    if (status === 404) {
      missingUri.value = `iglu:${ref.vendor}/${ref.name}/${ref.format}/${ref.version}`
      current.value = null
    } else {
      toast.add({ title: 'Could not open schema', description: String((e as Error).message), color: 'error' })
    }
  } finally {
    loading.value = false
  }
}

/** Open a schema by Iglu URI, looking through every folder registry. */
function openByUri(u: string, preferredFolder?: string) {
  const ref = parseUri(u)
  if (!ref) return
  const list = folders.value?.folders ?? []
  const has = (f: Folder) => f.listing.vendors.some(v => v.vendor === ref.vendor && v.names.some(n => n.name === ref.name && n.versions.some(x => x.version === ref.version && x.format === ref.format)))
  const folder = (preferredFolder ? list.find(f => f.id === preferredFolder && has(f)) : undefined) ?? list.find(has) ?? list.find(f => f.id === (preferredFolder ?? 'local')) ?? list[0]
  open({ ...ref, folder: folder?.id ?? 'local' })
}

let lintTimer: ReturnType<typeof setTimeout> | null = null
watch(content, () => {
  if (!current.value) return
  if (lintTimer) clearTimeout(lintTimer)
  lintTimer = setTimeout(() => runLint(false), 350)
})

async function runLint(announce: boolean) {
  if (!current.value) return
  validating.value = announce
  try {
    const res = await $fetch<Lint>('/api/schemas/lint', { method: 'POST', body: { ...current.value, content: content.value } })
    lint.value = res
    if (announce) {
      toast.add({
        title: res.valid ? (res.warnings.length ? `Valid, ${res.warnings.length} warning${res.warnings.length === 1 ? '' : 's'}` : 'Schema is valid') : `${res.errors.length} error${res.errors.length === 1 ? '' : 's'}`,
        description: res.valid ? 'Self-describing block matches the path and the JSON Schema compiles.' : res.errors[0]?.message,
        color: res.valid ? 'success' : 'error',
        icon: res.valid ? 'i-lucide-badge-check' : 'i-lucide-circle-x'
      })
    }
  } finally {
    validating.value = false
  }
}

async function save() {
  if (!current.value || !dirty.value) return
  saving.value = true
  try {
    const res = await $fetch<{ mtimeMs: number, lint: Lint }>('/api/schemas/file', { method: 'PUT', body: { ...current.value, content: content.value, expectedMtimeMs: mtime.value } })
    original.value = content.value
    mtime.value = res.mtimeMs
    lint.value = res.lint
    toast.add({ title: 'Saved', description: res.lint.valid ? 'Live now. Enrich resolves the new version on the next event.' : 'Saved with lint errors. Enrich may reject events until they are fixed.', color: res.lint.valid ? 'success' : 'warning', icon: 'i-lucide-save' })
    await refreshListing()
  } catch (e) {
    const msg = (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? (e as Error).message
    toast.add({ title: 'Save failed', description: msg, color: 'error', icon: 'i-lucide-x' })
  } finally {
    saving.value = false
  }
}

// ---- tree: folder registries → vendors → names → versions
const tree = computed<TreeItem[]>(() => (folders.value?.folders ?? []).map(f => ({
  label: f.name,
  icon: f.primary ? 'i-lucide-folder-open' : 'i-lucide-folder',
  trailingIcon: f.exists ? undefined : 'i-lucide-triangle-alert',
  defaultExpanded: true,
  children: f.listing.vendors.map(v => ({
    label: v.vendor,
    icon: 'i-lucide-building-2',
    defaultExpanded: true,
    children: v.names.map(n => ({
      label: n.name,
      icon: 'i-lucide-file-json',
      defaultExpanded: true,
      children: n.versions.map(x => ({
        label: x.version,
        icon: 'i-lucide-tag',
        value: `${f.id}|${x.uri}`,
        onSelect: () => open({ folder: f.id, vendor: v.vendor, name: n.name, format: x.format, version: x.version })
      }))
    }))
  }))
})))
const folderOptions = computed(() => (folders.value?.folders ?? []).map(f => ({ label: f.primary ? f.name : `${f.name} (${f.display})`, value: f.id })))

// ---- create / bump / delete
const createOpen = ref(false)
const createForm = reactive({ folder: 'local', vendor: 'com.example', name: '', version: '1-0-0', description: '' })
async function create(from?: Ref & { folder: string }) {
  try {
    const body = from
      ? { folder: from.folder, vendor: from.vendor, name: from.name, format: from.format, version: bumpForm.version, from }
      : { ...createForm }
    const res = await $fetch<{ ref: Ref, folder: string }>('/api/schemas/create', { method: 'POST', body })
    createOpen.value = false
    bumpOpen.value = false
    await refreshListing()
    await open({ ...res.ref, folder: res.folder })
    toast.add({ title: from ? `Created ${bumpForm.version}` : 'Schema created', description: 'It is served to enrich immediately.', color: 'success', icon: 'i-lucide-plus' })
  } catch (e) {
    const msg = (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? (e as Error).message
    toast.add({ title: 'Could not create schema', description: msg, color: 'error', icon: 'i-lucide-x' })
  }
}

const bumpOpen = ref(false)
const bumpForm = reactive({ version: '' })
function suggestBump(kind: 'addition' | 'revision' | 'model') {
  if (!current.value) return
  const [m, r, a] = current.value.version.split('-').map(Number) as [number, number, number]
  bumpForm.version = kind === 'addition' ? `${m}-${r}-${a + 1}` : kind === 'revision' ? `${m}-${r + 1}-0` : `${m + 1}-0-0`
}
function openBump() {
  suggestBump('addition')
  bumpOpen.value = true
}

const deleteOpen = ref(false)
async function remove() {
  if (!current.value) return
  try {
    await $fetch('/api/schemas/file', { method: 'DELETE', query: current.value })
    toast.add({ title: 'Schema deleted', color: 'success', icon: 'i-lucide-trash-2' })
    deleteOpen.value = false
    current.value = null
    content.value = ''
    original.value = ''
    lint.value = null
    router.replace({ query: {} })
    await refreshListing()
  } catch (e) {
    toast.add({ title: 'Delete failed', description: String((e as Error).message), color: 'error' })
  }
}

// ---- validate sample data against the editor content
const sampleOpen = ref(false)
const sample = ref('{\n  \n}')
const sampleResult = ref<{ valid: boolean, errors: string[] } | null>(null)
async function validateSample() {
  if (!current.value) return
  let data: unknown
  try {
    data = JSON.parse(sample.value)
  } catch (e) {
    sampleResult.value = { valid: false, errors: [`Sample is not valid JSON: ${(e as Error).message}`] }
    return
  }
  sampleResult.value = await $fetch('/api/schemas/validate', { method: 'POST', body: { ...current.value, content: content.value, data } })
}

async function copyUri() {
  if (!uri.value) return
  const ok = await copyText(uri.value)
  toast.add({ title: ok ? 'Iglu URI copied' : 'Copy failed', color: ok ? 'success' : 'error' })
}

function createMissing() {
  const ref = missingUri.value ? parseUri(missingUri.value) : null
  if (!ref) return
  createForm.vendor = ref.vendor
  createForm.name = ref.name
  createForm.version = ref.version
  createOpen.value = true
}

const pendingUri = ref<string | null>(typeof route.query.uri === 'string' ? route.query.uri : null)
const pendingFolder = typeof route.query.folder === 'string' ? route.query.folder : undefined
watch(folders, (f) => {
  if (f && pendingUri.value) {
    const u = pendingUri.value
    pendingUri.value = null
    openByUri(u, pendingFolder)
  }
}, { immediate: true })
</script>

<template>
  <UDashboardPanel id="schemas">
    <template #header>
      <UDashboardNavbar
        title="Schemas"
        icon="i-lucide-file-json"
      >
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UTooltip :text="folders ? `${folders.count} schemas across ${folders.folders.length} folder${folders.folders.length === 1 ? '' : 's'}` : 'Refresh'">
            <UButton
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              :loading="hydrated && listingPending"
              @click="refreshListing()"
            />
          </UTooltip>
          <UButton
            icon="i-lucide-plus"
            label="New schema"
            @click="createOpen = true"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)] 2xl:grid-cols-[24rem_minmax(0,1fr)] h-full">
        <aside class="min-w-0 flex flex-col gap-3">
          <UTree
            v-if="tree.length"
            :items="tree"
            size="sm"
            color="neutral"
          />
          <UEmpty
            v-else-if="hydrated && !listingPending"
            icon="i-lucide-folder-open"
            title="No schemas yet"
            description="Create one, or drop files into the linked directory using the Iglu layout: vendor/name/jsonschema/1-0-0"
            :ui="{ root: 'py-6' }"
          >
            <template #actions>
              <UButton
                icon="i-lucide-plus"
                label="New schema"
                size="sm"
                @click="createOpen = true"
              />
            </template>
          </UEmpty>
          <div
            v-if="folders"
            class="mt-auto flex flex-col gap-1 text-[11px] text-muted"
          >
            <p
              v-for="f in folders.folders"
              :key="f.id"
              class="font-mono break-all"
            >
              <UIcon
                :name="f.exists ? 'i-lucide-folder-open' : 'i-lucide-triangle-alert'"
                class="inline-block align-[-2px] mr-1"
              />{{ f.name }}<template v-if="!f.primary">
                : {{ f.display }}
              </template>
            </p>
            <NuxtLink
              to="/registries"
              class="text-primary hover:underline"
            >
              Manage folders on Schema registries
            </NuxtLink>
          </div>
        </aside>

        <section class="min-w-0 flex flex-col gap-3 min-h-[60vh]">
          <UAlert
            v-if="missingUri"
            color="warning"
            variant="subtle"
            icon="i-lucide-file-question"
            :title="`${missingUri} is not in any folder registry`"
            description="Events referencing it fail with a resolution error unless another registry serves it."
            :actions="[{ label: 'Create it here', icon: 'i-lucide-plus', onClick: createMissing }]"
          />
          <template v-if="current">
            <div class="flex flex-wrap items-center gap-2">
              <UButton
                variant="link"
                color="primary"
                class="px-0 font-mono text-sm"
                :label="uri ?? ''"
                trailing-icon="i-lucide-copy"
                @click="copyUri"
              />
              <UBadge
                v-if="dirty"
                color="warning"
                variant="subtle"
                label="Unsaved"
              />
              <UBadge
                v-else-if="lint"
                :color="lint.valid ? 'success' : 'error'"
                variant="subtle"
                :label="lint.valid ? 'Valid · live' : `${lint.errors.length} error${lint.errors.length === 1 ? '' : 's'}`"
                :icon="lint.valid ? 'i-lucide-radio' : 'i-lucide-circle-x'"
              />
              <div class="ml-auto flex flex-wrap items-center gap-1.5">
                <UButton
                  icon="i-lucide-badge-check"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  label="Validate"
                  :loading="validating"
                  @click="runLint(true)"
                />
                <UButton
                  icon="i-lucide-flask-conical"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  label="Test with data"
                  @click="sampleOpen = true"
                />
                <UButton
                  icon="i-lucide-git-branch"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  label="New version"
                  @click="openBump"
                />
                <UButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="subtle"
                  size="sm"
                  aria-label="Delete schema"
                  @click="deleteOpen = true"
                />
                <UButton
                  icon="i-lucide-save"
                  size="sm"
                  label="Save"
                  :disabled="!dirty"
                  :loading="saving"
                  @click="save"
                />
              </div>
            </div>
            <p class="text-[11px] text-muted font-mono break-all">
              {{ currentFolder?.name ?? current.folder }} · served to enrich at {{ servedAt }}
            </p>
            <div class="flex-1 min-h-[360px]">
              <ClientOnly>
                <CodeEditor
                  v-model="content"
                  @save="save"
                />
                <template #fallback>
                  <USkeleton class="h-[360px] w-full" />
                </template>
              </ClientOnly>
            </div>
            <LintResults :lint="lint" />
          </template>
          <UEmpty
            v-else-if="!missingUri"
            icon="i-lucide-mouse-pointer-click"
            title="Pick a schema"
            description="Edits are written straight to the folder and served to enrich immediately. Validation runs as you type and on save."
            class="flex-1"
          />
        </section>
      </div>
    </template>
  </UDashboardPanel>

  <UModal
    v-model:open="createOpen"
    title="New schema"
    description="Creates vendor/name/jsonschema/version from a starter template."
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <UFormField
          v-if="folderOptions.length > 1"
          label="Folder"
        >
          <USelect
            v-model="createForm.folder"
            :items="folderOptions"
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="Vendor"
          help="Reverse domain, e.g. com.acme"
        >
          <UInput
            v-model="createForm.vendor"
            class="w-full font-mono"
          />
        </UFormField>
        <UFormField
          label="Name"
          help="snake_case event or entity name"
        >
          <UInput
            v-model="createForm.name"
            class="w-full font-mono"
            placeholder="product_view"
          />
        </UFormField>
        <UFormField
          label="Version"
          help="MODEL-REVISION-ADDITION"
        >
          <UInput
            v-model="createForm.version"
            class="w-full font-mono"
          />
        </UFormField>
        <UFormField label="Description">
          <UInput
            v-model="createForm.description"
            class="w-full"
          />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton
          color="neutral"
          variant="ghost"
          label="Cancel"
          @click="createOpen = false"
        />
        <UButton
          icon="i-lucide-plus"
          label="Create"
          :disabled="!createForm.vendor || !createForm.name || !createForm.version"
          @click="create()"
        />
      </div>
    </template>
  </UModal>

  <UModal
    v-model:open="bumpOpen"
    title="New version"
    :description="current ? `Copy ${current.name} ${current.version} to a new version and update its self block.` : ''"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <UFieldGroup size="sm">
          <UButton
            color="neutral"
            variant="subtle"
            label="Addition"
            @click="suggestBump('addition')"
          />
          <UButton
            color="neutral"
            variant="subtle"
            label="Revision"
            @click="suggestBump('revision')"
          />
          <UButton
            color="neutral"
            variant="subtle"
            label="Model"
            @click="suggestBump('model')"
          />
        </UFieldGroup>
        <UFormField
          label="New version"
          help="Addition for backwards-compatible tweaks, revision for new optional fields, model for breaking changes."
        >
          <UInput
            v-model="bumpForm.version"
            class="w-full font-mono"
          />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton
          color="neutral"
          variant="ghost"
          label="Cancel"
          @click="bumpOpen = false"
        />
        <UButton
          icon="i-lucide-git-branch"
          label="Create version"
          @click="current && create(current)"
        />
      </div>
    </template>
  </UModal>

  <UModal
    v-model:open="deleteOpen"
    title="Delete schema?"
    :description="uri ?? ''"
  >
    <template #body>
      <p class="text-sm text-muted">
        The file is removed from the folder. Events referencing it will fail to resolve from then on.
      </p>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton
          color="neutral"
          variant="ghost"
          label="Cancel"
          @click="deleteOpen = false"
        />
        <UButton
          color="error"
          icon="i-lucide-trash-2"
          label="Delete"
          @click="remove"
        />
      </div>
    </template>
  </UModal>

  <USlideover
    v-model:open="sampleOpen"
    title="Test data against this schema"
    :description="uri ?? ''"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <p class="text-xs text-muted">
          Uses the editor content, saved or not, so you can try changes before saving.
        </p>
        <UTextarea
          v-model="sample"
          :rows="12"
          class="w-full font-mono"
          autoresize
        />
        <UAlert
          v-if="sampleResult"
          :color="sampleResult.valid ? 'success' : 'error'"
          variant="subtle"
          :icon="sampleResult.valid ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
          :title="sampleResult.valid ? 'Data is valid' : 'Data does not match'"
          :description="sampleResult.errors.join('\n')"
        />
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton
          icon="i-lucide-flask-conical"
          label="Validate"
          @click="validateSample"
        />
      </div>
    </template>
  </USlideover>
</template>
