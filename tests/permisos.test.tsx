/**
 * Quién ve qué MÓDULO, y con qué cuentas hace un pase, según el equipo "Pago a Proveedores"
 * (1501065).
 *
 * Es una regla de integridad de los datos —PAGOS y RECHAZO DE CHEQUE mueven la cuenta corriente de
 * proveedores—, así que se prueba en las TRES capas donde vive: la regla pura, el reducer —que la
 * hace cumplir aunque la pantalla se equivoque— y lo que dibuja el selector del pase.
 *
 * Lo que este archivo NO puede probar: el proxy `/api/monday` no conoce esta regla, así que es una
 * barrera de la APP, no del servidor.
 */
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { DispatchContext, StateContext } from '@/state/context'
import { initialState, reducer, type Action, type AppState } from '@/state/appState'
import { CuentasPaseConfig } from '@/features/pases/CuentasPaseConfig'
import {
  EQUIPO_PAGO_PROVEEDORES_ID,
  esDelEquipoProveedores,
  ladoInicialDePase,
  ladosDePase,
  operacionesPermitidas,
  puedeOperar,
  puedePasarEntre,
} from '@/lib/permisos'
import type { UsuarioActual } from '@/types'

const aplicar = (estado: AppState, acciones: Action[]): AppState =>
  acciones.reduce((acc, a) => reducer(acc, a), estado)

const usuario = (parche: Partial<UsuarioActual>): UsuarioActual => ({
  id: '1',
  name: 'Usuario',
  isAdmin: false,
  equipos: [],
  equipoIds: [],
  ...parche,
})

/* Los dos grupos, y los casos borde que no pueden abrir la puerta. */
const MIEMBRO = usuario({ id: '112492970', equipos: ['Pago a Proveedores'], equipoIds: ['1501065'] })
const AJENO = usuario({ id: '2', equipos: ['Vendedores'], equipoIds: ['999'] })
/* Admin de la CUENTA y del equipo "Administradores", pero NO del equipo: igual queda afuera. */
const ADMIN_AJENO = usuario({ id: '3', isAdmin: true, equipos: ['Administradores'], equipoIds: ['777'] })
/* Un equipo que se LLAMA igual pero es otro: por nombre entraría, por id no. */
const HOMONIMO = usuario({ id: '4', equipos: ['Pago a Proveedores'], equipoIds: ['424242'] })
/* Un servidor viejo que todavía no manda los ids: el campo llega ausente. */
const SIN_IDS = { ...usuario({ id: '5', equipos: ['Pago a Proveedores'] }), equipoIds: undefined } as unknown as UsuarioActual

const conUsuario = (u: UsuarioActual | null): AppState => ({ ...initialState, usuarioActual: u })
const enPase = (u: UsuarioActual | null): AppState =>
  aplicar(conUsuario(u), [{ type: 'setOperacionApp', operacion: 'PASES' }])

const pintarPase = (estado: AppState) =>
  renderToString(
    createElement(
      StateContext.Provider,
      { value: estado },
      createElement(DispatchContext.Provider, { value: () => undefined }, createElement(CuentasPaseConfig)),
    ),
  )

const casos: { nombre: string; ok: boolean }[] = [
  /* ===== Pertenencia al equipo ===== */
  { nombre: 'el id del equipo es 1501065', ok: EQUIPO_PAGO_PROVEEDORES_ID === '1501065' },
  { nombre: 'un miembro es del equipo', ok: esDelEquipoProveedores(MIEMBRO) },
  { nombre: 'un ajeno no', ok: !esDelEquipoProveedores(AJENO) },
  {
    nombre: 'ser admin de la cuenta NO alcanza: el acceso lo da el equipo',
    ok: !esDelEquipoProveedores(ADMIN_AJENO),
  },
  {
    nombre: 'un equipo HOMÓNIMO no entra: se compara por id, no por nombre',
    ok: !esDelEquipoProveedores(HOMONIMO),
  },
  /* Falla CERRADA: los dos errores posibles dan "no". */
  { nombre: 'sin usuario, NO es del equipo (falla cerrada)', ok: !esDelEquipoProveedores(null) },
  { nombre: 'sin ids de equipo, NO es del equipo (falla cerrada)', ok: !esDelEquipoProveedores(SIN_IDS) },

  /* ===== Qué módulos ofrece el selector ===== */
  {
    nombre: 'el miembro ve los CINCO módulos',
    ok: operacionesPermitidas(MIEMBRO).join() === 'COBROS,PASES,PAGOS,RECHAZOS,RESUMEN',
  },
  {
    /* PASES y RESUMEN son COMPARTIDOS: los ven los dos grupos. Lo exclusivo es PAGOS y RECHAZOS. */
    nombre: 'el ajeno ve COBROS, PASES y RESUMEN, sin PAGOS ni RECHAZOS',
    ok: operacionesPermitidas(AJENO).join() === 'COBROS,PASES,RESUMEN',
  },
  {
    nombre: 'sin usuario, tampoco aparecen PAGOS ni RECHAZOS',
    ok: operacionesPermitidas(null).join() === 'COBROS,PASES,RESUMEN',
  },
  {
    nombre: 'puedeOperar responde igual que el selector',
    ok:
      puedeOperar(MIEMBRO, 'PAGOS') &&
      puedeOperar(MIEMBRO, 'RECHAZOS') &&
      puedeOperar(MIEMBRO, 'PASES') &&
      !puedeOperar(AJENO, 'PAGOS') &&
      !puedeOperar(AJENO, 'RECHAZOS') &&
      puedeOperar(AJENO, 'PASES') &&
      puedeOperar(AJENO, 'COBROS') &&
      !puedeOperar(MIEMBRO, null),
  },

  /* ===== Con qué cuentas hace un pase ===== */
  {
    nombre: 'el miembro puede pasar entre CLIENTES y entre PROVEEDORES',
    ok: ladosDePase(MIEMBRO).join() === 'cliente,proveedor',
  },
  { nombre: 'el ajeno, sólo entre CLIENTES', ok: ladosDePase(AJENO).join() === 'cliente' },
  { nombre: 'sin usuario, sólo CLIENTES (falla cerrada)', ok: ladosDePase(null).join() === 'cliente' },
  {
    nombre: 'puedePasarEntre responde igual',
    ok:
      puedePasarEntre(MIEMBRO, 'cliente') &&
      puedePasarEntre(MIEMBRO, 'proveedor') &&
      puedePasarEntre(AJENO, 'cliente') &&
      !puedePasarEntre(AJENO, 'proveedor') &&
      !puedePasarEntre(null, 'proveedor'),
  },
  {
    /* Con una opción no hay nada que decidir; con dos, decide el usuario. */
    nombre: 'el lado inicial: el único posible, o ninguno si hay dos',
    ok: ladoInicialDePase(AJENO) === 'cliente' && ladoInicialDePase(MIEMBRO) === null,
  },

  /* ===== El reducer la hace cumplir aunque la pantalla se equivoque ===== */
  {
    nombre: 'un ajeno NO puede abrir PAGOS por despacho',
    ok: aplicar(conUsuario(AJENO), [{ type: 'setOperacionApp', operacion: 'PAGOS' }]).operacionApp === null,
  },
  {
    nombre: 'ni RECHAZOS',
    ok: aplicar(conUsuario(AJENO), [{ type: 'setOperacionApp', operacion: 'RECHAZOS' }]).operacionApp === null,
  },
  {
    nombre: 'sin usuario tampoco se abre PAGOS',
    ok: aplicar(conUsuario(null), [{ type: 'setOperacionApp', operacion: 'PAGOS' }]).operacionApp === null,
  },
  {
    nombre: 'el miembro sí los abre',
    ok:
      aplicar(conUsuario(MIEMBRO), [{ type: 'setOperacionApp', operacion: 'PAGOS' }]).operacionApp === 'PAGOS' &&
      aplicar(conUsuario(MIEMBRO), [{ type: 'setOperacionApp', operacion: 'RECHAZOS' }]).operacionApp === 'RECHAZOS',
  },
  {
    nombre: 'los DOS grupos abren el PASE',
    ok: enPase(MIEMBRO).operacionApp === 'PASES' && enPase(AJENO).operacionApp === 'PASES',
  },
  {
    /* Si un PAGOS llegara a quedar elegido por otra vía, CONFIRMAR tampoco lo abre. */
    nombre: 'confirmar un módulo ajeno no abre el circuito',
    ok: !aplicar({ ...conUsuario(AJENO), operacionApp: 'PAGOS' }, [{ type: 'confirmarOperacionApp' }])
      .operacionConfirmada,
  },
  {
    nombre: 'el pase del ajeno nace en CLIENTES',
    ok: enPase(AJENO).paseCuentasDe === 'cliente',
  },
  {
    nombre: 'el del miembro nace SIN elegir',
    ok: enPase(MIEMBRO).paseCuentasDe === null,
  },
  {
    nombre: 'el miembro puede elegir CLIENTES',
    ok: aplicar(enPase(MIEMBRO), [{ type: 'setPaseCuentasDe', rol: 'cliente' }]).paseCuentasDe === 'cliente',
  },
  {
    nombre: 'y PROVEEDORES',
    ok: aplicar(enPase(MIEMBRO), [{ type: 'setPaseCuentasDe', rol: 'proveedor' }]).paseCuentasDe === 'proveedor',
  },
  {
    nombre: 'y cambiar de uno a otro',
    ok:
      aplicar(enPase(MIEMBRO), [
        { type: 'setPaseCuentasDe', rol: 'proveedor' },
        { type: 'setPaseCuentasDe', rol: 'cliente' },
      ]).paseCuentasDe === 'cliente',
  },
  {
    nombre: 'el ajeno NO puede elegir PROVEEDORES por despacho',
    ok: aplicar(enPase(AJENO), [{ type: 'setPaseCuentasDe', rol: 'proveedor' }]).paseCuentasDe === 'cliente',
  },

  /* ===== La sesión se resuelve después: la regla no puede depender de ese orden ===== */
  {
    nombre: 'si la sesión resulta ser de un ajeno, un módulo ajeno se cierra',
    ok: (() => {
      const e = aplicar(
        { ...conUsuario(null), operacionApp: 'PAGOS', operacionConfirmada: true },
        [{ type: 'setUsuarioActual', usuario: AJENO }],
      )
      return e.operacionApp === null && !e.operacionConfirmada && e.usuarioActual?.id === AJENO.id
    })(),
  },
  {
    nombre: 'un pase entre PROVEEDORES pasa a CLIENTES si la sesión es de un ajeno',
    ok:
      aplicar({ ...conUsuario(null), operacionApp: 'PASES', paseCuentasDe: 'proveedor' }, [
        { type: 'setUsuarioActual', usuario: AJENO },
      ]).paseCuentasDe === 'cliente',
  },
  {
    /* Y lo cargado del lado vedado se descarta con él: no queda una cuenta de proveedor elegida. */
    nombre: 'y lo cargado del lado vedado se descarta',
    ok:
      aplicar(
        {
          ...conUsuario(null),
          operacionApp: 'PASES',
          paseCuentasDe: 'proveedor',
          cliente: { id: '9', name: 'Proveedor elegido' } as AppState['cliente'],
        },
        [{ type: 'setUsuarioActual', usuario: AJENO }],
      ).cliente === null,
  },
  {
    nombre: 'un miembro conserva el lado que ya había elegido',
    ok:
      aplicar({ ...conUsuario(null), operacionApp: 'PASES', paseCuentasDe: 'cliente' }, [
        { type: 'setUsuarioActual', usuario: MIEMBRO },
      ]).paseCuentasDe === 'cliente',
  },
  {
    nombre: 'un pase sin lado nace en CLIENTES si la sesión es de un ajeno',
    ok:
      aplicar({ ...conUsuario(null), operacionApp: 'PASES', paseCuentasDe: null }, [
        { type: 'setUsuarioActual', usuario: AJENO },
      ]).paseCuentasDe === 'cliente',
  },
  {
    nombre: 'y queda sin elegir si es de un miembro',
    ok:
      aplicar({ ...conUsuario(null), operacionApp: 'PASES', paseCuentasDe: null }, [
        { type: 'setUsuarioActual', usuario: MIEMBRO },
      ]).paseCuentasDe === null,
  },
  {
    nombre: 'un módulo permitido sobrevive a la resolución de la sesión',
    ok:
      aplicar({ ...conUsuario(null), operacionApp: 'COBROS' }, [
        { type: 'setUsuarioActual', usuario: AJENO },
      ]).operacionApp === 'COBROS',
  },
]

/* ===== Lo que dibuja el selector del pase ===== */
const paseMiembro = pintarPase(enPase(MIEMBRO))
const paseAjeno = pintarPase(enPase(AJENO))

casos.push(
  {
    nombre: 'el miembro ve las DOS opciones',
    ok: paseMiembro.includes('De Clientes') && paseMiembro.includes('De Proveedores'),
  },
  {
    nombre: 'y tiene que elegir: aparece "Seleccionar..."',
    ok: paseMiembro.includes('Seleccionar...'),
  },
  {
    nombre: 'el ajeno ve sólo "De Clientes": "De Proveedores" no aparece',
    ok: paseAjeno.includes('De Clientes') && !paseAjeno.includes('De Proveedores'),
  },
  {
    nombre: 'y ya viene elegida: sin "Seleccionar..."',
    ok: !paseAjeno.includes('Seleccionar...'),
  },
)

let fallas = 0
for (const c of casos) {
  if (!c.ok) {
    fallas++
    console.log(`FALLA  ${c.nombre}`)
  } else {
    console.log(`OK     ${c.nombre}`)
  }
}

console.log(fallas === 0 ? '\npermisos: OK' : `\npermisos: ${fallas} falla(s)`)
process.exit(fallas === 0 ? 0 : 1)
