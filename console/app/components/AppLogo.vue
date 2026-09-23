<script setup lang="ts">
defineProps<{ collapsed?: boolean }>()
</script>

<template>
  <NuxtLink
    to="/"
    class="flex items-center gap-2.5 min-w-0 rounded-md focus-visible:outline-2 outline-primary/40"
    aria-label="OpenSnowcat Console home"
  >
    <svg
      viewBox="0 0 64 64"
      class="size-8 shrink-0"
      aria-hidden="true"
    >
      <rect
        width="64"
        height="64"
        rx="14"
        class="fill-primary"
      />
      <g
        stroke="white"
        stroke-width="5"
        stroke-linecap="round"
      >
        <line
          x1="32"
          y1="12"
          x2="32"
          y2="52"
        />
        <line
          x1="14.7"
          y1="22"
          x2="49.3"
          y2="42"
        />
        <line
          x1="14.7"
          y1="42"
          x2="49.3"
          y2="22"
        />
      </g>
      <circle
        cx="32"
        cy="32"
        r="6"
        fill="white"
      />
    </svg>
    <span
      v-if="!collapsed"
      class="flex flex-col leading-none min-w-0"
    >
      <span class="font-semibold tracking-tight text-highlighted truncate">OpenSnowcat</span>
      <span class="text-[11px] uppercase tracking-[0.18em] text-muted mt-1">Console</span>
    </span>
  </NuxtLink>
</template>
