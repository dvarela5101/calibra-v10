import { randomUUID } from "node:crypto";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { diaDelNegocio } from "../src/lib/fechas";
import {
  enlaceDeConfirmacion,
  enviarCredenciales,
  esperarSesion,
  leerSesion,
  contrasenaAleatoria,
  correoUnico,
  expect,
  test as base,
  usarTurnstileDePrueba,
  variable,
  cookiesDeSesion,
  type Cuenta,
  type SesionEnCookie,
} from "./utilidades";

// HU-032 (RN-02, RN-12): crear la cuenta de Estudiante sin perder diagnósticos ni citas. Corre contra el Supabase local
// (Auth con las confirmaciones encendidas, base y Mailpit) con visitantes, Leads, citas y cuentas que crea y borra cada
// prueba. Se prueba a 390 y a 1280 px (los dos proyectos).
//
// - Cada navegador que abre una página pública gasta una sesión anónima del Auth local (150 por hora): cada prueba usa una
//   como máximo. `/ingresar`, `/cita`, `/privacidad` y las tres páginas de /cuenta/confirmar y /cuenta/contrasena viven fuera
//   de `(publico)` y no la crean; los contextos nuevos que solo inician sesión no gastan ninguna.
// - La cita se siembra con la llave secreta: se aparta `pendiente_pago` y se confirma con un UPDATE (e2e/cita.spec.ts).
// - html y body llevan `overflow-x: hidden` (globals.css): scrollWidth del documento nunca delata un desborde, así que se mide
//   por elemento, como e2e/resolver-reportes.spec.ts.
// - Cerrar las demás sesiones (criterio 5) cierra su renovación, no su token de acceso: ese sigue leyendo hasta `jwt_expiry`,
//   en local igual que en la nube (README, «Cuenta de Estudiante»). La prueba lo verifica con el token de renovación.

const ESPERA = { timeout: 20_000 };
const LARGA = { timeout: 45_000 };

const AUTORIZO = /Autorizo a Calibra a tratar mis datos personales/;
const ASUNTO_DE_LA_CUENTA = "Confirma tu correo para crear tu cuenta de Calibra";
const ASUNTO_DE_VERIFICACION = "Confirma tu correo para agendar en Calibra";
const INVITACION = "Crea tu cuenta para ver tus citas desde cualquier dispositivo.";
const CORREO_FIJO = "Tu correo es el de tu cuenta y no se puede cambiar aquí. Si necesitas cambiarlo, escribe a soporte.";
const TITULO_CONFIRMAR = "Confirma que este correo es tuyo";
const TITULO_SIN_ENLACE = "Este enlace ya no sirve";
const PRECIO = 25_000;

// ---------------------------------------------------------------------------
// Fechas (America/Bogota)
// ---------------------------------------------------------------------------
function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Día ISO (1 = lunes ... 7 = domingo) de un día de calendario, como `franja.dia`. */
function diaIso(fecha: string): number {
  const d = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

// ---------------------------------------------------------------------------
// Fixture `datos`: Leads, citas y cuentas de la prueba, que se borran al terminar
// ---------------------------------------------------------------------------
type FilaDeLead = { id: string; nombre: string; correo: string; estado: string; id_sesion_anonima: string | null };
type CitaSembrada = { id: string; materia: string };

type Datos = {
  /** Un correo que solo existe en esta prueba: su buzón se vacía al terminar. */
  correo(): string;
  /** Espera la sesión anónima que el navegador recibe al abrir una página pública, y la borra al terminar. */
  sesion(context: BrowserContext): Promise<SesionEnCookie>;
  /** Un Lead; de una sesión si se le pasa `idSesion` (como si hubiera dejado su contacto al agendar, HU-068). */
  crearLead(opciones?: { idSesion?: string | null; correo?: string; nombre?: string }): Promise<FilaDeLead>;
  /** Una cita confirmada de ese Lead. */
  cita(idLead: string): Promise<CitaSembrada>;
  /** Un diagnóstico terminado de la sesión (todavía sin Lead, como los de P-33). */
  diagnostico(idSesion: string): Promise<{ id: string }>;
  /** El Lead al que quedó ligado un diagnóstico. */
  leadDelDiagnostico(id: string): Promise<string | null>;
  /** Una cuenta de Estudiante completa: usuario con contraseña, su Lead y la fila de `estudiante`. */
  crearEstudiante(): Promise<{ cuenta: Cuenta; lead: FilaDeLead }>;
  estudiantesDe(id: string): Promise<{ id: string; id_lead: string }[]>;
  leadsDeSesion(idSesion: string): Promise<FilaDeLead[]>;
  lead(id: string): Promise<FilaDeLead>;
  /** El usuario de Auth, tal como lo ve la llave secreta. */
  usuario(id: string): Promise<{ id: string; is_anonymous?: boolean; email?: string; new_email?: string }>;
  /** Los correos del buzón para un destinatario. */
  asuntosA(correo: string): Promise<string[]>;
};

const test = base.extend<{ datos: Datos }>({
  datos: async ({ cuentas }, entregar) => {
    const cliente = cuentas.cliente;
    const correos: string[] = [];
    const sesiones: string[] = [];
    const estudiantes: string[] = [];
    const leads: string[] = [];
    const monitores: string[] = [];
    const materias: string[] = [];
    const monitorias: string[] = [];
    const diagnosticos: string[] = [];
    const evaluaciones: string[] = [];
    let idAdmin: string | undefined;

    async function insertar(tabla: string, fila: Record<string, unknown>) {
      const { data, error } = await cliente.from(tabla).insert(fila).select().single();
      if (error) throw new Error(`insertar ${tabla}: ${error.message}`);
      return data as { id: string };
    }

    async function crearLead(opciones: { idSesion?: string | null; correo?: string; nombre?: string } = {}): Promise<FilaDeLead> {
      const correo = opciones.correo ?? `lead-${randomUUID()}@calibra.test`;
      correos.push(correo);
      const { data, error } = await cliente
        .from("lead")
        .insert({
          id_sesion_anonima: opciones.idSesion ?? null,
          nombre: opciones.nombre ?? `Lead e2e cuenta ${randomUUID().replaceAll("-", "").slice(0, 8)}`,
          correo,
          acepta_tratamiento_datos: true,
          fecha_consentimiento: new Date().toISOString(),
        })
        .select("id, nombre, correo, estado, id_sesion_anonima")
        .single();
      if (error) throw new Error(`insertar lead: ${error.message}`);
      leads.push(data.id as string);
      return data as FilaDeLead;
    }

    await entregar({
      correo() {
        const correo = correoUnico();
        correos.push(correo);
        return correo;
      },
      async sesion(context) {
        const sesion = await esperarSesion(context);
        cuentas.borrarAlFinal(sesion.id);
        sesiones.push(sesion.id);
        return sesion;
      },
      crearLead,
      async cita(idLead) {
        const fecha = sumarDias(diaDelNegocio(new Date()), 5);
        idAdmin ??= (await cuentas.crearAdmin()).id;
        const monitor = await cuentas.crearMonitor();
        monitores.push(monitor.id);
        const nombreMateria = `Materia e2e cuenta ${randomUUID().slice(0, 6)}`;
        const materia = await insertar("materia", { nombre: nombreMateria, codigo: `E2E-${randomUUID().slice(0, 12)}` });
        materias.push(materia.id);
        await insertar("certificado", { id_monitor: monitor.id, id_materia: materia.id, id_admin: idAdmin });
        const franja = await insertar("franja", {
          id_monitor: monitor.id,
          dia: diaIso(fecha),
          hora: "10:00",
          duracion_min: 60,
          presencial: true,
          precio: PRECIO,
          lugar: `Edificio e2e ${randomUUID().slice(0, 6)}, salón 301`,
          enlace: null,
        });
        // Se aparta pendiente de pago y se confirma con un UPDATE, como `registrar_pago`: es lo que anota la confirmación.
        const monitoria = await insertar("monitoria", {
          id_franja: franja.id,
          id_monitor: monitor.id,
          id_materia: materia.id,
          id_lead: idLead,
          fecha,
          valor_total: PRECIO,
          estado: "pendiente_pago",
        });
        monitorias.push(monitoria.id);
        const { error } = await cliente.from("monitoria").update({ estado: "confirmada" }).eq("id", monitoria.id);
        if (error) throw new Error(`confirmar la monitoría: ${error.message}`);
        // Su correo de confirmación no es de esta prueba: se deja como procesado para que ningún proceso lo mande.
        await cliente.from("confirmacion_cita").update({ procesado_en: new Date().toISOString() }).eq("id_monitoria", monitoria.id).is("procesado_en", null);
        return { id: monitoria.id, materia: nombreMateria };
      },
      async diagnostico(idSesion) {
        const materia = await insertar("materia", { nombre: `Materia e2e cuenta ${randomUUID().slice(0, 6)}`, codigo: `E2E-${randomUUID().slice(0, 12)}` });
        materias.push(materia.id);
        const evaluacion = await insertar("evaluacion", { id_materia: materia.id, semana: 1, nombre: "Parcial e2e" });
        evaluaciones.push(evaluacion.id);
        const diagnostico = await insertar("diagnostico", {
          id_sesion_anonima: idSesion,
          id_evaluacion: evaluacion.id,
          id_materia: materia.id,
          respuestas: [{ clave: "P1" }, { clave: "P2" }],
          puntaje: 50,
          resultado_por_habilidad: { habilidades: [], errores: [], prerrequisitos: [] },
          semilla: 1,
          aciertos: 1,
        });
        diagnosticos.push(diagnostico.id);
        return diagnostico;
      },
      async leadDelDiagnostico(id) {
        const { data, error } = await cliente.from("diagnostico").select("id_lead").eq("id", id).single();
        if (error) throw new Error(`leer el diagnóstico: ${error.message}`);
        return (data as { id_lead: string | null }).id_lead;
      },
      async crearEstudiante() {
        const cuenta: Cuenta = { id: "", correo: `estudiante-${randomUUID()}@calibra.test`, contrasena: contrasenaAleatoria(), nombre: "Estudiante e2e" };
        const { data, error } = await cliente.auth.admin.createUser({ email: cuenta.correo, password: cuenta.contrasena, email_confirm: true });
        if (error) throw error;
        cuenta.id = data.user.id;
        cuentas.borrarAlFinal(cuenta.id);
        // El Lead de la cuenta lleva el correo de la cuenta (D-55 b), como lo deja `crear_estudiante`.
        const lead = await crearLead({ idSesion: cuenta.id, correo: cuenta.correo, nombre: cuenta.nombre });
        await insertar("estudiante", { id: cuenta.id, id_lead: lead.id });
        estudiantes.push(cuenta.id);
        return { cuenta, lead };
      },
      async estudiantesDe(id) {
        const { data, error } = await cliente.from("estudiante").select("id, id_lead").eq("id", id);
        if (error) throw new Error(`leer estudiante: ${error.message}`);
        return data as { id: string; id_lead: string }[];
      },
      async leadsDeSesion(idSesion) {
        const { data, error } = await cliente.from("lead").select("id, nombre, correo, estado, id_sesion_anonima").eq("id_sesion_anonima", idSesion);
        if (error) throw new Error(`leer Leads por sesión: ${error.message}`);
        return data as FilaDeLead[];
      },
      async lead(id) {
        const { data, error } = await cliente.from("lead").select("id, nombre, correo, estado, id_sesion_anonima").eq("id", id).single();
        if (error) throw new Error(`leer el Lead: ${error.message}`);
        return data as FilaDeLead;
      },
      async usuario(id) {
        const { data, error } = await cliente.auth.admin.getUserById(id);
        if (error) throw error;
        return data.user as unknown as { id: string; is_anonymous?: boolean; email?: string; new_email?: string };
      },
      async asuntosA(correo) {
        const busqueda = await fetch(`${variable("MAILPIT_URL")}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
        const { messages } = (await busqueda.json()) as { messages?: { Subject: string }[] };
        return (messages ?? []).map((mensaje) => mensaje.Subject);
      },
    });

    // Limpieza, antes de que la fixture `cuentas` borre a los usuarios (al borrar una sesión, su Lead ya no se encontraría
    // por ella): de las filas que dependen hacia las que no. Se intenta todo y se avisa de lo que falle.
    const fallos: string[] = [];
    const borrar = async (contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await consulta;
      if (error) fallos.push(`${contexto}: ${error.message}`);
    };
    // Los Estudiantes que se crearon por el navegador no pasaron por esta fixture: se buscan por sesión y por Lead.
    const idsDeSesiones = [...new Set([...sesiones, ...estudiantes])];
    // Un usuario anónimo con diagnósticos no se borra (`diagnostico_tiene_dueno`): primero los diagnósticos.
    if (diagnosticos.length) await borrar("diagnósticos", cliente.from("diagnostico").delete().in("id", diagnosticos));
    if (idsDeSesiones.length) await borrar("estudiantes", cliente.from("estudiante").delete().in("id", idsDeSesiones));
    if (leads.length) {
      const { data: ligados } = await cliente.from("estudiante").select("id").in("id_lead", leads);
      const sueltos = ((ligados as { id: string }[] | null) ?? []).map((fila) => fila.id);
      if (sueltos.length) await borrar("estudiantes de los Leads", cliente.from("estudiante").delete().in("id", sueltos));
    }
    if (monitorias.length) await borrar("monitorías", cliente.from("monitoria").delete().in("id", monitorias));
    if (monitores.length) {
      await borrar("franjas", cliente.from("franja").delete().in("id_monitor", monitores));
      await borrar("certificados", cliente.from("certificado").delete().in("id_monitor", monitores));
    }
    if (evaluaciones.length) await borrar("evaluaciones", cliente.from("evaluacion").delete().in("id", evaluaciones));
    if (materias.length) await borrar("materias", cliente.from("materia").delete().in("id", materias));
    // Los Leads de la prueba, los creados por la sesión del navegador y los de los correos; con sus enlaces y sus sesiones ligadas.
    const ids = new Set(leads);
    if (idsDeSesiones.length) {
      const { data } = await cliente.from("lead").select("id").in("id_sesion_anonima", idsDeSesiones);
      for (const { id } of (data as { id: string }[] | null) ?? []) ids.add(id);
    }
    if (correos.length) {
      const { data } = await cliente.from("lead").select("id").in("correo", correos);
      for (const { id } of (data as { id: string }[] | null) ?? []) ids.add(id);
      await borrar("registro de correos", cliente.from("correo_envio").delete().in("destinatario", correos));
    }
    if (ids.size) {
      const { data: enlaces } = await cliente.from("verificacion_lead").select("id").in("id_lead", [...ids]);
      const claves = ((enlaces as { id: string }[] | null) ?? []).map(({ id }) => `verificacion_lead:${id}`);
      if (claves.length) await borrar("correo_envio por clave", cliente.from("correo_envio").delete().in("clave", claves));
      await borrar("leads", cliente.from("lead").delete().in("id", [...ids]));
    }
    for (const correo of correos) {
      await fetch(`${variable("MAILPIT_URL")}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`, { method: "DELETE" }).catch((error: unknown) =>
        fallos.push(`buzón de ${correo}: ${String(error)}`),
      );
    }
    if (fallos.length) throw new Error(`No se pudo limpiar lo que creó la prueba:\n${fallos.join("\n")}`);
  },
});

test.describe.configure({ mode: "default", timeout: 120_000 });

const alerta = (page: Page, texto: string) => page.getByRole("alert").filter({ hasText: texto });
const estado = (page: Page, texto: string) => page.getByRole("status").filter({ hasText: texto });
const titulo = (page: Page, texto: string) => page.getByRole("heading", { level: 1, name: texto });

/** Abre una página y espera a que termine de cargar e hidratarse: los formularios y la sesión anónima llegan después. */
async function abrir(page: Page, ruta: string): Promise<void> {
  await page.goto(ruta);
  await page.waitForLoadState("networkidle");
}

/** Un contexto nuevo, otro dispositivo: sin cookies, con el widget de Turnstile de prueba. */
async function otroDispositivo(browser: Browser, viewport: { width: number; height: number } | null) {
  const context = await browser.newContext({ viewport: viewport ?? undefined });
  await usarTurnstileDePrueba(context);
  return { context, page: await context.newPage() };
}

/** El `href` de cada enlace de la página, ya desescapado. */
async function hrefs(page: Page): Promise<string[]> {
  return page.locator("a[href]").evaluateAll((enlaces) => enlaces.map((enlace) => enlace.getAttribute("href") ?? ""));
}

/** El token de renovación que guarda la cookie de sesión de Supabase; `null` si no hay sesión. */
function leerTokenDeRenovacion(cookies: Parameters<typeof cookiesDeSesion>[0]): string | null {
  const trozos = cookiesDeSesion(cookies);
  if (trozos.length === 0) return null;
  try {
    const bruto = decodeURIComponent(trozos.map((trozo) => trozo.value).join(""));
    const json = bruto.startsWith("base64-") ? Buffer.from(bruto.slice("base64-".length), "base64url").toString("utf8") : bruto;
    return (JSON.parse(json) as { refresh_token?: string }).refresh_token ?? null;
  } catch {
    return null;
  }
}

/** Inicia sesión por /ingresar en una página y espera a salir de la pantalla de ingreso. */
async function iniciarSesion(page: Page, ruta: string, cuenta: { correo: string; contrasena: string }): Promise<void> {
  await abrir(page, ruta);
  await enviarCredenciales(page, cuenta.correo, cuenta.contrasena);
  await expect(page).not.toHaveURL(/\/ingresar/, ESPERA);
}

// ---------------------------------------------------------------------------
// 1. Un solo navegador, de punta a punta
// ---------------------------------------------------------------------------
test.describe("Criterios 1 a 7, 14 a 17 y 20 · crear la cuenta en un solo navegador", () => {
  test("pedirla, confirmar con el botón, elegir la contraseña, volver a la ruta pedida y entrar desde otro dispositivo", async ({
    page,
    context,
    browser,
    cuentas,
    datos,
  }, info) => {
    const viewport = info.project.use.viewport ?? null;
    await abrir(page, "/");
    const sesion = await datos.sesion(context);
    expect(sesion.esAnonimo).toBe(true);
    const lead = await datos.crearLead({ idSesion: sesion.id, nombre: "Camila Rojas" });
    const cita = await datos.cita(lead.id);
    const contrasena = contrasenaAleatoria();

    await test.step("«Mis citas» muestra la cita y la invitación a crear la cuenta", async () => {
      await page.goto("/cita");
      await expect(page.getByRole("heading", { level: 1, name: "Mis citas" })).toBeVisible(ESPERA);
      await expect(page.getByText(cita.materia)).toBeVisible();
      await expect(page.getByText(INVITACION)).toBeVisible();
      await page.getByRole("link", { name: "Crear mi cuenta" }).click();
      await expect(page).toHaveURL(/\/cuenta\/crear$/, ESPERA);
    });

    await test.step("/cuenta/crear con Lead: nombre y correo como texto, sin contraseña, y los enlaces con la ruta de regreso", async () => {
      await abrir(page, "/cuenta/crear?siguiente=/privacidad");
      await expect(titulo(page, "Crea tu cuenta")).toBeVisible(ESPERA);
      await expect(page.getByText(lead.nombre)).toBeVisible();
      await expect(page.getByText(lead.correo, { exact: true })).toBeVisible();
      await expect(page.getByLabel("Nueva contraseña")).toHaveCount(0);
      await expect(page.locator('input[type="password"]')).toHaveCount(0);
      const enlaces = await hrefs(page);
      expect(enlaces).toContain(`/agendar/contacto?editar=1&siguiente=${encodeURIComponent("/cuenta/crear?siguiente=%2Fprivacidad")}`);
      expect(enlaces).toContain("/ingresar?siguiente=%2Fprivacidad");
      await expect(page.getByRole("link", { name: "¿Ya tienes cuenta? Inicia sesión" })).toBeVisible();
      await expectReglasDelProducto(page, "/cuenta/crear con el resumen del contacto");
    });

    await test.step("«Crear mi cuenta» manda el correo; el usuario sigue anónimo, sin Estudiante y con el Lead intacto", async () => {
      await page.getByRole("button", { name: "Crear mi cuenta" }).click();
      await expect(estado(page, `Si ${lead.correo} puede crear una cuenta`)).toBeVisible(LARGA);
      await expect(estado(page, "revisa la carpeta de spam")).toBeVisible();

      const usuario = await datos.usuario(sesion.id);
      expect(usuario.is_anonymous, "hasta confirmar sigue siendo anónimo").toBe(true);
      expect(usuario.new_email).toBe(lead.correo);
      expect(await datos.estudiantesDe(sesion.id)).toEqual([]);
      expect(await datos.lead(lead.id)).toEqual(lead);
    });

    const correo = await cuentas.esperarCorreo(lead.correo);
    expect(correo.asunto).toBe(ASUNTO_DE_LA_CUENTA);
    expect(correo.html).toContain("Confirma tu correo");
    const enlace = enlaceDeConfirmacion(correo.html);
    expect(new URL(enlace).pathname).toBe("/cuenta/confirmar");

    await test.step("abrir el enlace, dos veces, no gasta nada: sin sesión nueva, sin Estudiante, el botón sigue ahí", async () => {
      const cookiesAntes = leerSesion(await context.cookies());
      for (let i = 0; i < 2; i++) {
        await page.goto(enlace);
        await expect(titulo(page, TITULO_CONFIRMAR)).toBeVisible(ESPERA);
        await expect(page.getByRole("button", { name: "Sí, es mi correo" })).toBeVisible();
      }
      expect(leerSesion(await context.cookies())).toEqual(cookiesAntes);
      expect((await datos.usuario(sesion.id)).is_anonymous).toBe(true);
      expect(await datos.estudiantesDe(sesion.id)).toEqual([]);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
      await expectReglasDelProducto(page, "/cuenta/confirmar con el botón");
    });

    await test.step("«Sí, es mi correo»: queda confirmado con el mismo id, nace el Estudiante y llega a elegir la contraseña", async () => {
      await page.getByRole("button", { name: "Sí, es mi correo" }).click();
      await expect(page).toHaveURL(/\/cuenta\/contrasena$/, LARGA);
      await expect(titulo(page, "Elige tu contraseña")).toBeVisible(ESPERA);

      const usuario = await datos.usuario(sesion.id);
      expect(usuario.is_anonymous).toBe(false);
      expect(usuario.email).toBe(lead.correo);
      expect(await datos.estudiantesDe(sesion.id)).toEqual([{ id: sesion.id, id_lead: lead.id }]);
      // Es la misma cuenta del navegador: el id de la cookie no cambió.
      expect(leerSesion(await context.cookies())).toMatchObject({ id: sesion.id, esAnonimo: false });
      // El estado del Lead no cambia (RN-09).
      expect(await datos.lead(lead.id)).toEqual(lead);
      await expectReglasDelProducto(page, "/cuenta/contrasena");
    });

    await test.step("una contraseña de 7 caracteres o dos distintas dan el error y no cambian nada", async () => {
      await page.getByLabel("Nueva contraseña").fill("1234567");
      await page.getByLabel("Repite la contraseña").fill("1234567");
      await page.getByRole("button", { name: "Guardar contraseña" }).click();
      await expect(alerta(page, "La contraseña debe tener al menos 8 caracteres.")).toBeVisible(ESPERA);

      await page.getByLabel("Nueva contraseña").fill(contrasena);
      await page.getByLabel("Repite la contraseña").fill(`${contrasena}-distinta`);
      await page.getByRole("button", { name: "Guardar contraseña" }).click();
      await expect(alerta(page, "Las dos contraseñas no coinciden.")).toBeVisible(ESPERA);
      await expect(page).toHaveURL(/\/cuenta\/contrasena$/);
    });

    await test.step("una válida la guarda, no cierra la sesión y lleva a la ruta de regreso", async () => {
      await page.getByLabel("Nueva contraseña").fill(contrasena);
      await page.getByLabel("Repite la contraseña").fill(contrasena);
      await page.getByRole("button", { name: "Guardar contraseña" }).click();

      await expect(page).toHaveURL(/\/privacidad$/, LARGA);
      expect(leerSesion(await context.cookies())).toMatchObject({ id: sesion.id, esAnonimo: false });
      // La cookie de regreso se usó y se borró.
      expect((await context.cookies()).find((cookie) => cookie.name === "calibra_cuenta_siguiente")).toBeUndefined();
    });

    await test.step("«Mis citas» ya no invita, sigue mostrando la cita, y /cuenta/crear lleva a «Mis citas»", async () => {
      await page.goto("/cita");
      await expect(page.getByText(cita.materia)).toBeVisible(ESPERA);
      await expect(page.getByText(INVITACION)).toHaveCount(0);

      await page.goto("/cuenta/crear");
      await expect(page).toHaveURL(/\/cita$/, ESPERA);
    });

    const nuevo = await otroDispositivo(browser, viewport);
    await test.step("en otro dispositivo entra con correo y contraseña, llega a la ruta pedida y ve la misma cita", async () => {
      await iniciarSesion(nuevo.page, "/ingresar?siguiente=/privacidad", { correo: lead.correo, contrasena });
      await expect(nuevo.page).toHaveURL(/\/privacidad$/, ESPERA);
      expect(leerSesion(await nuevo.context.cookies())).toMatchObject({ id: sesion.id, esAnonimo: false });

      await nuevo.page.getByRole("link", { name: "Mis citas" }).click();
      await expect(nuevo.page.getByText(cita.materia)).toBeVisible(ESPERA);
      await nuevo.page.getByRole("link", { name: new RegExp(cita.materia) }).click();
      await expect(nuevo.page).toHaveURL(new RegExp(`/cita/${cita.id}$`), ESPERA);
      await expect(nuevo.page.getByRole("heading", { level: 1, name: "Tu monitoría está confirmada" })).toBeVisible(ESPERA);
    });

    await test.step("un Estudiante que abre /admin termina en /ingresar, sin bucle", async () => {
      const saltos: string[] = [];
      nuevo.page.on("response", (respuesta) => {
        if (respuesta.status() >= 300 && respuesta.status() < 400) saltos.push(respuesta.url());
      });
      await nuevo.page.goto("/admin");
      await expect(nuevo.page).toHaveURL(/\/ingresar\?siguiente=%2Fadmin$/, ESPERA);
      await nuevo.page.waitForLoadState("networkidle");
      // La URL queda estable: nadie la sigue empujando a otro lado.
      await nuevo.page.waitForTimeout(1_000);
      await expect(nuevo.page).toHaveURL(/\/ingresar\?siguiente=%2Fadmin$/);
      expect(saltos.length, `redirecciones: ${saltos.join(", ")}`).toBeLessThanOrEqual(2);
    });

    await test.step("el enlace del correo, ya usado, ya no sirve", async () => {
      const sinCuenta = await otroDispositivo(browser, viewport);
      await sinCuenta.page.goto(enlace);
      await expect(titulo(sinCuenta.page, TITULO_CONFIRMAR)).toBeVisible(ESPERA);
      await sinCuenta.page.getByRole("button", { name: "Sí, es mi correo" }).click();
      await expect(alerta(sinCuenta.page, "Este enlace ya no sirve. Ya se usó o venció.")).toBeVisible(LARGA);
      await expect(sinCuenta.page.getByRole("link", { name: "Pedir otro enlace" })).toBeVisible();
      expect(leerSesion(await sinCuenta.context.cookies())).toBeNull();
      await sinCuenta.context.close();
    });
    await nuevo.context.close();
  });
});

// ---------------------------------------------------------------------------
// 2. El enlace en otro dispositivo
// ---------------------------------------------------------------------------
test.describe("Criterios 5 y 15 · el enlace se abre en otro dispositivo", () => {
  test("confirma, elige después y termina en «Mis citas»; el navegador que pidió la cuenta ya no entra con ella", async ({
    page,
    context,
    browser,
    cuentas,
    datos,
  }, info) => {
    await abrir(page, "/");
    const sesion = await datos.sesion(context);
    const lead = await datos.crearLead({ idSesion: sesion.id });
    const cita = await datos.cita(lead.id);

    await abrir(page, "/cuenta/crear?siguiente=/privacidad");
    await page.getByRole("button", { name: "Crear mi cuenta" }).click();
    await expect(estado(page, `Si ${lead.correo} puede crear una cuenta`)).toBeVisible(LARGA);
    const enlace = enlaceDeConfirmacion((await cuentas.esperarCorreo(lead.correo)).html);

    const otro = await otroDispositivo(browser, info.project.use.viewport ?? null);
    await otro.page.goto(enlace);
    await expect(titulo(otro.page, TITULO_CONFIRMAR)).toBeVisible(ESPERA);
    await otro.page.getByRole("button", { name: "Sí, es mi correo" }).click();
    await expect(otro.page).toHaveURL(/\/cuenta\/contrasena$/, LARGA);
    expect(leerSesion(await otro.context.cookies())).toMatchObject({ id: sesion.id, esAnonimo: false });

    await test.step("«Elegir después» lleva a «Mis citas», no a la ruta del otro navegador, y la cuenta ya es Estudiante", async () => {
      await otro.page.getByRole("button", { name: "Elegir después" }).click();
      await expect(otro.page).toHaveURL(/\/cita$/, LARGA);
      await expect(otro.page.getByText(cita.materia)).toBeVisible(ESPERA);
      expect(await datos.estudiantesDe(sesion.id)).toEqual([{ id: sesion.id, id_lead: lead.id }]);
    });

    await test.step("el navegador que pidió la cuenta ya no puede renovar su sesión: Auth la cerró", async () => {
      // Lo que se cierra es la renovación. El token de acceso que ese navegador ya tiene sigue leyendo hasta que vence
      // (`jwt_expiry`, una hora): Auth verifica su firma sin preguntar por la sesión, también en local. Por eso se prueba con
      // el token de renovación de su cookie, que es lo que el proxy usaría al vencer el de acceso.
      const refresco = leerTokenDeRenovacion(await context.cookies());
      expect(refresco, "la cookie del primer navegador debía traer su token de renovación").toBeTruthy();
      const respuesta = await fetch(`${variable("NEXT_PUBLIC_SUPABASE_URL")}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { apikey: variable("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresco }),
      });
      expect(respuesta.ok, "la sesión cerrada no debía poder renovarse").toBe(false);
      expect(respuesta.status).toBeGreaterThanOrEqual(400);
      expect(respuesta.status).toBeLessThan(500);
    });
    await otro.context.close();
  });
});

// ---------------------------------------------------------------------------
// 3. P-23 desde /cuenta/crear
// ---------------------------------------------------------------------------
test.describe("Criterio 9 · el correo de otro Lead (P-23) desde /cuenta/crear", () => {
  test("sale el enlace de verificación con el final «creando tu cuenta», no se crea Lead ni sale el correo de Auth, y al confirmar vuelve a /cuenta/crear", async ({
    page,
    context,
    cuentas,
    datos,
  }) => {
    const dueno = await datos.crearLead({ nombre: "Ana Pérez" });

    await abrir(page, "/cuenta/crear");
    const sesion = await datos.sesion(context);
    await expect(titulo(page, "Crea tu cuenta")).toBeVisible(ESPERA);
    await expectReglasDelProducto(page, "/cuenta/crear sin Lead, con el formulario de contacto");

    await test.step("escribe el correo de Ana: se le avisa que llegó un enlace a ese correo", async () => {
      await page.getByLabel("Tu nombre", { exact: true }).fill("Otra Persona");
      await page.getByLabel("Tu correo", { exact: true }).fill(`  ${dueno.correo.toUpperCase()}  `);
      await page.getByLabel(AUTORIZO).check();
      await page.getByRole("button", { name: "Crear mi cuenta" }).click();

      await expect(estado(page, "Ese correo ya está en Calibra.")).toBeVisible(LARGA);
      await expect(estado(page, "sigues creando tu cuenta aquí")).toBeVisible();
      await expect(estado(page, "agendando")).toHaveCount(0);
      expect(await datos.leadsDeSesion(sesion.id)).toEqual([]);
    });

    const correo = await cuentas.esperarCorreo(dueno.correo);
    expect(correo.asunto).toBe(ASUNTO_DE_VERIFICACION);
    // Y no sale el correo de Auth para crear la cuenta.
    await page.waitForTimeout(1_500);
    expect(await datos.asuntosA(dueno.correo)).toEqual([ASUNTO_DE_VERIFICACION]);
    expect((await datos.usuario(sesion.id)).is_anonymous).toBe(true);
    const enlace = /href="([^"]*\/contacto\/verificar\?[^"]*)"/.exec(correo.html)?.[1]?.replaceAll("&amp;", "&");
    expect(enlace, "el correo debía traer el enlace de verificación").toBeTruthy();

    await test.step("al confirmar el correo en este navegador, vuelve a /cuenta/crear y sigue como un Lead con su contacto", async () => {
      await page.goto(enlace!);
      await expect(titulo(page, TITULO_CONFIRMAR)).toBeVisible(ESPERA);
      await page.getByRole("button", { name: "Sí, es mi correo" }).click();

      await expect(page).toHaveURL(/\/cuenta\/crear$/, LARGA);
      await expect(page.getByText("Ana Pérez", { exact: true })).toBeVisible(ESPERA);
      await expect(page.getByText(dueno.correo, { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Crear mi cuenta" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Cambiar mis datos" })).toBeVisible();
    });
  });
});

// ---------------------------------------------------------------------------
// 3b. Una sesión sin Lead
// ---------------------------------------------------------------------------
test.describe("Criterio 8 · una sesión sin Lead crea su Lead y pide la cuenta", () => {
  test("sin la autorización no se guarda nada; con ella se crea el Lead con los diagnósticos de la sesión y sale el correo de la cuenta", async ({
    page,
    context,
    cuentas,
    datos,
  }) => {
    await abrir(page, "/cuenta/crear");
    const sesion = await datos.sesion(context);
    const diagnostico = await datos.diagnostico(sesion.id);
    const correo = datos.correo();
    await expect(titulo(page, "Crea tu cuenta")).toBeVisible(ESPERA);
    expect(await datos.leadDelDiagnostico(diagnostico.id)).toBeNull();

    await page.getByLabel("Tu nombre", { exact: true }).fill("Camila Rojas");
    await page.getByLabel("Tu correo", { exact: true }).fill(correo);
    await page.getByLabel("Tu teléfono (opcional)").fill("300 123 4567");

    await test.step("sin marcar la autorización de datos no se guarda nada ni sale el correo", async () => {
      await page.getByRole("button", { name: "Crear mi cuenta" }).click();
      await expect(alerta(page, "necesitamos tu autorización para tratar tus datos")).toBeVisible(LARGA);
      expect(await datos.leadsDeSesion(sesion.id)).toEqual([]);
      expect((await datos.usuario(sesion.id)).new_email ?? "").toBe("");
    });

    await test.step("con la autorización se crea el Lead con el diagnóstico de la sesión y sale el correo de la cuenta", async () => {
      await page.getByLabel(AUTORIZO).check();
      await page.getByRole("button", { name: "Crear mi cuenta" }).click();
      // Ya tiene Lead: la pantalla pasa del formulario al resumen, con el aviso de que el correo salió.
      await expect(page).toHaveURL(/\/cuenta\/crear\?enviado=1$/, LARGA);
      await expect(estado(page, `Si ${correo} puede crear una cuenta`)).toBeVisible(LARGA);
      await expect(page.getByText("Camila Rojas", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Crear mi cuenta" })).toBeVisible();

      const [lead, ...otros] = await datos.leadsDeSesion(sesion.id);
      expect(otros, "debía crearse un solo Lead").toEqual([]);
      expect(lead).toMatchObject({ nombre: "Camila Rojas", correo, estado: "nuevo" });
      // P-33: el diagnóstico que la sesión hizo antes de dejar su contacto queda ligado al Lead.
      expect(await datos.leadDelDiagnostico(diagnostico.id)).toBe(lead.id);
      const usuario = await datos.usuario(sesion.id);
      expect(usuario.is_anonymous).toBe(true);
      expect(usuario.new_email).toBe(correo);
      expect(await datos.estudiantesDe(sesion.id)).toEqual([]);

      expect((await cuentas.esperarCorreo(correo)).asunto).toBe(ASUNTO_DE_LA_CUENTA);
    });
  });
});

// ---------------------------------------------------------------------------
// 3c. Terminar de crear mi cuenta
// ---------------------------------------------------------------------------
test.describe("Criterio 14 · «Terminar de crear mi cuenta»", () => {
  test("quien confirmó el correo y quedó sin Estudiante lo termina sin otro enlace; si el correo ya no es el del contacto, ve que escriba a soporte", async ({
    page,
    context,
    cuentas,
    datos,
  }) => {
    await abrir(page, "/");
    const sesion = await datos.sesion(context);
    const lead = await datos.crearLead({ idSesion: sesion.id });
    await abrir(page, "/cuenta/crear");
    await page.getByRole("button", { name: "Crear mi cuenta" }).click();
    await expect(estado(page, `Si ${lead.correo} puede crear una cuenta`)).toBeVisible(LARGA);
    const enlace = enlaceDeConfirmacion((await cuentas.esperarCorreo(lead.correo)).html);

    await page.goto(enlace);
    await page.getByRole("button", { name: "Sí, es mi correo" }).click();
    await expect(page).toHaveURL(/\/cuenta\/contrasena$/, LARGA);
    expect(await datos.estudiantesDe(sesion.id)).toHaveLength(1);

    await test.step("la base falló un instante: confirmó el correo y no hay Estudiante", async () => {
      const { error } = await cuentas.cliente.from("estudiante").delete().eq("id", sesion.id);
      if (error) throw new Error(`borrar el Estudiante: ${error.message}`);
      expect((await datos.usuario(sesion.id)).is_anonymous).toBe(false);

      // /cuenta/contrasena ya no es suya: sin el rol vuelve a /cuenta/crear, que le ofrece terminar.
      await page.goto("/cuenta/contrasena");
      await expect(page).toHaveURL(/\/cuenta\/crear$/, ESPERA);
      await expect(titulo(page, "Terminar de crear mi cuenta")).toBeVisible(ESPERA);
      await expect(page.getByText("Ya confirmaste tu correo. Falta un paso para activar tu cuenta.")).toBeVisible();
      await expect(page.getByLabel("Tu nombre", { exact: true })).toHaveCount(0);
      await expectReglasDelProducto(page, "/cuenta/crear con «Terminar de crear mi cuenta»");
    });

    await test.step("su botón crea el Estudiante sin otro enlace", async () => {
      await page.getByRole("button", { name: "Terminar de crear mi cuenta" }).click();
      await expect(page).toHaveURL(/\/cuenta\/contrasena$/, LARGA);
      expect(await datos.estudiantesDe(sesion.id)).toEqual([{ id: sesion.id, id_lead: lead.id }]);
    });

    await test.step("si el contacto ya tiene otro correo, dice que escriba a soporte y no crea nada", async () => {
      await cuentas.cliente.from("estudiante").delete().eq("id", sesion.id);
      const otroCorreo = datos.correo();
      const { error } = await cuentas.cliente.from("lead").update({ correo: otroCorreo }).eq("id", lead.id);
      if (error) throw new Error(`cambiar el correo del Lead: ${error.message}`);

      await page.goto("/cuenta/crear");
      await page.getByRole("button", { name: "Terminar de crear mi cuenta" }).click();
      await expect(alerta(page, "No pudimos activar tu cuenta con estos datos. Escribe a soporte")).toBeVisible(LARGA);
      await expect(page).toHaveURL(/\/cuenta\/crear$/);
      expect(await datos.estudiantesDe(sesion.id)).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Ya tiene cuenta
// ---------------------------------------------------------------------------
test.describe("Criterio 10 · un Lead que ya tiene cuenta", () => {
  test("otro navegador ligado a su Lead ve «Ya tienes una cuenta», sin formulario, y no sale ningún correo", async ({
    page,
    context,
    cuentas,
    datos,
  }) => {
    const { lead } = await datos.crearEstudiante();
    await abrir(page, "/");
    const sesion = await datos.sesion(context);
    // Ligado por el enlace de verificación de P-23 (HU-068): ve los datos del Lead, pero no es la cuenta.
    const { error } = await cuentas.cliente.from("lead_sesion").insert({ id_sesion: sesion.id, id_lead: lead.id });
    if (error) throw new Error(`ligar la sesión al Lead: ${error.message}`);

    await abrir(page, "/cuenta/crear?siguiente=/privacidad");
    await expect(titulo(page, "Ya tienes una cuenta")).toBeVisible(ESPERA);
    await expect(page.getByText("Este contacto ya tiene una cuenta de Calibra.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Iniciar sesión", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "¿Olvidaste tu contraseña?" })).toBeVisible();
    await expect(page.locator("main button")).toHaveCount(0);
    await expect(page.locator("form")).toHaveCount(0);
    expect(await hrefs(page)).toContain("/restablecer");
    await expectReglasDelProducto(page, "/cuenta/crear de quien ya tiene cuenta");

    await page.waitForTimeout(1_000);
    expect(await datos.asuntosA(lead.correo)).toEqual([]);
    expect((await datos.usuario(sesion.id)).is_anonymous).toBe(true);
    expect(await datos.estudiantesDe(sesion.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. Roles
// ---------------------------------------------------------------------------
test.describe("Criterios 11 y 12 · Estudiante, monitor y admin con sesión", () => {
  test("un Estudiante en /cuenta/crear va a «Mis citas»; en sus datos ve el correo fijo, cambia su nombre y no puede cambiar el correo", async ({
    browser,
    datos,
  }, info) => {
    const { cuenta, lead } = await datos.crearEstudiante();
    const { page } = await otroDispositivo(browser, info.project.use.viewport ?? null);
    await iniciarSesion(page, "/ingresar", cuenta);

    await test.step("/cuenta/crear lo lleva a «Mis citas», sin formulario", async () => {
      await page.goto("/cuenta/crear");
      await expect(page).toHaveURL(/\/cita$/, ESPERA);
    });

    await test.step("en /agendar/contacto?editar=1 ve su correo sin poder editarlo y la ayuda que dice por qué", async () => {
      await abrir(page, "/agendar/contacto?editar=1");
      await expect(titulo(page, "Cambia tus datos")).toBeVisible(ESPERA);
      const correo = page.getByLabel("Tu correo", { exact: true });
      await expect(correo).toHaveValue(lead.correo);
      await expect(correo).toHaveJSProperty("readOnly", true);
      await expect(page.getByText(CORREO_FIJO)).toBeVisible();
      await expectReglasDelProducto(page, "los datos de un Estudiante con el correo fijo");
    });

    await test.step("cambia su nombre y se guarda", async () => {
      await page.getByLabel("Tu nombre", { exact: true }).fill("Estudiante Cambiada");
      await page.getByLabel(AUTORIZO).check();
      await page.getByRole("button", { name: "Seguir" }).click();
      await expect(page).toHaveURL(/\/$/, LARGA);
      expect((await datos.lead(lead.id)).nombre).toBe("Estudiante Cambiada");
      expect((await datos.lead(lead.id)).correo).toBe(lead.correo);
    });

    await test.step("si quita el solo lectura y manda otro correo, ve el mensaje y el Lead no cambia", async () => {
      await abrir(page, "/agendar/contacto?editar=1");
      await expect(titulo(page, "Cambia tus datos")).toBeVisible(ESPERA);
      await page.getByLabel("Tu correo", { exact: true }).evaluate((campo: HTMLInputElement) => {
        campo.readOnly = false;
      });
      await page.getByLabel("Tu correo", { exact: true }).fill(`otro-${randomUUID()}@calibra.test`);
      await page.getByLabel("Tu nombre", { exact: true }).fill("Nombre que no se guarda");
      await page.getByLabel(AUTORIZO).check();
      await page.getByRole("button", { name: "Seguir" }).click();

      await expect(alerta(page, CORREO_FIJO)).toBeVisible(LARGA);
      // Se ve el correo de la cuenta, no el que mandó por fuera.
      await expect(page.getByLabel("Tu correo", { exact: true })).toHaveValue(lead.correo);
      expect(await datos.lead(lead.id)).toMatchObject({ nombre: "Estudiante Cambiada", correo: lead.correo });
    });
  });

  test("un monitor y un admin con sesión ven que están en su cuenta del equipo, sin formulario, y el enlace de confirmar no les cambia nada", async ({
    browser,
    cuentas,
    datos,
  }, info) => {
    const viewport = info.project.use.viewport ?? null;
    for (const [quien, cuenta] of [
      ["monitor", await cuentas.crearMonitor()],
      ["admin", await cuentas.crearAdmin()],
    ] as const) {
      const { context, page } = await otroDispositivo(browser, viewport);
      await iniciarSesion(page, "/ingresar", cuenta);

      await page.goto("/cuenta/crear");
      await expect(titulo(page, "Estás en tu cuenta del equipo"), quien).toBeVisible(ESPERA);
      await expect(page.getByText("Desde tu cuenta del equipo de Calibra no puedes crear una cuenta de Estudiante.")).toBeVisible();
      await expect(page.locator("form")).toHaveCount(0);
      await expectReglasDelProducto(page, `/cuenta/crear de un ${quien}`);

      // Un enlace de confirmar (de forma válida, inventado): la acción no lo manda a Auth con una cuenta del equipo abierta.
      const antes = leerSesion(await context.cookies());
      await page.goto(`/cuenta/confirmar?token_hash=${"A1b2".repeat(10)}&type=email_change`);
      await expect(titulo(page, TITULO_CONFIRMAR)).toBeVisible(ESPERA);
      await page.getByRole("button", { name: "Sí, es mi correo" }).click();
      await expect(alerta(page, "Tienes una cuenta de Calibra abierta en este navegador. Abre el enlace en otra ventana, sin iniciar sesión.")).toBeVisible(LARGA);
      expect(leerSesion(await context.cookies()), quien).toEqual(antes);
      expect(await datos.estudiantesDe(cuenta.id)).toEqual([]);
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Enlaces que no sirven
// ---------------------------------------------------------------------------
test.describe("Criterio 14 · un enlace usado, vencido o inventado", () => {
  test("sin token_hash, vacío o repetido dice «Este enlace ya no sirve»; uno inventado muestra el botón y al pulsarlo dice que ya se usó o venció", async ({
    page,
  }) => {
    for (const ruta of ["/cuenta/confirmar", "/cuenta/confirmar?token_hash=", `/cuenta/confirmar?token_hash=${"a".repeat(30)}&token_hash=${"b".repeat(30)}`]) {
      await page.goto(ruta);
      await expect(titulo(page, TITULO_SIN_ENLACE), ruta).toBeVisible(ESPERA);
      await expect(page.getByRole("button", { name: "Sí, es mi correo" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Crear mi cuenta" })).toBeVisible();
    }
    await expectReglasDelProducto(page, "/cuenta/confirmar con un enlace que no sirve");

    await page.goto(`/cuenta/confirmar?token_hash=pkce_${randomUUID().replaceAll("-", "")}&type=email_change`);
    await expect(titulo(page, TITULO_CONFIRMAR)).toBeVisible(ESPERA);
    await page.getByRole("button", { name: "Sí, es mi correo" }).click();
    await expect(alerta(page, "Este enlace ya no sirve. Ya se usó o venció.")).toBeVisible(LARGA);
    await expect(page.getByRole("link", { name: "Pedir otro enlace" })).toBeVisible();
    expect(leerSesion(await page.context().cookies())).toBeNull();
    await expectReglasDelProducto(page, "/cuenta/confirmar después de pulsar con un enlace inventado");

    // Sin sesión, /cuenta/contrasena no muestra el formulario: va a /cuenta/crear.
    await page.route("**/auth/v1/signup", (ruta) => ruta.abort());
    await page.goto("/cuenta/contrasena");
    await expect(page).toHaveURL(/\/cuenta\/crear$/, ESPERA);
    await expect(page.getByLabel("Nueva contraseña")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Medidas
// ---------------------------------------------------------------------------
test.describe("Criterio 21 · las pantallas respetan las reglas del producto", () => {
  test("el formulario de contacto y el resumen con un correo de 80 caracteres no se desbordan ni achican nada", async ({ page, context, datos }) => {
    await abrir(page, "/cuenta/crear");
    const sesion = await datos.sesion(context);
    await expect(titulo(page, "Crea tu cuenta")).toBeVisible(ESPERA);
    await expectReglasDelProducto(page, "/cuenta/crear con el formulario de contacto");

    // El resumen con un correo de 80 caracteres y un nombre largo.
    // Único por prueba: los dos proyectos corren a la vez y el correo de un Lead no se repite.
    const largo = `${randomUUID().replaceAll("-", "")}${"a".repeat(23)}@${"d".repeat(21)}.co`;
    expect(largo).toHaveLength(80);
    await datos.crearLead({ idSesion: sesion.id, correo: largo, nombre: "Maria de los Angeles Fernandez Rodriguez de la Torre y Montenegro" });
    await abrir(page, "/cuenta/crear");
    await expect(page.getByText(largo, { exact: true })).toBeVisible(ESPERA);
    await expectReglasDelProducto(page, "/cuenta/crear con un correo de 80 caracteres");
  });
});

// ---------------------------------------------------------------------------
// Las reglas del producto sobre la página abierta
// ---------------------------------------------------------------------------
async function expectReglasDelProducto(page: Page, donde: string): Promise<void> {
  const medidas = await medir(page);
  expect(medidas.sinScrollHorizontal, `${donde}: sin scroll horizontal`).toBe(true);
  expect(medidas.desbordados, `${donde}: ningún elemento fuera de la ventana`).toEqual([]);
  expect(medidas.menorTexto, `${donde}: ningún texto por debajo de 14 px`).toBeGreaterThanOrEqual(14);
  expect(medidas.degradados, `${donde}: sin degradados`).toBe(0);
  expect(medidas.tactilesChicos, `${donde}: áreas táctiles de 44 px o más`).toEqual([]);
  expect(medidas.controlesSinNombre, `${donde}: todo control tiene nombre`).toEqual([]);
}

async function medir(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const caja = el.getBoundingClientRect();
      return caja.width > 0 && caja.height > 0;
    };
    const conTexto = [...document.body.querySelectorAll<HTMLElement>("*")].filter(
      (el) => visible(el) && !el.closest("nextjs-portal") && [...el.childNodes].some((nodo) => nodo.nodeType === Node.TEXT_NODE && nodo.textContent?.trim()),
    );
    const controles = [...document.querySelectorAll<HTMLElement>("a, button, select, input:not([type=hidden]), textarea, summary")].filter(visible);
    // Los enlaces dentro de una frase son texto corrido: quedan fuera.
    const tocables = controles
      .filter((el) => !(el.tagName === "A" && el.closest("label, p")))
      .map((el) => (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? (el.labels?.[0] ?? el) : el));
    // `html` y `body` llevan `overflow-x: hidden` (globals.css): el scroll horizontal nunca aparece aunque el contenido se
    // desborde, así que `scrollWidth` de la página no lo delata. Se mide cada elemento a la vista: que su caja no se salga de
    // la ventana y que su contenido (un correo largo sin espacios, por ejemplo) no se salga de su propia caja.
    const ancho = window.innerWidth;
    const desbordados = [...document.body.querySelectorAll<HTMLElement>("*")]
      .filter((el) => visible(el) && !el.closest("nextjs-portal"))
      .flatMap((el) => {
        const caja = el.getBoundingClientRect();
        const fueraDeLaVentana = caja.right > ancho + 1 || caja.left < -1;
        // El texto de un campo más largo que el campo (un correo de 80 caracteres) se desplaza dentro de él: es lo normal.
        const contenidoFueraDeSuCaja = el.tagName !== "INPUT" && el.tagName !== "TEXTAREA" && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1;
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
