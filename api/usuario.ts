/**
 * `POST /api/usuario` — quién abrió la app, ya verificado.
 *
 * Es el pedido del PASO 1 de la secuencia: contesta de una sola vez si el usuario pasa la firma y
 * la lista blanca, y devuelve los datos con los que la app arma su estado (PASO 2).
 *
 * ── Por qué no alcanza con la query `me` ──
 * La app resolvía la sesión con `me` a través del proxy, y el proxy inyecta el token del SERVIDOR:
 * `me` contesta quién es el dueño de ESE token, no quién abrió la app. Con una sola cuenta de
 * servicio para todos, la app creía que todos eran esa persona —y le daba su rol—. Acá el id sale
 * del session token ya verificado, que es un dato firmado por Monday sobre este usuario y no se
 * puede falsear.
 *
 * ── Por qué NO exige el segundo factor ──
 * Es el paso 1, y el segundo factor es el paso 3. Exigirlo acá invertiría el orden y haría
 * imposible llegar al muro de MFA: nadie puede enrolarse en una app a la que no puede entrar. Lo
 * que sí se exige es todo lo anterior —firma y lista blanca—, así que esto sólo lo contesta alguien
 * que ya está habilitado. Los datos de verdad viven detrás de `/api/monday`, que sí lo exige.
 */
import type { ServerResponse } from 'node:http'
import { endpointMfa, type Pedido } from './_http.js'
import { perfilDe } from './_whitelist.js'

export default async function handler(req: Pedido, res: ServerResponse): Promise<void> {
  await endpointMfa(req, res, async ({ sesion }) => {
    const perfil = await perfilDe(sesion.userId)

    return {
      id: sesion.userId,
      /* Sin perfil se manda el id como nombre: es feo pero identifica, y es preferible a un
         encabezado vacío. El acceso ya se decidió arriba; esto es presentación. */
      name: perfil?.nombre || `Usuario ${sesion.userId}`,
      /* Del token FIRMADO, no de una consulta: es lo que Monday declara de este usuario. Se acepta
         también el `kind: admin` del perfil, que es el mismo dato visto desde la API. */
      isAdmin: sesion.isAdmin || (perfil?.esAdminDeCuenta ?? false),
      /* Nombres de equipo, que es con lo que trabaja `src/lib/permisos.ts`. Van por nombre y no por
         id porque ésa es la regla que ya tiene la app; sin equipos queda el rol más restrictivo. */
      equipos: perfil?.equipos ?? [],
    }
  })
}
