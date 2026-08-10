# Registrar cobros y recibos

App de La Batea (prototipo Monday Vibe) para **registrar el cobro de ventas pendientes y emitir el
recibo** correspondiente. Comparte el sistema de diseño y la arquitectura con
`../operaciones-de-venta`, pero es una app independiente: su propio estado, sus propios servicios y
su propio puerto (**5181**, para poder correr las dos a la vez).

## Recorrido

Un solo flujo, sin paso previo de configuración: la app abre directamente en la selección de
cliente. Las cuatro etapas viven en [src/lib/pasos.ts](src/lib/pasos.ts) y son la fuente de verdad
del stepper, de los títulos de paso y de la navegación.

| # | Etapa                          | Clave (`Paso`) | Estado         |
| - | ------------------------------ | -------------- | -------------- |
| 1 | Selección de Cliente           | `cliente`      | en construcción |
| 2 | Seleccionar Vtas Pend de Cobro | `ventas`       | en construcción |
| 3 | Registrar Cobro                | `cobro`        | en construcción |
| 4 | Emitir y Enviar Recibo         | `recibo`       | en construcción |

## Arquitectura

- **Estado**: `useReducer` + dos contextos (estado y dispatch por separado, para no re-renderizar a
  quien sólo despacha). Ver [src/state/](src/state/).
- **Cambios de estado**: toda la app es una máquina de pasos. Se navega despachando
  `{ type: 'goto', paso }`; el reducer recuerda el índice más avanzado alcanzado (`pasoMaxIdx`), que
  es lo que habilita los círculos del stepper.
- **Servicios**: [src/services/monday/](src/services/monday/) es el único lugar que conoce la API.
  En desarrollo pega contra el proxy de Vite (`/monday-api`) con `VITE_MONDAY_TOKEN`; en producción,
  contra la función serverless [api/monday.ts](api/monday.ts), que inyecta `MONDAY_TOKEN` del lado
  del servidor. Sin token, los servicios devuelven los mocks de [src/data/mock.ts](src/data/mock.ts).
- **Errores de Monday**: se comunican en UN solo lugar (`ModalErrorMonday`), despachando
  `{ type: 'errorMonday', accion }` desde el `catch` de cualquier consulta.

## Usuarios y permisos (RBAC)

El selector del encabezado se puebla con los miembros de los equipos **"Vendedores"** y
**"Administradores"** de Monday (sin visores, invitados ni usuarios desactivados). Por defecto queda
seleccionado el usuario logueado (`me`).

Sólo un administrador puede registrar el cobro **a nombre de otro usuario**; para el resto el
selector queda bloqueado en su propio usuario. Las reglas están en
[src/lib/permisos.ts](src/lib/permisos.ts), puras y sin React.

## Desarrollo

```bash
npm install
cp .env.local.example .env.local   # opcional: pegar un token de Monday
npm run dev                        # http://localhost:5181
npm run typecheck
npm run build
```
