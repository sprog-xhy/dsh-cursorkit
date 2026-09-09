import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Allow the desktop shell to talk to the host RPC from the same origin.
    proxy: undefined,
  },
  build: {
    outDir: 'dist',
  },
});
