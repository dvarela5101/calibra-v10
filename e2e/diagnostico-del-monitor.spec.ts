import { randomInt, randomUUID } from "node:crypto";
import type { Browser, Locator, Page, TestInfo } from "@playwright/test";
import { aciertosDe, filaDeDiagnosticoConRespuestas, habilidadesSembradas, planDeEjemplo, preguntasEsperadas, resultadoGuardadoSembrado, SEMILLA_SEMBRADA, textoDeErrorDeOpcion, textosDeErrorDeLasQueNoEligio, valoresInternos, type PlanDePregunta } from "../pruebas/respuestas-sembradas";
import type { ResultadoGuardado } from "../src/lib/diagnostico/resultado";
import { TEXTOS } from "../src/lib/diagnostico/vista-del-monitor";
import { diaDelNegocio, formatearDiaConSemana } from "../src/lib/fechas";
import { borrarDesembolsosDeMonitores, enviarCredenciales, esperarSesion, expect, test as base, usarTurnstileDePrueba, type Cuenta } from "./utilidades";

// HU-022: el monitor ve el diagnóstico de cada monitoría en su hub. Corre contra el Supabase local (Auth y base) con cuentas,
// materias, Evaluaciones, Leads, monitorías y diagnósticos que crea y borra cada prueba (códigos, nombres, correos y teléfonos únicos:
// las pruebas corren en paralelo, en `movil` y en `escritorio`, y solo se afirma sobre lo propio). El diagnóstico se siembra con
// `pruebas/respuestas-sembradas.ts`: copias de las preguntas con el orden de las opciones barajado, para que la letra que vio la
// persona no sea la del banco. Las fechas salen de la zona del negocio (America/Bogota), nunca de la de la máquina.
//
// Cada entrada por /ingresar gasta cupo de Auth (30 cada 5 minutos para toda la suite): cada prueba entra una vez, salvo la de los
// estados (entra también otro monitor) y la de los roles (un admin), y recorre sus pasos con `test.step`.

const ESPERA = { timeout: 20_000 };
const MINUTO_MS = 60_000;
const DIA_MS = 24 * 60 * MINUTO_MS;

// Los textos que la HU escribe tal cual (sin el punto final): las pruebas buscan por contenido.
const HU = {
  verDiagnostico: "Ver diagnóstico",
  sinDiagnostico: "No hay diagnóstico de esta materia ligado a esta monitoría",
  repetido: "Lo tomó otra vez; puede incluir preguntas que ya había visto",
  noAutorizo: "El estudiante no autorizó compartir sus respuestas",
  panel: "Abre tus franjas para que te agenden. En tu agenda ves quién agendó y abres el diagnóstico de cada cita confirmada o realizada.",
  noEncontrada: "No encontramos esta página",
};

// Cifras que ni la agenda ni el detalle muestran (P-24): lo que vale la monitoría y lo que pagó quien pagó, de siete cifras.
const VALOR_DE_LA_MONITORIA = 1_357_911;
const MONTO_DEL_PAGO = 2_468_024;
const CIFRAS_PROHIBIDAS = ["1357911", "1.357.911", "1,357,911", "2468024", "2.468.024", "2,468,024"];

/** La fórmula más ancha del banco real (HU-083 E.6: mide unos 266 px y una opción a 390 px deja unos 270 útiles). */
const FORMULA_MAS_ANCHA = String.raw`\lim_{x\to-\infty} \left(\sqrt{x^2 + 8x} + x\right) = -4`;

// ---------------------------------------------------------------------------
// Fechas (America/Bogota)
// ---------------------------------------------------------------------------
const hoy = () => diaDelNegocio(new Date());

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

/** La fecha de `semanas` semanas desde hoy: cae siempre en el día de la semana de la franja de hoy. */
const enSemanas = (semanas: number) => sumarDias(hoy(), 7 * semanas);

// ---------------------------------------------------------------------------
// Fixture `escenario`: lo que crea cada prueba, que se borra al terminar
// ---------------------------------------------------------------------------
type Materia = { id: string; nombre: string; codigo: string; idEvaluacion: string; nombreEvaluacion: string };
type Franja = { id: string };
type Lead = { id: string; nombre: string; correo: string; telefono: string };
type EstadoDeMonitoria = "pendiente_pago" | "confirmada" | "realizada" | "cancelada";
type DatosDeMonitoria = {
  estado: EstadoDeMonitoria;
  /** Minutos desde que se apartó: más de 10 en una pendiente de pago es una reserva vencida (RN-34). */
  apartadaHaceMin?: number;
  idDiagnostico?: string | null;
  /** Solo si está realizada: hace cuántos días se finalizó (por omisión, ahora). */
  finalizadaHaceDias?: number;
};
type DatosDeDiagnostico = { plan?: PlanDePregunta[]; resultado?: ResultadoGuardado; repetido?: boolean; marca?: string };
type Sembrado = { id: string; token: string; marca: string; plan: PlanDePregunta[]; resultado: ResultadoGuardado };

type Escenario = {
  /** Una materia con su Evaluación, de nombres únicos. */
  materia(): Promise<Materia>;
  monitorCertificado(materia: Materia): Promise<Cuenta>;
  /** Franja semanal. Por omisión cae el mismo día de la semana que hoy (así `enSemanas(n)` es una fecha suya). */
  franja(monitor: Cuenta, datos: { hora: string; duracionMin: number; presencial: boolean; dia?: number }): Promise<Franja>;
  /** Un Lead con correo y teléfono propios; el nombre lleva un sufijo único. `v2` autorizó compartir sus respuestas. */
  lead(nombre: string, version?: "v1" | "v2", idSesion?: string): Promise<Lead>;
  monitoria(monitor: Cuenta, materia: Materia, franja: Franja, lead: Lead, fecha: string, datos: DatosDeMonitoria): Promise<string>;
  /** Un diagnóstico terminado del Lead, con las 8 preguntas sembradas (3 falladas) y el resultado de cuatro niveles. */
  diagnostico(materia: Materia, lead: Lead, datos?: DatosDeDiagnostico): Promise<Sembrado>;
  /** Un pago de la monitoría (con su comprobante revisado). */
  pago(idMonitoria: string, estado: "en_revision" | "aprobado" | "rechazado"): Promise<void>;
  /** La monitoría pasa a ser una grupal (fila en `monitoria_grupal`). */
  volverGrupal(idMonitoria: string): Promise<void>;
  borrarDiagnostico(id: string): Promise<void>;
  /** Lo que vale `estado` de la monitoría en la base ahora. */
  estadoDe(idMonitoria: string): Promise<string>;
  cambiarVersionDelLead(lead: Lead, version: "v1" | "v2"): Promise<void>;
};

const test = base.extend<{ escenario: Escenario }>({
  escenario: async ({ cuentas }, entregar) => {
    const cliente = cuentas.cliente;
    const monitores: string[] = [];
    const materias: string[] = [];
    const evaluaciones: string[] = [];
    const leads: string[] = [];
    const monitorias: string[] = [];
    const diagnosticos: string[] = [];
    const pagos: string[] = [];
    const comprobantes: string[] = [];
    let idAdmin: string | undefined;

    async function insertar(tabla: string, fila: Record<string, unknown>) {
      const { data, error } = await cliente.from(tabla).insert(fila).select().single();
      if (error) throw new Error(`insertar ${tabla}: ${error.message}`);
      return data as { id: string };
    }

    await entregar({
      async materia() {
        const sufijo = randomUUID().slice(0, 6);
        const nombre = `Materia e2e monitor ${sufijo}`;
        const codigo = `E2E-${randomUUID().slice(0, 12)}`;
        const materia = await insertar("materia", { nombre, codigo });
        materias.push(materia.id);
        const nombreEvaluacion = `Parcial Veintidós ${sufijo}`;
        const evaluacion = await insertar("evaluacion", { id_materia: materia.id, semana: 1, nombre: nombreEvaluacion });
        evaluaciones.push(evaluacion.id);
        return { id: materia.id, nombre, codigo, idEvaluacion: evaluacion.id, nombreEvaluacion };
      },
      async monitorCertificado(materia) {
        idAdmin ??= (await cuentas.crearAdmin()).id;
        const monitor = await cuentas.crearMonitor();
        monitores.push(monitor.id);
        await insertar("certificado", { id_monitor: monitor.id, id_materia: materia.id, id_admin: idAdmin });
        return monitor;
      },
      async franja(monitor, datos) {
        const franja = await insertar("franja", {
          id_monitor: monitor.id,
          dia: datos.dia ?? diaIso(hoy()),
          hora: datos.hora,
          duracion_min: datos.duracionMin,
          presencial: datos.presencial,
          precio: 25_000,
          lugar: datos.presencial ? "Edificio ML, salón 101" : null,
          enlace: datos.presencial ? null : "https://meet.example.com/e2e-diagnostico-del-monitor",
        });
        return { id: franja.id };
      },
      async lead(nombre, version = "v2", idSesion) {
        const lead = {
          nombre: `${nombre} e2e ${randomUUID().replaceAll("-", "").slice(0, 8)}`,
          correo: `lead-${randomUUID()}@calibra.test`,
          // Un número de móvil colombiano de siete cifras al azar: se busca tal cual en el HTML.
          telefono: `310${randomInt(1_000_000, 9_999_999)}`,
        };
        const fila = await insertar("lead", {
          nombre: lead.nombre,
          correo: lead.correo,
          numero_telefono: lead.telefono,
          acepta_tratamiento_datos: true,
          fecha_consentimiento: new Date().toISOString(),
          version_autorizacion: version,
          id_sesion_anonima: idSesion ?? null,
        });
        leads.push(fila.id);
        return { id: fila.id, ...lead };
      },
      async monitoria(monitor, materia, franja, lead, fecha, datos) {
        const fila = await insertar("monitoria", {
          id_franja: franja.id,
          id_monitor: monitor.id,
          id_materia: materia.id,
          id_lead: lead.id,
          fecha,
          valor_total: VALOR_DE_LA_MONITORIA,
          estado: datos.estado,
          id_diagnostico: datos.idDiagnostico ?? null,
          ...(datos.estado === "cancelada" ? { motivo_cancelacion: "estudiante" } : {}),
          ...(datos.estado === "realizada"
            ? { fecha_finalizacion: new Date(Date.now() - (datos.finalizadaHaceDias ?? 0) * DIA_MS).toISOString() }
            : {}),
          ...(datos.apartadaHaceMin ? { fecha_creacion: new Date(Date.now() - datos.apartadaHaceMin * MINUTO_MS).toISOString() } : {}),
        });
        monitorias.push(fila.id);
        return fila.id;
      },
      async diagnostico(materia, lead, datos = {}) {
        const marca = datos.marca ?? `m${randomUUID().replaceAll("-", "").slice(0, 10)}`;
        const plan = datos.plan ?? planDeEjemplo();
        const resultado = datos.resultado ?? resultadoGuardadoSembrado(marca, { detalleDeLaElegida: textoDeErrorDeOpcion(planDeEjemplo()[1], marca, "A") });
        const fila = filaDeDiagnosticoConRespuestas({
          idLead: lead.id,
          idEvaluacion: materia.idEvaluacion,
          idMateria: materia.id,
          plan,
          marca,
          resultado,
          repetido: datos.repetido,
        });
        const { data, error } = await cliente.from("diagnostico").insert(fila).select("id, token_recuperacion").single();
        if (error) throw new Error(`insertar diagnostico: ${error.message}`);
        const sembrado = data as { id: string; token_recuperacion: string };
        diagnosticos.push(sembrado.id);
        return { id: sembrado.id, token: sembrado.token_recuperacion, marca, plan, resultado };
      },
      async pago(idMonitoria, estado) {
        idAdmin ??= (await cuentas.crearAdmin()).id;
        // pago.comprobante es una llave foránea a los comprobantes que el servidor ya revisó (HU-059).
        const comprobante = `${randomUUID()}/${randomUUID()}.png`;
        const { error } = await cliente.from("comprobante_revisado").insert({ ruta: comprobante, tipo: "image/png" });
        if (error) throw new Error(`insertar comprobante_revisado: ${error.message}`);
        comprobantes.push(comprobante);
        const fila = await insertar("pago", {
          id_monitoria: idMonitoria,
          monto: MONTO_DEL_PAGO,
          nombre_pagador: `Pagador e2e ${randomUUID().slice(0, 8)}`,
          contacto: `pagador-${randomUUID()}@calibra.test`,
          id_admin: idAdmin,
          comprobante,
          estado,
          fecha_revision: estado === "en_revision" ? null : new Date().toISOString(),
        });
        pagos.push(fila.id);
      },
      async volverGrupal(idMonitoria) {
        const { error } = await cliente.from("monitoria_grupal").insert({ id_monitoria: idMonitoria, cupos: 3, modalidad_pago: "dividido", precio_por_persona: 15_000 });
        if (error) throw new Error(`insertar monitoria_grupal: ${error.message}`);
      },
      async borrarDiagnostico(id) {
        const { error } = await cliente.from("diagnostico").delete().eq("id", id);
        if (error) throw new Error(`borrar el diagnóstico: ${error.message}`);
      },
      async estadoDe(idMonitoria) {
        const { data, error } = await cliente.from("monitoria").select("estado").eq("id", idMonitoria).single();
        if (error) throw new Error(`leer la monitoría: ${error.message}`);
        return (data as { estado: string }).estado;
      },
      async cambiarVersionDelLead(lead, version) {
        const { error } = await cliente.from("lead").update({ version_autorizacion: version }).eq("id", lead.id);
        if (error) throw new Error(`cambiar la versión de la autorización: ${error.message}`);
      },
    });

    // Limpieza, antes de que la fixture `cuentas` borre a los monitores y al admin: de las filas dependientes hacia las cuentas. Se
    // intenta todo y se avisa de lo que falle.
    const fallos: string[] = [];
    const borrar = async (contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await consulta;
      if (error) fallos.push(`${contexto}: ${error.message}`);
    };
    if (pagos.length) await borrar("pagos", cliente.from("pago").delete().in("id", pagos));
    if (comprobantes.length) await borrar("comprobantes revisados", cliente.from("comprobante_revisado").delete().in("ruta", comprobantes));
    if (monitorias.length) await borrar("grupales", cliente.from("monitoria_grupal").delete().in("id_monitoria", monitorias));
    if (monitores.length) {
      // HU-028: la que pasó a realizada tiene su desembolso, que no cae con la monitoría.
      await borrar("desembolsos", borrarDesembolsosDeMonitores(cliente, monitores));
      await borrar("monitorías", cliente.from("monitoria").delete().in("id_monitor", monitores));
      await borrar("franjas", cliente.from("franja").delete().in("id_monitor", monitores));
      await borrar("certificados", cliente.from("certificado").delete().in("id_monitor", monitores));
    }
    if (diagnosticos.length) await borrar("diagnósticos", cliente.from("diagnostico").delete().in("id", diagnosticos));
    if (evaluaciones.length) await borrar("evaluaciones", cliente.from("evaluacion").delete().in("id", evaluaciones));
    if (leads.length) await borrar("leads", cliente.from("lead").delete().in("id", leads));
    if (materias.length) await borrar("materias", cliente.from("materia").delete().in("id", materias));
    if (fallos.length) throw new Error(`No se pudo limpiar lo que creó la prueba:\n${fallos.join("\n")}`);
  },
});

test.describe.configure({ mode: "default", timeout: 120_000 });

// ---------------------------------------------------------------------------
// Ayudas de página
// ---------------------------------------------------------------------------
const RUTA_DE_LA_AGENDA = "/monitor/agenda";
const rutaDelDetalle = (id: string) => `/monitor/agenda/${id}`;
const UUID_INEXISTENTE = "00000000-0000-4000-8000-000000000022";

/** Entra por /ingresar a la ruta pedida: sin sesión, la página protegida manda a iniciar sesión. */
async function entrar(page: Page, ruta: string, cuenta: Cuenta): Promise<void> {
  await page.goto(ruta);
  await expect(page).toHaveURL(`/ingresar?siguiente=${encodeURIComponent(ruta)}`, ESPERA);
  await enviarCredenciales(page, cuenta.correo, cuenta.contrasena);
  await expect(page).toHaveURL(ruta, ESPERA);
}

const normalizar = (texto: string) => texto.replace(/\s+/g, " ").trim();
/** El texto que se ve, con los espacios duros como espacios normales. */
const textoVisible = async (page: Page) => normalizar(await page.locator("body").innerText());

const tituloDe = (page: Page, nombre: string) => page.getByRole("heading", { level: 1, name: nombre });
const region = (page: Page, nombre: string) => page.getByRole("region", { name: nombre, exact: true });
/** La tarjeta de la agenda de ese Lead (su nombre lleva un sufijo único). */
const tarjetaDe = (page: Page, lead: Lead) => page.getByRole("listitem").filter({ hasText: lead.nombre });
const enlaceDeDiagnostico = (zona: Page | Locator) => zona.getByRole("link", { name: HU.verDiagnostico, exact: true });

/** El HTML que recibe el navegador y el que ya armó la página; con `rsc`, el flujo que Next manda para navegar. */
async function fuentesDe(page: Page, ruta: string): Promise<{ nombre: string; texto: string }[]> {
  const html = await page.request.get(ruta);
  expect(html.status(), `GET ${ruta} con la sesión del monitor`).toBe(200);
  const rsc = await page.request.get(ruta, { headers: { RSC: "1" } });
  expect(rsc.status(), `GET ${ruta} como flujo RSC`).toBe(200);
  return [
    { nombre: "el HTML que responde el servidor", texto: await html.text() },
    { nombre: "el flujo RSC", texto: await rsc.text() },
    { nombre: "el HTML de la página abierta", texto: await page.content() },
  ];
}

/** Lo que responde una dirección: el status y el título de la página. Una cita ajena y una inexistente deben dar lo mismo. */
async function respuestaDe(page: Page, ruta: string): Promise<{ status: number | undefined; titulo: string }> {
  const respuesta = await page.goto(ruta);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible(ESPERA);
  return { status: respuesta?.status(), titulo: (await page.getByRole("heading", { level: 1 }).first().innerText()).trim() };
}

/** Un contexto aparte (otra persona) con las opciones del proyecto y el stub de Turnstile. */
async function contextoAparte(browser: Browser, testInfo: TestInfo, page: Page) {
  const contexto = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: "es-CO",
    timezoneId: "America/Bogota",
    viewport: page.viewportSize() ?? undefined,
  });
  await usarTurnstileDePrueba(contexto);
  return contexto;
}

/** Los avisos de error de la página, sin el anunciador de rutas de Next (que también es un `role="alert"`). */
const alertas = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');

/** Pulsa Tab hasta que el foco cae en el elemento que cumple `esElque` (máximo `intentos`). */
async function tabularHasta(page: Page, esElque: () => Promise<boolean>, intentos = 60): Promise<void> {
  for (let i = 0; i < intentos; i++) {
    await page.keyboard.press("Tab");
    if (await esElque()) return;
  }
  throw new Error(`Con Tab no se llegó al elemento en ${intentos} pulsaciones.`);
}

// ---------------------------------------------------------------------------
// 1. El detalle completo (criterios 1 a 5 y 13 a 15)
// ---------------------------------------------------------------------------
test.describe("El detalle del diagnóstico de una cita confirmada", () => {
  test("desde la agenda el monitor toca «Ver diagnóstico» y ve el resumen, las habilidades por nivel, los errores, los prerrequisitos, la nota de repetido y las 8 preguntas con sus letras; el HTML no trae nada sensible", async ({ page, escenario }) => {
    const materia = await escenario.materia();
    const monitor = await escenario.monitorCertificado(materia);
    const franja = await escenario.franja(monitor, { hora: "14:30", duracionMin: 90, presencial: true });
    const lead = await escenario.lead("Camila", "v2");
    const diagnostico = await escenario.diagnostico(materia, lead, { repetido: true });
    const fecha = enSemanas(1);
    const idCita = await escenario.monitoria(monitor, materia, franja, lead, fecha, { estado: "confirmada", idDiagnostico: diagnostico.id });
    await escenario.pago(idCita, "aprobado");
    const { plan, marca } = diagnostico;
    const esperadas = preguntasEsperadas(plan, marca);
    const habilidades = habilidadesSembradas(marca);

    await test.step("desde la agenda toca «Ver diagnóstico» y llega al detalle", async () => {
      await entrar(page, RUTA_DE_LA_AGENDA, monitor);
      const tarjeta = tarjetaDe(page, lead);
      await expect(tarjeta).toHaveCount(1, ESPERA);
      // La tarjeta conserva sus cuatro renglones: el enlace es un `a` y no suma ningún `span` hijo directo.
      await expect(tarjeta.locator(":scope > span")).toHaveCount(4);
      const enlace = enlaceDeDiagnostico(tarjeta);
      await expect(enlace).toHaveAttribute("href", rutaDelDetalle(idCita));
      await enlace.click();
      await expect(page).toHaveURL(rutaDelDetalle(idCita), ESPERA);
      await expect(page).toHaveTitle(TEXTOS.tituloDeLaPestana);
      await expect(tituloDe(page, `Diagnóstico de ${lead.nombre}`)).toBeVisible(ESPERA);
      await expect(page.getByText(`${materia.nombre} · ${formatearDiaConSemana(fecha)}, 14:30 a 16:00`)).toBeVisible();
      await expect(page.getByRole("link", { name: TEXTOS.volver })).toHaveAttribute("href", RUTA_DE_LA_AGENDA);
    });

    await test.step("la nota de repetido va arriba de todo, y es la única nota", async () => {
      const nota = page.getByText(HU.repetido);
      await expect(nota).toBeVisible();
      await expect(page.getByText("Lo tomó otra vez")).toHaveCount(1);
      // Va antes del resumen.
      const orden = await page.evaluate(() => {
        const texto = [...document.querySelectorAll("main p, main h2")];
        const nota = texto.findIndex((el) => el.textContent?.includes("Lo tomó otra vez"));
        const resumen = texto.findIndex((el) => el.textContent?.includes("Resumen del diagnóstico"));
        return { nota, resumen };
      });
      expect(orden.nota).toBeGreaterThanOrEqual(0);
      expect(orden.nota).toBeLessThan(orden.resumen);
    });

    await test.step("el resumen: la Evaluación, la fecha en hora de Bogotá (23:30 del 4 de octubre, no el 5) y «5 de 8 correctas»", async () => {
      const resumen = region(page, TEXTOS.resumen);
      await expect(resumen).toContainText(`${TEXTOS.evaluacion} ${materia.nombreEvaluacion}`);
      const fechaVista = normalizar(await resumen.locator("time").innerText());
      expect(fechaVista).toContain("4 de octubre de 2026");
      expect(fechaVista).toContain("11:30");
      expect(fechaVista).not.toContain("5 de octubre");
      await expect(resumen.locator("time")).toHaveAttribute("datetime", "2026-10-05T04:30:00.000Z");
      await expect(resumen).toContainText("5 de 8 correctas");
    });

    await test.step("las habilidades: por mirar en el orden no lo domina, en proceso y sin medir (el de la materia dentro de cada nivel), y las que domina plegadas con su número", async () => {
      const seccion = region(page, TEXTOS.habilidades);
      const aMirar = seccion.locator(":scope > ul > li");
      // Guardadas en el orden de la materia: 0 lo domina, 1 en proceso, 2 no lo domina, 3 sin medir, 4 no lo domina, 5 lo domina, 6 en proceso, 7 lo domina.
      const esperadoAMirar: [number, string, string][] = [
        [2, "No lo domina", "2 respuestas · 0 aciertos"],
        [4, "No lo domina", "1 respuesta · 0 aciertos"],
        [1, "En proceso", "2 respuestas · 1 acierto"],
        [6, "En proceso", "1 respuesta · 1 acierto"],
        [3, "Sin medir", "No se midió"],
      ];
      await expect(aMirar).toHaveCount(esperadoAMirar.length);
      for (const [i, [indice, nivel, cifras]] of esperadoAMirar.entries()) {
        const tarjeta = aMirar.nth(i);
        await expect(tarjeta, `habilidad ${i + 1} por mirar`).toContainText(habilidades[indice].descripcion);
        await expect(tarjeta.getByText(nivel, { exact: true }), `nivel de la habilidad ${i + 1} por mirar`).toHaveCount(1);
        await expect(tarjeta.getByText(cifras, { exact: true }), `cifras de la habilidad ${i + 1} por mirar`).toHaveCount(1);
      }
      // «No se midió» solo en la que no tiene respuestas, y sin el motivo.
      await expect(seccion.getByText("No se midió", { exact: true })).toHaveCount(1);
      const textoDeLaSeccion = await textoVisible(page);
      expect(textoDeLaSeccion).not.toMatch(/sin_preguntas_sin_ver|tope_una_respuesta|falta de material|le faltó material/i);

      const dominadas = seccion.locator("details");
      await expect(dominadas).toHaveCount(1);
      await expect(dominadas.locator("summary")).toHaveText("Lo domina (3)");
      await expect(dominadas).not.toHaveAttribute("open", /.*/);
      await expect(dominadas.locator("li")).toHaveCount(3);
      await expect(dominadas.locator("li").first()).toBeHidden();
      await dominadas.locator("summary").click();
      await expect(dominadas).toHaveAttribute("open", /.*/);
      const esperadasDominadas: [string, string][] = [
        ["calcula la fuerza neta con", "3 respuestas · 3 aciertos"],
        ["descompone vectores", "1 respuesta · 1 acierto"],
        ["usa la segunda ley de Newton", "2 respuestas · 2 aciertos"],
      ];
      for (const [i, [descripcion, cifras]] of esperadasDominadas.entries()) {
        const tarjeta = dominadas.locator("li").nth(i);
        await expect(tarjeta, `habilidad ${i + 1} que domina`).toContainText(descripcion);
        await expect(tarjeta.getByText("Lo domina", { exact: true })).toHaveCount(1);
        await expect(tarjeta.getByText(cifras, { exact: true })).toHaveCount(1);
      }
      // La fórmula del título se dibuja (no queda el texto crudo).
      await expect(dominadas.locator("li").first().locator("math")).toHaveCount(1);
      expect(await dominadas.locator("li").first().innerText()).not.toMatch(/[$\\]/);
    });

    await test.step("los errores: el confirmado primero, con su estado en texto, las veces, la habilidad (también la que no es de la Evaluación) y el detalle solo cuando lo hay", async () => {
      const errores = region(page, TEXTOS.errores).locator(":scope > ul > li");
      await expect(errores).toHaveCount(4);
      const detalleDeLaElegida = textoDeErrorDeOpcion(planDeEjemplo()[1], marca, "A");

      const primero = errores.nth(0);
      await expect(primero).toContainText("Error detectado:");
      await expect(primero).toContainText("sin cuadrar la velocidad");
      await expect(primero.locator("math")).toHaveCount(1);
      expect(await primero.innerText()).not.toMatch(/[$\\]/);
      await expect(primero.getByText("Lo eligió 2 veces", { exact: true })).toHaveCount(1);
      await expect(primero).toContainText(`Habilidad: ${habilidades[2].descripcion}`);
      await expect(primero).toContainText(detalleDeLaElegida);

      const segundo = errores.nth(1);
      await expect(segundo).toContainText("Posible error:");
      await expect(segundo).toContainText("confundes energía con potencia");
      await expect(segundo.getByText("Lo eligió 1 vez", { exact: true })).toHaveCount(1);
      await expect(segundo).toContainText(`Habilidad: ${habilidades[1].descripcion}`);
      await expect(segundo.locator("p")).toHaveCount(3); // el error, las veces y la habilidad: sin detalle

      const tercero = errores.nth(2);
      await expect(tercero).toContainText("Posible error:");
      await expect(tercero).toContainText("ignoras la fricción");
      // Una habilidad que no es de la Evaluación se muestra igual, con sus dos detalles.
      await expect(tercero).toContainText("Habilidad: calcula el trabajo de la fricción");
      await expect(tercero).toContainText("La fricción también hace trabajo.");
      await expect(tercero).toContainText("Piensa en el sentido del movimiento.");

      const cuarto = errores.nth(3);
      await expect(cuarto).toContainText("mezclas el sentido de dos vectores");
      // La descripción de la habilidad cayó a su clave: no se muestra la clave ni el renglón.
      expect(await cuarto.innerText()).not.toContain("Habilidad:");
    });

    await test.step("los prerrequisitos: sin repetir, con la materia solo cuando es otra", async () => {
      const prerrequisitos = region(page, TEXTOS.prerrequisitos).locator(":scope > ul > li");
      // Guardados cinco: el repetido sale una vez, la misma clave en otra materia es otro y otra clave con la misma descripción también.
      await expect(prerrequisitos).toHaveCount(4);
      await expect(prerrequisitos.nth(0)).toHaveText("despeja una incógnita");
      await expect(prerrequisitos.nth(1)).toHaveText("deriva polinomios (Cálculo Diferencial)");
      // El de la otra materia lleva una fórmula: se dibuja (no queda el texto crudo) y la materia va al final del renglón.
      await expect(prerrequisitos.nth(2)).toHaveText(/^reconoce.*como una potencia \(Precálculo\)$/);
      await expect(prerrequisitos.nth(2).locator("math")).toHaveCount(1);
      expect(await prerrequisitos.nth(2).innerText()).not.toMatch(/[$\\]/);
      await expect(prerrequisitos.nth(3)).toHaveText("despeja una incógnita");
    });

    await test.step("las 8 preguntas, en el orden en que las respondió, con las letras que vio (no las del banco), la elegida, la correcta, la solución y Acertó o Falló en texto", async () => {
      const preguntas = region(page, TEXTOS.preguntas).locator(":scope > ol > li");
      await expect(preguntas).toHaveCount(8);
      await expect(page.getByText(TEXTOS.noAutorizo)).toHaveCount(0);
      const marcas: string[] = [];
      for (const [i, esperada] of esperadas.entries()) {
        const pregunta = preguntas.nth(i);
        const marcaEsperada = esperada.acerto ? TEXTOS.acerto : TEXTOS.fallo;
        marcas.push(marcaEsperada);
        await expect(pregunta.getByRole("heading", { level: 3 }), `encabezado de la pregunta ${i + 1}`).toHaveText(`Pregunta ${i + 1} ${marcaEsperada}`);
        await expect(pregunta.locator(":scope > div").first(), `enunciado de la pregunta ${i + 1}`).toHaveText(esperada.enunciado);

        const opciones = pregunta.locator(":scope > ul > li");
        await expect(opciones).toHaveCount(4);
        for (const [j, opcion] of esperada.opciones.entries()) {
          const fila = opciones.nth(j);
          await expect(fila.locator(":scope > span").first(), `letra ${j + 1} de la pregunta ${i + 1}`).toHaveText(opcion.letra);
          await expect(fila.locator(".texto-banco"), `texto de la opción ${opcion.letra} de la pregunta ${i + 1}`).toHaveText(opcion.texto);
          await expect(fila.getByText(TEXTOS.eligio, { exact: true }), `«Eligió» en ${opcion.letra} de la pregunta ${i + 1}`).toHaveCount(opcion.letra === esperada.letraElegida ? 1 : 0);
          await expect(fila.getByText(TEXTOS.correcta, { exact: true }), `«Correcta» en ${opcion.letra} de la pregunta ${i + 1}`).toHaveCount(opcion.letra === esperada.letraCorrecta ? 1 : 0);
        }
        if (esperada.solucion === null) {
          await expect(pregunta.getByRole("heading", { level: 4 })).toHaveCount(0);
        } else {
          await expect(pregunta.getByRole("heading", { level: 4, name: TEXTOS.solucion })).toHaveCount(1);
          await expect(pregunta.locator(":scope > div").nth(1)).toContainText(esperada.solucion);
        }
      }
      expect(marcas.filter((m) => m === TEXTOS.fallo)).toHaveLength(3);
      expect(marcas.filter((m) => m === TEXTOS.acerto)).toHaveLength(aciertosDe(plan));
      // La letra del banco no es la que se ve: en la pregunta 1 (orden CADB) la correcta del banco es la B y se ve como D.
      expect(esperadas[0].letraCorrecta).toBe("D");
    });

    await test.step("criterio 13: ni la agenda ni el detalle traen el correo, el teléfono, el token, la semilla, las claves, los ids ni las cifras de pago", async () => {
      const prohibidos = [
        lead.correo,
        lead.telefono,
        diagnostico.token,
        String(SEMILLA_SEMBRADA),
        lead.id,
        diagnostico.id,
        "faltaMaterial",
        "falta_material",
        "sin_preguntas_sin_ver",
        "tope_una_respuesta",
        ...CIFRAS_PROHIBIDAS,
        ...valoresInternos(plan, marca),
        ...textosDeErrorDeLasQueNoEligio(plan, marca),
      ];
      for (const ruta of [RUTA_DE_LA_AGENDA, rutaDelDetalle(idCita)]) {
        await page.goto(ruta);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible(ESPERA);
        for (const fuente of await fuentesDe(page, ruta)) {
          for (const prohibido of prohibidos) expect(fuente.texto.includes(prohibido), `${fuente.nombre} de ${ruta} trae ${prohibido}`).toBe(false);
          expect(fuente.texto, `${fuente.nombre} de ${ruta} sin dominios de correo de los Leads`).not.toMatch(/lead-[0-9a-f-]{36}@/);
        }
      }
      const visible = await textoVisible(page);
      expect(visible).not.toContain("$");
      expect(visible).not.toMatch(/comisi[oó]n/i);
    });

    await test.step("el detalle se sirve privado: Cache-Control sin «public», y la página no se indexa", async () => {
      const respuesta = await page.request.get(rutaDelDetalle(idCita));
      const cache = respuesta.headers()["cache-control"] ?? "";
      expect(cache, "Cache-Control del detalle").toMatch(/private|no-store|no-cache/);
      expect(cache, "Cache-Control del detalle").not.toMatch(/public/);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Versión vieja de la autorización y diagnóstico no repetido (criterios 14 y 15)
// ---------------------------------------------------------------------------
test.describe("Un Lead que autorizó con el texto viejo", () => {
  test("el monitor ve el resultado y no las respuestas (ni en el HTML ni en el flujo RSC), sin la nota de repetido; al pasar el Lead a v2 la misma cita ya las trae", async ({ page, escenario }) => {
    const materia = await escenario.materia();
    const monitor = await escenario.monitorCertificado(materia);
    const franja = await escenario.franja(monitor, { hora: "09:00", duracionMin: 60, presencial: false });
    const lead = await escenario.lead("Mateo", "v1");
    const diagnostico = await escenario.diagnostico(materia, lead, { repetido: false });
    const idCita = await escenario.monitoria(monitor, materia, franja, lead, enSemanas(1), { estado: "confirmada", idDiagnostico: diagnostico.id });
    const esperadas = preguntasEsperadas(diagnostico.plan, diagnostico.marca);

    await entrar(page, rutaDelDetalle(idCita), monitor);
    await expect(tituloDe(page, `Diagnóstico de ${lead.nombre}`)).toBeVisible(ESPERA);

    await test.step("con el texto viejo ve el resto de la vista y el mensaje de «no autorizó»", async () => {
      await expect(region(page, TEXTOS.resumen)).toContainText("5 de 8 correctas");
      await expect(region(page, TEXTOS.habilidades).locator(":scope > ul > li")).toHaveCount(5);
      await expect(region(page, TEXTOS.errores).locator(":scope > ul > li")).toHaveCount(4);
      await expect(region(page, TEXTOS.prerrequisitos).locator(":scope > ul > li")).toHaveCount(4);
      const preguntas = region(page, TEXTOS.preguntas);
      await expect(preguntas).toContainText(HU.noAutorizo);
      await expect(preguntas.locator("li")).toHaveCount(0);
      await expect(page.getByRole("status")).toHaveCount(1);
      // Ninguna pregunta: el único h3 de la página es el de «Qué trabajar en la monitoría», dentro del resumen (HU-110).
      await expect(preguntas.getByRole("heading", { level: 3 })).toHaveCount(0);
    });

    await test.step("sin la nota de repetido", async () => {
      await expect(page.getByText("Lo tomó otra vez")).toHaveCount(0);
    });

    await test.step("ningún texto de enunciado, opción ni solución sale en el HTML, en la página abierta ni en el flujo RSC", async () => {
      for (const fuente of await fuentesDe(page, rutaDelDetalle(idCita))) {
        // Ni un enunciado, ni una opción, ni una solución. (La marca sí puede salir: va también en el texto de error de la opción que
        // eligió, que es el detalle de un error y se muestra aunque no haya autorizado compartir las respuestas, D-49 d.)
        for (const e of esperadas) {
          for (const texto of [e.enunciado, e.solucion ?? "", ...e.opciones.map((o) => o.texto)].filter(Boolean)) {
            expect(fuente.texto.includes(texto), `${fuente.nombre} trae «${texto}»`).toBe(false);
          }
        }
      }
    });

    await test.step("D-67: el Lead edita su contacto con el texto nuevo (v2) y, al recargar, la misma cita trae las 8 preguntas y ya no el mensaje", async () => {
      await escenario.cambiarVersionDelLead(lead, "v2");
      await page.reload();
      await expect(tituloDe(page, `Diagnóstico de ${lead.nombre}`)).toBeVisible(ESPERA);
      await expect(region(page, TEXTOS.preguntas).locator(":scope > ol > li")).toHaveCount(8);
      await expect(page.getByText(HU.noAutorizo)).toHaveCount(0);
      await expect(page.getByRole("status")).toHaveCount(0);
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Estados, plazo, direcciones, sin diagnóstico y borrado (criterios 6 a 9 y 11)
// ---------------------------------------------------------------------------
test.describe("Qué citas llevan enlace y qué responde cada dirección", () => {
  test("hay enlace en la confirmada, en la que tiene un pago rechazado y en la realizada hace 29 días; no en la reserva (vigente o vencida), la cancelada ni la realizada hace 31 días; y cada dirección que no se ve responde el mismo 404", async ({ page, browser, escenario }, testInfo) => {
    const materia = await escenario.materia();
    const monitor = await escenario.monitorCertificado(materia);
    const otroMonitor = await escenario.monitorCertificado(materia);
    const franja = await escenario.franja(monitor, { hora: "16:00", duracionMin: 60, presencial: true });
    // Las realizadas empiezan a las 00:30 y duran 90 minutos: su fin queda a un lado y al otro de los 30 días sea cual sea la hora a la que corra la prueba.
    const hace29 = sumarDias(hoy(), -29);
    const hace31 = sumarDias(hoy(), -31);
    const franja29 = await escenario.franja(monitor, { hora: "00:30", duracionMin: 90, presencial: true, dia: diaIso(hace29) });
    const franja31 = await escenario.franja(monitor, { hora: "00:30", duracionMin: 90, presencial: true, dia: diaIso(hace31) });
    // Los bordes de los 30 días, a cualquier hora del día: terminan a las 23:59 de hace 30 y de hace 31 días, así que al ahora le faltan
    // 29 días y un minuto más lo que va del día para el primero (dentro: se ve hasta las 23:59 de hoy) y 30 días y un minuto más lo que
    // va del día para el segundo (fuera). Un plazo de 29 días deja fuera al primero y uno de 31 deja dentro al segundo, a cualquier hora.
    const hace30 = sumarDias(hoy(), -30);
    const franjaDentro = await escenario.franja(monitor, { hora: "23:00", duracionMin: 59, presencial: true, dia: diaIso(hace30) });
    const franjaFuera = await escenario.franja(monitor, { hora: "23:00", duracionMin: 59, presencial: true, dia: diaIso(hace31) });
    // La que ya empezó y espera ser finalizada: ayer de 11 a 12 de la noche, así que hoy no la cierra sola el proceso de cada 15 minutos
    // (D-14: fin + 24 horas) y sigue en «Por finalizar» a cualquier hora del día.
    const ayer = sumarDias(hoy(), -1);
    const franjaDeAyer = await escenario.franja(monitor, { hora: "23:00", duracionMin: 60, presencial: true, dia: diaIso(ayer) });

    const [confirmada, conPagoRechazado, realizada29, realizada31, vigente, vencida, cancelada, grupal, sinDiagnostico, aBorrar, dentroPorPoco, fueraPorPoco] =
      await Promise.all([
      escenario.lead("Confirmada"),
      escenario.lead("Pago rechazado"),
      escenario.lead("Realizada 29"),
      escenario.lead("Realizada 31"),
      escenario.lead("Reserva vigente"),
      escenario.lead("Reserva vencida"),
      escenario.lead("Cancelada"),
      escenario.lead("Grupal"),
      escenario.lead("Sin diagnostico"),
      escenario.lead("A borrar"),
      escenario.lead("Dentro por poco"),
      escenario.lead("Fuera por poco"),
    ]);
    const dx = (lead: Lead) => escenario.diagnostico(materia, lead);
    const [dConfirmada, dRechazado, d29, d31, dVigente, dVencida, dCancelada, dGrupal, dABorrar, dDentro, dFuera] = await Promise.all([
      dx(confirmada),
      dx(conPagoRechazado),
      dx(realizada29),
      dx(realizada31),
      dx(vigente),
      dx(vencida),
      dx(cancelada),
      dx(grupal),
      dx(aBorrar),
      dx(dentroPorPoco),
      dx(fueraPorPoco),
    ]);

    const idConfirmada = await escenario.monitoria(monitor, materia, franja, confirmada, enSemanas(1), { estado: "confirmada", idDiagnostico: dConfirmada.id });
    // P-24: la sesión ya empezó y el pago se rechazó; la cita sigue confirmada (y espera ser finalizada).
    const idRechazado = await escenario.monitoria(monitor, materia, franjaDeAyer, conPagoRechazado, ayer, { estado: "confirmada", idDiagnostico: dRechazado.id });
    await escenario.pago(idRechazado, "rechazado");
    // La finalización no es el fin de la sesión: la de 29 días se finalizó hace 40 y la de 31 hoy; el plazo cuenta desde el fin programado.
    const id29 = await escenario.monitoria(monitor, materia, franja29, realizada29, hace29, { estado: "realizada", idDiagnostico: d29.id, finalizadaHaceDias: 40 });
    const id31 = await escenario.monitoria(monitor, materia, franja31, realizada31, hace31, { estado: "realizada", idDiagnostico: d31.id, finalizadaHaceDias: 0 });
    const idDentro = await escenario.monitoria(monitor, materia, franjaDentro, dentroPorPoco, hace30, { estado: "realizada", idDiagnostico: dDentro.id });
    const idFuera = await escenario.monitoria(monitor, materia, franjaFuera, fueraPorPoco, hace31, { estado: "realizada", idDiagnostico: dFuera.id });
    const idVigente = await escenario.monitoria(monitor, materia, franja, vigente, enSemanas(2), { estado: "pendiente_pago", idDiagnostico: dVigente.id });
    const idVencida = await escenario.monitoria(monitor, materia, franja, vencida, enSemanas(3), { estado: "pendiente_pago", idDiagnostico: dVencida.id, apartadaHaceMin: 11 });
    const idCancelada = await escenario.monitoria(monitor, materia, franja, cancelada, enSemanas(-2), { estado: "cancelada", idDiagnostico: dCancelada.id });
    const idGrupal = await escenario.monitoria(monitor, materia, franja, grupal, enSemanas(4), { estado: "confirmada", idDiagnostico: dGrupal.id });
    await escenario.volverGrupal(idGrupal);
    const idSinDiagnostico = await escenario.monitoria(monitor, materia, franja, sinDiagnostico, enSemanas(5), { estado: "confirmada" });
    const idABorrar = await escenario.monitoria(monitor, materia, franja, aBorrar, enSemanas(6), { estado: "confirmada", idDiagnostico: dABorrar.id });

    // La reserva vencida la puede cancelar el proceso de cada minuto (HU-027) antes de que se lea la agenda: sigue sin enlace.
    await entrar(page, RUTA_DE_LA_AGENDA, monitor);
    await expect(tituloDe(page, "Mi agenda")).toBeVisible(ESPERA);

    await test.step("criterio 8 y 9: enlaces solo en confirmada, confirmada con pago rechazado y realizada hace 29 días", async () => {
      for (const [lead, id, nombre] of [
        [confirmada, idConfirmada, "confirmada"],
        [conPagoRechazado, idRechazado, "confirmada con un pago rechazado (P-24)"],
        [realizada29, id29, "realizada hace 29 días"],
        [dentroPorPoco, idDentro, "realizada: terminó hace poco más de 29 días"],
      ] as [Lead, string, string][]) {
        const tarjeta = tarjetaDe(page, lead);
        await expect(tarjeta, nombre).toHaveCount(1);
        await expect(enlaceDeDiagnostico(tarjeta), nombre).toHaveAttribute("href", rutaDelDetalle(id));
        await expect(tarjeta.locator(":scope > span"), `${nombre}: sus renglones no cambian`).toHaveCount(lead === conPagoRechazado ? 5 : 4);
      }
      // La del pago rechazado está en «Por finalizar»: el enlace va antes del botón de finalizar.
      expect(await escenario.estadoDe(idRechazado), "el pago rechazado de una sesión que ya empezó no cancela la cita").toBe("confirmada");
      for (const [lead, nombre] of [
        [vigente, "reserva vigente"],
        [vencida, "reserva vencida"],
        [cancelada, "cancelada"],
        [realizada31, "realizada hace 31 días"],
        [fueraPorPoco, "realizada: terminó hace poco más de 30 días"],
      ] as [Lead, string][]) {
        const tarjeta = tarjetaDe(page, lead);
        await expect(tarjeta, nombre).toHaveCount(1);
        await expect(enlaceDeDiagnostico(tarjeta), `${nombre} no lleva enlace`).toHaveCount(0);
        await expect(tarjeta.getByRole("link"), `${nombre} no lleva ningún enlace`).toHaveCount(0);
      }
      // Sin enlace tampoco hay un aviso que lo explique (D-54: «sin avisos»).
      await expect(page.getByRole("status")).toHaveCount(0);
      const visible = await textoVisible(page);
      expect(visible).not.toMatch(/no se puede ver|ya no está disponible|venci[oó] el plazo del diagn/i);
    });

    await test.step("criterio 11: la dirección de cada cita que no se ve responde lo mismo que un id inexistente y que un id que no es UUID", async () => {
      const inexistente = await respuestaDe(page, rutaDelDetalle(UUID_INEXISTENTE));
      expect(inexistente).toEqual({ status: 404, titulo: HU.noEncontrada });
      expect(await respuestaDe(page, `${RUTA_DE_LA_AGENDA}/no-es-un-uuid`), "un id que no es UUID").toEqual(inexistente);
      expect(await respuestaDe(page, `${RUTA_DE_LA_AGENDA}/${idSinDiagnostico.toUpperCase().slice(0, 30)}`), "un UUID cortado").toEqual(inexistente);
      for (const [id, nombre] of [
        [idVigente, "reserva vigente"],
        [idVencida, "reserva vencida"],
        [idCancelada, "cancelada"],
        [id31, "realizada hace 31 días"],
        [idFuera, "realizada: terminó hace poco más de 30 días"],
        [idGrupal, "grupal (HU-040 decide)"],
      ] as [string, string][]) {
        expect(await respuestaDe(page, rutaDelDetalle(id)), nombre).toEqual(inexistente);
      }
      // Las que sí se ven abren el detalle (también la realizada de 29 días).
      for (const [id, lead] of [
        [id29, realizada29],
        [idDentro, dentroPorPoco],
        [idRechazado, conPagoRechazado],
      ] as [string, Lead][]) {
        expect(await respuestaDe(page, rutaDelDetalle(id))).toEqual({ status: 200, titulo: `Diagnóstico de ${lead.nombre}` });
      }
    });

    await test.step("criterio 11: otro monitor que escribe la dirección de una cita ajena ve el mismo 404", async () => {
      const contexto = await contextoAparte(browser, testInfo, page);
      try {
        const otra = await contexto.newPage();
        await entrar(otra, RUTA_DE_LA_AGENDA, otroMonitor);
        const inexistente = await respuestaDe(otra, rutaDelDetalle(UUID_INEXISTENTE));
        expect(inexistente).toEqual({ status: 404, titulo: HU.noEncontrada });
        expect(await respuestaDe(otra, rutaDelDetalle(idConfirmada)), "una cita ajena que sí se vería").toEqual(inexistente);
        expect(await respuestaDe(otra, rutaDelDetalle(id29)), "una realizada ajena dentro del plazo").toEqual(inexistente);
        const html = await otra.content();
        expect(html).not.toContain(confirmada.nombre);
        expect(html).not.toContain(dConfirmada.marca);
      } finally {
        await contexto.close();
      }
    });

    await test.step("criterio 6: una cita visible sin diagnóstico ligado muestra el mensaje y no un error", async () => {
      const respuesta = await page.goto(rutaDelDetalle(idSinDiagnostico));
      expect(respuesta?.status()).toBe(200);
      await expect(tituloDe(page, `Diagnóstico de ${sinDiagnostico.nombre}`)).toBeVisible(ESPERA);
      await expect(page.getByText(HU.sinDiagnostico)).toBeVisible();
      await expect(page.getByRole("status")).toHaveCount(1);
      await expect(alertas(page)).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
      await expect(page.getByText("Lo tomó otra vez")).toHaveCount(0);
    });

    await test.step("criterio 7: se borra el diagnóstico (supresión de datos) y, al recargar la cita, dice lo mismo", async () => {
      await page.goto(rutaDelDetalle(idABorrar));
      await expect(region(page, TEXTOS.resumen)).toBeVisible(ESPERA);
      await escenario.borrarDiagnostico(dABorrar.id);
      await page.reload();
      await expect(tituloDe(page, `Diagnóstico de ${aBorrar.nombre}`)).toBeVisible(ESPERA);
      await expect(page.getByText(HU.sinDiagnostico)).toBeVisible();
      await expect(region(page, TEXTOS.resumen)).toHaveCount(0);
      await expect(alertas(page)).toHaveCount(0);
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Otros roles (criterios 10 y 11)
// ---------------------------------------------------------------------------
test.describe("Quien no es monitor no llega al detalle", () => {
  test("un admin va a /admin; una sesión anónima con Lead y un visitante sin sesión van a /ingresar con la dirección en ?siguiente=, y no ven nada", async ({ page, browser, cuentas, escenario }, testInfo) => {
    const materia = await escenario.materia();
    const monitor = await escenario.monitorCertificado(materia);
    const franja = await escenario.franja(monitor, { hora: "11:00", duracionMin: 60, presencial: true });
    const lead = await escenario.lead("Estudiante ajena", "v2");
    const diagnostico = await escenario.diagnostico(materia, lead);
    const idCita = await escenario.monitoria(monitor, materia, franja, lead, enSemanas(1), { estado: "confirmada", idDiagnostico: diagnostico.id });
    const ruta = rutaDelDetalle(idCita);
    const sinNada = async (p: Page) => {
      const html = await p.content();
      expect(html).not.toContain(lead.nombre);
      expect(html).not.toContain(diagnostico.marca);
      await expect(p.getByRole("heading", { level: 1, name: /^Diagnóstico de / })).toHaveCount(0);
    };

    await test.step("un admin que escribe la dirección va a su panel", async () => {
      const admin = await cuentas.crearAdmin();
      await page.goto("/ingresar");
      await enviarCredenciales(page, admin.correo, admin.contrasena);
      await expect(page).toHaveURL("/admin", ESPERA);
      await page.goto(ruta);
      await expect(page).toHaveURL("/admin", ESPERA);
      await expect(page.getByRole("heading", { level: 1, name: `Hola, ${admin.nombre}` })).toBeVisible();
      await sinNada(page);
      // Con un id que no es UUID pasa lo mismo: el rol se comprueba antes que el id.
      await page.goto(`${RUTA_DE_LA_AGENDA}/no-es-un-uuid`);
      await expect(page).toHaveURL("/admin", ESPERA);
    });

    await test.step("una sesión anónima con Lead va a /ingresar y no ve nada", async () => {
      const contexto = await contextoAparte(browser, testInfo, page);
      try {
        const anonima = await contexto.newPage();
        await anonima.goto("/monitores");
        await anonima.waitForLoadState("networkidle");
        const sesion = await esperarSesion(contexto);
        cuentas.borrarAlFinal(sesion.id);
        await escenario.lead("Dueña de la sesión", "v2", sesion.id);
        await anonima.goto(ruta);
        await expect(anonima).toHaveURL(`/ingresar?siguiente=${encodeURIComponent(ruta)}`, ESPERA);
        await expect(anonima.getByLabel("Correo")).toBeVisible();
        await sinNada(anonima);
      } finally {
        await contexto.close();
      }
    });

    await test.step("un visitante sin sesión va a /ingresar; un id basura no viaja en ?siguiente=", async () => {
      const contexto = await browser.newContext({
        baseURL: testInfo.project.use.baseURL,
        locale: "es-CO",
        timezoneId: "America/Bogota",
        viewport: page.viewportSize() ?? undefined,
      });
      try {
        const visitante = await contexto.newPage();
        // Sin alta anónima: la prueba no la necesita y así no gasta el cupo por IP del Auth.
        await visitante.route("**/auth/v1/signup", (r) => r.abort());
        await visitante.goto(ruta);
        await expect(visitante).toHaveURL(`/ingresar?siguiente=${encodeURIComponent(ruta)}`, ESPERA);
        await expect(visitante.getByLabel("Correo")).toBeVisible();
        await sinNada(visitante);
        await visitante.goto(`${RUTA_DE_LA_AGENDA}/no-es-un-uuid`);
        await expect(visitante).toHaveURL(`/ingresar?siguiente=${encodeURIComponent(RUTA_DE_LA_AGENDA)}`, ESPERA);
      } finally {
        await contexto.close();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Reglas del producto, teclado y panel (criterios 16 y 17)
// ---------------------------------------------------------------------------
test.describe("Las reglas del producto, a 390 px y a 1280 px", () => {
  test("con una Evaluación de 18 habilidades, un nombre largo sin espacios y la fórmula más ancha del banco: sin desborde, texto de 14 px o más, áreas de 44 px o más, todo control con nombre, el teclado llega a todo y el panel dice el texto nuevo", async ({ page, escenario }) => {
    const materia = await escenario.materia();
    const monitor = await escenario.monitorCertificado(materia);
    const franja = await escenario.franja(monitor, { hora: "18:00", duracionMin: 45, presencial: false });
    // Un nombre largo y sin espacios: la tarjeta y el título tienen que partirlo en vez de desbordar la pantalla.
    const sufijoLargo = randomUUID().replaceAll("-", "");
    const lead = await escenario.lead(`Sebastiano${sufijoLargo}${sufijoLargo}`, "v2");
    const marca = `m${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const plan = planDeEjemplo();
    // La fórmula más ancha del banco en una opción (la correcta de la pregunta 1) y un enunciado con código en la pregunta 2.
    plan[0] = { ...plan[0], textos: { B: `$${FORMULA_MAS_ANCHA}$` } };
    plan[1] = {
      ...plan[1],
      enunciado: ["Considera el programa:", "```", "def cuadrados(n):", "    return [i * i for i in range(n)]  # una línea de código bastante larga para que el bloque tenga su propio scroll", "```", "¿Qué devuelve cuadrados(3)?"].join("\n"),
    };
    // Una descripción larga y una sin espacios en las habilidades extra.
    const resultado = resultadoGuardadoSembrado(marca, { habilidades: 18 });
    resultado.habilidades[8] = { ...resultado.habilidades[8], descripcion: `usa${"unapalabramuylargasinespacios".repeat(4)}` };
    const diagnostico = await escenario.diagnostico(materia, lead, { plan, marca, resultado, repetido: true });
    const idCita = await escenario.monitoria(monitor, materia, franja, lead, enSemanas(1), { estado: "confirmada", idDiagnostico: diagnostico.id });

    await test.step("el panel dice el texto nuevo y ya no dice «Pronto»", async () => {
      await entrar(page, "/monitor", monitor);
      await expect(page.getByText(HU.panel, { exact: true })).toBeVisible(ESPERA);
      await expect(page.getByText(/Pronto/)).toHaveCount(0);
      expect(await textoVisible(page)).not.toContain("Pronto verás aquí el diagnóstico");
      await expectReglasDelProducto(page, "el panel del monitor");
    });

    await test.step("la agenda con los enlaces «Ver diagnóstico» (y su descripción) respeta las reglas", async () => {
      await page.goto(RUTA_DE_LA_AGENDA);
      const tarjeta = tarjetaDe(page, lead);
      await expect(tarjeta).toHaveCount(1, ESPERA);
      const enlace = enlaceDeDiagnostico(tarjeta);
      await expect(enlace).toBeVisible();
      // El nombre es «Ver diagnóstico»; la descripción es el renglón de día y hora de la misma tarjeta.
      await expect(enlace).toHaveAccessibleName(HU.verDiagnostico);
      await expect(enlace).toHaveAccessibleDescription(`${formatearDiaConSemana(enSemanas(1))}, 18:00 a 18:45`);
      await expectReglasDelProducto(page, "la agenda con el enlace del diagnóstico");
    });

    await test.step("teclado: Tab llega al enlace «Ver diagnóstico» y Enter lo abre", async () => {
      await page.goto(RUTA_DE_LA_AGENDA);
      await expect(enlaceDeDiagnostico(tarjetaDe(page, lead))).toBeVisible(ESPERA);
      await tabularHasta(page, () => page.evaluate(() => document.activeElement?.textContent?.trim() === "Ver diagnóstico"));
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(rutaDelDetalle(idCita), ESPERA);
    });

    await test.step("el detalle con «Lo domina (N)» cerrado respeta las reglas", async () => {
      await expect(tituloDe(page, `Diagnóstico de ${lead.nombre}`)).toBeVisible(ESPERA);
      const dominadas = region(page, TEXTOS.habilidades).locator("details");
      // De las 18: las que domina son las 3 de las 8 primeras más las de los extras que caen en lo_domina.
      const cuantas = habilidadesSembradas(marca, 18).filter((h) => h.nivel === "lo_domina").length;
      await expect(dominadas.locator("summary")).toHaveText(`Lo domina (${cuantas})`);
      await expect(dominadas).not.toHaveAttribute("open", /.*/);
      await expect(region(page, TEXTOS.habilidades).locator(":scope > ul > li")).toHaveCount(18 - cuantas);
      await expectReglasDelProducto(page, "el detalle con Lo domina cerrado");
    });

    await test.step("el detalle con «Lo domina (N)» abierto respeta las reglas, y lo que domina también se lee", async () => {
      const dominadas = region(page, TEXTOS.habilidades).locator("details");
      await dominadas.locator("summary").click();
      await expect(dominadas).toHaveAttribute("open", /.*/);
      await expect(dominadas.locator("li").first()).toBeVisible();
      await expectReglasDelProducto(page, "el detalle con Lo domina abierto");
      await dominadas.locator("summary").click();
      await expect(dominadas).not.toHaveAttribute("open", /.*/);
    });

    await test.step("la fórmula más ancha y el bloque de código se dibujan: la fórmula es math, el código está en un pre enfocable, el enunciado en un div y no en un título, un p o un label", async () => {
      const preguntas = region(page, TEXTOS.preguntas).locator(":scope > ol > li");
      await expect(preguntas.nth(0).locator("math")).toHaveCount(1);
      expect(await preguntas.nth(0).innerText()).not.toMatch(/[$\\]/);
      const codigo = preguntas.nth(1).locator("pre");
      await expect(codigo).toHaveCount(1);
      await expect(codigo).toHaveAttribute("tabindex", "0");
      await expect(codigo).toContainText("def cuadrados(n):");
      for (const dentro of ["h1", "h2", "h3", "h4", "p", "label", "button", "a"]) {
        await expect(codigo.locator(`xpath=ancestor::${dentro}`), `el código no va dentro de un ${dentro}`).toHaveCount(0);
      }
    });

    await test.step("teclado: Tab llega al resumen de «Lo domina», Enter lo abre, y llega al bloque de código", async () => {
      await page.goto(rutaDelDetalle(idCita));
      await expect(tituloDe(page, `Diagnóstico de ${lead.nombre}`)).toBeVisible(ESPERA);
      const dominadas = region(page, TEXTOS.habilidades).locator("details");
      await expect(dominadas).not.toHaveAttribute("open", /.*/);
      await tabularHasta(page, () => page.evaluate(() => document.activeElement?.tagName === "SUMMARY"));
      await page.keyboard.press("Enter");
      await expect(dominadas).toHaveAttribute("open", /.*/);
      await tabularHasta(page, () => page.evaluate(() => document.activeElement?.tagName === "PRE"), 120);
      expect(await page.evaluate(() => document.activeElement?.textContent ?? "")).toContain("def cuadrados(n):");
    });

    await test.step("el HTML del detalle largo tampoco trae lo que no debe", async () => {
      for (const fuente of await fuentesDe(page, rutaDelDetalle(idCita))) {
        for (const prohibido of [lead.correo, lead.telefono, diagnostico.token, ...valoresInternos(plan, marca)]) {
          expect(fuente.texto.includes(prohibido), `${fuente.nombre} trae ${prohibido}`).toBe(false);
        }
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Las reglas del producto sobre la página abierta (copia de la `medir` por elemento de resolver-reportes.spec.ts)
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

/**
 * Texto, áreas táctiles (enlaces, botones y el resumen de un `details`), degradados, nombres y desborde. `html` y `body` llevan
 * `overflow-x: hidden` (globals.css): el scroll horizontal nunca aparece aunque el contenido se desborde, así que `scrollWidth` de la
 * página no lo delata. Se mide cada elemento a la vista: que su caja no se salga de la ventana y que su contenido (un texto largo sin
 * espacios, por ejemplo) no se salga de su propia caja. Lo que está dentro de un `details` cerrado no tiene caja y no se ve: por eso
 * el detalle se mide con «Lo domina (N)» cerrado y abierto. El `pre` de un bloque de código y una fórmula con scroll propio quedan
 * fuera: su scroll interno es legítimo (HU-083) y se prueba aparte.
 */
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
    const ancho = window.innerWidth;
    const conScroll = (math: Element | null) => math !== null && math.scrollWidth > math.clientWidth + 1;
    const desbordados = [...document.body.querySelectorAll<HTMLElement>("*")]
      .filter((el) => visible(el) && !el.closest("nextjs-portal") && !el.closest("pre") && !conScroll(el.closest("math")))
      .flatMap((el) => {
        const caja = el.getBoundingClientRect();
        const fueraDeLaVentana = caja.right > ancho + 1 || caja.left < -1;
        // El `scrollWidth` de un campo de texto es el de su contenido o su marcador, que se desplaza dentro del campo: no es un desborde.
        const esCampo = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
        const contenidoFueraDeSuCaja = !esCampo && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1;
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
