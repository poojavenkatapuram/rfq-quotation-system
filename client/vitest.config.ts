import { fileURLToPath } from 'node:url'

// Reuse the repository's installed backend Vitest runner; no new dependencies.
// Existing node:test suites continue to run separately with the TypeScript loader.
export default {
  test: {
    environment: 'node',
    include: ['tests/**/*.test.tsx'],
    alias: {
      vitest: fileURLToPath(new URL('../server/node_modules/vitest/dist/index.js', import.meta.url)),
    },
  },
}
