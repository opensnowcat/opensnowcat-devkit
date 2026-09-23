// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/ui'],

  devtools: { enabled: false },

  app: {
    head: {
      title: 'OpenSnowcat Console',
      htmlAttrs: { lang: 'en' },
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }]
    }
  },

  css: ['~/assets/css/main.css'],

  colorMode: {
    preference: 'dark',
    fallback: 'dark'
  },

  runtimeConfig: {
    // Server-only. Override with NUXT_<KEY> env vars, e.g. NUXT_KAFKA_BROKERS=warp:9092
    kafkaBrokers: 'localhost:9092',
    topicCollectedGood: 'collected-good',
    topicCollectedBad: 'collected-bad',
    topicEnrichedGood: 'enriched-good',
    topicEnrichedBad: 'enriched-bad',
    topicEnrichedJson: 'enriched-good-json',
    schemasDir: '../schemas',
    opensnowcatDir: '../opensnowcat',
    collectorUrl: 'http://localhost:8080',
    consoleRegistryUrl: 'http://console:3000/iglu',
    dockerSocket: '/var/run/docker.sock',
    dockerNetwork: 'opensnowcat',
    containerEnrich: 'opensnowcat_enrich',
    containerCollector: 'opensnowcat_collector',
    containerBento: 'bento',
    containerKafka: 'warp',
    containerTunnel: 'opensnowcat_tunnel',
    tunnelTarget: 'http://opensnowcat_collector:8080',
    tunnelImage: 'cloudflare/cloudflared:latest',
    public: {
      // Override with NUXT_PUBLIC_<KEY>
      collectorPublicUrl: 'http://localhost:8080',
      consolePublicUrl: 'http://localhost:8082'
    }
  },

  compatibilityDate: '2026-06-30',

  nitro: {
    experimental: { tasks: false }
  },

  vite: {
    optimizeDeps: {
      include: ['codemirror', '@codemirror/lang-json', '@codemirror/lint', '@codemirror/state', '@codemirror/view', '@codemirror/theme-one-dark', '@codemirror/commands', '@codemirror/language']
    }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
