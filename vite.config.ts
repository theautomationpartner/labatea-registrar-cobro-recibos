import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  /* Prefijo vacío para leer TAMBIÉN las variables sin `VITE_`. Se usan sólo acá, en el proceso de
     Vite: nada de esto entra en `import.meta.env`, así que no llega al navegador. */
  const env = loadEnv(mode, process.cwd(), '')

  /* Destino real del escenario de Make. En producción esto lo resuelve `api/make-comprobantes.ts`
     con la misma variable; en desarrollo no hay funciones serverless, así que el proxy de Vite hace
     de servidor y la dirección queda igual de lejos del bundle.
     Si no está configurada, la ruta no existe y la llamada da 404: es el mismo faltante que en
     producción, y el aviso lo da la app. */
  const webhook = env.MAKE_WEBHOOK_COMPROBANTES?.trim()
  const proxyMake: Record<string, ProxyOptions> = webhook
    ? {
        '/make-comprobantes': {
          target: new URL(webhook).origin,
          changeOrigin: true,
          rewrite: () => new URL(webhook).pathname,
          /* El escenario tiene un módulo de IA leyendo el documento: los 30 s por defecto de
             http-proxy lo cortarían a mitad de camino. Se acompaña el tope del cliente. */
          timeout: 120_000,
          proxyTimeout: 120_000,
        },
      }
    : {}

  /* Envío de los documentos (recibo, orden de pago, resumen) a los contactos: el MISMO escenario que
     usa la app de operaciones de venta. En producción lo resuelve la misma función
     (`/api/make-comprobantes?escenario=envio-documento`), con `MAKE_WEBHOOK_ENVIOS_URL`. */
  const webhookEnvio = env.MAKE_WEBHOOK_ENVIOS_URL?.trim()
  const proxyEnvio: Record<string, ProxyOptions> = webhookEnvio
    ? {
        '/make-envio-documento': {
          target: new URL(webhookEnvio).origin,
          changeOrigin: true,
          rewrite: () => new URL(webhookEnvio).pathname,
          timeout: 120_000,
          proxyTimeout: 120_000,
        },
      }
    : {}

  /* Estado de un WhatsApp enviado por 360Messenger. En producción lo resuelve `api/whatsapp-estado.ts`
     con la misma variable; acá el proxy de Vite pone la API key del lado del servidor, así tampoco
     llega al navegador. `/messenger360-estado?id=…` → `/v2/message/status?id=…`. La de producción si
     está; si no, la del número de testeo. */
  const clave360 = (env.WHATSAPP_API_KEY || env.WHATSAPP_API_KEY_TEST)?.trim()
  const proxy360: Record<string, ProxyOptions> = clave360
    ? {
        '/messenger360-estado': {
          target: 'https://api.360messenger.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/messenger360-estado/, '/v2/message/status'),
          headers: { Authorization: `Bearer ${clave360}` },
        },
      }
    : {}

  return {
    plugins: [react()],
    /* react-pdf y exceljs entran por `import()` recién al emitir. Sin esto, en desarrollo Vite los
       descubre en ese momento, los optimiza y RECARGA la página: se pierde la operación a mitad de
       camino. Pre-empaquetados de entrada, la primera emisión no recarga nada. */
    optimizeDeps: { include: ['@react-pdf/renderer', 'exceljs'] },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    /* Puerto propio: 5186. La app de operaciones de venta usa el 5180, así que las dos pueden
       correr a la vez en la misma máquina. `strictPort` evita que Vite salte a otro sin avisar: si
       el puerto está ocupado, falla y se ve, en vez de levantar en uno que nadie sabe cuál es. */
    server: {
      port: 5186,
      strictPort: true,
      // Proxy hacia las APIs externas en desarrollo: evita CORS al pegar desde el navegador.
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
        ...proxyMake,
        ...proxyEnvio,
        ...proxy360,
      },
    },
  }
})
