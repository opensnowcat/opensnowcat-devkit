<script setup lang="ts">
import type { ConsoleInfo, TunnelInfo } from '~/types/api'

useHead({ title: 'Expose · OpenSnowcat Console' })

const toast = useToast()
const { data: info } = await useFetch<ConsoleInfo>('/api/info', { server: false, lazy: true, getCachedData: () => undefined })
const { data: tunnel, refresh: refreshTunnel } = await useFetch<TunnelInfo>('/api/tunnel/status', { server: false, lazy: true, getCachedData: () => undefined })

const busy = ref(false)
async function start() {
  busy.value = true
  try {
    await $fetch('/api/tunnel/start', { method: 'POST' })
    await refreshTunnel()
    toast.add({ title: tunnel.value?.url ? 'Tunnel is up' : 'Tunnel started, waiting for URL', description: tunnel.value?.url ?? 'Refresh in a few seconds', color: 'success', icon: 'i-lucide-globe' })
  } catch (e) {
    const msg = (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? (e as Error).message
    toast.add({ title: 'Could not start tunnel', description: msg, color: 'error', icon: 'i-lucide-x' })
  } finally {
    busy.value = false
  }
}
async function stop() {
  busy.value = true
  try {
    await $fetch('/api/tunnel/stop', { method: 'POST' })
    await refreshTunnel()
    toast.add({ title: 'Tunnel stopped', color: 'neutral', icon: 'i-lucide-power-off' })
  } catch (e) {
    toast.add({ title: 'Could not stop tunnel', description: String((e as Error).message), color: 'error' })
  } finally {
    busy.value = false
  }
}

let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => { timer = setInterval(() => { if (tunnel.value?.running && !tunnel.value.url) refreshTunnel() }, 3000) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

const snippetTarget = ref<'tunnel' | 'local'>('local')
watch(() => tunnel.value?.url, (u) => { if (u) snippetTarget.value = 'tunnel' })
const snippetUrl = computed(() => snippetTarget.value === 'tunnel' && tunnel.value?.url ? tunnel.value.url : (info.value?.collectorPublicUrl ?? 'http://localhost:8080'))

const jsSnippet = computed(() => `<script type="text/javascript">
;(function(p,l,o,w,i,n,g){if(!p[i]){p.GlobalSnowplowNamespace=p.GlobalSnowplowNamespace||[];
p.GlobalSnowplowNamespace.push(i);p[i]=function(){(p[i].q=p[i].q||[]).push(arguments)
};p[i].q=p[i].q||[];n=l.createElement(o);g=l.getElementsByTagName(o)[0];n.async=1;
n.src=w;g.parentNode.insertBefore(n,g)}}(window,document,"script","https://cdn.jsdelivr.net/npm/@snowplow/javascript-tracker@3/dist/sp.js","snowplow"));

snowplow('newTracker', 'sp', '${snippetUrl.value}', {
  appId: 'my-site',
  platform: 'web',
  postPath: '/com.snowplowanalytics.snowplow/tp2',
  contexts: { webPage: true }
});
snowplow('trackPageView');
<${'/'}script>`)

const curlSnippet = computed(() => `curl -i "${snippetUrl.value}/i?e=pv&url=https%3A%2F%2Fexample.com%2F&aid=curl&p=web&tv=curl&eid=$(uuidgen)"`)

async function copy(text: string, what: string) {
  const ok = await copyText(text)
  toast.add({ title: ok ? `${what} copied` : 'Copy failed', color: ok ? 'success' : 'error' })
}
const sendOpen = ref(false)
const { ready } = useEventStream()
</script>

<template>
  <UDashboardPanel id="expose">
    <template #header>
      <UDashboardNavbar
        title="Expose the collector"
        icon="i-lucide-globe"
      >
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-send"
            color="neutral"
            variant="subtle"
            label="Send events"
            :disabled="!ready"
            @click="sendOpen = true"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-6">
        <p class="text-sm text-muted">
          Browsers only send cookies and beacons to HTTPS endpoints, and phones cannot reach your laptop. A Cloudflare quick tunnel gives the local collector a public HTTPS URL in seconds, no account needed.
        </p>

        <div class="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <UCard variant="subtle">
            <template #header>
              <div class="flex items-center gap-3">
                <UChip
                  :color="tunnel?.url ? 'success' : tunnel?.running ? 'warning' : 'neutral'"
                  standalone
                  inset
                />
                <div>
                  <h3 class="font-semibold">
                    One-click tunnel
                  </h3>
                  <p class="text-xs text-muted">
                    Runs cloudflared as a container on the devkit network, pointing at {{ tunnel?.target ?? 'the collector' }}.
                  </p>
                </div>
                <div class="ml-auto flex gap-2">
                  <UButton
                    v-if="!tunnel?.running"
                    icon="i-lucide-play"
                    label="Start tunnel"
                    :loading="busy"
                    :disabled="tunnel && !tunnel.available"
                    @click="start"
                  />
                  <UButton
                    v-else
                    icon="i-lucide-square"
                    color="error"
                    variant="subtle"
                    label="Stop"
                    :loading="busy"
                    @click="stop"
                  />
                  <UButton
                    icon="i-lucide-refresh-cw"
                    color="neutral"
                    variant="ghost"
                    @click="refreshTunnel()"
                  />
                </div>
              </div>
            </template>
            <UAlert
              v-if="tunnel && !tunnel.available"
              color="warning"
              variant="subtle"
              icon="i-lucide-plug-zap"
              title="Docker socket not available"
              :description="tunnel.error ?? 'Mount /var/run/docker.sock into the console container, or run cloudflared manually below.'"
            />
            <div
              v-else-if="tunnel?.url"
              class="flex flex-col sm:flex-row gap-4 items-start"
            >
              <div class="flex-1 min-w-0 flex flex-col gap-2">
                <p class="text-xs uppercase tracking-wider text-muted">
                  Public HTTPS collector
                </p>
                <div class="flex items-center gap-2">
                  <code class="font-mono text-sm text-highlighted break-all">{{ tunnel.url }}</code>
                  <UButton
                    icon="i-lucide-copy"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    @click="copy(tunnel!.url!, 'URL')"
                  />
                  <UButton
                    icon="i-lucide-external-link"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :to="`${tunnel.url}/health`"
                    target="_blank"
                  />
                </div>
                <p class="text-xs text-muted">
                  Quick tunnels get a new hostname every start and Cloudflare offers no uptime promise. Fine for development, not for production.
                </p>
              </div>
              <img
                v-if="tunnel.qr"
                :src="tunnel.qr"
                alt="QR code for the tunnel URL"
                class="size-36 rounded-md bg-elevated p-2"
              >
            </div>
            <p
              v-else-if="tunnel?.running"
              class="text-sm text-muted flex items-center gap-2"
            >
              <UIcon
                name="i-lucide-loader-circle"
                class="animate-spin"
              /> Waiting for cloudflared to print the URL…
            </p>
            <p
              v-else
              class="text-sm text-muted"
            >
              No tunnel running.
            </p>
            <UCollapsible
              v-if="tunnel?.logs"
              class="mt-3"
            >
              <UButton
                label="cloudflared logs"
                color="neutral"
                variant="link"
                size="xs"
                trailing-icon="i-lucide-chevron-down"
                class="px-0"
              />
              <template #content>
                <pre class="osc-json mt-2 max-h-64">{{ tunnel.logs }}</pre>
              </template>
            </UCollapsible>
          </UCard>

          <UCard variant="subtle">
            <template #header>
              <h3 class="font-semibold">
                Run cloudflared yourself
              </h3>
              <p class="text-xs text-muted">
                Same result, from a terminal on your machine.
              </p>
            </template>
            <ol class="flex flex-col gap-3 text-sm">
              <li>
                <p class="mb-1">
                  Install the client
                </p>
                <pre class="osc-json">brew install cloudflared          # macOS
winget install Cloudflare.cloudflared   # Windows
# Linux: https://pkg.cloudflare.com/</pre>
              </li>
              <li>
                <p class="mb-1">
                  Point a quick tunnel at the collector
                </p>
                <pre class="osc-json">cloudflared tunnel --url {{ info?.collectorPublicUrl ?? 'http://localhost:8080' }}</pre>
              </li>
              <li>
                <p class="mb-1">
                  Copy the <code class="font-mono">https://….trycloudflare.com</code> URL it prints and use it as the collector endpoint in your tracker.
                </p>
              </li>
              <li class="text-xs text-muted">
                Need a stable hostname? Create a named tunnel in the Cloudflare dashboard and run <code class="font-mono">cloudflared tunnel run &lt;name&gt;</code> with a route to {{ info?.collectorPublicUrl ?? 'http://localhost:8080' }}.
              </li>
            </ol>
          </UCard>
        </div>

        <UCard variant="subtle">
          <template #header>
            <div class="flex flex-wrap items-center gap-3">
              <div>
                <h3 class="font-semibold">
                  Tracker snippet
                </h3>
                <p class="text-xs text-muted">
                  Paste into a page and watch page views land in the live stream.
                </p>
              </div>
              <div class="ml-auto flex items-center gap-2">
                <USelect
                  v-model="snippetTarget"
                  :items="[{ label: `Local (${info?.collectorPublicUrl ?? 'http://localhost:8080'})`, value: 'local' }, { label: tunnel?.url ? `Tunnel (${tunnel.url})` : 'Tunnel (not running)', value: 'tunnel', disabled: !tunnel?.url }]"
                  size="sm"
                  class="w-72"
                />
                <UButton
                  icon="i-lucide-copy"
                  size="sm"
                  color="neutral"
                  variant="subtle"
                  label="Copy snippet"
                  @click="copy(jsSnippet, 'Snippet')"
                />
              </div>
            </div>
          </template>
          <pre class="osc-json max-h-80">{{ jsSnippet }}</pre>
          <template #footer>
            <p class="text-xs text-muted mb-1">
              Or hit the GET endpoint once from a terminal:
            </p>
            <div class="flex items-start gap-2">
              <pre class="osc-json flex-1">{{ curlSnippet }}</pre>
              <UButton
                icon="i-lucide-copy"
                size="xs"
                color="neutral"
                variant="ghost"
                @click="copy(curlSnippet, 'Command')"
              />
            </div>
          </template>
        </UCard>
      </div>
      <SendEventsPanel
        v-model:open="sendOpen"
        :default-target="tunnel?.url ? 'tunnel' : 'internal'"
      />
    </template>
  </UDashboardPanel>
</template>
