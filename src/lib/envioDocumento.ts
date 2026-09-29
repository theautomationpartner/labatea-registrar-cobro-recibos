import { nombreSinCodigo } from '@/lib/busquedaPersonas'
import { mensajesDe, type MensajesEnvio } from '@/lib/mensajesEnvio'
import { faltaParaMedio } from '@/lib/validaciones'
import type { CanalEnvio, Contacto, MedioEnvio } from '@/types'

export type { CanalEnvio }

/**
 * Lo que recibe el escenario de Make que envía un documento a los contactos. Es el MISMO escenario
 * —y el mismo contrato— con el que la app de operaciones de venta envía el presupuesto, el remito y
 * la proforma: `documento.tipo` dice cuál es. Esta app le suma el RECIBO, la ORDEN DE PAGO y el
 * RESUMEN DE CTA CTE.
 *
 * Viaja como JSON, con este objeto en la raíz y los archivos agregados en `pdf` (el principal) y en
 * `adjuntos` (todos, en orden) —ver `src/services/make/envioDocumento.ts`—: el webhook de Make lo
 * recibe ya estructurado.
 *
 * Está pensado para que el escenario NO tenga que decidir nada: cada destinatario ya trae por qué
 * canales se le manda (`canales`), así el escenario itera `destinatarios` y, por cada canal, manda el
 * mail o el WhatsApp. Las reglas —quién acepta el documento, qué dato exige cada medio, qué pasa con
 * "Ambos"— viven en la app, que es donde se valida y se le explica al usuario.
 *
 * `reenvio_email` / `reenvio_whatsapp` dicen por qué canal hay que mandar EN ESTE PEDIDO. En el
 * primer envío salen del medio elegido y nada más ("Ambos" → las dos en true); después de un envío
 * parcial, sólo va en `true` el canal que le faltó a ALGÚN contacto, y cada destinatario trae en
 * `canales` sólo lo suyo que faltó: así nadie recibe dos veces lo mismo.
 */
export interface EnvioDocumentoMake {
  /** Identificador del envío: vuelve en el historial de Make y permite rastrear un envío puntual. */
  appJobId: string
  documento: {
    tipo: TipoDocumentoMake
    /** "RECIBO-125" / "IDPAGO-021" / "CTACTEC-003". */
    numero: string
    /** yyyy-MM-dd: el formato que Make parsea sin configurar nada. */
    fechaEmision: string
    /** Recibo, orden de pago y resumen no vencen: `null`. */
    fechaVencimiento: string | null
    /** Nombre del archivo principal ("Razón social-RECIBO-125.pdf"): el mismo que la parte `pdf`. */
    archivo: string
    /**
     * Nombres de TODOS los archivos que viajan en `adjuntos`, en orden. El recibo y la orden llevan
     * uno; el resumen, hasta cuatro (resumen y estado de cuenta, en PDF y/o Excel).
     */
    archivos: string[]
  }
  /**
   * El TITULAR del documento: el cliente en el recibo y en el resumen, el PROVEEDOR en la orden de
   * pago. Se llama `cliente` porque es el contrato del escenario que comparte con la app de ventas.
   */
  cliente: {
    /** Ítem de la persona en Monday. */
    pulseId: string
    /** El nombre SIN su código interno ("123 - Agropecuaria…" → "Agropecuaria…"). */
    razonSocial: string
    cuit: string
  }
  /** Quién emite (su usuario de Monday): puede ir de firma en el mail o de remitente. */
  vendedor: { pulseId: string; nombre: string } | null
  /** Lo que eligió el usuario en "Medio de envío". El detalle por contacto está en `canales`. */
  medio: MedioEnvio
  /**
   * Desde qué casilla sale el email (ver `tipoDeEnvioEmail`): `labatea` para el resumen y el estado
   * de cta cte, `gmail` para el recibo y la orden de pago. `null` si el medio no incluye email.
   */
  tipo_de_envio_email: TipoEnvioEmail | null
  /** Hay que mandar por email en este pedido. */
  reenvio_email: boolean
  /** Hay que mandar por WhatsApp en este pedido. */
  reenvio_whatsapp: boolean
  destinatarios: DestinatarioMake[]
}

export interface DestinatarioMake {
  /** Ítem del contacto en Monday (el que se linkea). */
  pulseId: string
  nombre: string
  /** `null` cuando no hay dato: nunca un string vacío que el escenario tenga que interpretar. */
  email: string | null
  whatsapp: string | null
  /**
   * Por dónde se le manda EN ESTE PEDIDO, ya resuelto. Con "Ambos" y un solo dato cargado, va sólo
   * por ése (la misma regla que `sinViaDeEnvio`). En un reintento no incluye el canal que ya salió,
   * así que puede venir vacío: ese contacto no recibe nada esta vez.
   */
  canales: CanalEnvio[]
  /**
   * Los textos que acompañan al PDF para ESTE contacto, ya completos: `whatsapp` con el formato de
   * WhatsApp y `email` en HTML. El escenario los usa tal cual (ver `lib/mensajesEnvio`).
   */
  mensaje: MensajesEnvio
}

/** dd/MM/yyyy (como la app muestra las fechas) → yyyy-MM-dd. Si no se puede, queda como vino. */
export function fechaIso(ddmmyyyy: string): string {
  const [d, m, y] = ddmmyyyy.split('/')
  return d && m && y ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : ddmmyyyy
}

/** Los canales por los que se le puede mandar a un contacto con el medio elegido. */
export function canalesDe(contacto: Pick<Contacto, 'phone' | 'email'>, medio: MedioEnvio): CanalEnvio[] {
  const falta = faltaParaMedio(contacto, medio)
  const canales: CanalEnvio[] = []
  if ((medio === 'Email' || medio === 'Ambos') && !falta.email) canales.push('email')
  if ((medio === 'WhatsApp' || medio === 'Ambos') && !falta.telefono) canales.push('whatsapp')
  return canales
}

/**
 * Qué documento se envía. El escenario lo usa para saber qué despacha; los textos del mensaje ya los
 * manda la app (ver `lib/mensajesEnvio`). Son los de ESTA app: el presupuesto, el remito y la
 * proforma los envía la de operaciones de venta, por el mismo escenario.
 */
export type TipoDocumentoMake = 'RECIBO' | 'ORDEN DE PAGO' | 'RESUMEN CTA CTE'

/** Desde qué casilla manda el escenario el email del documento. */
export type TipoEnvioEmail = 'gmail' | 'labatea'

/**
 * `tipo_de_envio_email`: con qué casilla sale el email, según el documento. El resumen de cta cte —y
 * el estado, que viaja en el mismo envío— sale por `labatea`; el recibo y la orden de pago, por
 * `gmail`. Si el medio no incluye email (sólo WhatsApp), `null`.
 */
export function tipoDeEnvioEmail(tipo: TipoDocumentoMake, medio: MedioEnvio): TipoEnvioEmail | null {
  if (medio !== 'Email' && medio !== 'Ambos') return null
  return tipo === 'RESUMEN CTA CTE' ? 'labatea' : 'gmail'
}

/** Lo que hace falta para armar el envío. Sale del estado de la app. */
export interface DatosEnvioDocumento {
  jobId: string
  tipo: TipoDocumentoMake
  numero: string
  fechaEmision: string
  fechaVencimiento: string | null
  /** Nombres de los archivos que se adjuntan, en orden: el primero es el principal. */
  archivos: readonly string[]
  /** Sólo el resumen de cta cte: su período, en dd/MM/yyyy. Lo nombra el mensaje. */
  periodo?: { desde: string; hasta: string } | null
  cliente: { id: string; name: string; cuit: string }
  vendedor: { id: string; name: string } | null
  medio: MedioEnvio
  contactos: readonly Contacto[]
  /** Lo que YA salió, por contacto (envío parcial anterior). No se vuelve a pedir. */
  yaEnviados?: EnviadosPorContacto
}

/** Canales por los que el documento ya le llegó a cada contacto, por su `pulseId`. */
export type EnviadosPorContacto = Record<string, CanalEnvio[]>

/** El id con el que un contacto viaja al escenario (`pulseId`): el de su ítem en Monday. */
export const pulseIdDe = (c: Pick<Contacto, 'id' | 'itemId'>): string => c.itemId ?? c.id

/**
 * Al contacto ya le llegó TODO lo que pide el medio elegido. Es el tilde verde de su fila: a él no se
 * le vuelve a mandar nada y no se lo puede quitar de la lista.
 */
export function recibioTodo(
  c: Pick<Contacto, 'id' | 'itemId' | 'phone' | 'email'>,
  medio: MedioEnvio,
  enviados: EnviadosPorContacto,
): boolean {
  const recibio = enviados[pulseIdDe(c)] ?? []
  const pide = canalesDe(c, medio)
  return pide.length > 0 && pide.every((canal) => recibio.includes(canal))
}

/** Arma la estructura que recibe el webhook. */
export function armarEnvioDocumento(d: DatosEnvioDocumento): EnvioDocumentoMake {
  const dato = (v: string): string | null => v.trim() || null
  const yaEnviados = d.yaEnviados ?? {}
  const tipo = d.tipo
  const razonSocial = nombreSinCodigo(d.cliente.name)
  /* Sólo los contactos a los que les falta algo: en un reintento, al que ya le llegó todo no se lo
     manda, ni siquiera sin canales (el escenario no tiene que saltearlo). */
  const destinatarios = d.contactos
    .map((c) => {
      const pulseId = pulseIdDe(c)
      const recibio = yaEnviados[pulseId] ?? []
      return {
        pulseId,
        nombre: c.name,
        email: dato(c.email),
        whatsapp: dato(c.phone),
        canales: canalesDe(c, d.medio).filter((canal) => !recibio.includes(canal)),
        // Los textos del mensaje, ya completos para este contacto (lo saludan por su nombre).
        mensaje: mensajesDe(tipo, {
          razonSocial,
          contacto: c.name,
          fechaEmision: d.fechaEmision,
          fechaVencimiento: d.fechaVencimiento,
          periodo: d.periodo ?? null,
        }),
      }
    })
    .filter((x) => x.canales.length > 0)
  /* Primer envío: los canales del medio elegido, tal cual. Reintento (ya salió algo): sólo los que
     le faltaron a algún contacto. */
  const reintento = Object.values(yaEnviados).some((c) => c.length > 0)
  const delMedio = (canal: CanalEnvio) =>
    d.medio === 'Ambos' || (canal === 'email' ? d.medio === 'Email' : d.medio === 'WhatsApp')
  const pide = (canal: CanalEnvio) =>
    reintento ? destinatarios.some((x) => x.canales.includes(canal)) : delMedio(canal)
  return {
    appJobId: d.jobId,
    documento: {
      tipo,
      numero: d.numero,
      fechaEmision: fechaIso(d.fechaEmision),
      fechaVencimiento: d.fechaVencimiento == null ? null : fechaIso(d.fechaVencimiento),
      archivo: d.archivos[0] ?? '',
      archivos: [...d.archivos],
    },
    // El código de la persona es un dato interno: no viaja.
    cliente: { pulseId: d.cliente.id, razonSocial, cuit: d.cliente.cuit },
    vendedor: d.vendedor ? { pulseId: d.vendedor.id, nombre: d.vendedor.name } : null,
    medio: d.medio,
    tipo_de_envio_email: tipoDeEnvioEmail(tipo, d.medio),
    reenvio_email: pide('email'),
    reenvio_whatsapp: pide('whatsapp'),
    destinatarios,
  }
}

/** Los canales que se le piden al escenario en este pedido. */
export const canalesPedidos = (e: EnvioDocumentoMake): CanalEnvio[] => [
  ...(e.reenvio_email ? (['email'] as const) : []),
  ...(e.reenvio_whatsapp ? (['whatsapp'] as const) : []),
]

/** Cómo lo nombra el usuario. */
export const NOMBRE_CANAL: Record<CanalEnvio, string> = { email: 'email', whatsapp: 'WhatsApp' }

/** "email", "WhatsApp" o "email y WhatsApp". */
export const nombrarCanales = (canales: readonly CanalEnvio[]): string =>
  canales.map((c) => NOMBRE_CANAL[c]).join(' y ')

/**
 * Cómo le fue a UN envío (un contacto por un canal), según el escenario. Es un ítem de
 * `enviosEmail` / `enviosWhatsapp`, ya leído (ver `src/services/make/envioDocumento.ts`).
 */
export interface ResultadoEntrega {
  ok: boolean
  /** A qué contacto corresponde. Sin él, el ítem se empareja por orden (ver `repartir`). */
  pulseId?: string
  /**
   * Sólo WhatsApp: los ids en 360Messenger de lo que se le mandó, para confirmar cada uno. El texto y
   * los documentos salen como mensajes SEPARADOS, y el WhatsApp cuenta como enviado sólo si se
   * confirman todos.
   */
  whatsapp?: MensajesWhatsapp
  /** Por qué no salió, en palabras del usuario. */
  motivo?: string
}

/** Los mensajes de WhatsApp de un contacto en 360Messenger (ver `ResultadoEntrega.whatsapp`). */
export interface MensajesWhatsapp {
  /** Id del mensaje de texto. */
  texto?: string
  /** Id de cada documento enviado. */
  documentos: string[]
  /**
   * La respuesta trae el detalle de los documentos (`envio_mensaje_documentos`): sin ninguno, el
   * WhatsApp no cuenta como enviado. Falso con el formato viejo (`messageId` suelto), que no lo traía.
   */
  exigeDocumentos: boolean
}

/** Lo que dijo el escenario de cada canal: un ítem por contacto. */
export type ResultadosEnvio = Record<CanalEnvio, readonly ResultadoEntrega[]>

/** Un envío que no salió. */
export interface Falla {
  pulseId: string
  nombre: string
  canal: CanalEnvio
  motivo?: string
}

/** Cómo terminó el envío, contacto por contacto. */
export type EvaluacionEnvio =
  /** Salió todo lo que se pidió. `enviados`: lo que recibió cada contacto, contando lo de antes. */
  | { estado: 'ok'; enviados: EnviadosPorContacto }
  /** Algo salió (ahora o en un intento anterior) y algo no. */
  | { estado: 'parcial'; enviados: EnviadosPorContacto; fallas: Falla[] }
  /** No salió nada. */
  | { estado: 'error'; fallas: Falla[] }

/**
 * Empareja los resultados de un canal con los destinatarios que lo pidieron. Si los ítems traen
 * `pulseId`, por él; si no, por ORDEN: el primer ítem es el del primer destinatario que pidió ese
 * canal, y así. Un destinatario sin ítem cuenta como no enviado: lo que el escenario no confirmó no
 * se da por hecho.
 */
export function repartir(
  destinatarios: readonly DestinatarioMake[],
  canal: CanalEnvio,
  items: readonly ResultadoEntrega[],
): Map<string, ResultadoEntrega> {
  const pidieron = destinatarios.filter((d) => d.canales.includes(canal))
  /* Por id sólo si los ids del escenario son los de los destinatarios: si trae otro (el del cliente,
     el de su propio módulo), emparejar por él dejaría a todos como no enviados. */
  const porId = items.some((i) => i.pulseId && pidieron.some((d) => d.pulseId === i.pulseId))
  const reparto = new Map<string, ResultadoEntrega>()
  pidieron.forEach((d, i) => {
    const item = porId ? items.find((x) => x.pulseId === d.pulseId) : items[i]
    reparto.set(d.pulseId, item ?? { ok: false })
  })
  return reparto
}

/**
 * Evalúa la respuesta del escenario. Un 200 NO alcanza: el envío es exitoso sólo si cada contacto
 * recibió cada canal que se le pidió.
 *
 * Es parcial cuando algo salió —en este pedido o en uno anterior— y algo no: con "Ambos", el email
 * llegó y el WhatsApp no; o el WhatsApp le llegó a un contacto y a otro no.
 */
export function evaluarEnvio(
  envio: EnvioDocumentoMake,
  resultados: ResultadosEnvio,
  yaEnviados: EnviadosPorContacto = {},
): EvaluacionEnvio {
  const enviados: EnviadosPorContacto = Object.fromEntries(
    Object.entries(yaEnviados).map(([id, canales]) => [id, [...canales]]),
  )
  const fallas: Falla[] = []
  for (const canal of ['email', 'whatsapp'] as const) {
    for (const [pulseId, r] of repartir(envio.destinatarios, canal, resultados[canal])) {
      if (r.ok) {
        enviados[pulseId] = [...new Set([...(enviados[pulseId] ?? []), canal])]
      } else {
        const nombre = envio.destinatarios.find((d) => d.pulseId === pulseId)?.nombre ?? pulseId
        fallas.push({ pulseId, nombre, canal, ...(r.motivo ? { motivo: r.motivo } : {}) })
      }
    }
  }
  if (fallas.length === 0) return { estado: 'ok', enviados }
  if (Object.values(enviados).some((c) => c.length > 0)) return { estado: 'parcial', enviados, fallas }
  return { estado: 'error', fallas }
}

/**
 * Los contactos que fallaron, por `pulseId`, con el motivo de su primera falla: es la cruz roja de su
 * fila, y el reintento se les manda sólo a ellos.
 */
export const fallidosDe = (fallas: readonly Falla[]): Record<string, string> =>
  Object.fromEntries(
    [...new Set(fallas.map((f) => f.pulseId))].map((id) => {
      const falla = fallas.find((f) => f.pulseId === id)
      return [id, falla?.motivo ?? `no se pudo enviar por ${NOMBRE_CANAL[falla?.canal ?? 'email']}`]
    }),
  )

/** Los canales de una lista de fallas, sin repetir y en orden fijo (email primero). */
const canalesDeFallas = (fallas: readonly Falla[]): CanalEnvio[] =>
  (['email', 'whatsapp'] as const).filter((c) => fallas.some((f) => f.canal === c))

/** Nombres en castellano: "Ana", "Ana y Beto", "Ana, Beto y Caro". */
const enumerar = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`

/** Cada falla en una frase: "Caro por WhatsApp (el número no tiene WhatsApp)". */
export const detalleFallas = (fallas: readonly Falla[]): string =>
  enumerar(fallas.map((f) => `${f.nombre} por ${NOMBRE_CANAL[f.canal]}${f.motivo ? ` (${f.motivo})` : ''}`))

/** La primera letra en mayúscula: el motivo abre una oración. */
const capitalizar = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1)

/** Un motivo del escenario, con punto final y un espacio adelante; vacío si no hay. */
const conMotivo = (motivo?: string): string => (motivo ? ` ${motivo.replace(/\.?$/, '.')}` : '')

/**
 * El aviso de un envío parcial, en palabras del usuario.
 *
 * Si lo que falló es un canal ENTERO —no le llegó a nadie por ahí— y otro sí salió, se dice así:
 * "se envió por email, pero no por WhatsApp". Si falló para algunos contactos y no para otros, se
 * dice a quién le faltó y por dónde.
 */
export function mensajeParcial(
  fallas: readonly Falla[],
  enviados: EnviadosPorContacto,
  motivo?: string,
  /**
   * Cómo se nombra el documento en el aviso, CON su artículo y en mayúscula inicial: "El recibo",
   * "La orden de pago". El artículo va adentro porque el género cambia de un documento a otro.
   */
  documento = 'El documento',
): string {
  const ok = (['email', 'whatsapp'] as const).filter((c) => Object.values(enviados).some((l) => l.includes(c)))
  const faltan = canalesDeFallas(fallas)
  const porCanal = faltan.every((c) => !ok.includes(c))
  if (porCanal) {
    /* Sin un mensaje del escenario, se dice el motivo de las fallas (el de 360Messenger, p. ej.)
       cuando es uno solo: si difieren por contacto, no entran en una frase por canal. */
    const motivos = [...new Set(fallas.map((f) => f.motivo).filter((m): m is string => Boolean(m)))]
    const porque = motivo || (motivos.length === 1 ? capitalizar(motivos[0]) : undefined)
    return `${documento} se envió por ${nombrarCanales(ok)}, pero no por ${nombrarCanales(faltan)}.${conMotivo(
      porque,
    )} Volvé a tocar el botón para completar el envío por ${nombrarCanales(faltan)}: por ${nombrarCanales(ok)} no se manda de nuevo.`
  }
  return `${documento} no les llegó a todos. Faltó: ${detalleFallas(fallas)}.${conMotivo(
    motivo,
  )} Volvé a tocar el botón para reintentar sólo lo que faltó: lo que ya salió no se manda de nuevo.`
}

/** Título del error cuando no salió nada: "No se pudo enviar por WhatsApp". */
export const tituloError = (fallas: readonly Falla[]): string =>
  `No se pudo enviar por ${nombrarCanales(canalesDeFallas(fallas))}`

/**
 * Qué tiene que corregir el usuario antes de enviar: un renglón por problema, con el nombre del
 * contacto adelante para saber a quién tocar. Vacío = se puede enviar.
 *
 *   · El contacto no acepta el documento (su "Para Enviar" no lo incluye).
 *   · No tiene el dato que pide el medio: email para "Email", WhatsApp para "WhatsApp", y al menos
 *     uno de los dos para "Ambos".
 */
export function problemasDeContactos(
  contactos: readonly Contacto[],
  medio: MedioEnvio,
  /** El documento en plural, como lo lee el usuario: "recibos", "órdenes de pago". */
  documentos: string,
): string[] {
  return contactos.flatMap((c) => {
    const problemas: string[] = []
    if (!c.ok) problemas.push(`${c.name}: no acepta recibir ${documentos}. Quitalo de la lista.`)
    if (canalesDe(c, medio).length === 0) {
      const dato =
        medio === 'Email'
          ? 'un email'
          : medio === 'WhatsApp'
            ? 'un número de WhatsApp'
            : 'ni email ni número de WhatsApp'
      problemas.push(
        medio === 'Ambos'
          ? `${c.name}: no tiene ${dato} cargado. Cargale uno en Monday o quitalo de la lista.`
          : `${c.name}: no tiene ${dato} cargado. Cargáselo en Monday, cambiá el medio de envío o quitalo de la lista.`,
      )
    }
    return problemas
  })
}
