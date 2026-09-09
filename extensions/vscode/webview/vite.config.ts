import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// webview 构建为库：chat.js + chat.css → ../dist/webview/
export default defineConfig({
  plugins: [react()],
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
