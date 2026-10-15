import { randomBytes, randomUUID } from "node:crypto";
import type { Browser, BrowserContext, Page, Response } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Client } from "pg";
import { sembrarDiagnostico, CLAVES_INTERNAS_DE_EJEMPLO, type DiagnosticoSembrado } from "../pruebas/diagnostico-sembrado";
import { desescaparComillas } from "../pruebas/flujo-recibido";
import { formatearDia } from "../src/lib/fechas";
import { abrirConexion } from "./banco-del-proyecto";
import { correoUnico, crearClienteAdmin, esperarCorreo, esperarSesion, expect, leerSesion, test as base, variable } from "./utilidades";

// HU-031: recuperar los resultados del diagnóstico desde otro dispositivo, con el enlace `/resultados?token=` del correo. Se corre
// en el movil (390×844) y en el escritorio (1280×800) contra el Supabase local y Mailpit. La lógica del token, del reconstructor y de
// la proyección está en los Vitest y en la integración; aquí se prueba lo que solo se ve en un navegador: el correo que llega, el
// enlace abierto en un contexto sin cookies, lo que ese navegador recibe, las cabeceras y las medidas de la pantalla.
//
// - Dos contextos de Playwright: el primero (la fixture `page`) hace de la persona que deja su contacto debajo del resultado
//   (HU-010) y recibe el correo; el segundo (`browser.newContext`) es "otro dispositivo": sin cookies ni sesión.
// - El diagnóstico se siembra con `sembrarDiagnostico` (como las pruebas «HU-010» de e2e/diagnostico.spec.ts): hacerlo a mano ya
//   lo prueba esa spec. La materia y su Evaluación son de esta prueba (código `E2E-RR-…` al azar) y no las del banco del proyecto:
//   el banco de e2e/diagnostico.spec.ts lo carga y lo borra otro trabajador al mismo tiempo, y ese borrado por código se llevaría
//   por delante nuestros datos. La Evaluación nace apagada (`activa = false`): el enlace se arma con lo guardado (criterio 9).
// - Cada prueba crea sus datos con nombres y correos al azar y los borra al terminar, aunque falle (`escenario`).
// - Criterio 7 sin conteos globales: con `fullyParallel`, otras specs crean usuarios de Auth, sesiones y diagnósticos al mismo
//   tiempo y un conteo de toda la tabla fallaría por azar. Lo que prueba que abrir el enlace no crea nada es lo que solo depende
//   de este contexto: ninguna cookie `sb-…`, ningún intento de alta anónima (`/auth/v1/signup` interceptado) y los conteos de lo
//   que es de esta prueba (los diagnósticos de su materia y las sesiones ligadas a su Lead).

const ESPERA = { timeout: 20_000 };

const TITULO_DEL_RESULTADO = "Tu resultado";
const TITULO_NO_SIRVE = "Este enlace no sirve";
const TITULO_DEL_CONTACTO = /Déjanos tu contacto/;
const AUTORIZO = /Autorizo a Calibra a tratar mis datos personales/;
const SIN_CITAS = "No tienes citas en este navegador.";
const NOMBRE_DE_LA_EVALUACION = "Parcial 1";
const TELEFONO = "+573001234567";
/** 5 de 8; es del 4 de octubre en Bogotá y del 5 en UTC. */
const FECHA_DEL_DIAGNOSTICO = "2026-10-05T03:30:00+00:00";
const DIA_EN_BOGOTA = "2026-10-04";
const REGIONES = ["Habilidades", "Errores", "Conviene repasar antes"] as const;
const TOKEN = /^[0-9a-f]{64}$/;
/** Del correo no puede salir nada del resultado: ni niveles, ni errores, ni puntaje. */
const DEL_RESULTADO_EN_EL_CORREO = /Puntaje|Lo dominas|En proceso|No lo dominas|Sin medir|Error detectado|Posible error|63\s?%|Acertaste/i;
/** Las claves que nunca llegan al navegador, entre comillas como las deja el JSON (ver `desescaparComillas`). */
const CLAVES_PROHIBIDAS = [
  '"dificultad"',
  '"misconcepcion"',
  '"solucion"',
  '"correcta"',
  '"respuestas"',
  '"semilla"',
  '"token_recuperacion"',
  '"faltaMaterial"',
  '"falta_material"',
  '"repetido"',
  '"puntaje"',
  '"id_lead"',
];

const titulo = (page: Page, nombre: string) => page.getByRole("heading", { level: 1, name: nombre, exact: true });

// ---------------------------------------------------------------------------
// Fixture: la materia, el Lead y los diagnósticos de la prueba, y su limpieza
// ---------------------------------------------------------------------------

type Materia = { id: string; nombre: string; codigo: string };
type LeadDePrueba = { id: string; nombre: string; correo: string };

type Escenario = {
  admin: SupabaseClient;
  /** La conexión `pg` que pide `sembrarDiagnostico`. */
  bd: Client;
  materia: Materia;
  idEvaluacion: string;
  /** Un Lead con correo, sin pasar por la app (no sale ningún correo): para las pruebas que no son del envío. */
  crearLead(): Promise<LeadDePrueba>;
  /** Un diagnóstico terminado, con el Lead dado o con una sesión (un usuario de Auth cualquiera) como dueña. */
  sembrar(dueno: { idLead: string } | { idSesion: string }): Promise<DiagnosticoSembrado>;
  /** Un usuario de Auth que no es de nadie más: la dueña de un diagnóstico sin Lead. */
  crearSesion(): Promise<string>;
  /** Anota lo que creó la app (un Lead o una sesión anónima) para borrarlo al final. */
  anotarCorreo(correo: string): void;
  anotarSesion(id: string): void;
};

const test = base.extend<{ escenario: Escenario }>({
  escenario: async ({}, entregar) => {
    const admin = crearClienteAdmin();
    const bd = await abrirConexion();
    const correos = new Set<string>();
    const sesiones = new Set<string>();
    const sufijo = randomUUID().slice(0, 8);
    let materia: Materia | undefined;

    try {
      const nombre = `Materia de prueba RR ${sufijo}`;
      const codigo = `E2E-RR-${sufijo}`;
      const { data: fila, error } = await admin.from("materia").insert({ nombre, codigo }).select("id").single();
      if (error) throw new Error(`insertar la materia: ${error.message}`);
      materia = { id: fila.id as string, nombre, codigo };
      const { data: evaluacion, error: errorDeEvaluacion } = await admin
        .from("evaluacion")
        .insert({ id_materia: materia.id, semana: 1, nombre: NOMBRE_DE_LA_EVALUACION, clave: "parcial-1", activa: false })
        .select("id")
        .single();
      if (errorDeEvaluacion) throw new Error(`insertar la Evaluación: ${errorDeEvaluacion.message}`);
      const idEvaluacion = evaluacion.id as string;

      await entregar({
        admin,
        bd,
        materia,
        idEvaluacion,
        async crearLead() {
          const correo = correoUnico();
          correos.add(correo);
          const { data, error: errorDelLead } = await admin
            .from("lead")
            .insert({
              nombre: "Ana Pérez",
              correo,
              numero_telefono: TELEFONO,
              acepta_tratamiento_datos: true,
              fecha_consentimiento: new Date().toISOString(),
            })
            .select("id")
            .single();
          if (errorDelLead) throw new Error(`insertar el Lead: ${errorDelLead.message}`);
          return { id: data.id as string, nombre: "Ana Pérez", correo };
        },
        sembrar: (dueno) =>
          sembrarDiagnostico(bd, {
            idEvaluacion,
            fecha: FECHA_DEL_DIAGNOSTICO,
            ...("idLead" in dueno ? { idLead: dueno.idLead } : { idSesionAnonima: dueno.idSesion }),
          }),
        async crearSesion() {
          const { data, error: errorDeUsuario } = await admin.auth.admin.createUser({ email: correoUnico(), email_confirm: true });
          if (errorDeUsuario) throw new Error(`crear el usuario de la sesión: ${errorDeUsuario.message}`);
          sesiones.add(data.user.id);
          return data.user.id;
        },
        anotarCorreo: (correo) => void correos.add(correo),
        anotarSesion: (id) => void sesiones.add(id),
      });
    } finally {
      // Se borra todo lo de la prueba aunque haya fallado, en el orden de las llaves: diagnósticos, Leads (con su registro de
      // correos y el buzón), la Evaluación y la materia, y al final las sesiones.
      const fallos: string[] = [];
      const intentar = async (contexto: string, accion: PromiseLike<{ error: { message: string } | null }>) => {
        const { error } = await accion;
        if (error && !/not found/i.test(error.message)) fallos.push(`${contexto}: ${error.message}`);
      };
      const lista = [...correos];
      const ids = [...sesiones];
      if (materia) await intentar("diagnostico de la materia", admin.from("diagnostico").delete().eq("id_materia", materia.id));
      const leads = new Set<string>();
      const { data: porCorreo } = await admin.from("lead").select("id").in("correo", lista);
      const { data: porSesion } = ids.length ? await admin.from("lead").select("id").in("id_sesion_anonima", ids) : { data: [] };
      for (const { id } of [...(porCorreo ?? []), ...(porSesion ?? [])] as { id: string }[]) leads.add(id);
      if (leads.size) await intentar("diagnostico de los Leads", admin.from("diagnostico").delete().in("id_lead", [...leads]));
      if (lista.length) await intentar("correo_envio", admin.from("correo_envio").delete().in("destinatario", lista));
      for (const correo of lista) {
        await fetch(`${variable("MAILPIT_URL")}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`, { method: "DELETE" }).catch(() => {});
      }
      if (leads.size) await intentar("lead", admin.from("lead").delete().in("id", [...leads]));
      if (materia) {
        await intentar("evaluacion", admin.from("evaluacion").delete().eq("id_materia", materia.id));
        await intentar("materia", admin.from("materia").delete().eq("id", materia.id));
      }
      for (const id of ids) await intentar(`usuario ${id}`, admin.auth.admin.deleteUser(id));
      await bd.end().catch(() => {});
      if (fallos.length) throw new Error(`No se pudo limpiar lo que creó la prueba:\n${fallos.join("\n")}`);
    }
  },
});

test.describe.configure({ timeout: 120_000 });

// ---------------------------------------------------------------------------
// Utilidades de la prueba
// ---------------------------------------------------------------------------

/** "Otro dispositivo": un contexto aparte, con las opciones del proyecto y sin cookies. No lleva el stub de Turnstile a propósito. */
async function otroDispositivo(browser: Browser): Promise<{ contexto: BrowserContext; page: Page; altas: { intentos: number } }> {
  const { baseURL, viewport, locale, timezoneId } = test.info().project.use;
  const contexto = await browser.newContext({ baseURL, viewport, locale, timezoneId });
  const page = await contexto.newPage();
  // Si algo intentara crear una sesión anónima desde este navegador, se anota y no nace.
  const altas = { intentos: 0 };
  await page.route("**/auth/v1/signup", (ruta) => {
    altas.intentos += 1;
    return ruta.abort();
  });
  return { contexto, page, altas };
}

/** Lo que es de esta prueba y nadie más toca: los diagnósticos de su materia y las sesiones ligadas a su Lead. */
async function propios(escenario: Escenario, idLead: string): Promise<{ diagnosticos: number; sesionesDelLead: number }> {
  const { count: diagnosticos, error } = await escenario.admin
    .from("diagnostico")
    .select("*", { count: "exact", head: true })
    .eq("id_materia", escenario.materia.id);
  if (error) throw new Error(`contar los diagnósticos de la materia: ${error.message}`);
  const { count: sesionesDelLead, error: errorDeSesiones } = await escenario.admin
    .from("lead_sesion")
    .select("*", { count: "exact", head: true })
    .eq("id_lead", idLead);
  if (errorDeSesiones) throw new Error(`contar las sesiones del Lead: ${errorDeSesiones.message}`);
  return { diagnosticos: diagnosticos ?? -1, sesionesDelLead: sesionesDelLead ?? -1 };
}

/** Un `Cache-Control` que nunca es público. Con `next start` (CI) las dinámicas salen privadas; `next dev` manda solo «no-cache». */
function exigirSinCachePublico(respuesta: Response | null, donde: string): void {
  const cabecera = respuesta?.headers()["cache-control"];
  expect(cabecera, `${donde}: debe traer Cache-Control`).toBeTruthy();
  expect(cabecera, `${donde}: no puede ser público ni compartido`).not.toMatch(/\bpublic\b|s-maxage/i);
  expect(cabecera, `${donde}: privado o sin caché`).toMatch(process.env.CI ? /\b(private|no-store)\b/i : /\b(private|no-store|no-cache)\b/i);
}

/** `noindex` y `no-referrer`: el enlace lleva el token, que no queda en buscadores ni se filtra por el Referer. */
async function expectNoIndexNiReferer(page: Page, donde: string): Promise<void> {
  await expect(page.locator('meta[name="robots"]'), `${donde}: robots`).toHaveAttribute("content", /noindex/);
  await expect(page.locator('meta[name="referrer"]'), `${donde}: referrer`).toHaveAttribute("content", "no-referrer");
}

/** El documento sin sus `<script>`: lo que la persona ve y los enlaces y campos que tiene, sin el flujo interno de Next. */
async function htmlVisible(page: Page): Promise<string> {
  return page.evaluate(() => {
    const copia = document.documentElement.cloneNode(true) as HTMLElement;
    copia.querySelectorAll("script").forEach((script) => script.remove());
    return copia.outerHTML;
  });
}

async function textosDeRegiones(page: Page): Promise<string[]> {
  return Promise.all(REGIONES.map((nombre) => page.getByRole("region", { name: nombre, exact: true }).innerText()));
}

/** El bloque de contacto de HU-010 no se dibuja: el visitante ya es Lead. */
async function expectSinBloqueDeContacto(page: Page, donde: string): Promise<void> {
  await expect(page.getByRole("region", { name: TITULO_DEL_CONTACTO }), `${donde}: sin el formulario de contacto`).toHaveCount(0);
  await expect(page.getByText(TITULO_DEL_CONTACTO), `${donde}: sin «Déjanos tu contacto…»`).toHaveCount(0);
  await expect(page.getByText("Ya tenemos tu contacto"), `${donde}: sin «Ya tenemos tu contacto»`).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Guardar mis datos" }), `${donde}: sin «Guardar mis datos»`).toHaveCount(0);
  await expect(page.getByLabel("Tu correo"), `${donde}: sin el campo del correo`).toHaveCount(0);
}

/** El resultado por token, ya cargado: lo que ve la persona, sin sesión ni datos de más. */
async function expectResultado(page: Page, escenario: Escenario, donde: string): Promise<void> {
  const { materia } = escenario;
  const principal = page.locator("main");
  await expect(titulo(page, TITULO_DEL_RESULTADO), `${donde}: título`).toBeVisible(ESPERA);
  await expect(page.getByText(materia.nombre, { exact: true }), `${donde}: la materia de la cabecera`).toBeVisible();
  await expect(principal, `${donde}: la materia y la Evaluación`).toContainText(`${materia.nombre} · ${NOMBRE_DE_LA_EVALUACION}`);
  await expect(principal, `${donde}: la fecha en hora de Bogotá`).toContainText(`Fecha: ${formatearDia(DIA_EN_BOGOTA)}`);
  await expect(principal, `${donde}: las respondidas`).toContainText("Respondiste 8 preguntas");
  for (const nombre of REGIONES) await expect(page.getByRole("region", { name: nombre, exact: true }), `${donde}: ${nombre}`).toBeVisible();
  await expect(page.getByRole("region", { name: "Habilidades", exact: true }).getByRole("listitem")).toHaveCount(5);
  await expect(principal, `${donde}: los niveles escritos`).toContainText("Lo dominas");
  const verMonitores = page.getByRole("link", { name: `Ver monitores de ${materia.nombre}`, exact: true });
  await expect(verMonitores, `${donde}: «Ver monitores de …»`).toHaveAttribute("href", `/monitores?materia=${materia.codigo}`);
  await expectSinBloqueDeContacto(page, donde);
}

// ---------------------------------------------------------------------------
// Medidas (las mismas de e2e/diagnostico.spec.ts y e2e/agendar.spec.ts)
// ---------------------------------------------------------------------------

const TAMANOS = [
  { ancho: 390, alto: 844 },
  { ancho: 1280, alto: 800 },
] as const;

async function expectReglas(page: Page, donde: string): Promise<void> {
  const medidas = await medir(page);
  expect(medidas.sinScrollHorizontal, `${donde}: sin scroll horizontal`).toBe(true);
  expect(medidas.desbordados, `${donde}: ningún elemento se sale de la pantalla ni de su caja`).toEqual([]);
  expect(medidas.menorTexto, `${donde}: ningún texto por debajo de 14 px`).toBeGreaterThanOrEqual(14);
  expect(medidas.degradados, `${donde}: sin degradados`).toBe(0);
  expect(medidas.tactilesChicos, `${donde}: áreas táctiles de 44 px o más`).toEqual([]);
  expect(medidas.controlesSinNombre, `${donde}: todo control tiene nombre`).toEqual([]);
}

/** `html` y `body` llevan `overflow-x: hidden`: el scroll del documento nunca delata un desborde, así que se mide por elemento. */
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
    const ancho = window.innerWidth;
    const desbordados = [...document.body.querySelectorAll<HTMLElement>("*")]
      .filter((el) => visible(el) && !el.closest("nextjs-portal"))
      .flatMap((el) => {
        if (el.closest("pre") && el.tagName !== "PRE") return [];
        const caja = el.getBoundingClientRect();
        const fueraDeLaVentana = caja.right > ancho + 1 || caja.left < -1;
        const contenidoFueraDeSuCaja = el.tagName !== "PRE" && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1;
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

// ---------------------------------------------------------------------------
// Casos 1 y 2: el correo, el enlace en otro dispositivo y lo que ese navegador no deja
// ---------------------------------------------------------------------------

test("HU-031 · criterios 2, 6 y 10: al dejar su contacto llega el correo con el enlace, y en otro navegador sin cookies se ve el resultado sin crear nada", async ({
  page,
  context,
  browser,
  escenario,
}) => {
  const { materia, admin } = escenario;
  const correo = correoUnico();
  escenario.anotarCorreo(correo);

  // Contexto 1: una persona con un diagnóstico terminado en su sesión anónima, todavía sin contacto.
  await page.goto("/diagnostico");
  await expect(titulo(page, "Elige tu materia")).toBeVisible(ESPERA);
  const sesion = await esperarSesion(context);
  escenario.anotarSesion(sesion.id);
  const sembrado = await escenario.sembrar({ idSesion: sesion.id });
  const rutaDelResultado = `/diagnostico/resultado/${sembrado.id}`;
  await page.goto(rutaDelResultado);
  await expect(titulo(page, TITULO_DEL_RESULTADO)).toBeVisible(ESPERA);
  // Hidratado: el envío pasa por la espera de la sesión anónima (HU-058), como el de una persona.
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("region", { name: TITULO_DEL_CONTACTO }), "antes de dejar el contacto, el formulario está").toBeVisible();

  await test.step("deja su contacto debajo del resultado, con la autorización, y queda como Lead con su diagnóstico", async () => {
    await page.getByLabel("Tu nombre", { exact: true }).fill("Ana Pérez");
    await page.getByLabel("Tu correo", { exact: true }).fill(correo);
    await page.getByLabel("Tu teléfono (opcional)", { exact: true }).fill(TELEFONO);
    await page.getByLabel(AUTORIZO).check();
    await page.getByRole("button", { name: "Guardar mis datos" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Ya tenemos tu contacto" })).toBeVisible(ESPERA);
  });
  const { data: lead } = await admin.from("lead").select("id").eq("correo", correo).single();
  expect(lead, "el Lead debía quedar guardado").toBeTruthy();
  const idLead = (lead as { id: string }).id;

  // El resultado tal como lo ve su dueña, para compararlo con lo que ve el otro dispositivo.
  await page.goto(rutaDelResultado);
  await expect(titulo(page, TITULO_DEL_RESULTADO)).toBeVisible(ESPERA);
  const delDueno = await textosDeRegiones(page);
  expect(delDueno.every((texto) => texto.length > 0), "las tres secciones del resultado de la dueña tienen texto").toBe(true);

  const enlace = await test.step("criterio 1: llega un solo correo con el asunto, el nombre y el botón «Ver mis resultados»; sin niveles ni puntaje", async () => {
    const mensaje = await esperarCorreo(correo);
    expect(mensaje.asunto).toBe(`Tus resultados del diagnóstico de ${materia.nombre}`);
    expect(mensaje.html).toContain("Ana");
    expect(mensaje.html).toContain("Ver mis resultados");
    expect(mensaje.html, "el correo no trae niveles, errores ni puntaje").not.toMatch(DEL_RESULTADO_EN_EL_CORREO);

    const href = /href="([^"]*\/resultados\?[^"]*)"/.exec(mensaje.html)?.[1]?.replaceAll("&amp;", "&");
    expect(href, "el correo debía traer el enlace a /resultados").toBeTruthy();
    const url = new URL(href!);
    expect(url.pathname).toBe("/resultados");
    const token = url.searchParams.getAll("token");
    expect(token, "un solo parámetro token").toHaveLength(1);
    expect(token[0]).toMatch(TOKEN);
    expect(token[0], "el enlace es el token de recuperación de ese diagnóstico").toBe(sembrado.tokenDeRecuperacion);

    // Un solo correo (el del diagnóstico más reciente) y registrado con la clave del diagnóstico.
    const busqueda = await fetch(`${variable("MAILPIT_URL")}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`);
    const { messages } = (await busqueda.json()) as { messages?: unknown[] };
    expect(messages ?? [], "un solo correo para el Lead").toHaveLength(1);
    await expect
      .poll(
        async () => {
          const { data } = await admin.from("correo_envio").select("estado").eq("clave", `recuperacion_diagnostico:${sembrado.id}`).maybeSingle();
          return (data as { estado: string } | null)?.estado;
        },
        { message: "el envío queda registrado como enviado", timeout: 15_000 },
      )
      .toBe("enviado");
    return { ruta: `${url.pathname}${url.search}`, token: token[0] };
  });

  // Contexto 2: otro dispositivo, sin cookies.
  const otro = await otroDispositivo(browser);
  try {
    const propiosAntes = await propios(escenario, idLead);

    const respuesta = await test.step("abre el enlace: ve su resultado completo, sin el bloque de contacto, con cabeceras y metas privadas", async () => {
      const primera = await otro.page.goto(enlace.ruta);
      expect(primera?.status()).toBe(200);
      exigirSinCachePublico(primera, "el resultado por token");
      await expectResultado(otro.page, escenario, "el enlace del correo");
      await expectNoIndexNiReferer(otro.page, "el resultado por token");
      expect(await textosDeRegiones(otro.page), "el mismo texto que ve su dueña").toEqual(delDueno);
      return primera!;
    });

    await test.step("no se creó ninguna sesión ni se dejó ningún dato", async () => {
      await otro.page.waitForLoadState("networkidle");
      const cookies = await otro.contexto.cookies();
      expect(cookies.filter((cookie) => /^sb-/.test(cookie.name)), "ninguna cookie de sesión de Supabase").toEqual([]);
      expect(leerSesion(cookies)).toBeNull();
      expect(otro.altas.intentos, "la página no intentó crear una sesión anónima").toBe(0);
      expect(await propios(escenario, idLead), "los diagnósticos de la materia y las sesiones del Lead no cambian").toEqual(propiosAntes);

      await otro.page.goto("/cita");
      await expect(otro.page.getByText(SIN_CITAS, { exact: false }), "«Mis citas» en ese navegador sigue vacío").toBeVisible(ESPERA);
      expect(leerSesion(await otro.contexto.cookies())).toBeNull();
    });

    await test.step("abrirlo otra vez, y otra más, da lo mismo y no cambia nada", async () => {
      for (const vez of [2, 3]) {
        const repetida = await otro.page.goto(enlace.ruta);
        expect(repetida?.status(), `vez ${vez}`).toBe(200);
        await expectResultado(otro.page, escenario, `la vez ${vez}`);
        expect(await textosDeRegiones(otro.page), `vez ${vez}: el mismo texto`).toEqual(delDueno);
      }
      await otro.page.waitForLoadState("networkidle");
      expect((await otro.contexto.cookies()).filter((cookie) => /^sb-/.test(cookie.name))).toEqual([]);
      expect(otro.altas.intentos).toBe(0);
      expect(await propios(escenario, idLead)).toEqual(propiosAntes);
    });

    await test.step("criterio 10: el token solo está en la URL, y el navegador no recibe datos del Lead ni del diagnóstico que no pinta el resultado", async () => {
      await otro.page.goto(enlace.ruta);
      await expectResultado(otro.page, escenario, "el enlace del correo");
      expect(otro.page.url(), "el token está en la barra de direcciones").toContain(enlace.token);

      // Lo que se ve y los enlaces y campos de la página no repiten el token. Se miden sin los `<script>`: el flujo interno de Next
      // guarda la ruta con sus parámetros, y eso no es un enlace ni un campo.
      const visible = await htmlVisible(otro.page);
      expect(visible, "ni un enlace ni un campo ni un texto repite el token").not.toContain(enlace.token);

      // Lo que llegó en la respuesta, flujo de Next incluido: nada interno ni del Lead.
      const recibido = desescaparComillas(await respuesta.text());
      expect(recibido, "se ve el flujo de la página (y por eso podría verse una clave)").toMatch(/self\.__next_f\.push/);
      const prohibidos = [
        ...CLAVES_INTERNAS_DE_EJEMPLO,
        ...CLAVES_PROHIBIDAS,
        correo,
        TELEFONO,
        "573001234567",
        idLead,
        "habilidad-secreta",
        "misc-secreta",
        "repasar-secreta",
      ];
      for (const prohibido of prohibidos) expect(recibido.includes(prohibido), `llegó al navegador: ${prohibido}`).toBe(false);
    });

    await test.step("criterio 12: el resultado por token cumple las medidas a 390 y a 1280 px", async () => {
      await otro.page.goto(enlace.ruta);
      await expectResultado(otro.page, escenario, "el enlace del correo");
      for (const { ancho, alto } of TAMANOS) {
        await otro.page.setViewportSize({ width: ancho, height: alto });
        await expectReglas(otro.page, `el resultado por token a ${ancho} px`);
      }
    });
  } finally {
    await otro.contexto.close();
  }
});

// ---------------------------------------------------------------------------
// Caso 3: enlaces que no sirven
// ---------------------------------------------------------------------------

test("HU-031 · criterio 8 y 11: sin token, vacío, repetido, mal formado, el id del diagnóstico, el de uno sin Lead o con ?correo= o ?telefono= dicen «Este enlace no sirve», todos iguales y sin datos", async ({
  page,
  escenario,
}) => {
  const { materia } = escenario;
  const altas = { intentos: 0 };
  await page.route("**/auth/v1/signup", (ruta) => {
    altas.intentos += 1;
    return ruta.abort();
  });

  const lead = await escenario.crearLead();
  const conLead = await escenario.sembrar({ idLead: lead.id });
  const sinLead = await escenario.sembrar({ idSesion: await escenario.crearSesion() });
  const valido = conLead.tokenDeRecuperacion;
  const inventado = randomBytes(32).toString("hex");

  const variantes: [string, string][] = [
    ["sin token", "/resultados"],
    ["token vacío", "/resultados?token="],
    ["token inventado", `/resultados?token=${inventado}`],
    ["repetido (dos inventados)", `/resultados?token=${inventado}&token=${randomBytes(32).toString("hex")}`],
    ["repetido (el real dos veces)", `/resultados?token=${valido}&token=${valido}`],
    ["repetido (a y b)", "/resultados?token=a&token=b"],
    ["no tiene 64 hexadecimales", "/resultados?token=abc"],
    ["con una letra de más", `/resultados?token=${valido}x`],
    ["con un espacio delante", `/resultados?token=%20${valido}`],
    ["en mayúsculas", `/resultados?token=${valido.toUpperCase()}`],
    ["el id del diagnóstico en lugar del token", `/resultados?token=${conLead.id}`],
    ["el token de un diagnóstico sin Lead", `/resultados?token=${sinLead.tokenDeRecuperacion}`],
    ["?correo= del Lead", `/resultados?correo=${encodeURIComponent(lead.correo)}`],
    ["?correo= cualquiera", "/resultados?correo=x@y.co"],
    ["?telefono=", `/resultados?telefono=${encodeURIComponent(TELEFONO)}`],
  ];

  // El enlace válido se abre: son esos mismos datos los que ninguna variante puede mostrar.
  const control = await page.goto(`/resultados?token=${valido}`);
  expect(control?.status()).toBe(200);
  await expectResultado(page, escenario, "el enlace válido de control");

  const datosQueNoSalen = [materia.nombre, lead.nombre, lead.correo, TELEFONO, conLead.id, sinLead.id, "Lo dominas", "Conviene repasar antes"];
  let referencia: { status: number; texto: string } | undefined;
  for (const [descripcion, ruta] of variantes) {
    const respuesta = await page.goto(ruta);
    await expect(titulo(page, TITULO_NO_SIRVE), descripcion).toBeVisible(ESPERA);
    const status = respuesta!.status();
    const texto = await page.locator("main").innerText();
    // Mismo código HTTP y mismo contenido en todos los casos.
    expect(status, `${descripcion}: el código HTTP es el de «sirve» (la pantalla no delata nada)`).toBe(200);
    referencia ??= { status, texto };
    expect(status, `${descripcion}: mismo código que las demás`).toBe(referencia.status);
    expect(texto, `${descripcion}: mismo texto que las demás`).toBe(referencia.texto);

    // Sin ningún dato del diagnóstico, ni en pantalla ni en lo que se recibió.
    const recibido = desescaparComillas(await respuesta!.text());
    const visible = await htmlVisible(page);
    for (const dato of datosQueNoSalen) {
      expect(visible.includes(dato), `${descripcion}: en pantalla salió «${dato}»`).toBe(false);
      // Next repite en su flujo los parámetros de la dirección: lo que la persona escribió en la URL vuelve tal cual, y eso no es
      // un dato de la base. Lo que no está en la URL no puede llegar.
      if (decodeURIComponent(ruta).includes(dato)) continue;
      expect(recibido.includes(dato), `${descripcion}: llegó al navegador «${dato}»`).toBe(false);
    }
    for (const clave of [...CLAVES_INTERNAS_DE_EJEMPLO, ...CLAVES_PROHIBIDAS]) {
      expect(recibido.includes(clave), `${descripcion}: llegó al navegador ${clave}`).toBe(false);
    }
    await expect(page.locator("dt"), descripcion).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Habilidades", exact: true }), descripcion).toHaveCount(0);
    await expect(page.getByRole("link", { name: `Ver monitores de ${materia.nombre}` }), descripcion).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Ir al inicio", exact: true }), `${descripcion}: sale por el inicio`).toBeVisible();
    await expectNoIndexNiReferer(page, descripcion);
    exigirSinCachePublico(respuesta, descripcion);
  }
  // Ninguna variante, ni la válida, creó una sesión anónima en este navegador.
  expect(altas.intentos, "abrir /resultados no intenta crear una sesión anónima").toBe(0);
});

// ---------------------------------------------------------------------------
// Caso 4: medidas
// ---------------------------------------------------------------------------

test("HU-031 · criterio 12: el resultado y «Este enlace no sirve» no tienen scroll horizontal, texto menor de 14 px ni áreas táctiles de menos de 44 px a 390 y a 1280 px", async ({
  page,
  escenario,
}) => {
  await page.route("**/auth/v1/signup", (ruta) => ruta.abort());
  const lead = await escenario.crearLead();
  const sembrado = await escenario.sembrar({ idLead: lead.id });

  const pantallas: [string, string, () => Promise<void>][] = [
    ["el resultado por token", `/resultados?token=${sembrado.tokenDeRecuperacion}`, () => expectResultado(page, escenario, "el resultado por token")],
    ["«Este enlace no sirve»", `/resultados?token=${randomBytes(32).toString("hex")}`, () => expect(titulo(page, TITULO_NO_SIRVE)).toBeVisible(ESPERA)],
  ];
  for (const { ancho, alto } of TAMANOS) {
    await page.setViewportSize({ width: ancho, height: alto });
    for (const [nombre, ruta, esperar] of pantallas) {
      await page.goto(ruta);
      await esperar();
      await expectReglas(page, `${nombre} a ${ancho} px`);
    }
  }
  // Con el ancho más angosto y el enlace que no sirve se mira también que el botón de salida se toque bien (lo cubre `tactilesChicos`).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/resultados`);
  await expect(titulo(page, TITULO_NO_SIRVE)).toBeVisible(ESPERA);
  await expectReglas(page, "«Este enlace no sirve» sin token a 390 px");

});
