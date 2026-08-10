import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/App'
import { AppProvider } from '@/state/AppProvider'

import '@/styles/base.css'
import '@/styles/layout.css'
import '@/styles/components.css'

const container = document.getElementById('root')
if (!container) throw new Error('No se encontró el nodo #root')

createRoot(container).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
)
