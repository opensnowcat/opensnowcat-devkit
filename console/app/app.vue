<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

useHead({
  meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }]
})

const links: NavigationMenuItem[] = [
  { label: 'Live stream', icon: 'i-lucide-radio', to: '/' },
  { label: 'Schemas', icon: 'i-lucide-file-json', to: '/schemas' },
  { label: 'Linking', icon: 'i-lucide-link', to: '/linking' },
  { label: 'Expose', icon: 'i-lucide-globe', to: '/expose' },
  { label: 'Pipeline', icon: 'i-lucide-server', to: '/pipeline' }
]

const external: NavigationMenuItem[] = [
  { label: 'Documentation', icon: 'i-lucide-book-open', to: 'https://opensnowcat.io/', target: '_blank' },
  { label: 'GitHub', icon: 'i-simple-icons-github', to: 'https://github.com/opensnowcat/opensnowcat-devkit', target: '_blank' }
]

const { stats, connected, connect } = useEventStream()
onMounted(connect)

const kafkaState = computed(() => {
  if (!connected.value) return { label: 'Console offline', color: 'error' as const }
  if (stats.value?.kafka.connected) return { label: 'Kafka connected', color: 'success' as const }
  return { label: stats.value?.kafka.error ? 'Kafka error' : 'Kafka connecting', color: 'warning' as const }
})
</script>

<template>
  <UApp>
    <UDashboardGroup unit="rem">
      <UDashboardSidebar
        id="nav"
        collapsible
        resizable
        :min-size="12"
        :default-size="16"
        :max-size="22"
        class="bg-elevated/25"
        :ui="{ footer: 'border-t border-default' }"
      >
        <template #header="{ collapsed }">
          <AppLogo :collapsed="collapsed" />
        </template>

        <template #default="{ collapsed }">
          <UNavigationMenu
            :collapsed="collapsed"
            :items="links"
            orientation="vertical"
            highlight
          />
          <UNavigationMenu
            :collapsed="collapsed"
            :items="external"
            orientation="vertical"
            class="mt-auto"
          />
        </template>

        <template #footer="{ collapsed }">
          <div class="flex flex-col gap-2 w-full">
            <UTooltip :text="stats?.kafka.error ?? kafkaState.label">
              <div class="flex items-center gap-2 text-xs text-muted">
                <UChip
                  :color="kafkaState.color"
                  standalone
                  inset
                />
                <span
                  v-if="!collapsed"
                  class="truncate"
                >{{ kafkaState.label }}</span>
              </div>
            </UTooltip>
            <UButton
              v-if="!collapsed"
              to="https://www.snowcatcloud.com/?utm_source=opensnowcat-console"
              target="_blank"
              color="neutral"
              variant="subtle"
              size="sm"
              icon="i-lucide-cloud"
              trailing-icon="i-lucide-arrow-up-right"
              label="Hosted by SnowcatCloud"
              class="justify-between"
            />
            <UButton
              v-else
              to="https://www.snowcatcloud.com/?utm_source=opensnowcat-console"
              target="_blank"
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-cloud"
              aria-label="SnowcatCloud"
            />
          </div>
        </template>
      </UDashboardSidebar>

      <NuxtPage />
    </UDashboardGroup>
  </UApp>
</template>
