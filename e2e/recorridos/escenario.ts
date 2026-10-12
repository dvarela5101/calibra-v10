import { randomInt, randomUUID } from "node:crypto";
import type { Browser, BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import { diaDelNegocio, formatearDiaConSemana } from "../../src/lib/fechas";
import { formatearPesos } from "../../src/lib/moneda";
import {
  enviarCredenciales,
  esperarSesion,
  exigirSupabaseLocal,
  expect,
  test as base,
  usarTurnstileDePrueba,
  type Cuenta,
} from "../utilidades";
import { borrarCorreosDe } from "./procesos";
import { expectReglasDelProducto } from "./reglas";

// HU-048: lo que comparten los recorridos de punta a punta. Por la base, con la llave secreta, solo la preparación:
// la materia, el monitor certificado con su llave, el admin de la prueba y la franja. Todo lo demás pasa por las
// pantallas. Al terminar, bien o mal, se borra lo que el recorrido creó, y la prueba falla si no se puede.

export const ESPERA = { timeout: 20_000 };
const MINUTO_MS = 60_000;
export const PRECIO = 36_000;
const DURACION_MIN = 30;

// Un PNG mínimo: la app mira la firma de los primeros bytes (HU-059).
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);

/** Texto con los espacios duros (los pesos los llevan) como espacios normales. */
export const normalizar = (texto: string) => texto.replace(/\s/g, " ");
export const pesos = (monto: number) => normalizar(formatearPesos(monto));

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function diaIso(fecha: string): number {
  const dia = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  return dia === 0 ? 7 : dia;
}

/**
 * La sesión que empezó hace 90 minutos (de `e2e/finalizar.spec.ts`). Bogotá es UTC-5 todo el año, así que correr el
 * reloj 5 horas da la fecha y la hora de pared sin depender de la zona de la máquina. La franja termina el mismo día:
 * si falta poco para la medianoche, se acorta.
 */
export function sesionQueYaEmpezo(): {
  fecha: string;
  hora: string;
  duracionMin: number;
} {
  const inicioMs = Math.floor((Date.now() - 90 * MINUTO_MS) / MINUTO_MS) * MINUTO_MS;
  const pared = new Date(inicioMs - 5 * 60 * MINUTO_MS).toISOString();
  const minutosDelDia = Number(pared.slice(11, 13)) * 60 + Number(pared.slice(14, 16));
  return {
    fecha: pared.slice(0, 10),
    hora: pared.slice(11, 16),
    duracionMin: Math.min(DURACION_MIN, 24 * 60 - minutosDelDia),
  };
}

// Selectores compartidos.
export const titulo = (page: Page, nombre: string) => page.getByRole("heading", { level: 1, name: nombre });
export const dato = (zona: Page | Locator, etiqueta: string): Locator =>
  zona.locator("dt", { hasText: new RegExp(`^${etiqueta}$`) }).locator("xpath=following-sibling::dd[1]");
export const aviso = (page: Page, texto: string) => page.getByRole("status").filter({ hasText: texto });
export const tarjetaDeMonitor = (page: Page, nombre: string) => page.getByRole("region", { name: nombre });

export type Preparacion = {
  materia: { id: string; nombre: string; codigo: string };
  monitor: Cuenta;
  admin: Cuenta;
  franja: { id: string; hora: string; duracionMin: number; lugar: string };
  /** El día de la sesión que empezó hace 90 minutos, y el de la reserva: una semana después, en la misma franja. */
  sesion: { fecha: string };
  fechaDeLaReserva: string;
  /** El correo y el celular del Lead (10 cifras, sin indicativo), únicos por recorrido. */
  correoDelLead: string;
  telefonoDelLead: string;
};

export type Recorrido = Preparacion & {
  cliente: import("@supabase/supabase-js").SupabaseClient;
  /** El navegador del visitante: anónimo, con el stub de Turnstile (es el `page` de la prueba). */
  visitante: Page;
  /** Anota la sesión anónima del visitante para que `cuentas` la borre al final. */
  anotarSesion(id: string): void;
  /** Un navegador nuevo, al ancho del proyecto, con la sesión de esa cuenta ya iniciada. */
  entrar(cuenta: Cuenta, ruta: string): Promise<Page>;
  /** Un navegador nuevo sin sesión y sin alta anónima (para la lista de monitores o el enlace de un correo). */
  sinSesion(): Promise<Page>;
  /** Mueve la fecha de la monitoría: el salto de reloj de cada recorrido (ver notas de HU-048). */
  moverA(idMonitoria: string, fecha: string): Promise<void>;
  /** Pasa el pago o el reporte al admin de la prueba: `registrar_pago` y el reporte los asignan al primer admin activo. */
  asignarPago(idPago: string): Promise<void>;
  asignarReporte(idReporte: string): Promise<void>;
  /** Lee una fila con la llave secreta. */
  una<T>(tabla: string, columnas: string, filtro: Record<string, string>): Promise<T>;
  varias<T>(tabla: string, columnas: string, filtro: Record<string, string>): Promise<T[]>;
};

/** La ventana de este proyecto: 390x844 o 1440x900. */
function opcionesDeContexto(info: TestInfo) {
  const { baseURL, viewport } = info.project.use;
  return {
    baseURL,
    viewport: viewport ?? undefined,
    locale: "es-CO",
    timezoneId: "America/Bogota",
  };
}

export const test = base.extend<{ recorrido: Recorrido }>({
  recorrido: async ({ cuentas, page, browser }, entregar, info) => {
    exigirSupabaseLocal();
    const cliente = cuentas.cliente;
    const contextos: BrowserContext[] = [];
    const creados = { materias: [] as string[], franjas: [] as string[] };
    // Lo que la limpieza necesita aunque la preparación se corte a medias.
    const correoDelLead = `recorrido-${randomUUID()}@calibra.test`;
    const correos: string[] = [correoDelLead];
    const cuentasCreadas: { monitor?: string; admin?: string } = {};

    async function preparar(): Promise<Preparacion> {
      const materia = {
        nombre: `Materia recorrido ${randomUUID().slice(0, 6)}`,
        codigo: `REC-${randomUUID().slice(0, 12)}`,
      };
      const { data: m, error: em } = await cliente.from("materia").insert(materia).select("id").single();
      if (em) throw new Error(`insertar materia: ${em.message}`);
      creados.materias.push(m.id);
      const monitor = await cuentas.crearMonitor();
      cuentasCreadas.monitor = monitor.id;
      correos.push(monitor.correo);
      const admin = await cuentas.crearAdmin();
      cuentasCreadas.admin = admin.id;
      correos.push(admin.correo);
      const { error: ec } = await cliente.from("certificado").insert({
        id_monitor: monitor.id,
        id_materia: m.id,
        id_admin: admin.id,
      });
      if (ec) throw new Error(`insertar certificado: ${ec.message}`);
      const sesion = sesionQueYaEmpezo();
      const lugar = `Salón recorrido ${randomUUID().slice(0, 4)}`;
      const { data: f, error: ef } = await cliente
        .from("franja")
        .insert({
          id_monitor: monitor.id,
          dia: diaIso(sesion.fecha),
          hora: sesion.hora,
          duracion_min: sesion.duracionMin,
          presencial: true,
          precio: PRECIO,
          lugar,
          enlace: null,
        })
        .select("id")
        .single();
      if (ef) throw new Error(`insertar franja: ${ef.message}`);
      creados.franjas.push(f.id);
      return {
        materia: { id: m.id, ...materia },
        monitor,
        admin,
        franja: {
          id: f.id,
          hora: sesion.hora,
          duracionMin: sesion.duracionMin,
          lugar,
        },
        sesion: { fecha: sesion.fecha },
        fechaDeLaReserva: sumarDias(sesion.fecha, 7),
        correoDelLead,
        telefonoDelLead: `3${String(randomInt(0, 1_000_000_000)).padStart(9, "0")}`,
      };
    }

    async function nuevoContexto(): Promise<BrowserContext> {
      const contexto = await (browser as Browser).newContext(opcionesDeContexto(info));
      await usarTurnstileDePrueba(contexto);
      contextos.push(contexto);
      return contexto;
    }

    const actualizar = async (contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await consulta;
      if (error) throw new Error(`${contexto}: ${error.message}`);
    };

    let preparacion: Preparacion;
    try {
      preparacion = await preparar();
    } catch (error) {
      // Si la preparación se cortó a medias, se borra lo que alcanzó a crear antes de fallar.
      await limpiar().catch(() => undefined);
      throw error;
    }
    await entregar({
      ...preparacion,
      cliente,
      visitante: page,
      anotarSesion: (id) => cuentas.borrarAlFinal(id),
      async entrar(cuenta, ruta) {
        const pagina = await (await nuevoContexto()).newPage();
        await pagina.goto(ruta);
        await expect(pagina).toHaveURL(/\/ingresar\?siguiente=/, ESPERA);
        await enviarCredenciales(pagina, cuenta.correo, cuenta.contrasena);
        await expect(pagina).toHaveURL(ruta, ESPERA);
        return pagina;
      },
      async sinSesion() {
        const pagina = await (await nuevoContexto()).newPage();
        await pagina.route("**/auth/v1/signup", (ruta) => ruta.abort());
        return pagina;
      },
      moverA: (idMonitoria, fecha) => actualizar("mover la monitoría", cliente.from("monitoria").update({ fecha }).eq("id", idMonitoria)),
      // Los triggers de pago miran solo `update of estado`: este cambio no dispara ninguno.
      asignarPago: (idPago) =>
        actualizar("asignar el pago", cliente.from("pago").update({ id_admin: preparacion.admin.id }).eq("id", idPago)),
      asignarReporte: (idReporte) =>
        actualizar(
          "asignar el reporte",
          cliente.from("reporte_inasistencia").update({ id_admin: preparacion.admin.id }).eq("id", idReporte),
        ),
      async una(tabla, columnas, filtro) {
        const filas = await this.varias(tabla, columnas, filtro);
        expect(filas, `una fila de ${tabla} con ${JSON.stringify(filtro)}`).toHaveLength(1);
        return filas[0] as never;
      },
      async varias(tabla, columnas, filtro) {
        let consulta = cliente.from(tabla).select(columnas);
        for (const [columna, valor] of Object.entries(filtro)) consulta = consulta.eq(columna, valor);
        const { data, error } = await consulta;
        if (error) throw new Error(`leer ${tabla}: ${error.message}`);
        return (data ?? []) as never[];
      },
    });

    await limpiar();

    // Limpieza, antes de que `cuentas` borre las cuentas y las sesiones. De las filas que dependen hacia lo demás:
    // reembolsos (no caen con el pago), reportes y desembolsos (no caen con la monitoría), pagos, comprobantes del
    // bucket (por su API) y sus revisados, monitorías (avisos, confirmaciones y cancelaciones caen con ellas), Leads,
    // franjas, certificados, materias, la bandeja de salida y los correos de Mailpit. Se intenta todo y se avisa de lo
    // que falle.
    async function limpiar(): Promise<void> {
      for (const contexto of contextos) await contexto.close().catch(() => undefined);
      const fallos: string[] = [];
      const borrar = async (contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) => {
        const { error } = await consulta;
        if (error) fallos.push(`${contexto}: ${error.message}`);
      };
      const ids = async (tabla: string, columna: string, valores: string[]) => {
        if (valores.length === 0) return [];
        const { data, error } = await cliente.from(tabla).select("id").in(columna, valores);
        if (error) fallos.push(`buscar ${tabla}: ${error.message}`);
        return ((data ?? []) as { id: string }[]).map((f) => f.id);
      };
      const monitorias = await ids("monitoria", "id_franja", creados.franjas);
      const pagos = await ids("pago", "id_monitoria", monitorias);
      const rutas = new Set<string>();
      if (pagos.length) {
        const { data, error } = await cliente.from("pago").select("comprobante").in("id", pagos);
        if (error) fallos.push(`buscar comprobantes: ${error.message}`);
        for (const { comprobante } of (data ?? []) as { comprobante: string }[]) rutas.add(comprobante);
        await borrar("reembolsos", cliente.from("reembolso").delete().in("id_pago", pagos));
      }
      if (monitorias.length) {
        await borrar("reportes", cliente.from("reporte_inasistencia").delete().in("id_monitoria", monitorias));
        await borrar("desembolsos", cliente.from("desembolso").delete().in("id_monitoria", monitorias));
        await borrar("pagos", cliente.from("pago").delete().in("id_monitoria", monitorias));
      }
      const { data: leads, error: errorLeads } = await cliente.from("lead").select("id, id_sesion_anonima").eq("correo", correoDelLead);
      if (errorLeads) fallos.push(`buscar leads: ${errorLeads.message}`);
      for (const { id_sesion_anonima: sesion } of (leads ?? []) as {
        id_sesion_anonima: string | null;
      }[]) {
        if (!sesion) continue;
        const { data, error } = await cliente.storage.from("comprobantes").list(sesion, { limit: 100 });
        if (error) fallos.push(`listar comprobantes de ${sesion}: ${error.message}`);
        for (const archivo of data ?? []) rutas.add(`${sesion}/${archivo.name}`);
      }
      if (rutas.size) {
        const { error } = await cliente.storage.from("comprobantes").remove([...rutas]);
        if (error) fallos.push(`comprobantes del Storage: ${error.message}`);
        await borrar(
          "comprobantes revisados",
          cliente
            .from("comprobante_revisado")
            .delete()
            .in("ruta", [...rutas]),
        );
      }
      if (monitorias.length) await borrar("monitorías", cliente.from("monitoria").delete().in("id", monitorias));
      await borrar("leads", cliente.from("lead").delete().eq("correo", correoDelLead));
      if (creados.franjas.length) await borrar("franjas", cliente.from("franja").delete().in("id", creados.franjas));
      if (cuentasCreadas.monitor)
        await borrar("certificados", cliente.from("certificado").delete().eq("id_monitor", cuentasCreadas.monitor));
      if (creados.materias.length) await borrar("materias", cliente.from("materia").delete().in("id", creados.materias));
      await borrar("bandeja de salida", cliente.from("correo_envio").delete().in("destinatario", correos));
      // El turno de revisión (RN-07) reparte los pagos, reembolsos y reportes nuevos entre todos los admins activos, también
      // los de otros recorridos que corren a la vez. Si alguno le quedó a este admin, pasa a uno que no es de prueba (el de
      // menor orden): sin eso, `cuentas` no podría borrarlo. El recorrido dueño del caso lo vuelve a pasar a su admin.
      const propio = cuentasCreadas.admin;
      if (propio) {
        const { data: otros } = await cliente.from("admin").select("id").neq("id", propio).order("orden_revision").limit(1);
        const destino = (otros as { id: string }[] | null)?.[0]?.id;
        for (const tabla of destino ? ["pago", "reembolso", "reporte_inasistencia"] : []) {
          await borrar(`casos ajenos en ${tabla}`, cliente.from(tabla).update({ id_admin: destino }).eq("id_admin", propio));
        }
      }
      await borrarCorreosDe(correos).catch((error: unknown) => fallos.push(`Mailpit: ${String(error)}`));
      if (fallos.length) throw new Error(`No se pudo limpiar lo que creó el recorrido:\n${fallos.join("\n")}`);
    }
  },
});

export { expect, expectReglasDelProducto };

// ---------------------------------------------------------------------------
// Tramos que comparten los recorridos
// ---------------------------------------------------------------------------

const RESERVA = /\/agendar\/reserva\/([0-9a-f-]{36})$/;

/**
 * Criterio 1: el visitante sin sesión de Lead agenda desde la lista de la materia, deja su contacto, aparta la fecha y
 * adjunta el comprobante. Devuelve el id de la monitoría y su sesión anónima. Mide cada pantalla que abre.
 */
export async function agendarYPagar(r: Recorrido): Promise<{ idMonitoria: string; idSesion: string }> {
  const page = r.visitante;
  let idSesion = "";
  await test.step("criterio 1: desde la lista de monitores de la materia, toca Agendar en la fecha", async () => {
    await page.goto(`/monitores?materia=${encodeURIComponent(r.materia.codigo)}`);
    await page.waitForLoadState("networkidle");
    // La sesión anónima nace en el navegador; la fixture `cuentas` la borra al final.
    idSesion = (await esperarSesion(page.context())).id;
    r.anotarSesion(idSesion);
    await expectReglasDelProducto(page, "lista de monitores");
    await tarjetaDeMonitor(page, r.monitor.nombre)
      .getByRole("link", {
        name: new RegExp(formatearDiaConSemana(r.fechaDeLaReserva)),
      })
      .click();
    await expect(titulo(page, "Confirma tu monitoría")).toBeVisible(ESPERA);
    await expectReglasDelProducto(page, "confirmar");
  });

  await test.step("criterio 1: deja nombre, correo y la autorización, y vuelve a confirmar", async () => {
    await page.getByRole("link", { name: "Dejar mis datos y seguir" }).click();
    await expect(titulo(page, "Tus datos para agendar")).toBeVisible(ESPERA);
    await page.waitForLoadState("networkidle");
    await expectReglasDelProducto(page, "contacto");
    await page.getByLabel("Tu nombre", { exact: true }).fill("Lead del recorrido");
    await page.getByLabel("Tu correo", { exact: true }).fill(r.correoDelLead);
    await page.getByLabel("Tu teléfono (opcional)").fill(r.telefonoDelLead);
    await page.getByLabel(/^Autorizo a Calibra a tratar mis datos personales/).check();
    await page.getByRole("button", { name: "Seguir" }).click();
    await expect(titulo(page, "Confirma tu monitoría")).toBeVisible(ESPERA);
    await expect(page.getByRole("link", { name: "Dejar mis datos y seguir" })).toHaveCount(0);
  });

  let idMonitoria = "";
  await test.step("criterio 1: aparta la fecha y adjunta el comprobante: la monitoría queda confirmada", async () => {
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Apartar esta fecha" }).click();
    await expect(page).toHaveURL(RESERVA, ESPERA);
    idMonitoria = RESERVA.exec(page.url())![1];
    await expect(titulo(page, "Apartamos tu fecha")).toBeVisible(ESPERA);
    expect(
      await r.una<{ estado: string }>("monitoria", "estado", {
        id: idMonitoria,
      }),
    ).toEqual({ estado: "pendiente_pago" });
    await page.waitForLoadState("networkidle");
    await expectReglasDelProducto(page, "reserva");

    await page.getByLabel("Comprobante de la transferencia").setInputFiles({
      name: "comprobante.png",
      mimeType: "image/png",
      buffer: PNG,
    });
    await page.getByRole("button", { name: "Enviar comprobante" }).click();
    await expect(titulo(page, "Tu monitoría está confirmada")).toBeVisible(ESPERA);
    await expect(aviso(page, "Recibimos tu comprobante de pago.")).toBeVisible();

    expect(
      await r.una<{ estado: string }>("monitoria", "estado", {
        id: idMonitoria,
      }),
    ).toEqual({ estado: "confirmada" });
    const pago = await r.una<{
      estado: string;
      monto: number;
      comprobante: string;
    }>("pago", "estado, monto, comprobante", { id_monitoria: idMonitoria });
    expect(pago).toMatchObject({ estado: "en_revision", monto: PRECIO });
    expect(pago.comprobante).toMatch(/\.png$/);
  });
  return { idMonitoria, idSesion };
}

/** El pago de una monitoría, pasado al admin de la prueba. */
export async function pagoAsignado(r: Recorrido, idMonitoria: string): Promise<{ id: string; nombre_pagador: string }> {
  const pago = await r.una<{ id: string; nombre_pagador: string }>("pago", "id, nombre_pagador", { id_monitoria: idMonitoria });
  await r.asignarPago(pago.id);
  return pago;
}

/** El admin abre el pago desde «Pagos por revisar» de su bandeja. */
export async function abrirPagoDesdeLaBandeja(admin: Page, pago: { id: string; nombre_pagador: string }): Promise<void> {
  await admin.goto("/admin");
  const region = admin.getByRole("region", { name: /Pagos por revisar/ });
  await region.getByRole("list", { name: "Asignados a ti" }).locator(`a[href="/admin/pagos/${pago.id}"]`).click();
  await expect(admin).toHaveURL(`/admin/pagos/${pago.id}`, ESPERA);
  await expect(titulo(admin, "Revisar el pago")).toBeVisible(ESPERA);
}

/** Hoy en Bogotá. */
export const hoy = () => diaDelNegocio(new Date());
