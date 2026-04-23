import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      shared: path.resolve(__dirname, '../../packages/shared/dist/index.d.ts'),
    },
    dedupe: ['react', 'react-dom', 'react-dom/client'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    clearMocks: true,
    server: {
      deps: {
        inline: [
          '@testing-library/react',
          '@testing-library/user-event',
          'zustand',
        ],
      },
    },
  },
})
