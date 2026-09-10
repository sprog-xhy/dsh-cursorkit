import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// webview 构建为库：chat.js + chat.css → ../dist/webview/
export default defineConfig({
  plugins: [react()],
  /**
   * 关键：Vite 的 lib 模式**不会**替换 `process.env.NODE_ENV`
   * （它假设由使用方处理）。而 webview 沙箱里没有 Node 的 process，
   * React/react-dom 的 CJS 构建里带着该引用 → 加载即 `ReferenceError: process is not defined`
   * → 整个面板白屏（真实事故，已复现并有回归测试）。
   */
  define: {
    // 值必须是 JS 字面量或标识符（`({})` 会被 esbuild 拒绝）
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  esbuild: {
    // 其它 process 引用（如果有）在 webview 里没有意义，统一替换为 undefined 上下文
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  },
  build: {
    outDir: '../dist/webview',
    emptyOutDir: true,
    lib: {
      entry: 'src/main.tsx',
      name: 'DshCursorkitChat',
      formats: ['iife'],
      fileName: () => 'chat.js',
    },
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith('.css') ? 'chat.css' : assetInfo.name ?? 'asset',
      },
    },
  },
  base: './',
});
