import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // node by default; files that need a DOM opt in with a
    // `// @vitest-environment jsdom` docblock comment (e.g. test/toolcall-card.test.tsx).
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
