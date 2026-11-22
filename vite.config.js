import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    rollupOptions: {
      input: {
        manager: fileURLToPath(new URL('./index.html', import.meta.url)),
        chooser: fileURLToPath(new URL('./chooser.html', import.meta.url)),
        background: fileURLToPath(new URL('./src/background/index.js', import.meta.url)),
      },
      output: { entryFileNames: chunk => chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js' },
    },
  },
  test: { include: ['tests/**/*.test.js'], environment: 'node' },
})
