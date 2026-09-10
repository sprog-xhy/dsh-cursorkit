import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * 扩展包测试配置：
 * - 把 `vscode` 别名到测试桩，从而能在 node 里真正执行 activate()/deactivate()
 * - include 覆盖 .ts/.tsx 测试
 */
export default defineConfig({
  resolve: {
    alias: {
      vscode: resolve(__dirname, 'test/stubs/vscode.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'node',
  },
});
