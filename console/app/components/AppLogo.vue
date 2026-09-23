<script setup lang="ts">
defineProps<{ collapsed?: boolean }>()
</script>

<template>
  <NuxtLink
    to="/"
    class="flex items-center gap-2.5 min-w-0 rounded-md focus-visible:outline-2 outline-primary/40"
    aria-label="OpenSnowcat Console home"
  >
    <img
      src="/opensnowcat-logo.png"
      alt=""
      class="size-8 shrink-0"
      width="32"
      height="32"
    >
    <span
      v-if="!collapsed"
      class="flex flex-col leading-none min-w-0"
    >
      <span class="font-semibold tracking-tight text-highlighted truncate">OpenSnowcat</span>
      <span class="text-[11px] uppercase tracking-[0.18em] text-muted mt-1">Console</span>
    </span>
  </NuxtLink>
</template>
