import { randomInt, randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { diaDelNegocio, formatearDia } from "../src/lib/fechas";
import { formatearPesos } from "../src/lib/moneda";
import { enviarCredenciales, expect, test as base, type Cuenta } from "./utilidades";

// HU-030: el admin asignado ve un reporte de inasistencia en «Reportes en revisión» de su bandeja, lo abre, ve los datos
// del caso y lo acepta o lo rechaza con la confirmación y observaciones; la decisión queda en la base (monitoría, reporte,
// desembolso, reembolsos, aviso al monitor) y el Lead la ve en la página de su cita. Corre contra el Supabase local (Auth y
// base) y el servidor de Next con la configuración de .env.local (`npm run db:env`). Cada prueba crea y borra su propio
// admin, el monitor (con su llave), la materia, la franja, el Lead, una monitoría que empezó hace 2 horas con sus pagos y un
// reporte en revisión asignado a ese admin.
//
// El reporte se inserta ya en revisión, como lo deja la puerta de HU-029 (que ya recorre e2e/cita.spec.ts), pero asignado
// al admin de la prueba: la puerta se lo daría al primer admin activo, que en la base local es uno de la semilla, sin sesión
// aquí. La monitoría nace `pendiente_pago` y se confirma con un UPDATE (así el trigger de HU-019 le anota su token, el del
// enlace de la cita del Lead) y, si la prueba lo pide, se realiza con otro (así el de HU-028 le crea su desembolso). Los
// reembolsos que crea la decisión van al primer admin activo (D-26): la prueba los lee por su monitoría. Los correos los manda
// la app con sus procesadores (`integracion/resolver-reportes.test.ts` los recorre hasta Mailpit): aquí no corre ninguno.
//
// Los reportes son por admin y cada prueba tiene el suyo, así que el contador de la bandeja propia es exacto aunque las pruebas
// corran en paralelo. Cada prueba inicia una sola sesión: el Auth local deja 30 inicios cada 5 minutos para toda la suite.

const ESPERA = { timeout: 20_000 };
const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const BASE = "El monitor no asistió a la monitoría.";

/** Texto con los espacios duros (los pesos y la hora los llevan) como espacios normales. */
const normalizar = (texto: string) => texto.replace(/\s+/g, " ");

const pesos = (monto: number) => normalizar(formatearPesos(monto));

const formatoDeHora = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Bogota",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** El día y la hora (`HH:MM:SS`) de un instante en Bogotá, tal como los guarda la base, y los minutos desde la medianoche. */
function sesionEn(instante: Date) {
  const fecha = diaDelNegocio(instante);
  const hora = formatoDeHora.format(instante);
  return {
    fecha,
    dia: new Date(`${fecha}T12:00:00Z`).getUTCDay() || 7,
    hora,
    minutoDelDia: Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5)),
  };
}

// ---------------------------------------------------------------------------
// Fixture `escenario`: lo que crea cada prueba, que se borra al terminar
// ---------------------------------------------------------------------------
type Pago = { id: string; nombre: string; monto: number; contacto: string };

type Caso = {
  idReporte: string;
  idMonitoria: string;
  /** El día de la sesión; empezó hace 2 horas. */
  fecha: string;
  nombreLead: string;
  correoLead: string;
  telefonoLead: string;
  /** El token del enlace de la cita del Lead (`/cita?token=`). */
  token: string;
  aprobado: Pago;
  /** Un segundo pago, todavía en revisión; solo si la prueba lo pidió. */
  enRevision: Pago | null;
  /** El desembolso que crea el trigger al realizarse; `null` en una confirmada. */
  desembolso: { id: string; comision: number; neto: number } | null;
  /** La reseña del pago aprobado, si la prueba la pidió. */
  resena: { calificacion: number; comentario: string } | null;
  /** Lo que nunca debe salir en la pantalla: la comisión y el neto del desembolso (CLAUDE.md, P-32). */
  prohibidos: number[];
};

type OpcionesDeCaso = {
  estado: "confirmada" | "realizada";
  conPagoEnRevision?: boolean;
  conResena?: boolean;
  /** El nombre de quien pagó el pago aprobado (texto libre de hasta 120 caracteres); por defecto, uno corto de la prueba. */
  nombrePagador?: string;
  /** El comentario de la reseña del pago aprobado; por defecto, uno corto. Solo con `conResena`. */
  comentarioDeResena?: string;
};

type Escenario = {
  /** El admin de la prueba: el que tiene asignado el reporte y el único que entra, salvo `otroAdmin`. */
  admin: Cuenta;
  monitor: Cuenta;
  /** La llave del monitor (`monitor_privado`): nunca debe salir en la pantalla del reporte. */
  llave: string;
  materia: string;
  /** Otro admin, para ver un reporte que no es suyo. */
  otroAdmin(): Promise<Cuenta>;
  caso(opciones: OpcionesDeCaso): Promise<Caso>;
  /** Todo lo que quedó en la base de esa monitoría después de una decisión. */
  leerMonitoria(id: string): Promise<{ estado: string; motivo_cancelacion: string | null; fecha_finalizacion: string | null }>;
  leerReporte(id: string): Promise<{ estado: string; id_admin: string; fecha_decision: string | null; observaciones: string | null }>;
  leerDesembolso(idMonitoria: string): Promise<{ estado: string; monto_bruto: number; comision: number; monto_neto: number } | null>;
  leerReembolsos(idMonitoria: string): Promise<{ id: string; id_pago: string; id_admin: string | null; monto: number; motivo: string; estado: string }[]>;
  leerEventosDeAviso(idMonitoria: string): Promise<string[]>;
  leerPedidosDeLlave(idReembolso: string): Promise<string[]>;
  leerPago(id: string): Promise<{ estado: string }>;
};

const test = base.extend<{ escenario: Escenario }>({
  escenario: async ({ cuentas }, entregar) => {
    const cliente = cuentas.cliente;
    const admin = await cuentas.crearAdmin();
    const monitor = await cuentas.crearMonitor();
    const creados = {
      resenas: [] as string[],
      pagos: [] as string[],
      comprobantes: [] as string[],
      monitorias: [] as string[],
      franjas: [] as string[],
      leads: [] as string[],
      materias: [] as string[],
    };

    async function insertar(tabla: string, fila: Record<string, unknown>): Promise<string> {
      const { data, error } = await cliente.from(tabla).insert(fila).select("id").single();
      if (error) throw new Error(`insertar ${tabla}: ${error.message}`);
      return data.id as string;
    }

    async function actualizar(tabla: string, id: string, cambios: Record<string, unknown>): Promise<void> {
      const { error } = await cliente.from(tabla).update(cambios).eq("id", id);
      if (error) throw new Error(`actualizar ${tabla}: ${error.message}`);
    }

    async function calcular(funcion: "comision" | "monto_neto", bruto: number): Promise<number> {
      const { data, error } = await cliente.rpc(funcion, { p_monto_bruto: bruto });
      if (error) throw new Error(`${funcion}: ${error.message}`);
      return data as number;
    }

    /** Un pago de la monitoría; su comprobante tiene que estar revisado antes (HU-059). */
    async function crearPago(idMonitoria: string, estado: "aprobado" | "en_revision", monto: number, nombrePropio?: string): Promise<Pago> {
      const comprobante = `${randomUUID()}/${randomUUID()}.png`;
      const { error } = await cliente.from("comprobante_revisado").insert({ ruta: comprobante, tipo: "image/png" });
      if (error) throw new Error(`insertar comprobante_revisado: ${error.message}`);
      creados.comprobantes.push(comprobante);
      const nombre = nombrePropio ?? `Pagador ${estado === "aprobado" ? "aprobado" : "en revisión"} e2e ${randomUUID().slice(0, 6)}`;
      const contacto = `pagador-${randomUUID()}@calibra.test`;
      const id = await insertar("pago", {
        id_monitoria: idMonitoria,
        id_admin: admin.id,
        comprobante,
        monto,
        nombre_pagador: nombre,
        contacto,
        estado,
        ...(estado === "aprobado" ? { fecha_revision: new Date().toISOString() } : {}),
      });
      creados.pagos.push(id);
      return { id, nombre, monto, contacto };
    }

    const { data: privado, error: errorLlave } = await cliente.from("monitor_privado").select("llave").eq("id_monitor", monitor.id).single();
    if (errorLlave) throw new Error(`leer la llave del monitor: ${errorLlave.message}`);

    const materia = `Materia e2e reportes ${randomUUID().slice(0, 6)}`;
    const idMateria = await insertar("materia", { nombre: materia, codigo: `E2E-${randomUUID().slice(0, 12)}` });
    creados.materias.push(idMateria);
    const { error: errorCertificado } = await cliente.from("certificado").insert({ id_monitor: monitor.id, id_materia: idMateria, id_admin: admin.id });
    if (errorCertificado) throw new Error(`insertar certificado: ${errorCertificado.message}`);

    await entregar({
      admin,
      monitor,
      llave: (privado as { llave: string }).llave,
      materia,
      otroAdmin: () => cuentas.crearAdmin(),
      async caso({ estado, conPagoEnRevision = false, conResena = false, nombrePagador, comentarioDeResena }) {
        // Empezó hace 2 horas, en su propia franja: el cierre automático (fin + 24 h) no la alcanza mientras corre la prueba.
        const inicio = new Date(Math.floor((Date.now() - 2 * HORA) / MINUTO) * MINUTO);
        const sesion = sesionEn(inicio);
        const idFranja = await insertar("franja", {
          id_monitor: monitor.id,
          dia: sesion.dia,
          hora: sesion.hora,
          duracion_min: Math.min(60, 24 * 60 - sesion.minutoDelDia),
          presencial: true,
          precio: 25_000,
          lugar: "Salón e2e",
        });
        creados.franjas.push(idFranja);
        const nombreLead = `Lead e2e ${randomUUID().slice(0, 6)}`;
        const correoLead = `e2e-${randomUUID()}@calibra.test`;
        const telefonoLead = `31${randomInt(10_000_000, 99_999_999)}`;
        const idLead = await insertar("lead", {
          nombre: nombreLead,
          correo: correoLead,
          numero_telefono: telefonoLead,
          acepta_tratamiento_datos: true,
          fecha_consentimiento: new Date().toISOString(),
        });
        creados.leads.push(idLead);

        // Montos al azar, altos: el desembolso de la prueba se reconoce y su comisión no se confunde con otra cifra.
        const aprobadoMonto = randomInt(110_000, 150_000);
        const idMonitoria = await insertar("monitoria", {
          id_franja: idFranja,
          id_monitor: monitor.id,
          id_materia: idMateria,
          id_lead: idLead,
          fecha: sesion.fecha,
          valor_total: aprobadoMonto,
          estado: "pendiente_pago",
        });
        creados.monitorias.push(idMonitoria);
        await actualizar("monitoria", idMonitoria, { estado: "confirmada" });
        const aprobado = await crearPago(idMonitoria, "aprobado", aprobadoMonto, nombrePagador);
        const enRevision = conPagoEnRevision ? await crearPago(idMonitoria, "en_revision", randomInt(20_000, 40_000)) : null;
        let resena: Caso["resena"] = null;
        if (estado === "realizada") {
          await actualizar("monitoria", idMonitoria, { estado: "realizada", fecha_finalizacion: new Date().toISOString() });
          if (conResena) {
            resena = { calificacion: 2, comentario: comentarioDeResena ?? `El monitor no llegó <b>nunca</b> ${randomUUID().slice(0, 6)}` };
            const { error } = await cliente.from("resena").insert({ id_pago: aprobado.id, ...resena });
            if (error) throw new Error(`insertar resena: ${error.message}`);
            creados.resenas.push(aprobado.id);
          }
        }
        const idReporte = await insertar("reporte_inasistencia", { id_monitoria: idMonitoria, id_admin: admin.id });

        const { data: confirmacion, error: errorToken } = await cliente.from("confirmacion_cita").select("token").eq("id_monitoria", idMonitoria).single();
        if (errorToken) throw new Error(`leer el token de la cita: ${errorToken.message}`);
        let desembolso: Caso["desembolso"] = null;
        if (estado === "realizada") {
          const { data, error } = await cliente.from("desembolso").select("id, comision, monto_neto").eq("id_monitoria", idMonitoria).single();
          if (error) throw new Error(`leer el desembolso: ${error.message}`);
          desembolso = { id: data.id as string, comision: data.comision as number, neto: data.monto_neto as number };
        }
        const comisionDelPago = await calcular("comision", aprobadoMonto);
        const netoDelPago = await calcular("monto_neto", aprobadoMonto);
        return {
          idReporte,
          idMonitoria,
          fecha: sesion.fecha,
          nombreLead,
          correoLead,
          telefonoLead,
          token: (confirmacion as { token: string }).token,
          aprobado,
          enRevision,
          desembolso,
          resena,
          prohibidos: [comisionDelPago, netoDelPago, ...(desembolso ? [desembolso.comision, desembolso.neto] : [])],
        };
      },
      async leerMonitoria(id) {
        const { data, error } = await cliente.from("monitoria").select("estado, motivo_cancelacion, fecha_finalizacion").eq("id", id).single();
        if (error) throw new Error(`leer monitoria: ${error.message}`);
        return data;
      },
      async leerReporte(id) {
        const { data, error } = await cliente.from("reporte_inasistencia").select("estado, id_admin, fecha_decision, observaciones").eq("id", id).single();
        if (error) throw new Error(`leer reporte: ${error.message}`);
        return data;
      },
      async leerDesembolso(idMonitoria) {
        const { data, error } = await cliente.from("desembolso").select("estado, monto_bruto, comision, monto_neto").eq("id_monitoria", idMonitoria).maybeSingle();
        if (error) throw new Error(`leer desembolso: ${error.message}`);
        return data;
      },
      async leerReembolsos(idMonitoria) {
        const { data: pagos, error: errorPagos } = await cliente.from("pago").select("id").eq("id_monitoria", idMonitoria);
        if (errorPagos) throw new Error(`leer pagos: ${errorPagos.message}`);
        const { data, error } = await cliente
          .from("reembolso")
          .select("id, id_pago, id_admin, monto, motivo, estado")
          .in("id_pago", (pagos ?? []).map((p) => p.id as string))
          .order("id_pago");
        if (error) throw new Error(`leer reembolsos: ${error.message}`);
        return data ?? [];
      },
      async leerEventosDeAviso(idMonitoria) {
        const { data, error } = await cliente.from("aviso_monitor").select("evento").eq("id_monitoria", idMonitoria).order("creado_en");
        if (error) throw new Error(`leer aviso_monitor: ${error.message}`);
        return (data ?? []).map((fila) => fila.evento as string);
      },
      async leerPedidosDeLlave(idReembolso) {
        const { data, error } = await cliente.from("pedido_llave").select("tipo").eq("id_reembolso", idReembolso);
        if (error) throw new Error(`leer pedido_llave: ${error.message}`);
        return (data ?? []).map((fila) => fila.tipo as string);
      },
      async leerPago(id) {
        const { data, error } = await cliente.from("pago").select("estado").eq("id", id).single();
        if (error) throw new Error(`leer pago: ${error.message}`);
        return data;
      },
    });

    // Limpieza en el orden de las llaves foráneas, antes de que `cuentas` borre a los admins (pago y certificado les apuntan
    // sin cascada) y al monitor. Los reembolsos que creó la decisión cuelgan de los pagos; su solicitud y su pedido de llave
    // se van con ellos, y el aviso al monitor y el token de la cita, con la monitoría. Se intenta todo y se avisa de lo que falle.
    const fallos: string[] = [];
    const borrar = async (contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await consulta;
      if (error) fallos.push(`${contexto}: ${error.message}`);
    };
    if (creados.resenas.length) await borrar("reseñas", cliente.from("resena").delete().in("id_pago", creados.resenas));
    if (creados.monitorias.length) await borrar("reportes", cliente.from("reporte_inasistencia").delete().in("id_monitoria", creados.monitorias));
    if (creados.pagos.length) await borrar("reembolsos", cliente.from("reembolso").delete().in("id_pago", creados.pagos));
    if (creados.monitorias.length) await borrar("desembolsos", cliente.from("desembolso").delete().in("id_monitoria", creados.monitorias));
    if (creados.pagos.length) await borrar("pagos", cliente.from("pago").delete().in("id", creados.pagos));
    // Después de los pagos, que les apuntan.
    if (creados.comprobantes.length) await borrar("comprobantes revisados", cliente.from("comprobante_revisado").delete().in("ruta", creados.comprobantes));
    if (creados.monitorias.length) await borrar("monitorías", cliente.from("monitoria").delete().in("id", creados.monitorias));
    await borrar("franjas", cliente.from("franja").delete().in("id", creados.franjas));
    await borrar("certificados", cliente.from("certificado").delete().eq("id_admin", admin.id));
    await borrar("leads", cliente.from("lead").delete().in("id", creados.leads));
    await borrar("materias", cliente.from("materia").delete().in("id", creados.materias));
    if (fallos.length) throw new Error(`No se pudo limpiar lo que creó la prueba:\n${fallos.join("\n")}`);
  },
});

test.describe.configure({ mode: "default", timeout: 120_000 });

// Next tiene su propio role="alert" (el anunciador de rutas): se busca por el texto.
const alerta = (page: Page, texto: string) => page.getByRole("alert").filter({ hasText: texto });
const aviso = (page: Page, texto: string) => page.getByRole("status").filter({ hasText: texto });
const titulo = (page: Page, nombre: string) => page.getByRole("heading", { level: 1, name: nombre });
const reportesDeLaBandeja = (page: Page) => page.getByRole("region", { name: /Reportes en revisión/ });
const contadorDeReportes = (page: Page, n: number) =>
  page.getByRole("navigation", { name: "Resumen de tu bandeja" }).getByRole("link", { name: new RegExp(`^${n} Reportes en revisión$`) });
const enlaceAlReporte = (page: Page, c: Caso) => reportesDeLaBandeja(page).locator(`a[href="/admin/reportes/${c.idReporte}"]`);
const seccion = (page: Page, nombre: string) => page.getByRole("region", { name: nombre, exact: true });
const abrir = (page: Page, decision: "Aceptar" | "Rechazar") => page.locator("summary", { hasText: `${decision} el reporte` });
const botonDe = (page: Page, decision: "aceptar" | "rechazar") => page.getByRole("button", { name: `Sí, ${decision} el reporte` });
/** El `<details>` de una decisión: abierto, deja ver sus consecuencias, sus observaciones y su botón. */
const confirmacion = (page: Page, decision: "aceptar" | "rechazar") => page.locator("details", { has: page.locator(`#${decision}-consecuencias`) });
const observaciones = (page: Page, decision: "aceptar" | "rechazar") => page.locator(`#${decision}-observaciones`);
const consecuencias = (page: Page, decision: "aceptar" | "rechazar") => page.locator(`#${decision}-consecuencias`);

/** Los botones de confirmar de las dos decisiones, estén o no a la vista (cada uno vive dentro de su `<details>`). */
const botonesDeConfirmar = (page: Page) => page.locator("details form button[type=submit]");

/**
 * Detiene la petición de la acción del servidor (un POST con la cabecera `Next-Action`) hasta que la prueba la suelta: mientras
 * está en vuelo, la página tiene que mostrar su estado de envío. Devuelve la función que la suelta.
 */
async function retenerLaAccion(page: Page): Promise<() => void> {
  let soltar!: () => void;
  const soltada = new Promise<void>((resolver) => {
    soltar = resolver;
  });
  await page.route("**/admin/reportes/*", async (route) => {
    const peticion = route.request();
    if (peticion.method() === "POST" && "next-action" in peticion.headers()) await soltada;
    await route.continue();
  });
  return soltar;
}

/** Mientras una decisión se envía, los dos botones de confirmar quedan inactivos (SPEC 4.5) y el de la decisión dice lo suyo. */
async function expectEnviando(page: Page, enCurso: "Aceptando…" | "Rechazando…") {
  await expect(page.getByRole("button", { name: enCurso })).toBeDisabled(ESPERA);
  await expect(botonesDeConfirmar(page)).toHaveCount(2);
  for (const boton of await botonesDeConfirmar(page).all()) await expect(boton).toBeDisabled();
  // La otra decisión sigue con su texto de siempre, aunque inactiva y fuera de la vista.
  const otro = enCurso === "Aceptando…" ? "Sí, rechazar el reporte" : "Sí, aceptar el reporte";
  await expect(botonesDeConfirmar(page).filter({ hasText: otro })).toBeDisabled();
}

/** El valor de una etiqueta (Reportó, Estado, Materia...) dentro de una sección de la página. */
const dato = (donde: Locator, etiqueta: string): Locator =>
  donde.locator("dt", { hasText: new RegExp(`^${etiqueta}$`) }).locator("xpath=following-sibling::dd[1]");

async function entrarComoAdmin(page: Page, admin: Cuenta) {
  await page.goto("/admin");
  await expect(page).toHaveURL("/ingresar?siguiente=%2Fadmin", ESPERA);
  await enviarCredenciales(page, admin.correo, admin.contrasena);
  await expect(page).toHaveURL("/admin", ESPERA);
}

/** Ni el bruto ni la comisión llegan a la pantalla del reporte (CLAUDE.md): ni la palabra ni la cifra, ni la llave del monitor. */
async function expectSinComision(page: Page, c: Caso, llave?: string) {
  const cuerpo = page.locator("body");
  await expect(cuerpo).not.toContainText(/comisi[oó]n/i);
  await expect(cuerpo).not.toContainText(/bruto/i);
  for (const monto of c.prohibidos) await expect(cuerpo).not.toContainText(pesos(monto));
  if (llave) await expect(cuerpo).not.toContainText(llave);
}

// ---------------------------------------------------------------------------
// Aceptar el reporte de una monitoría ya realizada, con su desembolso y su reseña
// ---------------------------------------------------------------------------
test.describe("Aceptar · el admin asignado abre el reporte desde su bandeja y lo acepta", () => {
  test("la bandeja lo lista con un enlace; la página muestra quién reportó, el monitor, la monitoría, los pagos y la reseña, sin comisión; Enter con la confirmación cerrada no envía; al abrirla se leen las consecuencias; al confirmar la monitoría se cancela, el desembolso se anula, nace el reembolso con el comentario y el reporte sale de la bandeja; el reembolso y la cita del Lead lo dicen", async ({
    page,
    escenario,
  }) => {
    const { admin, monitor, materia } = escenario;
    const c = await escenario.caso({ estado: "realizada", conPagoEnRevision: true, conResena: true });
    const comentario = `Hablamos con ${monitor.nombre} y no dio razón de su ausencia <i>${randomUUID().slice(0, 6)}</i>.`;
    await entrarComoAdmin(page, admin);

    await test.step("la bandeja cuenta el reporte arriba y lo lista con un enlace a su resolución", async () => {
      await expect(contadorDeReportes(page, 1)).toBeVisible(ESPERA);
      const fila = enlaceAlReporte(page, c);
      await expect(fila).toBeVisible();
      await expect(fila).toContainText(`Sesión del ${formatearDia(c.fecha)}`);
      await expect(fila).toContainText("Reportado el");
      await expect(reportesDeLaBandeja(page)).toContainText("Abre cada uno para aceptarlo o rechazarlo.");
      await fila.click();
      await expect(page).toHaveURL(`/admin/reportes/${c.idReporte}`, ESPERA);
      await expect(page).toHaveTitle("Resolver un reporte · Calibra");
    });

    await test.step("un enlace escrito a mano no anuncia una decisión que no pasó: con el reporte en revisión, ?resuelto= no muestra ningún éxito", async () => {
      for (const resuelto of ["aceptado", "rechazado"]) {
        await page.goto(`/admin/reportes/${c.idReporte}?resuelto=${resuelto}`);
        await expect(titulo(page, "Resolver el reporte")).toBeVisible(ESPERA);
        await expect(page.getByRole("status").filter({ hasText: /Aceptaste|Rechazaste/ })).toHaveCount(0);
      }
      await page.goto(`/admin/reportes/${c.idReporte}`);
    });

    await test.step("la página muestra el reporte, la monitoría, los pagos y la reseña; nunca la comisión, el neto ni la llave del monitor", async () => {
      await expect(titulo(page, "Resolver el reporte")).toBeVisible(ESPERA);
      await expect(page.getByText("Quien agendó dice que el monitor no llegó. Revisa los datos y decide.")).toBeVisible();

      const reporte = seccion(page, "Reporte");
      await expect(dato(reporte, "Reportó")).toHaveText(c.nombreLead);
      await expect(dato(reporte, "Contacto de quien reportó")).toHaveText(`${c.correoLead} · ${c.telefonoLead}`);
      await expect(dato(reporte, "Estado")).toHaveText("En revisión");
      await expect(dato(reporte, "Asignado a")).toHaveText(admin.nombre);
      await expect(reporte).not.toContainText("Decidido");

      const monitoria = seccion(page, "Monitoría");
      await expect(dato(monitoria, "Materia")).toHaveText(materia);
      await expect(dato(monitoria, "Monitor")).toHaveText(monitor.nombre);
      await expect(dato(monitoria, "Contacto del monitor")).toHaveText(`${monitor.correo} · 3001234567`);
      await expect(dato(monitoria, "Fecha")).toHaveText(formatearDia(c.fecha));
      await expect(dato(monitoria, "Estado")).toHaveText("Realizada");
      // Un dato que el admin pesa al decidir, sin decir que lo marcó el monitor (también lo pone el cierre automático).
      await expect(monitoria).toContainText("La monitoría quedó realizada el");

      const pagos = seccion(page, "Pagos");
      await expect(pagos).toContainText(c.aprobado.nombre);
      await expect(pagos).toContainText(`${pesos(c.aprobado.monto)} · Aprobado`);
      await expect(pagos).toContainText(c.enRevision!.nombre);
      await expect(pagos).toContainText(`${pesos(c.enRevision!.monto)} · En revisión`);
      await expect(pagos).not.toContainText("Abrir el reembolso");

      // La reseña se conserva y se ve al decidir (D-40 c); el comentario va escapado, tal cual se escribió.
      const resena = seccion(page, "Reseña");
      await expect(resena).toContainText(c.aprobado.nombre);
      await expect(resena).toContainText(`${c.resena!.calificacion} de 5. ${c.resena!.comentario}`);

      await expectSinComision(page, c, escenario.llave);
      await expectReglasDelProducto(page, "el reporte en revisión");
    });

    await test.step("los dos formularios están dentro de confirmaciones cerradas: Enter solo abre la confirmación y no cambia nada", async () => {
      await expect(abrir(page, "Aceptar")).toBeVisible();
      await expect(abrir(page, "Rechazar")).toBeVisible();
      await expect(botonDe(page, "aceptar")).toBeHidden();
      await expect(botonDe(page, "rechazar")).toBeHidden();
      await expect(observaciones(page, "aceptar")).toBeHidden();

      await abrir(page, "Aceptar").press("Enter");
      await expect(botonDe(page, "aceptar")).toBeVisible();
      await abrir(page, "Aceptar").click();
      await expect(botonDe(page, "aceptar")).toBeHidden();
      expect((await escenario.leerReporte(c.idReporte)).estado).toBe("en_revision");
      await expect(page).toHaveURL(`/admin/reportes/${c.idReporte}`);
    });

    await test.step("al abrir «Aceptar el reporte» se lee qué pasa antes del botón: la monitoría, el reembolso, el pago en revisión, el aviso y que no se deshace", async () => {
      await abrir(page, "Aceptar").click();
      await expect(
        page.getByText("Opcionales. Hasta 500 caracteres. Quien pagó lee este comentario junto con la solicitud de su llave, en el correo y en la página donde la envía: escríbelo pensando en esa persona."),
      ).toBeVisible();
      await expect(consecuencias(page, "aceptar")).toHaveText(
        `La monitoría del ${formatearDia(c.fecha)} pasa a cancelada porque el monitor no asistió, y no se le desembolsa. ` +
          `Creamos un reembolso de ${pesos(c.aprobado.monto)} y le pedimos la llave a quien pagó, por correo. ` +
          "1 pago sigue en revisión: recibe su reembolso cuando se apruebe, y si se rechaza no hay reembolso. " +
          "Le avisamos al monitor por correo, sin los datos de contacto de quien reportó. Esta decisión no se puede deshacer.",
      );
      await expect(botonDe(page, "aceptar")).toHaveAttribute("aria-describedby", "aceptar-consecuencias");
      // Las dos confirmaciones son independientes: abrir una no abre la otra.
      await expect(botonDe(page, "rechazar")).toBeHidden();
      await expectSinComision(page, c);
      await expectReglasDelProducto(page, "la confirmación de aceptar abierta");
    });

    await test.step("al confirmar, el aviso dice lo que quedó, la página pasa a «Reporte aceptado» con las observaciones y ya no ofrece formularios", async () => {
      await observaciones(page, "aceptar").fill(`  ${comentario}\n`);
      const soltar = await retenerLaAccion(page);
      await botonDe(page, "aceptar").click();
      // Con la petición en vuelo los dos botones están inactivos y el de aceptar dice «Aceptando…»: no hay doble clic ni otra decisión.
      await expectEnviando(page, "Aceptando…");
      expect((await escenario.leerReporte(c.idReporte)).estado).toBe("en_revision");
      soltar();

      await expect(aviso(page, "Aceptaste el reporte")).toHaveText(
        "Aceptaste el reporte. La monitoría quedó cancelada y su desembolso, anulado. Creamos 1 reembolso y le pedimos la llave a quien pagó. " +
          "Los pagos en revisión recibirán el suyo cuando se aprueben. Le avisamos al monitor por correo.",
        ESPERA,
      );
      await expect(page).toHaveURL(`/admin/reportes/${c.idReporte}?resuelto=aceptado`);
      await expect(titulo(page, "Reporte aceptado")).toBeVisible();
      await expect(dato(seccion(page, "Reporte"), "Estado")).toHaveText("Aceptado");
      await expect(dato(seccion(page, "Reporte"), "Observaciones")).toHaveText(comentario);
      await expect(dato(seccion(page, "Reporte"), "Decidido")).toBeVisible();
      await expect(dato(seccion(page, "Monitoría"), "Estado")).toHaveText("Cancelada: se aceptó un reporte de inasistencia");
      await expect(page.locator("form")).toHaveCount(0);
      await expect(abrir(page, "Aceptar")).toHaveCount(0);
      await expect(page.getByText("Quien agendó dice que el monitor no llegó")).toHaveCount(0);
      // El comentario es texto, no marcas: lo escapa React.
      await expect(page.locator("body i")).toHaveCount(0);
      await expectSinComision(page, c);
      await expectReglasDelProducto(page, "el reporte aceptado");
    });

    const reembolsoDelPago = await test.step("la base quedó bien: monitoría cancelada, reporte aceptado, desembolso anulado, un reembolso con el comentario y el aviso al monitor", async () => {
      expect(await escenario.leerMonitoria(c.idMonitoria)).toMatchObject({ estado: "cancelada", motivo_cancelacion: "monitor_no_asistio" });
      expect((await escenario.leerMonitoria(c.idMonitoria)).fecha_finalizacion).not.toBeNull();
      const reporte = await escenario.leerReporte(c.idReporte);
      expect(reporte).toMatchObject({ estado: "aceptado", id_admin: admin.id, observaciones: comentario });
      expect(reporte.fecha_decision).not.toBeNull();
      expect(await escenario.leerDesembolso(c.idMonitoria)).toMatchObject({ estado: "anulado" });
      const reembolsos = await escenario.leerReembolsos(c.idMonitoria);
      // Solo el pago aprobado: el que sigue en revisión lo recibirá cuando se apruebe (P-07).
      expect(reembolsos).toEqual([
        expect.objectContaining({ id_pago: c.aprobado.id, monto: c.aprobado.monto, motivo: `${BASE} ${comentario}`, estado: "esperando_llave" }),
      ]);
      expect(reembolsos[0].id_admin).not.toBeNull();
      expect((await escenario.leerPago(c.enRevision!.id)).estado).toBe("en_revision");
      expect(await escenario.leerEventosDeAviso(c.idMonitoria)).toEqual(["confirmada", "inasistencia_aceptada"]);
      expect(await escenario.leerPedidosDeLlave(reembolsos[0].id)).toEqual(["pedido"]);
      return reembolsos[0];
    });

    await test.step("la página enlaza el reembolso del pago aprobado, y el reembolso lleva el motivo con el comentario", async () => {
      const pagos = seccion(page, "Pagos");
      await expect(pagos).toContainText("Reembolso: esperando la llave");
      const enlace = pagos.getByRole("link", { name: "Abrir el reembolso" });
      await expect(enlace).toHaveCount(1);
      await expect(enlace).toHaveAttribute("href", `/admin/reembolsos/${reembolsoDelPago.id}`);
      await enlace.click();
      await expect(page).toHaveURL(`/admin/reembolsos/${reembolsoDelPago.id}`, ESPERA);
      const datos = seccion(page, "Reembolso");
      await expect(dato(datos, "Pagador")).toHaveText(c.aprobado.nombre);
      await expect(dato(datos, "Monto")).toHaveText(pesos(c.aprobado.monto));
      await expect(dato(datos, "Motivo")).toHaveText(`${BASE} ${comentario}`);
      await expect(dato(datos, "Estado")).toHaveText("Esperando la llave");
    });

    await test.step("vuelve a su bandeja: el reporte ya no está y el contador bajó a cero", async () => {
      await page.goto("/admin");
      await expect(contadorDeReportes(page, 0)).toBeVisible(ESPERA);
      await expect(enlaceAlReporte(page, c)).toHaveCount(0);
      await expect(reportesDeLaBandeja(page)).toContainText("No tienes reportes en revisión.");
    });

    await test.step("el Lead, con el enlace de su cita, ve que se aceptó su reporte; las observaciones son para quien pagó y no salen", async () => {
      await page.goto(`/cita?token=${c.token}`);
      await expect(titulo(page, "Esta monitoría se canceló")).toBeVisible(ESPERA);
      await expect(page.getByText("El monitor no asistió y se aceptó tu reporte.")).toBeVisible();
      await expect(page.locator("body")).not.toContainText("Observaciones del admin");
      await expect(page.locator("body")).not.toContainText(comentario);
      await expectReglasDelProducto(page, "la cita del Lead con el reporte aceptado");
    });
  });
});

// ---------------------------------------------------------------------------
// Aceptar el reporte de una monitoría confirmada: sin desembolso que anular
// ---------------------------------------------------------------------------
test.describe("Aceptar · una monitoría que todavía no se realizó no tiene desembolso", () => {
  test("la consecuencia no habla de pagos en revisión, al confirmar dice que no se le desembolsa al monitor y la base cancela la monitoría confirmada sin desembolso", async ({ page, escenario }) => {
    const { admin } = escenario;
    const c = await escenario.caso({ estado: "confirmada" });
    await entrarComoAdmin(page, admin);
    await page.goto(`/admin/reportes/${c.idReporte}`);
    await expect(titulo(page, "Resolver el reporte")).toBeVisible(ESPERA);
    await expect(dato(seccion(page, "Monitoría"), "Estado")).toHaveText("Confirmada");
    await expect(seccion(page, "Monitoría")).not.toContainText("La monitoría quedó realizada el");
    await expect(page.getByRole("region", { name: "Reseña", exact: true })).toHaveCount(0);

    await abrir(page, "Aceptar").click();
    await expect(consecuencias(page, "aceptar")).toHaveText(
      `La monitoría del ${formatearDia(c.fecha)} pasa a cancelada porque el monitor no asistió, y no se le desembolsa. ` +
        `Creamos un reembolso de ${pesos(c.aprobado.monto)} y le pedimos la llave a quien pagó, por correo. ` +
        "Le avisamos al monitor por correo, sin los datos de contacto de quien reportó. Esta decisión no se puede deshacer.",
    );

    // Con más de 500 caracteres, Aceptar también vuelve con el error, la confirmación abierta y lo escrito, sin cambiar nada.
    const demasiado = "x".repeat(501);
    await expect(observaciones(page, "aceptar")).toHaveAttribute("maxlength", "500");
    await observaciones(page, "aceptar").evaluate((campo: HTMLTextAreaElement) => campo.removeAttribute("maxlength"));
    await observaciones(page, "aceptar").fill(demasiado);
    await botonDe(page, "aceptar").click();
    await expect(alerta(page, "Las observaciones pueden tener hasta 500 caracteres.")).toBeVisible(ESPERA);
    await expect(confirmacion(page, "aceptar")).toHaveJSProperty("open", true);
    await expect(observaciones(page, "aceptar")).toHaveValue(demasiado);
    await expect(botonDe(page, "aceptar")).toBeEnabled();
    expect((await escenario.leerReporte(c.idReporte)).estado).toBe("en_revision");
    await expectReglasDelProducto(page, "aceptar con error");

    await observaciones(page, "aceptar").fill("");
    await botonDe(page, "aceptar").click();

    await expect(aviso(page, "Aceptaste el reporte")).toHaveText(
      "Aceptaste el reporte. La monitoría quedó cancelada y no se le desembolsa al monitor. Creamos 1 reembolso y le pedimos la llave a quien pagó. Le avisamos al monitor por correo.",
      ESPERA,
    );
    await expect(titulo(page, "Reporte aceptado")).toBeVisible();
    // Sin observaciones: la sección no tiene la fila.
    await expect(seccion(page, "Reporte")).not.toContainText("Observaciones");
    expect(await escenario.leerMonitoria(c.idMonitoria)).toMatchObject({ estado: "cancelada", motivo_cancelacion: "monitor_no_asistio", fecha_finalizacion: null });
    expect(await escenario.leerDesembolso(c.idMonitoria)).toBeNull();
    expect(await escenario.leerReembolsos(c.idMonitoria)).toEqual([expect.objectContaining({ id_pago: c.aprobado.id, motivo: BASE, estado: "esperando_llave" })]);
    expect(await escenario.leerEventosDeAviso(c.idMonitoria)).toEqual(["confirmada", "inasistencia_aceptada"]);
    await expectSinComision(page, c);
    await expectReglasDelProducto(page, "el reporte aceptado de una confirmada");
  });
});

// ---------------------------------------------------------------------------
// Textos largos: lo que escriben quienes pagan y el admin no tiene un largo corto
// ---------------------------------------------------------------------------
/** Quien pagó, 120 caracteres (el máximo de su nombre): palabras y un tramo sin espacios que solo `overflow-wrap` puede partir. */
const NOMBRE_LARGO = `${"Nombre ".repeat(8)}${"N".repeat(64)}`.slice(0, 120);
/** Una reseña con un tramo de 300 caracteres sin espacios. */
const COMENTARIO_LARGO = `Comentario ${"W".repeat(300)}`;
/**
 * 500 caracteres con 11 saltos de línea: el campo (que cuenta cada salto como uno) los deja escribir, y el navegador los envía
 * como 511 (cada salto, CRLF). Termina con un tramo de 401 caracteres sin espacios.
 */
const OBSERVACIONES_LARGAS = [...Array.from({ length: 11 }, (_, i) => `línea ${String(i + 1).padStart(2, "0")}`), "M".repeat(401)].join("\n");

test.describe("Aceptar · textos largos", () => {
  test("el nombre de 120 caracteres de quien pagó y su reseña se leen enteros sin salirse de la pantalla a 390 px; 500 caracteres de observaciones con 11 saltos de línea se aceptan, se guardan y se leen enteros", async ({
    page,
    escenario,
  }) => {
    expect(NOMBRE_LARGO).toHaveLength(120);
    expect(OBSERVACIONES_LARGAS).toHaveLength(500);
    expect(OBSERVACIONES_LARGAS.split("\n")).toHaveLength(12);
    const { admin } = escenario;
    const c = await escenario.caso({ estado: "realizada", conResena: true, nombrePagador: NOMBRE_LARGO, comentarioDeResena: COMENTARIO_LARGO });
    await entrarComoAdmin(page, admin);
    await page.goto(`/admin/reportes/${c.idReporte}`);
    await expect(titulo(page, "Resolver el reporte")).toBeVisible(ESPERA);

    await test.step("el pago y la reseña con el nombre y el comentario largos se leen enteros y ningún elemento se sale de la pantalla", async () => {
      await expect(seccion(page, "Pagos")).toContainText(NOMBRE_LARGO);
      await expect(seccion(page, "Pagos")).toContainText(`${pesos(c.aprobado.monto)} · Aprobado`);
      const resena = seccion(page, "Reseña");
      await expect(resena).toContainText(NOMBRE_LARGO);
      await expect(resena).toContainText(`2 de 5. ${COMENTARIO_LARGO}`);
      await expectSinComision(page, c, escenario.llave);
      await expectReglasDelProducto(page, "el reporte con textos largos");
    });

    await test.step("el campo deja escribir los 500 caracteres con sus saltos de línea y la acción las acepta (no responde «hasta 500 caracteres»)", async () => {
      await abrir(page, "Aceptar").click();
      await observaciones(page, "aceptar").fill(OBSERVACIONES_LARGAS);
      await expect(observaciones(page, "aceptar")).toHaveValue(OBSERVACIONES_LARGAS);
      await botonDe(page, "aceptar").click();
      await expect(aviso(page, "Aceptaste el reporte")).toBeVisible(ESPERA);
      await expect(alerta(page, "Las observaciones pueden tener hasta 500 caracteres.")).toHaveCount(0);
      await expect(titulo(page, "Reporte aceptado")).toBeVisible();
    });

    await test.step("la página las muestra enteras, con sus saltos de línea y sin salirse de la pantalla", async () => {
      const observacionesDelReporte = dato(seccion(page, "Reporte"), "Observaciones");
      await expect(observacionesDelReporte).toBeVisible();
      expect(await observacionesDelReporte.innerText()).toBe(OBSERVACIONES_LARGAS);
      await expectSinComision(page, c, escenario.llave);
      await expectReglasDelProducto(page, "el reporte aceptado con observaciones largas");
    });

    await test.step("la base las guardó con saltos simples (500 caracteres) y el reembolso lleva el comentario completo", async () => {
      const reporte = await escenario.leerReporte(c.idReporte);
      expect(reporte).toMatchObject({ estado: "aceptado", observaciones: OBSERVACIONES_LARGAS });
      expect(reporte.observaciones).toHaveLength(500);
      expect(reporte.observaciones).not.toContain("\r");
      expect(await escenario.leerReembolsos(c.idMonitoria)).toEqual([
        expect.objectContaining({ id_pago: c.aprobado.id, motivo: `${BASE} ${OBSERVACIONES_LARGAS}`, estado: "esperando_llave" }),
      ]);
    });
  });
});

// ---------------------------------------------------------------------------
// Rechazar el reporte
// ---------------------------------------------------------------------------
test.describe("Rechazar · el admin asignado rechaza el reporte con observaciones y el Lead las ve en su cita", () => {
  test("la confirmación dice que el desembolso deja de esperar el reporte; con más de 500 caracteres vuelve con el error y lo escrito; al confirmar nada cambia salvo el reporte, el desembolso sigue pendiente, sin reembolsos ni aviso al monitor, y la cita del Lead muestra la decisión con las observaciones", async ({
    page,
    escenario,
  }) => {
    const { admin } = escenario;
    const c = await escenario.caso({ estado: "realizada" });
    const motivo = `El monitor mostró que sí asistió: hay registro de su ingreso <u>${randomUUID().slice(0, 6)}</u>.`;
    await entrarComoAdmin(page, admin);
    await page.goto(`/admin/reportes/${c.idReporte}`);
    await expect(titulo(page, "Resolver el reporte")).toBeVisible(ESPERA);
    await expectSinComision(page, c);

    await test.step("al abrir «Rechazar el reporte» se lee qué pasa: la monitoría sigue igual, el desembolso deja de esperar y la decisión no se deshace", async () => {
      await abrir(page, "Rechazar").click();
      await expect(page.getByText("Opcionales. Hasta 500 caracteres. Quien reportó lo lee en la página de su cita: escríbelo pensando en esa persona.")).toBeVisible();
      const texto = consecuencias(page, "rechazar");
      await expect(texto).toContainText("La monitoría sigue como estaba y no se crea ningún reembolso. El reporte no se puede volver a hacer.");
      // Está dentro de la ventana de reporte: el desembolso se podrá ejecutar cuando termine.
      await expect(texto).toContainText("El desembolso de esta monitoría deja de esperar este reporte: se puede ejecutar cuando termine la ventana de reporte (después del ");
      await expect(texto).toContainText("), si nada más lo bloquea. Quien reportó verá tu decisión y tus observaciones en la página de su cita; no le mandamos correo. Esta decisión no se puede deshacer.");
      await expect(botonDe(page, "rechazar")).toHaveAttribute("aria-describedby", "rechazar-consecuencias");
      await expectSinComision(page, c);
      await expectReglasDelProducto(page, "la confirmación de rechazar abierta");
    });

    await test.step("con 501 caracteres la acción vuelve con el error, conserva lo escrito y no cambia nada", async () => {
      const demasiado = "x".repeat(501);
      // El campo limita lo que se escribe a 500 (y `fill` lo respeta): para que llegue a la acción lo que el navegador no
      // dejaría escribir, se le quita el límite, como haría un cliente que se lo salta.
      await expect(observaciones(page, "rechazar")).toHaveAttribute("maxlength", "500");
      await observaciones(page, "rechazar").evaluate((campo: HTMLTextAreaElement) => campo.removeAttribute("maxlength"));
      await observaciones(page, "rechazar").fill(demasiado);
      await botonDe(page, "rechazar").click();
      await expect(alerta(page, "Las observaciones pueden tener hasta 500 caracteres.")).toBeVisible(ESPERA);
      await expect(observaciones(page, "rechazar")).toHaveValue(demasiado);
      await expect(botonDe(page, "rechazar")).toBeVisible();
      expect((await escenario.leerReporte(c.idReporte)).estado).toBe("en_revision");
      await expectReglasDelProducto(page, "el rechazo con error");
    });

    await test.step("al corregirlo y confirmar, el aviso dice que se rechazó y la página muestra la decisión con las observaciones", async () => {
      await observaciones(page, "rechazar").fill(`${motivo}\n`);
      const soltar = await retenerLaAccion(page);
      await botonDe(page, "rechazar").click();
      // Con la petición en vuelo los dos botones están inactivos y el de rechazar dice «Rechazando…».
      await expectEnviando(page, "Rechazando…");
      expect((await escenario.leerReporte(c.idReporte)).estado).toBe("en_revision");
      soltar();

      await expect(aviso(page, "Rechazaste el reporte")).toHaveText(
        "Rechazaste el reporte. La monitoría sigue como estaba. Quien reportó verá tu decisión en la página de su cita.",
        ESPERA,
      );
      await expect(page).toHaveURL(`/admin/reportes/${c.idReporte}?resuelto=rechazado`);
      await expect(titulo(page, "Reporte rechazado")).toBeVisible();
      await expect(dato(seccion(page, "Reporte"), "Estado")).toHaveText("Rechazado");
      await expect(dato(seccion(page, "Reporte"), "Observaciones")).toHaveText(motivo);
      await expect(dato(seccion(page, "Monitoría"), "Estado")).toHaveText("Realizada");
      await expect(page.locator("form")).toHaveCount(0);
      await expect(page.locator("body u")).toHaveCount(0);
      await expectSinComision(page, c);
      await expectReglasDelProducto(page, "el reporte rechazado");
    });

    await test.step("la base quedó bien: solo cambió el reporte; la monitoría y el desembolso siguen, sin reembolsos y sin aviso al monitor", async () => {
      const reporte = await escenario.leerReporte(c.idReporte);
      expect(reporte).toMatchObject({ estado: "rechazado", id_admin: admin.id, observaciones: motivo });
      expect(reporte.fecha_decision).not.toBeNull();
      expect(await escenario.leerMonitoria(c.idMonitoria)).toMatchObject({ estado: "realizada", motivo_cancelacion: null });
      expect(await escenario.leerDesembolso(c.idMonitoria)).toMatchObject({ estado: "pendiente" });
      expect(await escenario.leerReembolsos(c.idMonitoria)).toEqual([]);
      expect(await escenario.leerEventosDeAviso(c.idMonitoria)).toEqual(["confirmada"]);
    });

    await test.step("el reporte sale de la bandeja y el Lead ve en su cita que no se aceptó, con las observaciones", async () => {
      await page.goto("/admin");
      await expect(contadorDeReportes(page, 0)).toBeVisible(ESPERA);
      await expect(enlaceAlReporte(page, c)).toHaveCount(0);

      await page.goto(`/cita?token=${c.token}`);
      await expect(titulo(page, "Tu monitoría se realizó")).toBeVisible(ESPERA);
      await expect(page.getByText("Un admin revisó tu reporte y no lo aceptó: la monitoría sigue como estaba.")).toBeVisible();
      await expect(page.getByText("Observaciones del admin")).toBeVisible();
      await expect(page.getByText(motivo)).toBeVisible();
      // Un reporte rechazado no se repite: la cita no ofrece reportar otra vez.
      await expect(page.getByRole("button", { name: /reportar/i })).toHaveCount(0);
      await expectReglasDelProducto(page, "la cita del Lead con el reporte rechazado");
    });
  });
});

// ---------------------------------------------------------------------------
// Otro admin: lo ve, no lo resuelve
// ---------------------------------------------------------------------------
test.describe("Otro admin · puede abrir el reporte, pero solo el asignado lo resuelve", () => {
  test("la página dice quién lo tiene asignado y no ofrece ningún formulario; no muestra la comisión", async ({ page, escenario }) => {
    const c = await escenario.caso({ estado: "realizada", conPagoEnRevision: true });
    const otro = await escenario.otroAdmin();
    await entrarComoAdmin(page, otro);

    await page.goto(`/admin/reportes/${c.idReporte}`);
    await expect(titulo(page, "Resolver el reporte")).toBeVisible(ESPERA);
    await expect(dato(seccion(page, "Reporte"), "Reportó")).toHaveText(c.nombreLead);
    await expect(dato(seccion(page, "Reporte"), "Asignado a")).toHaveText(escenario.admin.nombre);
    await expect(page.getByText(`Este reporte lo tiene asignado ${escenario.admin.nombre}: solo esa persona lo resuelve.`)).toBeVisible();
    await expect(page.getByText("Quien agendó dice que el monitor no llegó")).toHaveCount(0);
    await expect(abrir(page, "Aceptar")).toHaveCount(0);
    await expect(abrir(page, "Rechazar")).toHaveCount(0);
    await expect(page.locator("form")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Volver a mi bandeja" })).toBeVisible();
    await expectSinComision(page, c);
    await expectReglasDelProducto(page, "el reporte de otro admin");
    expect((await escenario.leerReporte(c.idReporte)).estado).toBe("en_revision");

    // Y en su bandeja no aparece: los reportes son del admin asignado (RN-63, sin escalamiento).
    await page.goto("/admin");
    await expect(contadorDeReportes(page, 0)).toBeVisible(ESPERA);
    await expect(enlaceAlReporte(page, c)).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Las reglas del producto sobre la página abierta (copia de e2e/casos-p24.spec.ts; de los radios, como de las casillas,
// cuenta su etiqueta, que es lo que se toca: e2e/franjas.spec.ts)
// ---------------------------------------------------------------------------

/** Con el tamaño de la prueba y, si es más ancho, también a 390 px (el ancho de referencia del teléfono). */
async function expectReglasDelProducto(page: Page, donde: string): Promise<void> {
  await expectReglas(page, donde);
  const original = page.viewportSize();
  if (original && original.width > 390) {
    await page.setViewportSize({ width: 390, height: 844 });
    await expectReglas(page, `${donde} (390 px)`);
    await page.setViewportSize(original);
  }
}

async function expectReglas(page: Page, donde: string): Promise<void> {
  const medidas = await medir(page);
  expect(medidas.sinScrollHorizontal, `${donde}: sin scroll horizontal`).toBe(true);
  expect(medidas.desbordados, `${donde}: ningún elemento se sale de la pantalla`).toEqual([]);
  expect(medidas.menorTexto, `${donde}: ningún texto por debajo de 14 px`).toBeGreaterThanOrEqual(14);
  expect(medidas.degradados, `${donde}: sin degradados`).toBe(0);
  expect(medidas.tactilesChicos, `${donde}: áreas táctiles de 44 px o más`).toEqual([]);
  expect(medidas.controlesSinNombre, `${donde}: todo control tiene nombre`).toEqual([]);
}

/** Texto, áreas táctiles, degradados y nombres. De las casillas y los radios cuenta su etiqueta, que también los marca. */
async function medir(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const caja = el.getBoundingClientRect();
      return caja.width > 0 && caja.height > 0;
    };
    const conTexto = [...document.body.querySelectorAll<HTMLElement>("*")].filter(
      (el) => visible(el) && [...el.childNodes].some((nodo) => nodo.nodeType === Node.TEXT_NODE && nodo.textContent?.trim()),
    );
    const controles = [...document.querySelectorAll<HTMLElement>("a, button, select, input:not([type=hidden]), textarea, summary")].filter(visible);
    // Los enlaces dentro de una frase son texto corrido: quedan fuera.
    const tocables = controles
      .filter((el) => !(el.tagName === "A" && el.closest("label, p")))
      .map((el) => (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? (el.labels?.[0] ?? el) : el));
    // `html` y `body` llevan `overflow-x: hidden` (globals.css): el scroll horizontal nunca aparece aunque el contenido se
    // desborde, así que `scrollWidth` de la página no lo delata. Se mide cada elemento a la vista: que su caja no se salga de
    // la ventana y que su contenido (un texto largo sin espacios, por ejemplo) no se salga de su propia caja.
    const ancho = window.innerWidth;
    const desbordados = [...document.body.querySelectorAll<HTMLElement>("*")]
      .filter((el) => visible(el) && !el.closest("nextjs-portal"))
      .flatMap((el) => {
        const caja = el.getBoundingClientRect();
        const fueraDeLaVentana = caja.right > ancho + 1 || caja.left < -1;
        const contenidoFueraDeSuCaja = el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1;
        if (!fueraDeLaVentana && !contenidoFueraDeSuCaja) return [];
        return [
          {
            elemento: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}`,
            texto: (el.textContent ?? "").trim().slice(0, 40),
            izquierda: Math.round(caja.left),
            derecha: Math.round(caja.right),
            anchoDeLaCaja: el.clientWidth,
            anchoDelContenido: el.scrollWidth,
          },
        ];
      });
    return {
      sinScrollHorizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      desbordados,
      menorTexto: Math.min(...conTexto.map((el) => parseFloat(getComputedStyle(el).fontSize))),
      degradados: [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el).backgroundImage.includes("gradient")).length,
      tactilesChicos: tocables
        .map((el) => ({ texto: (el.textContent || el.id || el.tagName).trim().slice(0, 40), alto: Math.round(el.getBoundingClientRect().height) }))
        .filter((el) => el.alto < 44),
      controlesSinNombre: controles
        .filter((el) => {
          const etiquetas = (el as HTMLInputElement).labels?.length ?? 0;
          return !(el.textContent?.trim() || el.getAttribute("aria-label") || etiquetas);
        })
        .map((el) => el.outerHTML.slice(0, 80)),
    };
  });
}
