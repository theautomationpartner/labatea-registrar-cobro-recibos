import { type ReactNode } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Dropdown } from '@/components/ui/Dropdown'
import { LogoEmpresa } from '@/components/ui/LogoEmpresa'
import { puedeElegirUsuario, puedeOperarPagos } from '@/lib/permisos'
import { useApp, useDispatch } from '@/state/hooks'
import type { OperacionApp, Usuario } from '@/types'

/** Módulos que ofrece el encabezado. "Pagos" queda reservado a los administradores. */
const OPERACIONES: readonly OperacionApp[] = ['COBROS', 'PAGOS']

/**
 * Módulo que se está operando. Mismo control y mismos estilos que el selector de vendedor de al
 * lado: los dos son contexto de TODA la transacción, así que se ven y se comportan igual.
 *
 * "Pagos" se muestra SIEMPRE, pero sólo un administrador puede elegirlo (RBAC de `lib/permisos`,
 * el mismo rol que habilita cambiar el vendedor): esconderlo dejaría al usuario sin saber que el
 * módulo existe, y el tooltip explica por qué no está disponible.
 */
function OperacionSelector() {
  const { operacionApp, usuarioActual } = useApp()
  const dispatch = useDispatch()
  const habilitado = puedeOperarPagos(usuarioActual)

  return (
    <Dropdown<OperacionApp>
      label={<span className="selbox-val-txt">{operacionApp}</span>}
      items={OPERACIONES}
      itemKey={(o) => o}
      renderItem={(o) => o}
      itemClassName="dditem--strong"
      itemDisabled={(o) => o === 'PAGOS' && !habilitado}
      itemTitle={() => 'Sólo un administrador puede operar el módulo de Pagos.'}
      onSelect={(o) => dispatch({ type: 'setOperacionApp', operacion: o })}
    />
  )
}

/** Item de la barra: etiqueta arriba, selector abajo. */
function TopSel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="topsel-item">
      <span className="topsel-lbl">{label}</span>
      {children}
    </div>
  )
}

/**
 * Usuario responsable del cobro. Se carga con el logueado en Monday y sólo un administrador puede
 * cambiarlo (RBAC, ver `lib/permisos`): para el resto el selector queda bloqueado en su propio
 * usuario, que es a nombre de quien se registra la operación.
 */
function UsuarioSelector() {
  const { usuario, usuarios, usuariosCargando, usuarioActual } = useApp()
  const dispatch = useDispatch()
  const habilitado = puedeElegirUsuario(usuarioActual)
  const bloqueado = usuariosCargando || !habilitado

  /* El usuario elegido se muestra con el MISMO avatar con el que figura en la lista: sin él, el
     selector cerrado sería el único lugar donde la persona aparece sin su ícono.
     Mientras se traen los usuarios de Monday queda el placeholder de carga. */
  const etiqueta = usuariosCargando ? (
    <span className="selbox-ph">Cargando vendedores...</span>
  ) : usuario ? (
    /* Avatar y nombre van dentro de UN solo elemento: el botón reparte el espacio sobrante entre
       sus hijos, así que sueltos se separarían uno del otro en lugar de quedar juntos. */
    <span className="selbox-val">
      <Avatar ini={usuario.ini} color={usuario.color} size="sm" />
      <span className="selbox-val-txt">{usuario.name}</span>
    </span>
  ) : (
    <span className="selbox-ph">Seleccionar...</span>
  )

  return (
    <span
      title={
        habilitado || usuariosCargando
          ? undefined
          : 'Sólo un administrador puede registrar el cobro a nombre de otro vendedor.'
      }
    >
      <Dropdown<Usuario>
        label={etiqueta}
        items={usuarios}
        itemKey={(u) => u.id}
        disabled={bloqueado}
        renderItem={(u) => (
          <>
            <Avatar ini={u.ini} color={u.color} />
            {u.name}
          </>
        )}
        onSelect={(u) => dispatch({ type: 'setUsuario', usuario: u })}
      />
    </span>
  )
}

/**
 * Contexto de la transacción: la marca y el usuario responsable, que valen para TODO el circuito
 * y por eso se ven igual en los cuatro pasos. `children` deja sumar acciones a la derecha.
 */
export function SelectoresContexto({ children }: { children?: ReactNode }) {
  return (
    <div className="topsel">
      {/* La marca abre la barra, contra el margen izquierdo y separada de los controles. */}
      <LogoEmpresa />
      <TopSel label="Seleccionar Operación:">
        <OperacionSelector />
      </TopSel>
      <TopSel label="Seleccionar Vendedor:">
        <UsuarioSelector />
      </TopSel>
      {children}
    </div>
  )
}
