import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  /* Puerto propio: 5181. La app de operaciones de venta usa el 5180, así que las dos pueden
     correr a la vez en la misma máquina. `strictPort` evita que Vite salte a otro sin avisar. */
  server: {
    port: 5181,
    strictPort: true,
    // Proxy hacia la API de Monday en desarrollo: evita CORS al pegar desde el navegador.
    proxy: {
      /* Subida de archivos a columnas `file` (comprobantes de retención/transferencia y cupones).
         Va ANTES de '/monday-api' porque Vite matchea por prefijo y '/monday-api-file' también
         empieza con '/monday-api'. */
      '/monday-api-file': {
        target: 'https://api.monday.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/monday-api-file/, '/v2/file'),
      },
      '/monday-api': {
        target: 'https://api.monday.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/monday-api/, '/v2'),
      },
    },
  },
})
