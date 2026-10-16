import { randomUUID } from "node:crypto";
import type { Browser, BrowserContext, Locator, Page, Response } from "@playwright/test";
import { Client } from "pg";
import type { ResultadoGuardado } from "../src/lib/diagnostico/resultado";
import {
  CLAVES_INTERNAS_DE_EJEMPLO,
  GUARDADO_DE_EJEMPLO,
  sembrarDiagnostico,
  type DatosParaSembrar,
  type DiagnosticoSembrado,
} from "../pruebas/diagnostico-sembrado";
import {
  erroresEnOrdenDePantalla,
  renglonDeError,
  renglonDeHabilidad,
  renglonDePrerrequisito,
  type RenglonEsperado,
} from "../pruebas/expectativas-del-resultado";
import { cuerpoDe } from "../pruebas/cuerpo-de-respuesta";
import { CAMPOS_SIN_CENTINELA, centinelasDeLasRespuestas, respuestasConCentinelas } from "../pruebas/respuestas-con-centinelas";
import { correoUnico, enviarCredenciales, esperarSesion, expect, test as base, usarTurnstileDePrueba } from "./utilidades";

// HU-011: la portada con el último diagnóstico de la sesión, medida en un navegador a 390×844 (`movil`) y a 1280×800 (`escritorio`).
// La lógica está en los Vitest (`ultimo.test.ts`, `page.test.ts`) y en pgTAP (`ultimo_diagnostico.test.sql`); aquí se prueba lo que
// solo se ve en el navegador: quién ve su resultado y quién el inicio de siempre, qué recibe el navegador, la cabecera
// `Cache-Control` y las reglas del producto.
//
// - Sin banco de ejemplo. Esta HU no toma diagnósticos: los terminados los siembra `sembrarDiagnostico` (HU-009) con una conexión
//   `pg`. Cada prueba crea su propia materia (`E2E-<hex>`, con nombre propio), su Evaluación, sus sesiones y sus diagnósticos, y los
//   borra al terminar (la fixture `siembra` comprueba después que no quedó una sola fila). No usa `cargarBancoDePrueba` ni toca el
//   banco de HU-009, así que corre en paralelo en los dos proyectos sin serializar nada.
// - `Cache-Control` solo discrimina contra `next start` (`CI=1`): `next dev` responde sin caché a cualquier página, así que fuera de CI
//   la aserción solo exige que no sea público ni compartido.
// - Cada navegador con sesión gasta un alta anónima del Auth local (150 por hora por IP): las pruebas que no la necesitan la bloquean
//   (`sinSesionAnonima`) y las que miran varios casos de «inicio normal» comparten una sola sesión.
// - html y body llevan `overflow-x: hidden` (globals.css): `scrollWidth` del documento nunca delata un desborde, así que se mide por
//   elemento, como e2e/resolver-reportes.spec.ts.

const ESPERA = { timeout: 20_000 };
const LARGA = { timeout: 45_000 };

const H1_NORMAL = "Descubre en qué tema fallas antes de tu monitoría";
const H1_DE_LA_PORTADA = "Tu último diagnóstico";
const SIN_MONITORES = "Todavía no hay monitores certificados en esta materia. Vuelve pronto o elige otra.";
const NIVELES = ["Lo dominas", "En proceso", "No lo dominas", "Sin medir"] as const;

/** 5 de 8, con `repetido`: el 5 de octubre a las 03:30 UTC es el 4 de octubre en Bogotá. */
const FECHA_DEL_EJEMPLO = "2026-10-05T03:30:00.000Z";
const SEMILLA_CENTINELA = 3141592653;
const FALTA_MATERIAL = [{ habilidad: "habilidad-sin-material-secreta", motivos: ["tope_una_respuesta"] }];
const RESPUESTAS_SEMBRADAS = 8;

const DIA = 24 * 60 * 60 * 1000;
const haceDias = (dias: number) => new Date(Date.now() - dias * DIA).toISOString();

// ---------------------------------------------------------------------------
// Fixture: la materia, la Evaluación, las sesiones y los diagnósticos de cada prueba
// ---------------------------------------------------------------------------

type Materia = { id: string; codigo: string; nombre: string };
type Evaluacion = { id: string; nombre: string; idMateria: string };

type Siembra = {
  materia(): Promise<Materia>;
  /** Sin preguntas. Por omisión inactiva (el valor de la tabla); `activa: true` es una Evaluación vigente. */
  evaluacion(materia: Materia, opciones?: { activa?: boolean }): Promise<Evaluacion>;
  /** Apaga una Evaluación que estaba activa (falla si no lo estaba: un `update` que no cambia nada no probaría nada). */
  apagar(evaluacion: Evaluacion): Promise<void>;
  /** Un diagnóstico terminado, con el sembrador de HU-009. */
  diagnostico(datos: DatosParaSembrar): Promise<DiagnosticoSembrado>;
  /** Un diagnóstico a medias (una fila por sesión en `diagnostico_en_curso`). */
  enCurso(idSesion: string, evaluacion: Evaluacion): Promise<void>;
  /** Un Lead con correo único en minúsculas; lo creó esa sesión, o ninguna. */
  lead(idSesionCreadora: string | null): Promise<{ id: string }>;
  /** La sesión confirmó el correo del Lead por el enlace de P-23. */
  ligar(idSesion: string, idLead: string): Promise<void>;
  /** Anota las sesiones anónimas que nazcan en ese contexto, aunque la prueba falle antes de leer la cookie. */
  vigilar(context: BrowserContext): void;
  /** Un contexto aparte (otra persona) con las opciones del proyecto, el stub de Turnstile y su vigilancia. */
  contexto(browser: Browser): Promise<BrowserContext>;
};

async function abrirConexion(): Promise<Client> {
  const url = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  if (!/@(127\.0\.0\.1|localhost):/.test(url)) throw new Error(`SUPABASE_DB_URL no es local (${url}).`);
  const bd = new Client({ connectionString: url });
  await bd.connect();
  return bd;
}

const test = base.extend<{ siembra: Siembra }>({
  siembra: async ({ cuentas }, entregar) => {
    const bd = await abrirConexion();
    // Depende de `cuentas`: se desarma antes que ella, así que las filas de un monitor o un admin se borran antes que su usuario.
    const admin = cuentas.cliente;
    const creados = { materias: [] as string[], evaluaciones: [] as string[], diagnosticos: [] as string[], leads: [] as string[], sesiones: new Set<string>() };
    const lecturas: Promise<void>[] = [];

    const siembra: Siembra = {
      async materia() {
        const sufijo = randomUUID().slice(0, 6);
        const codigo = `E2E-${randomUUID().slice(0, 12)}`;
        const nombre = `Materia e2e portada ${sufijo}`;
        const { rows } = await bd.query<{ id: string }>("insert into public.materia (nombre, codigo) values ($1, $2) returning id", [nombre, codigo]);
        creados.materias.push(rows[0].id);
        return { id: rows[0].id, codigo, nombre };
      },
      async evaluacion(materia, opciones = {}) {
        const nombre = `Parcial e2e ${randomUUID().slice(0, 6)}`;
        const { rows } = await bd.query<{ id: string }>(
          "insert into public.evaluacion (id_materia, semana, nombre, activa) values ($1, 1, $2, $3) returning id",
          [materia.id, nombre, opciones.activa ?? false],
        );
        creados.evaluaciones.push(rows[0].id);
        return { id: rows[0].id, nombre, idMateria: materia.id };
      },
      async apagar(evaluacion) {
        const { rowCount } = await bd.query("update public.evaluacion set activa = false where id = $1 and activa = true", [evaluacion.id]);
        if (rowCount !== 1) throw new Error("La Evaluación no estaba activa: apagarla no cambia nada y la prueba no probaría que se desactivó.");
      },
      async diagnostico(datos) {
        const sembrado = await sembrarDiagnostico(bd, datos);
        creados.diagnosticos.push(sembrado.id);
        return sembrado;
      },
      async enCurso(idSesion, evaluacion) {
        await bd.query(
          "insert into public.diagnostico_en_curso (id_sesion, id_evaluacion, id_materia, semilla, candidatas, contexto) values ($1, $2, $3, 4242, '[]', '{}')",
          [idSesion, evaluacion.id, evaluacion.idMateria],
        );
      },
      async lead(idSesionCreadora) {
        const { rows } = await bd.query<{ id: string }>(
          `insert into public.lead (id_sesion_anonima, nombre, correo, acepta_tratamiento_datos, fecha_consentimiento)
           values ($1, 'Lead de HU-011', $2, true, now()) returning id`,
          [idSesionCreadora, correoUnico().toLowerCase()],
        );
        creados.leads.push(rows[0].id);
        return { id: rows[0].id };
      },
      async ligar(idSesion, idLead) {
        await bd.query("insert into public.lead_sesion (id_sesion, id_lead) values ($1, $2)", [idSesion, idLead]);
      },
      vigilar(context) {
        context.on("response", (respuesta) => {
          if (respuesta.request().method() !== "POST" || new URL(respuesta.url()).pathname !== "/auth/v1/signup" || !respuesta.ok()) return;
          lecturas.push(
            respuesta
              .json()
              .then(({ user }: { user?: { id: string } }) => void (user && creados.sesiones.add(user.id)))
              // La página se cerró antes de leer la respuesta: la cookie lo registra.
              .catch(() => {}),
          );
        });
      },
      async contexto(browser) {
        const { baseURL, viewport, locale, timezoneId } = test.info().project.use;
        const contexto = await browser.newContext({ baseURL, viewport, locale, timezoneId });
        // Un contexto de `browser.newContext` no hereda el stub de Turnstile: sin él corre el reto real de Cloudflare.
        await usarTurnstileDePrueba(contexto);
        siembra.vigilar(contexto);
        return contexto;
      },
    };

    try {
      await entregar(siembra);
    } finally {
      // Se borra lo que nació en la prueba, aunque haya fallado: de las filas que dependen hacia las cuentas.
      await Promise.all(lecturas);
      const sesiones = [...creados.sesiones];
      const fallos: string[] = [];
      const intentar = async (contexto: string, accion: Promise<unknown>) => {
        try {
          await accion;
        } catch (error) {
          fallos.push(`${contexto}: ${error instanceof Error ? error.message : String(error)}`);
        }
      };
      const { materias, evaluaciones, diagnosticos, leads } = creados;
      await intentar(
        "diagnostico",
        bd.query(
          "delete from public.diagnostico where id = any($1::uuid[]) or id_sesion_anonima = any($2::uuid[]) or id_lead = any($3::uuid[]) or id_materia = any($4::uuid[])",
          [diagnosticos, sesiones, leads, materias],
        ),
      );
      await intentar("diagnostico_en_curso", bd.query("delete from public.diagnostico_en_curso where id_sesion = any($1::uuid[]) or id_materia = any($2::uuid[])", [sesiones, materias]));
      await intentar("lead_sesion", bd.query("delete from public.lead_sesion where id_lead = any($1::uuid[]) or id_sesion = any($2::uuid[])", [leads, sesiones]));
      await intentar("lead", bd.query("delete from public.lead where id = any($1::uuid[])", [leads]));
      await intentar("evaluacion", bd.query("delete from public.evaluacion where id = any($1::uuid[]) or id_materia = any($2::uuid[])", [evaluaciones, materias]));
      await intentar("materia", bd.query("delete from public.materia where id = any($1::uuid[])", [materias]));
      for (const id of sesiones) {
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error && !/not found/i.test(error.message)) fallos.push(`usuario ${id}: ${error.message}`);
      }

      // Y se comprueba, con la llave secreta, que no queda ninguna fila de lo que creó.
      try {
        const { rows } = await bd.query<Record<string, number>>(
          `select
             (select count(*)::int from public.diagnostico where id = any($1::uuid[]) or id_sesion_anonima = any($2::uuid[]) or id_lead = any($3::uuid[]) or id_materia = any($4::uuid[])) as diagnosticos,
             (select count(*)::int from public.diagnostico_en_curso where id_sesion = any($2::uuid[]) or id_materia = any($4::uuid[])) as en_curso,
             (select count(*)::int from public.lead_sesion where id_lead = any($3::uuid[]) or id_sesion = any($2::uuid[])) as lead_sesion,
             (select count(*)::int from public.lead where id = any($3::uuid[])) as leads,
             (select count(*)::int from public.evaluacion where id = any($5::uuid[]) or id_materia = any($4::uuid[])) as evaluaciones,
             (select count(*)::int from public.materia where id = any($4::uuid[])) as materias,
             (select count(*)::int from auth.users where id = any($2::uuid[])) as sesiones`,
          [diagnosticos, sesiones, leads, materias, evaluaciones],
        );
        const restos = Object.entries(rows[0]).filter(([, cuantas]) => cuantas > 0);
        if (restos.length) fallos.push(`quedaron filas: ${restos.map(([tabla, cuantas]) => `${tabla}=${cuantas}`).join(", ")}`);
      } catch (error) {
        fallos.push(`comprobar la limpieza: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await bd.end().catch(() => {});
      }
      if (fallos.length) throw new Error(`No se pudo limpiar lo que creó la prueba:\n${fallos.join("\n")}`);
    }
  },

  // Todo contexto de la fixture `page` anota las sesiones que nacen en él.
  context: async ({ context, siembra }, entregar) => {
    siembra.vigilar(context);
    await entregar(context);
  },
});

// Cada prueba es independiente (su materia, sus sesiones, sus filas): corren en paralelo, también las de un mismo archivo.
test.describe.configure({ timeout: 90_000 });

/** Sin alta anónima: las pruebas que no la necesitan no gastan el cupo por IP de Supabase Auth. */
async function sinSesionAnonima(page: Page) {
  await page.route("**/auth/v1/signup", (ruta) => ruta.abort());
}

// ---------------------------------------------------------------------------
// Lo que se vigila
// ---------------------------------------------------------------------------

/**
 * Todo lo que el servidor le manda al navegador (las páginas y las respuestas de las acciones), para buscar ahí lo que no debe llegar.
 * Un cuerpo que una recarga cortó a medias no llega ni falla: `cuerpoDe` lo descarta pasado el tope en lugar de esperar el timeout de
 * la prueba (falló una vez en `movil` esperando tres minutos). Por eso quien lo usa comprueba además que sí leyó el HTML que importa.
 */
function vigilarRespuestas(page: Page): () => Promise<string> {
  const cuerpos: Promise<string>[] = [];
  page.on("response", (respuesta) => {
    const tipo = respuesta.headers()["content-type"] ?? "";
    if (/text\/html|text\/x-component/.test(tipo)) cuerpos.push(cuerpoDe(respuesta));
  });
  return async () => (await Promise.all(cuerpos)).join("\n");
}

function vigilarErrores(page: Page, errores: string[] = []): string[] {
  page.on("console", (mensaje) => {
    if (mensaje.type() === "error") errores.push(mensaje.text());
  });
  page.on("pageerror", (error) => errores.push(error.message));
  return errores;
}

/** Un `Cache-Control` que nunca es público. Con `next start` (CI) las dinámicas salen privadas; `next dev` manda solo «no-cache». */
function exigirSinCachePublico(respuesta: Response | null, donde: string): void {
  const cabecera = respuesta?.headers()["cache-control"];
  expect(cabecera, `${donde}: debe traer Cache-Control`).toBeTruthy();
  expect(cabecera, `${donde}: no puede ser público ni compartido`).not.toMatch(/\bpublic\b|s-maxage/i);
  expect(cabecera, `${donde}: privado o sin caché`).toMatch(process.env.CI ? /\b(private|no-store)\b/i : /\b(private|no-store|no-cache)\b/i);
}

/**
 * Lo que no puede llegar al navegador en la portada con un resultado (criterio 7): la semilla y el token, las claves internas, la
 * marca de falta de material y, uno por uno, los centinelas de la copia de las respuestas (clave de la pregunta, enunciado, texto
 * de cada opción, la correcta, la misconcepción y el error de cada opción y la solución).
 */
function lasPalabrasProhibidas(sembrado: DiagnosticoSembrado): string[] {
  return [
    String(SEMILLA_CENTINELA),
    sembrado.tokenDeRecuperacion,
    ...CLAVES_INTERNAS_DE_EJEMPLO,
    "falta_material",
    "faltaMaterial",
    "habilidad-sin-material-secreta",
    "tope_una_respuesta",
    "token_recuperacion",
    "tokenDeRecuperacion",
    ...centinelasDeLasRespuestas(RESPUESTAS_SEMBRADAS),
  ];
}

/** Los campos que no tienen un texto único (la dificultad es 1, 2 o 3), por su nombre entre comillas, también escapadas en el payload de Next. */
const CAMPOS_ENTRE_COMILLAS = [...CAMPOS_SIN_CENTINELA, "repetido", "semilla", "puntaje"] as const;

function expectSinLoProhibido(texto: string, prohibidas: string[], donde: string): void {
  for (const prohibida of prohibidas) expect(texto.includes(prohibida), `${donde} trae «${prohibida}»`).toBe(false);
  for (const campo of CAMPOS_ENTRE_COMILLAS) {
    expect(new RegExp(`\\b${campo}\\\\*"`).test(texto), `${donde} trae el campo "${campo}"`).toBe(false);
  }
}

/** Ni la materia, ni el código, ni nada del diagnóstico de otra persona: ni en el HTML que mandó el servidor ni en la pantalla. */
async function expectSinRastro(page: Page, respuesta: Response | null, ajenos: string[], quien: string): Promise<void> {
  const crudo = (await respuesta?.text()) ?? "";
  const pintado = await page.content();
  for (const ajeno of ajenos) {
    expect(crudo.includes(ajeno), `${quien}: el HTML del servidor no trae «${ajeno}»`).toBe(false);
    expect(pintado.includes(ajeno), `${quien}: la pantalla no trae «${ajeno}»`).toBe(false);
  }
}

// ---------------------------------------------------------------------------
// Lo que se ve
// ---------------------------------------------------------------------------

const titulo = (page: Page, nombre: string) => page.getByRole("heading", { level: 1, name: nombre, exact: true });

/** El inicio de siempre: el h1, «Hacer el diagnóstico» a /diagnostico, «Ver monitores certificados» a /monitores y nada de la portada con resultado. */
async function expectInicioNormal(page: Page, quien: string): Promise<void> {
  await expect(titulo(page, H1_NORMAL), `${quien}: el h1 del inicio`).toBeVisible(ESPERA);
  await expect(page.getByRole("link", { name: "Hacer el diagnóstico", exact: true }), quien).toHaveAttribute("href", "/diagnostico");
  await expect(page.getByRole("link", { name: "Ver monitores certificados", exact: true }), quien).toHaveAttribute("href", "/monitores");
  await expect(titulo(page, H1_DE_LA_PORTADA), `${quien}: nada de la portada con resultado`).toHaveCount(0);
  await expect(page.getByText("Puntaje global"), quien).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Tomar otro diagnóstico", exact: true }), quien).toHaveCount(0);
}

/** Un renglón de la lista: los textos que debe llevar, los que no y cuántas fórmulas se dibujan dentro (cada una es un `<math>`). */
async function expectRenglon(renglon: Locator, esperado: RenglonEsperado, donde: string): Promise<void> {
  for (const texto of esperado.contiene) await expect(renglon, `${donde} lleva «${texto}»`).toContainText(texto);
  for (const texto of esperado.noContiene) await expect(renglon, `${donde} no lleva «${texto}»`).not.toContainText(texto);
  await expect(renglon.locator("math"), `${donde}: sus fórmulas salen como math`).toHaveCount(esperado.formulas);
}

/**
 * El resultado de ejemplo de HU-009 (`GUARDADO_DE_EJEMPLO`, 5 de 8, hecho el 4 de octubre en Bogotá) tal como lo pinta la
 * portada: encabezado con las cifras de D-53 c, los cuatro niveles en el orden guardado, el error confirmado primero, la habilidad
 * solo si es del resultado, las fórmulas como `math` y los prerrequisitos de otra materia. Sin nada de repetido.
 *
 * Los textos de cada renglón y cuántas fórmulas lleva salen de los datos del ejemplo (`pruebas/expectativas-del-resultado.ts`,
 * comprobado contra el componente con las dos versiones del ejemplo), no de frases ni números escritos aquí: HU-009 cambia el
 * ejemplo (fórmulas en la habilidad, el detalle y el prerrequisito) y esta prueba no puede romperse por eso. Lo que sí se fija a
 * mano son las reglas del producto: los niveles y las cifras, el orden y el prefijo de los errores, y los encabezados.
 */
async function expectResultadoDeEjemplo(page: Page, materia: Materia, evaluacion: Evaluacion): Promise<void> {
  const principal = page.locator("main");
  await expect(titulo(page, H1_DE_LA_PORTADA)).toBeVisible(ESPERA);
  await expect(principal).toContainText(`${materia.nombre} · ${evaluacion.nombre}`);
  await expect(principal).toContainText("Fecha: 4 de octubre de 2026");
  await expect(principal.locator("time")).toHaveAttribute("datetime", FECHA_DEL_EJEMPLO);
  await expect(principal).toContainText("Respondiste 8 preguntas");
  await expect(principal).toContainText("Puntaje global: 63 %");

  const habilidades = page.getByRole("region", { name: "Habilidades", exact: true }).getByRole("listitem");
  const guardadas = GUARDADO_DE_EJEMPLO.habilidades;
  await expect(habilidades).toHaveCount(guardadas.length);
  // El nivel escrito y la cifra de cada habilidad, en el orden guardado.
  const niveles = [
    ["Lo dominas", "Acertaste 3 de 3"],
    ["En proceso", "Acertaste 1 de 2"],
    ["No lo dominas", "Acertaste 0 de 2"],
    ["Sin medir", "No medimos esta habilidad en esta prueba."],
    ["No lo dominas", null],
  ] as const;
  expect(niveles, "una línea de nivel por habilidad del ejemplo").toHaveLength(guardadas.length);
  for (const [i, [nivel, cifra]] of niveles.entries()) {
    await expectRenglon(habilidades.nth(i), renglonDeHabilidad(guardadas[i]), `habilidad ${i + 1}`);
    await expect(habilidades.nth(i)).toContainText(nivel);
    if (cifra) await expect(habilidades.nth(i)).toContainText(cifra);
  }
  expect(new Set(niveles.map(([nivel]) => nivel)), "los cuatro niveles están en pantalla").toEqual(new Set(NIVELES));

  // Los errores: el confirmado primero y los demás en el orden guardado; cada renglón con su prefijo, su título, su habilidad solo
  // si es del resultado, sus detalles y sus fórmulas.
  const errores = page.getByRole("region", { name: "Errores", exact: true }).getByRole("listitem");
  const enPantalla = erroresEnOrdenDePantalla(GUARDADO_DE_EJEMPLO.errores);
  await expect(errores).toHaveCount(enPantalla.length);
  for (const [i, error] of enPantalla.entries()) {
    await expectRenglon(errores.nth(i), renglonDeError(error, guardadas), `error ${i + 1}`);
  }
  expect(enPantalla[0].estado, "el primero es el confirmado").toBe("confirmada");
  expect(renglonDeError(enPantalla[0], guardadas).formulas, "el error confirmado lleva fórmulas: la prueba de las fórmulas no es vacía").toBeGreaterThan(0);
  expect(
    enPantalla.some((error) => !guardadas.some((habilidad) => habilidad.habilidad === error.habilidad)),
    "el ejemplo trae un error de una habilidad que no es del resultado: nunca se nombra",
  ).toBe(true);

  const repasar = page.getByRole("region", { name: "Conviene repasar antes", exact: true }).getByRole("listitem");
  const prerrequisitos = GUARDADO_DE_EJEMPLO.prerrequisitos;
  await expect(repasar).toHaveCount(prerrequisitos.length);
  for (const [i, prerrequisito] of prerrequisitos.entries()) {
    await expectRenglon(repasar.nth(i), renglonDePrerrequisito(prerrequisito), `prerrequisito ${i + 1}`);
  }
  expect(
    prerrequisitos.some((prerrequisito) => prerrequisito.materia !== null),
    "el ejemplo trae un prerrequisito de otra materia",
  ).toBe(true);

  await expect(principal, "la persona no ve la marca de repetido").not.toContainText(/repetid|otra vez/i);

  // Encabezados: el h1 de la portada y, debajo, los h2 del componente, sin saltos de nivel (un `nivelDeTitulos` distinto lo rompería).
  const encabezados = await principal.evaluate((main) =>
    [...main.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => [Number(h.tagName.slice(1)), (h.textContent ?? "").trim()]),
  );
  expect(encabezados, "h1, y debajo los h2 del resultado").toEqual([
    [1, H1_DE_LA_PORTADA],
    [2, "Habilidades"],
    [2, "Errores"],
    [2, "Conviene repasar antes"],
  ]);
}

/** Las dos salidas del resultado: los monitores de la materia, por código, y otro diagnóstico. */
async function expectLasSalidas(page: Page, materia: Materia): Promise<void> {
  await expect(page.getByRole("link", { name: `Ver monitores de ${materia.nombre}`, exact: true })).toHaveAttribute(
    "href",
    `/monitores?materia=${encodeURIComponent(materia.codigo)}`,
  );
  await expect(page.getByRole("link", { name: "Tomar otro diagnóstico", exact: true })).toHaveAttribute("href", "/diagnostico");
}

// ---------------------------------------------------------------------------
// Reglas del producto
// ---------------------------------------------------------------------------

async function expectReglas(page: Page, donde: string): Promise<void> {
  const medidas = await medir(page);
  expect(medidas.sinScrollHorizontal, `${donde}: sin scroll horizontal`).toBe(true);
  expect(medidas.desbordados, `${donde}: ningún elemento se sale de la pantalla ni de su caja`).toEqual([]);
  expect(medidas.menorTexto, `${donde}: ningún texto por debajo de 14 px`).toBeGreaterThanOrEqual(14);
  expect(medidas.degradados, `${donde}: sin degradados`).toBe(0);
  expect(medidas.tactilesChicos, `${donde}: áreas táctiles de 44 px o más`).toEqual([]);
  expect(medidas.controlesSinNombre, `${donde}: todo control tiene nombre`).toEqual([]);
}

/** Texto, áreas táctiles, degradados, nombres y desborde por elemento. */
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
    const tocables = controles.filter((el) => !(el.tagName === "A" && el.closest("label, p")));
    // `html` y `body` llevan `overflow-x: hidden` (globals.css): el scroll horizontal nunca aparece aunque el contenido se
    // desborde, así que `scrollWidth` de la página no lo delata. Se mide cada elemento a la vista: que su caja no se salga de la
    // ventana y que su contenido no se salga de su propia caja. El scroll interno de un bloque de código (`pre`) es legítimo:
    // queda fuera de la segunda comprobación, y lo que lleva dentro, de las dos.
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
// Armar la escena: un navegador con sesión y un diagnóstico terminado
// ---------------------------------------------------------------------------

/**
 * Abre `/` (nace la sesión anónima) y espera la cookie. Devuelve el id de la sesión. La primera visita es el inicio normal.
 */
async function conSesion(page: Page, context: BrowserContext): Promise<{ id: string; respuesta: Response | null }> {
  const respuesta = await page.goto("/");
  const sesion = await esperarSesion(context);
  return { id: sesion.id, respuesta };
}

/** El diagnóstico de ejemplo con todo lo que no puede llegar al navegador: el repetido, la semilla, el token, la falta de material y las copias de las preguntas. */
async function sembrarElDeEjemplo(siembra: Siembra, idSesionAnonima: string, evaluacion: Evaluacion): Promise<DiagnosticoSembrado> {
  return siembra.diagnostico({
    idSesionAnonima,
    idEvaluacion: evaluacion.id,
    fecha: FECHA_DEL_EJEMPLO,
    repetido: true,
    semilla: SEMILLA_CENTINELA,
    faltaMaterial: FALTA_MATERIAL,
    respuestas: respuestasConCentinelas(RESPUESTAS_SEMBRADAS),
  });
}

// ===============================================================================================================
// 1. Vuelve y ve su último diagnóstico
// ===============================================================================================================

test("Vuelve · desde el mismo navegador ve su último diagnóstico con las cifras, sin nada interno, con sus dos salidas y sin caché compartido", async ({
  page,
  context,
  siembra,
}) => {
  test.setTimeout(180_000);
  const errores = vigilarErrores(page);
  const recibido = vigilarRespuestas(page);
  const materia = await siembra.materia();
  // Una Evaluación vigente (activa, sin una sola pregunta): se apaga después de sembrar y antes de recargar (criterio 5).
  const evaluacion = await siembra.evaluacion(materia, { activa: true });

  // Primera visita, sin cookie: el inicio de siempre, con la cabecera privada.
  const primera = await page.goto("/");
  expect(primera?.status()).toBe(200);
  exigirSinCachePublico(primera, "la primera visita, sin sesión");
  await expectInicioNormal(page, "la primera visita");
  await expect(page).toHaveTitle("Calibra");
  const sesion = await esperarSesion(context);

  const sembrado = await sembrarElDeEjemplo(siembra, sesion.id, evaluacion);
  await siembra.apagar(evaluacion);

  // Al volver (recarga con la cookie de la sesión): su último diagnóstico, aunque la Evaluación ya no esté activa.
  const respuesta = await page.reload();
  expect(respuesta?.status()).toBe(200);
  exigirSinCachePublico(respuesta, "la portada con sesión");
  await expectResultadoDeEjemplo(page, materia, evaluacion);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Hacer el diagnóstico", exact: true }), "no pinta el inicio normal debajo").toHaveCount(0);
  await expect(page.getByRole("link", { name: "Ver monitores certificados", exact: true })).toHaveCount(0);
  await expectLasSalidas(page, materia);

  // Lo que recibió el navegador: las páginas y los payloads de Next. Ni lo de adentro de la fila ni las copias de las preguntas.
  const prohibidas = lasPalabrasProhibidas(sembrado);
  const todoLoRecibido = await recibido();
  // Control positivo: si el vigilante descartó el HTML de la portada (un cuerpo que no llegó), buscar ahí no probaría nada.
  expect(todoLoRecibido, "el vigilante leyó el HTML de la portada con el resultado").toContain(H1_DE_LA_PORTADA);
  expectSinLoProhibido(todoLoRecibido, prohibidas, "lo recibido");
  expectSinLoProhibido(await page.content(), prohibidas, "la pantalla");

  // «Ver monitores de {materia}»: va a la lista de su materia y esa página dice que no hay monitores. El botón se muestra siempre.
  await page.getByRole("link", { name: `Ver monitores de ${materia.nombre}`, exact: true }).click();
  await expect(page).toHaveURL(`/monitores?materia=${encodeURIComponent(materia.codigo)}`, ESPERA);
  await expect(page.getByRole("status")).toHaveText(SIN_MONITORES, ESPERA);
  await page.goBack();
  await expect(titulo(page, H1_DE_LA_PORTADA)).toBeVisible(ESPERA);

  // «Tomar otro diagnóstico»: al inicio del diagnóstico de HU-009.
  await page.getByRole("link", { name: "Tomar otro diagnóstico", exact: true }).click();
  await expect(page).toHaveURL("/diagnostico", ESPERA);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible(ESPERA);

  // Se cierra la página y se abre otra en el mismo contexto: la sesión sigue siendo suya.
  await page.close();
  const otra = await context.newPage();
  vigilarErrores(otra, errores);
  const vuelta = await otra.goto("/");
  exigirSinCachePublico(vuelta, "otra pestaña de la misma sesión");
  await expectResultadoDeEjemplo(otra, materia, evaluacion);
  await expectLasSalidas(otra, materia);

  expect(errores, "ningún console.error ni pageerror en el recorrido").toEqual([]);
});

// ===============================================================================================================
// 2. Solo el más reciente, y el desempate
// ===============================================================================================================

test("Varias materias · muestra solo el más reciente, de cualquier materia, y no nombra las otras", async ({ page, context, siembra }) => {
  const materiaA = await siembra.materia();
  const materiaB = await siembra.materia();
  const evaluacionA = await siembra.evaluacion(materiaA);
  const evaluacionB = await siembra.evaluacion(materiaB);
  const { id } = await conSesion(page, context);

  // A hace 3 días, B hace 1 y A hace 2: el más reciente es el de B, que no es ni el primero ni el último insertado
  // y tiene el id MÁS CHICO de los tres (con ids al azar, ordenar por id en lugar de por fecha acertaría una vez de cada tres).
  const base = randomUUID().slice(0, 34);
  await siembra.diagnostico({ id: `${base}c3`, idSesionAnonima: id, idEvaluacion: evaluacionA.id, fecha: haceDias(3) });
  await siembra.diagnostico({ id: `${base}b1`, idSesionAnonima: id, idEvaluacion: evaluacionB.id, fecha: haceDias(1) });
  await siembra.diagnostico({ id: `${base}c2`, idSesionAnonima: id, idEvaluacion: evaluacionA.id, fecha: haceDias(2) });

  const respuesta = await page.reload();
  exigirSinCachePublico(respuesta, "la portada con varias materias");
  await expect(titulo(page, H1_DE_LA_PORTADA)).toBeVisible(ESPERA);
  await expect(page.locator("main")).toContainText(`${materiaB.nombre} · ${evaluacionB.nombre}`);
  await expectLasSalidas(page, materiaB);
  await expectSinRastro(page, respuesta, [materiaA.nombre, materiaA.codigo, evaluacionA.nombre], "la materia que no es la más reciente");
});

test("Empate · con la misma fecha exacta gana el id mayor aunque el menor se insertó primero", async ({ page, context, siembra }) => {
  const materiaMenor = await siembra.materia();
  const materiaMayor = await siembra.materia();
  const evaluacionMenor = await siembra.evaluacion(materiaMenor);
  const evaluacionMayor = await siembra.evaluacion(materiaMayor);
  const { id } = await conSesion(page, context);

  // `movil` y `escritorio` corren esta prueba a la vez contra la misma base: el prefijo es aleatorio y solo los dos últimos dígitos son fijos.
  const base = randomUUID().slice(0, 34);
  const fecha = haceDias(1);
  // El id menor se inserta primero, en un `insert` aparte: sin un desempate por id, Postgres devolvería la fila más antigua.
  await siembra.diagnostico({ id: `${base}0a`, idSesionAnonima: id, idEvaluacion: evaluacionMenor.id, fecha });
  await siembra.diagnostico({ id: `${base}ff`, idSesionAnonima: id, idEvaluacion: evaluacionMayor.id, fecha });

  const respuesta = await page.reload();
  await expect(titulo(page, H1_DE_LA_PORTADA)).toBeVisible(ESPERA);
  await expect(page.locator("main")).toContainText(`${materiaMayor.nombre} · ${evaluacionMayor.nombre}`);
  await expectLasSalidas(page, materiaMayor);
  await expectSinRastro(page, respuesta, [materiaMenor.nombre, materiaMenor.codigo, evaluacionMenor.nombre], "el de id menor");
});

// ===============================================================================================================
// 3. Inicio normal
// ===============================================================================================================

test("Inicio normal · sin sesión ve el inicio de siempre, sin caché compartido y sin ningún dato de un diagnóstico ajeno", async ({ page, siembra }) => {
  await sinSesionAnonima(page);
  const materia = await siembra.materia();
  const evaluacion = await siembra.evaluacion(materia);
  const lead = await siembra.lead(null);
  // Un diagnóstico que existe, de un Lead: sin sesión no hay forma de que el navegador lo reciba.
  await siembra.diagnostico({ idLead: lead.id, idEvaluacion: evaluacion.id, fecha: haceDias(1) });

  const respuesta = await page.goto("/");
  expect(respuesta?.status()).toBe(200);
  exigirSinCachePublico(respuesta, "la portada sin sesión");
  await expectInicioNormal(page, "sin sesión");
  await expectSinRastro(page, respuesta, [materia.nombre, materia.codigo, evaluacion.nombre], "sin sesión");
});

test("Inicio normal · una sesión sin diagnósticos, con uno solo a medias y con uno guardado que no se puede armar ve el inicio de siempre, sin error", async ({
  page,
  context,
  siembra,
}) => {
  test.setTimeout(120_000);
  const aMedias = await siembra.materia();
  const evaluacionAMedias = await siembra.evaluacion(aMedias);
  const rota = await siembra.materia();
  const evaluacionRota = await siembra.evaluacion(rota);
  const ajenos = [aMedias.nombre, aMedias.codigo, evaluacionAMedias.nombre, rota.nombre, rota.codigo, evaluacionRota.nombre];

  const { id } = await conSesion(page, context);
  let respuesta: Response | null;

  await test.step("b. sesión anónima sin diagnósticos", async () => {
    respuesta = await page.reload();
    exigirSinCachePublico(respuesta, "la portada con una sesión vacía");
    await expectInicioNormal(page, "sesión sin diagnósticos");
    await expectSinRastro(page, respuesta, ajenos, "sesión sin diagnósticos");
  });

  await test.step("c. solo un diagnóstico en curso (a medias no cuenta)", async () => {
    await siembra.enCurso(id, evaluacionAMedias);
    respuesta = await page.reload();
    await expectInicioNormal(page, "sesión con un diagnóstico en curso");
    await expectSinRastro(page, respuesta, ajenos, "sesión con un diagnóstico en curso");
  });

  await test.step("g. un resultado guardado que cumple los checks de la base pero no se puede armar: sin error en pantalla", async () => {
    // Un nivel que no existe: la base lo acepta (solo exige la forma) y `proyectarResultado` lo rechaza sin contenido.
    const imposible = {
      habilidades: [{ habilidad: "habilidad-imposible", descripcion: "no se puede armar", nivel: "nivel-que-no-existe", respuestas: 1, aciertos: 1 }],
      errores: [],
      prerrequisitos: [],
    } as unknown as ResultadoGuardado;
    await siembra.diagnostico({ idSesionAnonima: id, idEvaluacion: evaluacionRota.id, fecha: haceDias(1), resultado: imposible });
    respuesta = await page.reload();
    expect(respuesta?.status(), "la lectura que falla no tumba la página").toBe(200);
    await expectInicioNormal(page, "resultado que no se puede armar");
    await expectSinRastro(page, respuesta, [...ajenos, "habilidad-imposible", "no se puede armar", "nivel-que-no-existe"], "resultado que no se puede armar");
    // («error» no sirve de patrón: el subtítulo del inicio dice «en qué habilidad está el error».)
    await expect(page.locator("main"), "ni un mensaje de fallo").not.toContainText(/falló|no pudimos|no se pudo|algo salió mal|inténtalo/i);
    await expect(page.getByRole("alert").filter({ hasText: /\S/ }), "ni una alerta con texto").toHaveCount(0);
  });
});

test("Inicio normal · otra sesión anónima no ve el diagnóstico de la primera", async ({ page, context, browser, siembra }) => {
  test.setTimeout(150_000);
  const materia = await siembra.materia();
  const evaluacion = await siembra.evaluacion(materia);
  const duena = await conSesion(page, context);
  await siembra.diagnostico({ idSesionAnonima: duena.id, idEvaluacion: evaluacion.id, fecha: haceDias(1) });

  // La dueña lo ve (si no, que la otra no lo vea no probaría nada).
  await page.reload();
  await expect(page.locator("main")).toContainText(`${materia.nombre} · ${evaluacion.nombre}`);

  const otro = await siembra.contexto(browser);
  try {
    const pagina = await otro.newPage();
    await pagina.goto("/");
    const sesion = await esperarSesion(otro);
    expect(sesion.id, "es otra sesión").not.toBe(duena.id);
    const respuesta = await pagina.reload();
    exigirSinCachePublico(respuesta, "la portada de otra sesión");
    await expectInicioNormal(pagina, "otra sesión anónima");
    await expectSinRastro(pagina, respuesta, [materia.nombre, materia.codigo, evaluacion.nombre], "otra sesión anónima");
  } finally {
    await otro.close();
  }
});

test("Inicio normal · D-53 e: de las sesiones de un mismo Lead solo ve el resultado la que lo hizo", async ({ page, context, browser, siembra }) => {
  test.setTimeout(240_000);
  const materia = await siembra.materia();
  const evaluacion = await siembra.evaluacion(materia);

  // A creó el Lead y no hizo diagnósticos; B y C confirmaron su correo por el enlace de P-23. Cada una en su navegador.
  const contextoA = await siembra.contexto(browser);
  const contextoC = await siembra.contexto(browser);
  try {
    const paginaA = await contextoA.newPage();
    const paginaC = await contextoC.newPage();
    await paginaA.goto("/");
    await page.goto("/");
    await paginaC.goto("/");
    const idA = (await esperarSesion(contextoA)).id;
    const idB = (await esperarSesion(context)).id;
    const idC = (await esperarSesion(contextoC)).id;
    expect(new Set([idA, idB, idC]).size, "tres sesiones distintas").toBe(3);

    const lead = await siembra.lead(idA);
    await siembra.ligar(idB, lead.id);
    await siembra.ligar(idC, lead.id);
    // El diagnóstico de B quedó ligado al Lead (`id_lead`), y sigue siendo de la sesión que lo hizo.
    await siembra.diagnostico({ idSesionAnonima: idB, idLead: lead.id, idEvaluacion: evaluacion.id, fecha: haceDias(1) });

    const deB = await page.reload();
    exigirSinCachePublico(deB, "la portada de B");
    await expect(titulo(page, H1_DE_LA_PORTADA)).toBeVisible(ESPERA);
    await expect(page.locator("main")).toContainText(`${materia.nombre} · ${evaluacion.nombre}`);
    await expectLasSalidas(page, materia);

    for (const [quien, pagina] of [
      ["A, la que creó el Lead", paginaA],
      ["C, ligada al Lead", paginaC],
    ] as const) {
      const respuesta = await pagina.reload();
      await expectInicioNormal(pagina, quien);
      await expectSinRastro(pagina, respuesta, [materia.nombre, materia.codigo, evaluacion.nombre], quien);
    }
  } finally {
    await contextoA.close();
    await contextoC.close();
  }
});

test("Inicio normal · un monitor y un admin, aunque tengan un diagnóstico a su nombre, ven el inicio de siempre", async ({ browser, siembra, cuentas }) => {
  test.setTimeout(150_000);
  const materia = await siembra.materia();
  const evaluacion = await siembra.evaluacion(materia);
  const monitor = await cuentas.crearMonitor();
  const admin = await cuentas.crearAdmin();
  const lead = await siembra.lead(null);
  // Cada uno es la sesión dueña de una fila; el admin, además, puede leer el de otra persona (la política de la tabla lo deja).
  await siembra.diagnostico({ idSesionAnonima: monitor.id, idEvaluacion: evaluacion.id, fecha: haceDias(1) });
  await siembra.diagnostico({ idSesionAnonima: admin.id, idEvaluacion: evaluacion.id, fecha: haceDias(2) });
  await siembra.diagnostico({ idLead: lead.id, idEvaluacion: evaluacion.id, fecha: haceDias(0.5) });

  for (const [quien, cuenta, destino] of [
    ["un monitor", monitor, "/monitor"],
    ["un admin", admin, "/admin"],
  ] as const) {
    const contexto = await siembra.contexto(browser);
    try {
      const pagina = await contexto.newPage();
      await pagina.goto("/ingresar");
      await enviarCredenciales(pagina, cuenta.correo, cuenta.contrasena);
      await expect(pagina).toHaveURL(destino, LARGA);
      const respuesta = await pagina.goto("/");
      exigirSinCachePublico(respuesta, `la portada de ${quien}`);
      await expectInicioNormal(pagina, quien);
      await expectSinRastro(pagina, respuesta, [materia.nombre, materia.codigo, evaluacion.nombre], quien);
    } finally {
      await contexto.close();
    }
  }
});

// ===============================================================================================================
// 4. Reglas del producto
// ===============================================================================================================

test("Reglas del producto · la portada con un resultado a 390 y a 1280 px, y con el teclado", async ({ page, context, siembra }) => {
  test.setTimeout(150_000);
  const materia = await siembra.materia();
  const evaluacion = await siembra.evaluacion(materia, { activa: true });
  const { id } = await conSesion(page, context);
  await sembrarElDeEjemplo(siembra, id, evaluacion);
  await siembra.apagar(evaluacion);
  await page.reload();
  await expectResultadoDeEjemplo(page, materia, evaluacion);

  const original = page.viewportSize();
  try {
    for (const [ancho, alto] of [
      [390, 844],
      [1280, 800],
    ] as const) {
      await page.setViewportSize({ width: ancho, height: alto });
      await expect(titulo(page, H1_DE_LA_PORTADA)).toBeVisible();
      await expectReglas(page, `la portada con resultado a ${ancho} px`);
    }
  } finally {
    if (original) await page.setViewportSize(original);
  }

  // Teclado: con Tab se llega a las dos salidas, sin trampas, y Enter en la primera navega.
  const nombreDeLaPrimera = `Ver monitores de ${materia.nombre}`;
  const visitados: string[] = [];
  for (let i = 0; i < 30 && !(visitados.includes(nombreDeLaPrimera) && visitados.includes("Tomar otro diagnóstico")); i++) {
    await page.keyboard.press("Tab");
    visitados.push(await page.evaluate(() => (document.activeElement?.textContent ?? "").trim()));
  }
  expect(visitados, "Tab llega a «Ver monitores de {materia}»").toContain(nombreDeLaPrimera);
  expect(visitados, "Tab llega a «Tomar otro diagnóstico»").toContain("Tomar otro diagnóstico");

  await page.reload();
  await expect(titulo(page, H1_DE_LA_PORTADA)).toBeVisible(ESPERA);
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    if ((await page.evaluate(() => (document.activeElement?.textContent ?? "").trim())) === nombreDeLaPrimera) break;
  }
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/monitores?materia=${encodeURIComponent(materia.codigo)}`, ESPERA);
});
