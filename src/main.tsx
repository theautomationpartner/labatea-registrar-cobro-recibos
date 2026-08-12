import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/App'
import { AppProvider } from '@/state/AppProvider'

import '@/styles/base.css'
import '@/styles/layout.css'
import '@/styles/components.css'
import '@/styles/cliente.css'
import '@/styles/facturas.css'
import '@/styles/cobro.css'
import '@/styles/anticipos.css'
import '@/styles/recibo.css'
import '@/styles/envio.css'

const container = document.getElementById('root')
if (!container) throw new Error('No se encontró el nodo #root')

createRoot(container).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
)
