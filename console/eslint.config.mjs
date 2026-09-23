// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  rules: {
    // Pages intentionally render a panel plus slideovers/modals as siblings (Vue 3 fragments).
    'vue/no-multiple-template-root': 'off',
    // Short guard clauses on one line read better in the server utilities.
    '@stylistic/max-statements-per-line': 'off'
  }
})
