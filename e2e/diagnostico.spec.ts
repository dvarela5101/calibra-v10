import { randomUUID } from "node:crypto";
import type { Browser, BrowserContext, ElementHandle, Locator, Page, Request, Response } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderToStaticMarkup } from "react-dom/server";
import { dibujarTexto } from "../src/components/contenido/dibujar";
import { diaDelNegocio, formatearDia } from "../src/lib/fechas";
import type { Banco, Pregunta } from "../scripts/contenido/modelo.mts";
import { CLAVES_INTERNAS_DE_EJEMPLO, GUARDADO_DE_EJEMPLO, sembrarDiagnostico } from "../pruebas/diagnostico-sembrado";
import { cuerpoDe } from "../pruebas/cuerpo-de-respuesta";
import { desescaparComillas } from "../pruebas/flujo-recibido";
import {
  borrarBancoDelProyecto,
  cargarBancoDelProyecto,
  contarFilasDelProyecto,
  FORMULA_MAS_ANCHA,
  type BancoCargado,
} from "./banco-del-proyecto";
import { COOKIE_ORIGEN } from "../src/lib/leads/origen";
import { crearClienteAdmin, enviarCredenciales, esperarSesion, expect, leerSesion, test as base, usarTurnstileDePrueba, variable } from "./utilidades";

// HU-009: tomar el diagnóstico sin iniciar sesión, de /diagnostico al resultado, medido en un navegador a 390×844 (`movil`) y a
// 1280×800 (`escritorio`). La lógica está en src/lib/diagnostico/*.test.ts y en los Vitest de las pantallas; aquí se prueba lo
// que solo se ve en un navegador (foco, teclado, regiones vivas, peticiones, el 404 del segmento, las cabeceras) contra el
// Supabase local, con el banco de ejemplo cargado con el cargador real.
//
// - Un banco por proyecto (e2e/banco-del-proyecto.ts): Playwright corre los dos proyectos a la vez contra la misma base, y cada
//   uno tiene sus materias (`ZZDM-` y `ZZDE-`), con nombre propio, que se borran por código exacto. El archivo corre en orden
//   dentro de cada proyecto. Una prueba que cambia el banco (activar `parcial-2` o `examen-final`) lo deja como estaba en un
//   `finally`; ninguna apaga `parcial-1` de la materia A.
// - Cada navegador que abre una página gasta una sesión anónima del Auth local (150 por hora): las pruebas que no la necesitan la
//   bloquean (`sinSesionAnonima`), y las demás borran al terminar las que nacieron (con sus diagnósticos).
// - La pregunta que sale en pantalla se reconoce por su texto contra el banco leído del disco (`Indice`): las letras dependen
//   de la semilla, así que las respuestas se eligen por el texto de la opción, no por la letra.
// - html y body llevan `overflow-x: hidden` (globals.css): scrollWidth del documento nunca delata un desborde, así que se mide
//   por elemento, como e2e/resolver-reportes.spec.ts.

const ESPERA = { timeout: 20_000 };
const LARGA = { timeout: 45_000 };
const CLOUDFLARE = "**/challenges.cloudflare.com/**";
const URL_RESULTADO = /\/diagnostico\/resultado\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

const TITULO_DEL_SELECTOR = "Elige tu materia";
const TITULO_DE_LA_PREGUNTA = "Tu diagnóstico";
const TITULO_DEL_RESULTADO = "Tu resultado";
const TITULO_SIN_PREGUNTAS = "Ya viste todas las preguntas";
const ELIGE_UNA_OPCION = "Elige una opción";
const ERROR_AL_RESPONDER = "No pudimos guardar tu respuesta. Inténtalo de nuevo.";
const ERROR_AL_EMPEZAR = "No pudimos empezar el diagnóstico. Inténtalo de nuevo.";
const DIAGNOSTICO_VENCIDO = "Ese diagnóstico ya no está. Empieza uno nuevo.";
const NO_DISPONIBLE = "Esa evaluación no está disponible";
const CUENTA_DEL_EQUIPO = "Estás con tu cuenta del equipo de Calibra. Para agendar como estudiante, sal de tu cuenta o usa otra ventana.";
const SIN_VERIFICACION = "No pudimos verificar tu navegador. Revisa tu conexión y vuelve a intentarlo.";
const NIVELES = { lo_domina: "Lo dominas", en_proceso: "En proceso", no_lo_domina: "No lo dominas", sin_medir: "Sin medir" } as const;

// ---------------------------------------------------------------------------
// Fixtures: el banco del proyecto y lo que nace en cada prueba
// ---------------------------------------------------------------------------

type Limpieza = {
  /** Cliente con la llave secreta. */
  admin: SupabaseClient;
  /** Anota cada usuario que nazca por un alta anónima de este contexto, aunque la prueba falle antes de leer la cookie. */
  vigilar(context: BrowserContext): void;
  /** Anota un usuario que no vigiló el contexto. */
  anotar(id: string): void;
};

const test = base.extend<{ limpieza: Limpieza }, { banco: BancoCargado }>({
  // Una vez por trabajador: carga el banco de su proyecto y, al terminar, comprueba que no quedó ningún diagnóstico y lo borra.
  banco: [
    async ({}, entregar, workerInfo) => {
      const banco = await cargarBancoDelProyecto(workerInfo.project.name);
      let restos = { diagnosticos: 0, enCurso: 0 };
      try {
        await entregar(banco);
        restos = await contarFilasDelProyecto(banco.bd, banco.proyecto);
      } finally {
        try {
          await borrarBancoDelProyecto(banco.bd, banco.proyecto);
        } finally {
          await banco.bd.end();
        }
      }
      expect(restos, "al terminar no queda ningún diagnóstico ni diagnóstico en curso de las materias del proyecto").toEqual({
        diagnosticos: 0,
        enCurso: 0,
      });
    },
    { scope: "worker", timeout: 120_000 },
  ],

  limpieza: async ({}, entregar) => {
    const admin = crearClienteAdmin();
    const sesiones = new Set<string>();
    const lecturas: Promise<void>[] = [];

    await entregar({
      admin,
      vigilar(context) {
        context.on("response", (respuesta) => {
          if (respuesta.request().method() !== "POST" || new URL(respuesta.url()).pathname !== "/auth/v1/signup" || !respuesta.ok()) return;
          lecturas.push(
            respuesta
              .json()
              .then(({ user }: { user?: { id: string } }) => void (user && sesiones.add(user.id)))
              // La página se cerró antes de leer la respuesta: la cookie o `anotar` lo registran.
              .catch(() => {}),
          );
        });
      },
      anotar: (id) => void sesiones.add(id),
    });

    // Se borra lo que nació en la prueba, aunque haya fallado: primero los diagnósticos y después las sesiones.
    await Promise.all(lecturas);
    const ids = [...sesiones];
    const fallos: string[] = [];
    const intentar = async (contexto: string, accion: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await accion;
      if (error && !/not found/i.test(error.message)) fallos.push(`${contexto}: ${error.message}`);
    };
    if (ids.length) {
      await intentar("diagnostico_en_curso", admin.from("diagnostico_en_curso").delete().in("id_sesion", ids));
      await intentar("diagnostico", admin.from("diagnostico").delete().in("id_sesion_anonima", ids));
    }
    for (const id of ids) await intentar(`usuario ${id}`, admin.auth.admin.deleteUser(id));
    if (fallos.length) throw new Error(`No se pudo limpiar lo que creó la prueba:\n${fallos.join("\n")}`);
  },

  // Todo contexto de la fixture `page` anota las sesiones que nacen en él.
  context: async ({ context, limpieza }, entregar) => {
    limpieza.vigilar(context);
    await entregar(context);
  },
});

// `fullyParallel` corre hasta las pruebas de un archivo a la vez; aquí van en orden, una detrás de otra, en cada proyecto.
test.describe.configure({ mode: "default", timeout: 120_000 });

/** Un contexto aparte (otra persona) con las mismas opciones del proyecto, el stub de Turnstile y su limpieza. */
async function nuevoContexto(browser: Browser, limpieza: Limpieza): Promise<BrowserContext> {
  const { baseURL, viewport, locale, timezoneId } = test.info().project.use;
  const contexto = await browser.newContext({ baseURL, viewport, locale, timezoneId });
  await usarTurnstileDePrueba(contexto);
  limpieza.vigilar(contexto);
  return contexto;
}

/** Sin alta anónima: las pruebas que no la necesitan no gastan el cupo por IP de Supabase Auth. */
async function sinSesionAnonima(page: Page) {
  await page.route("**/auth/v1/signup", (ruta) => ruta.abort());
}

// ---------------------------------------------------------------------------
// Lo que hay en la base
// ---------------------------------------------------------------------------

type FilaEnCurso = { id: string; paso: number; id_evaluacion: string; repetido: boolean; npasos: number };

async function enCursoDe(banco: BancoCargado, idSesion: string): Promise<FilaEnCurso | null> {
  const { rows } = await banco.bd.query<FilaEnCurso>(
    "select id, paso, id_evaluacion, repetido, jsonb_array_length(pasos) as npasos from public.diagnostico_en_curso where id_sesion = $1",
    [idSesion],
  );
  return rows[0] ?? null;
}

type FilaTerminada = { id: string; respondidas: number; aciertos: number; repetido: boolean; id_evaluacion: string; token_recuperacion: string };

async function diagnosticosDe(banco: BancoCargado, idSesion: string): Promise<FilaTerminada[]> {
  const { rows } = await banco.bd.query<FilaTerminada>(
    "select id, respondidas, aciertos, repetido, id_evaluacion, token_recuperacion from public.diagnostico where id_sesion_anonima = $1 order by fecha_realizacion, id",
    [idSesion],
  );
  return rows;
}

/** Activa una Evaluación mientras dura `accion` y la deja apagada al terminar, falle o no. */
async function conEvaluacionActiva<T>(banco: BancoCargado, idEvaluacion: string, accion: () => Promise<T>): Promise<T> {
  await banco.bd.query("update public.evaluacion set activa = true where id = $1", [idEvaluacion]);
  try {
    return await accion();
  } finally {
    await banco.bd.query("update public.evaluacion set activa = false where id = $1", [idEvaluacion]);
  }
}

/** Hace envejecer el diagnóstico en curso de una sesión: su última respuesta fue hace más de dos horas. */
async function envejecer(banco: BancoCargado, idSesion: string): Promise<void> {
  const { rowCount } = await banco.bd.query(
    "update public.diagnostico_en_curso set actualizado_en = now() - interval '2 hours 1 minute' where id_sesion = $1",
    [idSesion],
  );
  expect(rowCount, "había un diagnóstico en curso que envejecer").toBe(1);
}

// ---------------------------------------------------------------------------
// El banco como oráculo: reconocer la pregunta que sale en pantalla
// ---------------------------------------------------------------------------

/** El texto que ve la persona en un trozo de HTML: sin etiquetas, con las entidades de React decodificadas y los espacios juntos. */
function textoPlano(html: string): string {
  const entidades: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'" };
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (entidad) => entidades[entidad])
    .replace(/\s+/g, " ")
    .trim();
}

/** Lo que aparece en pantalla cuando un texto del banco pasa por `TextoDelBanco` (el mismo `dibujarTexto`). */
const plano = (texto: string | null): string => textoPlano(renderToStaticMarkup(dibujarTexto(texto)));

type OpcionDelBanco = { texto: string; plano: string; correcta: boolean; error: string | null };
type PreguntaDelBanco = { clave: string; pregunta: Pregunta; enunciado: string; opciones: OpcionDelBanco[] };

/** Lo que lee la persona en una pregunta: el avance, el enunciado y las opciones con su letra. */
type VistaDePregunta = { avance: string; enunciado: string; opciones: { letra: string; texto: string }[] };

type Reconocida = {
  clave: string;
  letraDeLaCorrecta: string;
  letraDeUnaTrampa: string;
  /** La opción del banco que está en esa letra de la pantalla. */
  opcionEn(letra: string): OpcionDelBanco;
};

class Indice {
  private readonly preguntas: PreguntaDelBanco[] = [];

  constructor(banco: Banco) {
    for (const materia of banco.materias) {
      for (const tema of materia.temas) {
        for (const pregunta of tema.preguntas) {
          if (pregunta.estado !== "revisada") continue;
          this.preguntas.push({
            clave: pregunta.clave,
            pregunta,
            enunciado: plano(pregunta.enunciado),
            opciones: pregunta.opciones.map((o) => ({ texto: o.texto, plano: plano(o.texto), correcta: o.correcta, error: o.error })),
          });
        }
      }
    }
  }

  /** Todos los textos de error propios (D-14) de las opciones del banco. */
  textosDeError(): string[] {
    return this.preguntas.flatMap((p) => p.opciones.flatMap((o) => (o.error ? [o.error] : [])));
  }

  /** Las soluciones del banco, que no llegan nunca al navegador. */
  soluciones(): string[] {
    return this.preguntas.flatMap((p) => (p.pregunta.solucion ? [p.pregunta.solucion] : []));
  }

  reconocer(vista: VistaDePregunta): Reconocida {
    const halladas = this.preguntas.filter((p) => p.enunciado === vista.enunciado);
    if (halladas.length !== 1) {
      throw new Error(`No reconozco la pregunta que salió en pantalla (${halladas.length} coincidencias): ${vista.enunciado.slice(0, 100)}`);
    }
    const [pregunta] = halladas;
    const porLetra = new Map<string, OpcionDelBanco>();
    for (const opcion of vista.opciones) {
      const coincidencias = pregunta.opciones.filter((o) => o.plano === opcion.texto);
      if (coincidencias.length !== 1) throw new Error(`No reconozco la opción ${opcion.letra} de ${pregunta.clave}: ${opcion.texto}`);
      porLetra.set(opcion.letra, coincidencias[0]);
    }
    const letraDe = (cumple: (o: OpcionDelBanco) => boolean) => {
      const hallada = [...porLetra].find(([, o]) => cumple(o));
      if (!hallada) throw new Error(`${pregunta.clave} no tiene la opción que se buscaba.`);
      return hallada[0];
    };
    return {
      clave: pregunta.clave,
      letraDeLaCorrecta: letraDe((o) => o.correcta),
      letraDeUnaTrampa: letraDe((o) => !o.correcta),
      opcionEn: (letra) => porLetra.get(letra)!,
    };
  }
}

// ---------------------------------------------------------------------------
// La pantalla
// ---------------------------------------------------------------------------

const titulo = (page: Page, nombre: string) => page.getByRole("heading", { level: 1, name: nombre, exact: true });
// Next tiene su propio role="alert" (el anunciador de rutas): se busca por el texto.
const alerta = (page: Page, texto: string) => page.getByRole("alert").filter({ hasText: texto });
const botonEmpezar = (page: Page) => page.getByRole("button", { name: "Empezar", exact: true });
const botonResponder = (page: Page) => page.getByRole("button", { name: "Responder", exact: true });
const regionDeAvance = (page: Page) => page.locator('main p[aria-live="polite"]');
const ENUNCIADO = "#enunciado-de-la-pregunta";

/** Abre /diagnostico y espera a que se hidrate: el formulario y la sesión anónima llegan después. */
async function abrirSelector(page: Page): Promise<Response | null> {
  const respuesta = await page.goto("/diagnostico");
  await expect(titulo(page, TITULO_DEL_SELECTOR)).toBeVisible(ESPERA);
  await page.waitForLoadState("networkidle");
  return respuesta;
}

/**
 * Elige la materia y, si tiene una sola Evaluación, también esa: desde D-74 b ya no viene elegida. Con varias, la prueba elige
 * la que quiera.
 */
async function elegirMateria(page: Page, nombre: string): Promise<void> {
  await page.getByRole("radiogroup", { name: "Materia", exact: true }).getByRole("radio", { name: nombre, exact: true }).check();
  const evaluaciones = page.getByRole("radiogroup", { name: "Evaluación", exact: true }).getByRole("radio");
  await expect(evaluaciones.first()).toBeVisible();
  if ((await evaluaciones.count()) === 1) await evaluaciones.first().check();
}

/** Abre el selector, elige la materia y su única Evaluación, y pulsa «Empezar» hasta que sale la primera pregunta. */
async function empezarPrueba(page: Page, nombreDeLaMateria: string): Promise<void> {
  await abrirSelector(page);
  await elegirMateria(page, nombreDeLaMateria);
  await botonEmpezar(page).click();
  await expect(titulo(page, TITULO_DE_LA_PREGUNTA)).toBeVisible(LARGA);
}

async function leerPregunta(page: Page): Promise<VistaDePregunta> {
  return page.evaluate(() => {
    const juntar = (texto: string | null | undefined) => (texto ?? "").replace(/\s+/g, " ").trim();
    return {
      avance: juntar(document.querySelector('main p[aria-live="polite"]')?.textContent),
      enunciado: juntar(document.getElementById("enunciado-de-la-pregunta")?.textContent),
      opciones: [...document.querySelectorAll<HTMLInputElement>('input[name="opcion"]')].map((radio) => ({
        letra: radio.value,
        // La letra es un `span` y el texto el último elemento de la tarjeta (`TextoDelBanco`).
        texto: juntar(radio.closest("label")?.lastElementChild?.textContent),
      })),
    };
  });
}

/** Las peticiones de Server Actions (POST con cabecera `next-action`) que hace la página. */
function contarAcciones(page: Page): { total(): number } {
  const acciones: Request[] = [];
  page.on("request", (peticion) => {
    if (peticion.method() === "POST" && peticion.headers()["next-action"] !== undefined) acciones.push(peticion);
  });
  return { total: () => acciones.length };
}

let vigilantesCreados = 0;

/**
 * Todo lo que el servidor le manda al navegador (las páginas y las respuestas de las acciones), para buscar ahí lo que no debe
 * llegar. Next incrusta el flujo de cada página en una cadena de JavaScript con las comillas escapadas (`\"clave\"`): se
 * desescapan, o un centinela como `"clave"` solo podría dispararse contra una acción y nunca contra una página.
 *
 * Los cuerpos llegan por dos caminos, porque el del protocolo de Chrome (`response.text()`) no sirve para las respuestas de `fetch`:
 * con el servidor de producción responde «No data found for resource with given identifier» a respuestas que la página sí recibió,
 * sin ninguna navegación de por medio (en una corrida de esta prueba con cuatro trabajadores: 4 de 65 respuestas de acciones y la
 * mitad de las de flujo RSC, también la de cada navegación al resultado). El cuerpo se perdía en silencio, y bastaba perder los dos
 * de D-51 (los únicos que traen `"habilidades"`) para que el control positivo fallara aunque la app funcionara.
 * - Todo lo que la página pide con `fetch` (las acciones y el flujo de cada navegación del cliente) lo lee la propia página, con un
 *   `clone()` de la respuesta en un `fetch` envuelto antes de que corra su código, y se lo pasa a la prueba. Es lo que el navegador
 *   recibió, completo y sin depender de lo que Chrome conserve.
 * - Las páginas (`text/html`) se leen por el protocolo, como antes, pero con `cuerpoDe`: un cuerpo cortado por una recarga o una
 *   navegación se descarta pasado el tope en lugar de dejar la prueba esperando hasta su timeout.
 * Quien necesite un cuerpo concreto lo espera con `esperarQueLleguen`: el de la página llega a la prueba un instante después.
 */
async function vigilarRespuestas(page: Page): Promise<() => Promise<string>> {
  const paginas: Promise<string>[] = [];
  const delFetch: string[] = [];
  const nombre = `__calibraVigilante${vigilantesCreados++}`;

  await page.exposeFunction(nombre, (texto: string) => void delFetch.push(texto));
  await page.addInitScript((nombreDeLaFuncion: string) => {
    const original = window.fetch;
    window.fetch = async function (this: unknown, ...argumentos: Parameters<typeof fetch>) {
      const respuesta = await original.apply(this, argumentos);
      const entregar = (window as unknown as Record<string, ((texto: string) => unknown) | undefined>)[nombreDeLaFuncion];
      if (entregar && /text\/html|text\/x-component/.test(respuesta.headers.get("content-type") ?? "")) {
        respuesta
          .clone()
          .text()
          .then(
            (texto) => void entregar(texto),
            // Next cancela algunos prefetch: lo que la página no pudo leer tampoco le llegó.
            () => undefined,
          );
      }
      return respuesta;
    };
  }, nombre);

  page.on("response", (respuesta) => {
    const tipo = respuesta.headers()["content-type"] ?? "";
    if (/text\/html|text\/x-component/.test(tipo)) paginas.push(cuerpoDe(respuesta));
  });
  return async () => desescaparComillas([...(await Promise.all(paginas)), ...delFetch].join("\n"));
}

/** Espera a que lo recibido tenga el centinela: el cuerpo que lo trae puede estar todavía de camino hacia la prueba. */
async function esperarQueLleguen(recibido: () => Promise<string>, centinela: string, mensaje: string): Promise<void> {
  await expect.poll(async () => (await recibido()).includes(centinela), { message: mensaje, timeout: ESPERA.timeout }).toBe(true);
}

/** Las claves que nunca llegan al navegador, escritas entre comillas como las deja el JSON (ver `desescaparComillas`). */
const CLAVES_PROHIBIDAS = [
  '"dificultad"',
  '"misconcepcion"',
  '"solucion"',
  '"correcta"',
  '"semilla"',
  '"token_recuperacion"',
  '"faltaMaterial"',
  '"falta_material"',
  '"vistasAntes"',
  '"candidatas"',
  '"repetido"',
  '"idUltimoDiagnostico"',
  '"habilidad"',
  '"descripcionHabilidad"',
  '"puntaje"',
  '"clave"',
];

/**
 * Lo que el banco de ejemplo tiene y no llega nunca al navegador mientras la persona responde: las claves de las misconcepciones,
 * las soluciones y los textos de error propios (D-14) de las opciones que no eligió.
 */
function valoresProhibidos(indice: Indice, textosElegidos: ReadonlySet<string>): string[] {
  return [
    ...["no-resta-uno", "suma-uno", "no-baja", "olvida-interna", "solo-interna"],
    ...indice.soluciones().map((solucion) => solucion.split("\n")[0]),
    ...indice.textosDeError().filter((texto) => !textosElegidos.has(texto)),
  ];
}

/** Falla con el nombre de cada centinela que aparece en lo recibido. */
function exigirQueNoLlego(recibido: string, prohibidos: readonly string[]): void {
  for (const prohibido of prohibidos) expect(recibido.includes(prohibido), `llegó al navegador: ${prohibido}`).toBe(false);
}

/** Un `Cache-Control` que nunca es público. Con `next start` (CI) las dinámicas salen privadas; `next dev` manda solo «no-cache». */
function exigirSinCachePublico(respuesta: Response | null, donde: string): void {
  const cabecera = respuesta?.headers()["cache-control"];
  expect(cabecera, `${donde}: debe traer Cache-Control`).toBeTruthy();
  expect(cabecera, `${donde}: no puede ser público ni compartido`).not.toMatch(/\bpublic\b|s-maxage/i);
  expect(cabecera, `${donde}: privado o sin caché`).toMatch(process.env.CI ? /\b(private|no-store)\b/i : /\b(private|no-store|no-cache)\b/i);
}

// ---------------------------------------------------------------------------
// Responder
// ---------------------------------------------------------------------------

type OpcionesDeEnvio = { teclado?: boolean; dobleClic?: boolean };

/** Elige la letra con el teclado, como lo haría quien no usa el ratón: desde la A, las flechas cambian la opción. */
async function elegirConTeclado(page: Page, letra: string): Promise<void> {
  const posicion = ["A", "B", "C", "D"].indexOf(letra);
  await page.locator('input[name="opcion"][value="A"]').focus();
  if (posicion === 0) await page.keyboard.press("Space");
  for (let i = 0; i < posicion; i++) await page.keyboard.press("ArrowDown");
  await expect(page.locator(`input[name="opcion"][value="${letra}"]`)).toBeChecked();
  await expect(page.locator('input[name="opcion"]:checked')).toHaveCount(1);
}

async function elegirYResponder(page: Page, letra: string, opciones: OpcionesDeEnvio = {}): Promise<void> {
  if (opciones.teclado) {
    await elegirConTeclado(page, letra);
    await page.keyboard.press("Enter");
    return;
  }
  await page.locator(`input[name="opcion"][value="${letra}"]`).check();
  if (opciones.dobleClic) await botonResponder(page).dblclick();
  else await botonResponder(page).click();
}

/** Espera la pregunta que sigue (el avance cambió) o el resultado (cambió la dirección). */
async function esperarSiguiente(page: Page, avanceAnterior: string | null): Promise<"pregunta" | "resultado"> {
  let destino: "pregunta" | "resultado" = "pregunta";
  await expect
    .poll(
      async () => {
        if (URL_RESULTADO.test(page.url())) {
          destino = "resultado";
          return true;
        }
        const avance = await regionDeAvance(page)
          .textContent({ timeout: 1_000 })
          .catch(() => null);
        return avance !== null && avance.trim() !== "" && avance.trim() !== avanceAnterior;
      },
      { message: "debía salir la pregunta que sigue o el resultado", timeout: 30_000 },
    )
    .toBe(true);
  return destino;
}

type Paso = { clave: string; elegida: OpcionDelBanco; correcta: boolean };

/** Las preguntas cuyas reglas del producto se midieron en esta prueba (`darPaso` con `revisar`): P5 trae la fórmula más ancha. */
const preguntasMedidas: string[] = [];

/**
 * Lee la pregunta en pantalla, la reconoce en el banco, elige la correcta o una trampa por el texto de la opción, responde y
 * espera lo que sigue. Con `revisar`, mide antes las reglas del producto en esa pantalla (y la fórmula más ancha del banco, que
 * viene en la opción D de P5).
 */
async function darPaso(
  page: Page,
  indice: Indice,
  cual: "correcta" | "trampa",
  opciones: OpcionesDeEnvio & { revisar?: boolean } = {},
): Promise<{ paso: Paso; destino: "pregunta" | "resultado" }> {
  const vista = await leerPregunta(page);
  const reconocida = indice.reconocer(vista);
  if (opciones.revisar) {
    if (reconocida.clave === "P5") await expectLaFormulaMasAncha(page, vista);
    await expectReglas(page, `la pregunta ${reconocida.clave}`);
    preguntasMedidas.push(reconocida.clave);
  }
  const letra = cual === "correcta" ? reconocida.letraDeLaCorrecta : reconocida.letraDeUnaTrampa;
  const elegida = reconocida.opcionEn(letra);
  await elegirYResponder(page, letra, opciones);
  const destino = await esperarSiguiente(page, vista.avance);
  return { paso: { clave: reconocida.clave, elegida, correcta: cual === "correcta" }, destino };
}

/** Responde hasta llegar al resultado. `decidir` recibe el número de la pregunta (desde 0). */
async function recorrerHastaElResultado(
  page: Page,
  indice: Indice,
  decidir: (numero: number) => "correcta" | "trampa",
  opciones: { revisar?: boolean } = {},
): Promise<Paso[]> {
  const pasos: Paso[] = [];
  for (let numero = 0; numero < 40; numero++) {
    const { paso, destino } = await darPaso(page, indice, decidir(numero), opciones);
    pasos.push(paso);
    if (destino === "resultado") {
      await expect(titulo(page, TITULO_DEL_RESULTADO)).toBeVisible(LARGA);
      return pasos;
    }
  }
  throw new Error("El diagnóstico no terminó en 40 preguntas.");
}

/** Después de «Empezar»: la primera pregunta o el mensaje de D-51, lo que salga primero. */
async function esperarPreguntaOMensaje(page: Page): Promise<"pregunta" | "sin_preguntas"> {
  let que: "pregunta" | "sin_preguntas" = "pregunta";
  await expect
    .poll(
      async () => {
        if ((await titulo(page, TITULO_DE_LA_PREGUNTA).count()) > 0) return true;
        if ((await titulo(page, TITULO_SIN_PREGUNTAS).count()) > 0) {
          que = "sin_preguntas";
          return true;
        }
        return false;
      },
      { message: "debía salir la primera pregunta o el mensaje de D-51", timeout: 30_000 },
    )
    .toBe(true);
  return que;
}

// ---------------------------------------------------------------------------
// Las reglas del producto sobre la pantalla abierta (copia adaptada de e2e/resolver-reportes.spec.ts; de los radios cuenta su
// etiqueta, que es lo que se toca)
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
  expect(medidas.desbordados, `${donde}: ningún elemento se sale de la pantalla ni de su caja`).toEqual([]);
  expect(medidas.formulasFueraDeSuTarjeta, `${donde}: cada fórmula cabe dentro de su tarjeta`).toEqual([]);
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
    // Los enlaces dentro de una frase son texto corrido: quedan fuera. De un radio cuenta su etiqueta, que es lo que se toca.
    const tocables = controles
      .filter((el) => !(el.tagName === "A" && el.closest("label, p")))
      .map((el) => (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? (el.labels?.[0] ?? el) : el));
    // `html` y `body` llevan `overflow-x: hidden`: el scroll horizontal nunca aparece aunque el contenido se desborde. Se mide cada
    // elemento a la vista: que su caja no se salga de la ventana y que su contenido no se salga de su propia caja. El scroll
    // interno de un bloque de código (`pre`) es legítimo: queda fuera de la segunda comprobación, y lo que lleva dentro, de las dos.
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
    // Una fórmula en línea (`math`) no se parte y su caja no tiene `clientWidth`: se compara con el borde de la tarjeta (menos su
    // relleno y su borde). Una fórmula que se sale de su tarjeta sin salirse de la ventana no la delata ninguna otra medida.
    const formulasFueraDeSuTarjeta = [...document.querySelectorAll<HTMLElement>("label math")]
      .filter(visible)
      .flatMap((formula) => {
        const tarjeta = formula.closest("label")!;
        const estilo = getComputedStyle(tarjeta);
        const limite = tarjeta.getBoundingClientRect().right - parseFloat(estilo.paddingRight) - parseFloat(estilo.borderRightWidth);
        const derecha = formula.getBoundingClientRect().right;
        return derecha > limite + 1 ? [{ formula: (formula.textContent ?? "").slice(0, 40), derecha: Math.round(derecha), limite: Math.round(limite) }] : [];
      });
    return {
      sinScrollHorizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      desbordados,
      formulasFueraDeSuTarjeta,
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

/** La opción D de P5 trae la fórmula más ancha del banco: se dibuja como `math` y cabe en su tarjeta (lo mide `expectReglas`). */
async function expectLaFormulaMasAncha(page: Page, vista: VistaDePregunta): Promise<void> {
  const esperado = plano(`$${FORMULA_MAS_ANCHA}$`);
  const letra = vista.opciones.find((opcion) => opcion.texto === esperado)?.letra;
  expect(letra, "P5 trae la fórmula más ancha del banco en una de sus opciones").toBeDefined();
  await expect(page.locator(`label:has(input[name="opcion"][value="${letra}"]) math`), "la fórmula más ancha se dibuja como math").toHaveCount(1);
}

// ---------------------------------------------------------------------------
// El resultado
// ---------------------------------------------------------------------------

type Guardado = typeof GUARDADO_DE_EJEMPLO;

/**
 * Lo que ve la persona es lo que quedó guardado: el resultado de la base (con la llave secreta) y la pantalla dicen lo mismo,
 * habilidad por habilidad, error por error y prerrequisito por prerrequisito, y el orden de los errores es el de la regla
 * (confirmados primero).
 */
async function expectResultadoGuardado(page: Page, banco: BancoCargado, idDiagnostico: string): Promise<void> {
  const { rows } = await banco.bd.query<{ resultado: Guardado }>("select resultado_por_habilidad as resultado from public.diagnostico where id = $1", [idDiagnostico]);
  expect(rows, "el diagnóstico está guardado").toHaveLength(1);
  const guardado = rows[0].resultado;

  const habilidades = page.getByRole("region", { name: "Habilidades", exact: true }).getByRole("listitem");
  await expect(habilidades).toHaveCount(guardado.habilidades.length);
  for (const [i, h] of guardado.habilidades.entries()) {
    const tarjeta = habilidades.nth(i);
    await expect(tarjeta, `habilidad ${i + 1}`).toContainText(plano(h.descripcion));
    await expect(tarjeta, `nivel de la habilidad ${i + 1}`).toContainText(NIVELES[h.nivel]);
    if (h.respuestas > 0) await expect(tarjeta).toContainText(`Acertaste ${h.aciertos} de ${h.respuestas}`);
    else await expect(tarjeta, `la habilidad ${i + 1} no tiene respuestas: sin cifras`).not.toContainText("Acertaste");
    if (h.nivel === "sin_medir") await expect(tarjeta).toContainText("No medimos esta habilidad en esta prueba.");
    else await expect(tarjeta).not.toContainText("No medimos");
  }

  const errores = page.getByRole("region", { name: "Errores", exact: true });
  if (guardado.errores.length === 0) {
    await expect(errores).toContainText("No detectamos errores concretos en esta prueba.");
  } else {
    const lista = errores.getByRole("listitem");
    await expect(lista).toHaveCount(guardado.errores.length);
    const descripciones = new Map(guardado.habilidades.map((h) => [h.habilidad, h.descripcion]));
    const ordenados = [...guardado.errores.filter((e) => e.estado === "confirmada"), ...guardado.errores.filter((e) => e.estado !== "confirmada")];
    for (const [i, e] of ordenados.entries()) {
      const tarjeta = lista.nth(i);
      await expect(tarjeta, `error ${i + 1}`).toContainText(`${e.estado === "confirmada" ? "Error detectado:" : "Posible error:"} ${plano(e.texto)}`);
      const habilidad = descripciones.get(e.habilidad);
      if (habilidad !== undefined) await expect(tarjeta).toContainText(`Habilidad: ${plano(habilidad)}`);
      else await expect(tarjeta, "una habilidad que no es del resultado no se nombra").not.toContainText("Habilidad:");
      for (const detalle of e.detalles) await expect(tarjeta).toContainText(plano(detalle));
    }
  }

  const repasar = page.getByRole("region", { name: "Conviene repasar antes", exact: true });
  await expect(repasar, "Conviene repasar antes solo sale con prerrequisitos").toHaveCount(guardado.prerrequisitos.length > 0 ? 1 : 0);
  if (guardado.prerrequisitos.length > 0) {
    const lista = repasar.getByRole("listitem");
    await expect(lista).toHaveCount(guardado.prerrequisitos.length);
    for (const [i, p] of guardado.prerrequisitos.entries()) {
      await expect(lista.nth(i)).toContainText(`${plano(p.descripcion)}${p.materia === null ? "" : ` (${p.materia})`}`);
    }
  }
}

/** Lo que dice el encabezado del resultado: «Respondiste N preguntas» y «Puntaje global: P %» (D-53 c). */
async function expectCifras(page: Page, respondidas: number, aciertos: number): Promise<void> {
  const principal = page.locator("main");
  await expect(principal).toContainText(respondidas === 1 ? /Respondiste 1 pregunta(?!s)/ : `Respondiste ${respondidas} preguntas`);
  await expect(principal).toContainText(`Puntaje global: ${Math.round((aciertos * 100) / respondidas)} %`);
}

// ===============================================================================================================
// 1. Inicio
// ===============================================================================================================

test("Inicio · «Hacer mi diagnóstico gratis» lleva a /diagnostico y la página ya no dice «subtema» ni «Estamos preparando»", async ({ page }) => {
  await sinSesionAnonima(page);
  await page.goto("/");

  // HU-108: la landing; el resto de lo suyo lo prueba e2e/portada.spec.ts.
  await expect(titulo(page, "Monitorías de ciclo básico que empiezan por tu error.")).toBeVisible();
  const acceso = page.getByRole("link", { name: "Hacer mi diagnóstico gratis", exact: true }).first();
  await expect(acceso).toBeVisible();
  await expect(acceso).toHaveAttribute("href", "/diagnostico");
  await expect(page.getByText("Nueva versión en construcción", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Estamos preparando esta versión")).toHaveCount(0);
  // Ningún texto de la página, ni la descripción de la pestaña, dice «subtema».
  expect((await page.content()).toLowerCase()).not.toContain("subtema");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    "Un diagnóstico corto te dice en qué habilidad fallas y te conecta con un monitor certificado de tu materia.",
  );
  await expectReglas(page, "el inicio");

  await acceso.click();
  await expect(page).toHaveURL("/diagnostico");
  await expect(titulo(page, TITULO_DEL_SELECTOR)).toBeVisible(ESPERA);
});

// ===============================================================================================================
// 2. Selector
// ===============================================================================================================

test("Selector · la materia y su única Evaluación se eligen, el botón a los monitores, ningún dato que escribir y «Empezar» sin elegir no manda nada", async ({
  page,
  context,
  banco,
  limpieza,
}) => {
  const acciones = contarAcciones(page);
  await abrirSelector(page);
  limpieza.anotar((await esperarSesion(context)).id);

  // «Diagnóstico» también es un paso del carril (D-74 d): el eyebrow es el de la columna principal.
  await expect(page.getByRole("main").getByText("Diagnóstico", { exact: true })).toBeVisible();
  await expect(page.getByText("Responde unas preguntas de opción múltiple y mira qué habilidades dominas. No necesitas crear una cuenta.")).toBeVisible();
  const materias = page.getByRole("radiogroup", { name: "Materia", exact: true });
  await expect(materias.getByRole("radio", { name: banco.nombreA, exact: true })).toBeVisible();
  // La materia B no tiene ninguna Evaluación activa (D-13): no se ofrece.
  await expect(materias.getByRole("radio", { name: banco.nombreB, exact: true })).toHaveCount(0);
  // «Empezar» no pide ningún dato: solo hay radios.
  await expect(page.locator("main input:not([type=radio]), main textarea, main select")).toHaveCount(0);

  // Sin elegir nada: el error, y ninguna llamada.
  await botonEmpezar(page).click();
  await expect(alerta(page, "Elige una materia")).toBeVisible();

  // Antes de elegir materia, el botón lleva a la lista de monitores (D-74 c); la línea de D-53 a ya no sale con materias.
  const aMonitores = page.getByRole("link", { name: "Ver monitores sin hacer la prueba", exact: true });
  await expect(aMonitores).toHaveAttribute("href", "/monitores");
  await expect(page.getByText("¿No ves tu materia?")).toHaveCount(0);

  // Con una sola Evaluación activa también hay que elegirla (D-74 b): una tarjeta con su nombre y sus temas, sin elegir.
  await materias.getByRole("radio", { name: banco.nombreA, exact: true }).check();
  await expect(alerta(page, "Elige una materia")).toHaveCount(0);
  const evaluaciones = page.getByRole("radiogroup", { name: "Evaluación", exact: true }).getByRole("radio");
  await expect(evaluaciones).toHaveCount(1);
  await expect(evaluaciones.first()).toHaveAccessibleName(/^Parcial 1\s*Temas: Derivadas$/);
  await expect(evaluaciones.first()).not.toBeChecked();
  await botonEmpezar(page).click();
  await expect(alerta(page, "Elige una evaluación")).toBeVisible();
  await evaluaciones.first().check();
  await expect(alerta(page, "Elige una evaluación")).toHaveCount(0);

  // Con la materia elegida, el botón lleva a sus monitores.
  await expect(aMonitores).toHaveAttribute("href", `/monitores?materia=${banco.codigoA}`);

  await expectReglas(page, "el selector");
  expect(acciones.total(), "elegir y pulsar «Empezar» sin elegir no llama a ninguna acción").toBe(0);
});

test("Selector · con varias Evaluaciones activas cada una trae su nombre y sus temas, y hay que elegir una", async ({ page, banco, limpieza, context }) => {
  await conEvaluacionActiva(banco, banco.idParcial2, async () => {
    await abrirSelector(page);
    limpieza.anotar((await esperarSesion(context)).id);
    await elegirMateria(page, banco.nombreA);

    const grupo = page.getByRole("radiogroup", { name: "Evaluación", exact: true });
    const radios = grupo.getByRole("radio");
    await expect(radios).toHaveCount(2);
    // Por semana: Parcial 1 (6) y Parcial 2 (12), cada una con sus temas. La acumulativa trae también los de antes.
    await expect(radios.nth(0)).toHaveAccessibleName(/^Parcial 1\s*Temas: Derivadas$/);
    await expect(radios.nth(1)).toHaveAccessibleName(/^Parcial 2\s*Temas: .*Integrales/);
    await expect(page.getByRole("group", { name: "Evaluación", exact: true })).toHaveCount(0);

    // Ninguna elegida todavía.
    await botonEmpezar(page).click();
    await expect(alerta(page, "Elige una evaluación")).toBeVisible();
    await radios.nth(1).check();
    await expect(alerta(page, "Elige una evaluación")).toHaveCount(0);
    await expectReglas(page, "el selector con dos Evaluaciones");
  });
});

test("Sesión anónima · si la sesión no nace, «Empezar» avisa con su botón y no crea nada; al reintentar el envío sigue solo", async ({
  page,
  context,
  banco,
  limpieza,
}) => {
  await context.route(CLOUDFLARE, (ruta) => ruta.abort());
  const esDeCloudflare = (peticion: Request) => new URL(peticion.url()).hostname === "challenges.cloudflare.com";
  const falla = page.waitForEvent("requestfailed", { predicate: esDeCloudflare, timeout: 30_000 });
  await page.goto("/diagnostico");
  await falla;
  await page.waitForLoadState("networkidle");
  await expect(titulo(page, TITULO_DEL_SELECTOR)).toBeVisible(ESPERA);
  expect(leerSesion(await context.cookies()), "sin Cloudflare no hay sesión").toBeNull();

  await elegirMateria(page, banco.nombreA);
  await botonEmpezar(page).click();
  await expect(alerta(page, SIN_VERIFICACION)).toBeVisible(LARGA);
  const reintentar = page.getByRole("button", { name: "Reintentar la verificación", exact: true });
  await expect(reintentar).toBeVisible();
  await expect(titulo(page, TITULO_DEL_SELECTOR)).toBeVisible();
  expect(leerSesion(await context.cookies())).toBeNull();
  expect(await contarFilasDelProyecto(banco.bd, banco.proyecto), "no se creó nada").toEqual({ diagnosticos: 0, enCurso: 0 });

  // Con Cloudflare de vuelta (el stub de Turnstile sigue puesto), reintentar crea la sesión y el envío sigue solo.
  await context.unroute(CLOUDFLARE);
  await reintentar.click();
  await expect(titulo(page, TITULO_DE_LA_PREGUNTA)).toBeVisible(LARGA);
  const sesion = await esperarSesion(context);
  limpieza.anotar(sesion.id);
  expect(sesion.esAnonimo).toBe(true);
  expect(await enCursoDe(banco, sesion.id)).toMatchObject({ paso: 0, id_evaluacion: banco.idParcial1 });
});

test("Casos que no empiezan · una Evaluación que se apagó después de cargar la página responde «Esa evaluación no está disponible» y no crea nada", async ({
  page,
  context,
  banco,
  limpieza,
}) => {
  await conEvaluacionActiva(banco, banco.idExamenFinal, async () => {
    await abrirSelector(page);
    limpieza.anotar((await esperarSesion(context)).id);
    // La materia B tiene hoy una sola Evaluación activa: elegirMateria la elige también (D-74 b).
    await elegirMateria(page, banco.nombreB);
    await expect(page.getByRole("radiogroup", { name: "Evaluación", exact: true })).toContainText("Examen final");

    // El banco cambió mientras la página estaba abierta.
    await banco.bd.query("update public.evaluacion set activa = false where id = $1", [banco.idExamenFinal]);
    await botonEmpezar(page).click();

    await expect(alerta(page, NO_DISPONIBLE)).toBeVisible(ESPERA);
    await expect(titulo(page, TITULO_DEL_SELECTOR)).toBeVisible();
    // La lista se vuelve a pedir: la materia B ya no se ofrece.
    await expect(page.getByRole("radio", { name: banco.nombreB, exact: true })).toHaveCount(0, ESPERA);
    expect(await contarFilasDelProyecto(banco.bd, banco.proyecto), "no se creó nada").toEqual({ diagnosticos: 0, enCurso: 0 });
  });
});

test("Casos que no empiezan · un monitor y un admin que pulsan «Empezar» ven el aviso del equipo y no se crea nada", async ({
  browser,
  banco,
  limpieza,
  cuentas,
}) => {
  for (const rol of ["monitor", "admin"] as const) {
    await test.step(`cuenta de ${rol}`, async () => {
      const cuenta = rol === "monitor" ? await cuentas.crearMonitor() : await cuentas.crearAdmin();
      const contexto = await nuevoContexto(browser, limpieza);
      try {
        const page = await contexto.newPage();
        await page.goto("/ingresar");
        await enviarCredenciales(page, cuenta.correo, cuenta.contrasena);
        await expect(page).toHaveURL(rol === "monitor" ? "/monitor" : "/admin", LARGA);

        await abrirSelector(page);
        await elegirMateria(page, banco.nombreA);
        await botonEmpezar(page).click();
        await expect(alerta(page, CUENTA_DEL_EQUIPO)).toBeVisible(ESPERA);
        await expect(titulo(page, TITULO_DEL_SELECTOR)).toBeVisible();
        expect(await contarFilasDelProyecto(banco.bd, banco.proyecto), `${rol}: no se creó nada`).toEqual({ diagnosticos: 0, enCurso: 0 });
      } finally {
        await contexto.close();
      }
    });
  }
});

// ===============================================================================================================
// 3. Recorrido
// ===============================================================================================================

test("Recorrido · empezar, responder con el teclado y con doble clic, llegar al resultado, repetir y agotar las preguntas (D-51)", async ({
  page,
  context,
  banco,
  limpieza,
}) => {
  test.setTimeout(300_000);
  const indice = new Indice(banco.banco);
  const acciones = contarAcciones(page);
  const todoLoRecibido = await vigilarRespuestas(page);
  const elegidas: OpcionDelBanco[] = [];
  const principal = page.locator("main");
  preguntasMedidas.length = 0;

  // --- Empezar
  const documento = await abrirSelector(page);
  exigirSinCachePublico(documento, "/diagnostico (primera visita, sin sesión)");
  const sesion = await esperarSesion(context);
  limpieza.anotar(sesion.id);
  await elegirMateria(page, banco.nombreA);
  expect(acciones.total(), "elegir no envía nada").toBe(0);
  await botonEmpezar(page).click();
  await expect(titulo(page, TITULO_DE_LA_PREGUNTA)).toBeVisible(LARGA);
  expect(acciones.total(), "«Empezar» llama una sola vez").toBe(1);

  // --- La primera pregunta
  const primera = await leerPregunta(page);
  expect(primera.avance).toMatch(/^Pregunta 1 de hasta \d+$/);
  expect(Number(/hasta (\d+)/.exec(primera.avance)![1]), "el ejemplo da al menos tres preguntas").toBeGreaterThanOrEqual(3);
  expect(primera.opciones.map((o) => o.letra), "cuatro opciones, de la A a la D").toEqual(["A", "B", "C", "D"]);
  await expect(page.getByText(`${banco.nombreA} · Parcial 1`, { exact: true })).toBeVisible();
  await expect(page.getByRole("radiogroup")).toHaveCount(1);
  await expect(page.locator(ENUNCIADO), "al llegar la primera pregunta por una transición el foco queda en el enunciado").toBeFocused();
  // Sin acierto a la vista y sin volver atrás: solo se puede responder o cambiar de materia.
  await expect(page.locator("main button")).toHaveText(["Responder", "Cambiar de materia"]);
  await expect(principal).not.toContainText(/Correcta|Incorrecta|Acertaste|Anterior/i);
  await expect(regionDeAvance(page)).toHaveAttribute("aria-atomic", "true");
  const regionAntes = await regionDeAvance(page).elementHandle();

  // «Responder» sin elegir: el aviso, sin llamar a nada y sin mover el foco.
  await botonResponder(page).click();
  await expect(alerta(page, ELIGE_UNA_OPCION)).toBeVisible();
  await expect(botonResponder(page)).toBeFocused();
  expect(acciones.total(), "«Responder» sin elegir no llama a nada").toBe(1);
  // Elegir una opción tampoco envía nada, y quita el aviso.
  await page.locator('input[name="opcion"][value="B"]').check();
  await expect(alerta(page, ELIGE_UNA_OPCION)).toHaveCount(0);
  expect(acciones.total(), "elegir una opción no envía nada").toBe(1);

  // --- Pregunta 1: con el teclado (las flechas cambian la opción y Enter envía una sola vez)
  const uno = await darPaso(page, indice, "correcta", { teclado: true, revisar: true });
  elegidas.push(uno.paso.elegida);
  expect(uno.destino).toBe("pregunta");
  expect(acciones.total(), "Enter envía una sola vez").toBe(2);
  await expect(page.locator(ENUNCIADO), "al llegar la pregunta siguiente el foco queda en su enunciado").toBeFocused();
  // La región viva es el mismo elemento: solo cambió su texto.
  expect(await regionAntes!.evaluate((el) => el.isConnected), "el avance es el mismo elemento antes y después de responder").toBe(true);
  await expect(regionDeAvance(page)).toHaveText(/^Pregunta 2 de hasta \d+$/);
  await expect(page.locator('input[name="opcion"]:checked'), "la opción de la pregunta anterior no se conserva").toHaveCount(0);

  // --- Pregunta 2: una trampa y doble clic (una sola petición)
  const dos = await darPaso(page, indice, "trampa", { dobleClic: true, revisar: true });
  elegidas.push(dos.paso.elegida);
  expect(acciones.total(), "un doble clic responde una sola vez").toBe(3);

  // --- El resto, bien
  const pasos: Paso[] = [uno.paso, dos.paso];
  if (dos.destino === "pregunta") pasos.push(...(await recorrerHastaElResultado(page, indice, () => "correcta", { revisar: true })));
  elegidas.push(...pasos.slice(2).map((p) => p.elegida));
  expect(pasos.length, "el diagnóstico tiene al menos tres preguntas").toBeGreaterThanOrEqual(3);

  // --- El resultado
  await expect(titulo(page, TITULO_DEL_RESULTADO)).toBeVisible(LARGA);
  const idDelPrimero = URL_RESULTADO.exec(page.url())![1];
  const aciertos = pasos.filter((p) => p.correcta).length;
  await expect(page.getByText(`${banco.nombreA} · Parcial 1`, { exact: true }).first()).toBeVisible();
  await expectCifras(page, pasos.length, aciertos);
  await expectResultadoGuardado(page, banco, idDelPrimero);
  await expectReglasDelProducto(page, "el resultado");
  expect(await enCursoDe(banco, sesion.id), "al terminar ya no hay diagnóstico en curso").toBeNull();
  const terminados = await diagnosticosDe(banco, sesion.id);
  expect(terminados).toHaveLength(1);
  expect(terminados[0]).toMatchObject({ id: idDelPrimero, respondidas: pasos.length, aciertos, repetido: false, id_evaluacion: banco.idParcial1 });

  // Tiene dirección propia y sigue ahí al recargar.
  const recargada = await page.reload();
  exigirSinCachePublico(recargada, "el resultado, con sesión");
  // La página del resultado se lee ahora, antes de seguir navegando: es lo que el control positivo del final exige haber visto.
  const paginaDelResultado = (await recargada?.text()) ?? "";
  await expect(titulo(page, TITULO_DEL_RESULTADO)).toBeVisible(ESPERA);
  await expectCifras(page, pasos.length, aciertos);

  // Después del resultado: la lista de monitores de la materia (siempre) y otro diagnóstico.
  const aMonitores = page.getByRole("link", { name: `Ver monitores de ${banco.nombreA}`, exact: true });
  await expect(aMonitores).toHaveAttribute("href", `/monitores?materia=${banco.codigoA}`);
  await expect(page.getByRole("link", { name: "Tomar otro diagnóstico", exact: true })).toHaveAttribute("href", "/diagnostico");
  await aMonitores.click();
  await expect(page).toHaveURL(`/monitores?materia=${banco.codigoA}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible(ESPERA);
  await page.goBack();
  await expect(titulo(page, TITULO_DEL_RESULTADO)).toBeVisible(ESPERA);

  // --- Varios diagnósticos (RN-14, D-49 a): las preguntas de uno nuevo no repiten las de antes, hasta que no queden (D-51)
  const vistas = new Set(pasos.map((p) => p.clave));
  const diagnosticos = [{ id: idDelPrimero, pasos }];
  let agotadas = false;
  for (let vuelta = 0; vuelta < 6 && !agotadas; vuelta++) {
    await page.getByRole("link", { name: "Tomar otro diagnóstico", exact: true }).click();
    await expect(page).toHaveURL("/diagnostico");
    await expect(titulo(page, TITULO_DEL_SELECTOR)).toBeVisible(ESPERA);
    await elegirMateria(page, banco.nombreA);
    await botonEmpezar(page).click();
    if ((await esperarPreguntaOMensaje(page)) === "sin_preguntas") {
      agotadas = true;
      break;
    }
    const nuevos = await recorrerHastaElResultado(page, indice, () => "correcta", { revisar: true });
    for (const paso of nuevos) expect(vistas.has(paso.clave), `la pregunta ${paso.clave} ya se había visto en un diagnóstico anterior`).toBe(false);
    nuevos.forEach((paso) => vistas.add(paso.clave));
    elegidas.push(...nuevos.map((p) => p.elegida));
    diagnosticos.push({ id: URL_RESULTADO.exec(page.url())![1], pasos: nuevos });
    await expectResultadoGuardado(page, banco, diagnosticos.at(-1)!.id);
  }
  expect(agotadas, "tras unos diagnósticos no quedan preguntas nuevas").toBe(true);
  // Para llegar al mensaje de D-51 se vieron las cinco preguntas: todas se midieron, también la de la fórmula más ancha.
  expect([...new Set(preguntasMedidas)].sort(), "se midieron las reglas del producto en las cinco preguntas").toEqual(["P1", "P2", "P3", "P4", "P5"]);
  expect(diagnosticos.length, "al menos dos diagnósticos de la misma Evaluación").toBeGreaterThanOrEqual(2);
  const guardados = await diagnosticosDe(banco, sesion.id);
  expect(guardados.map((fila) => fila.id), "todos quedan guardados").toEqual(diagnosticos.map((d) => d.id));

  // --- D-51: el mensaje, la pregunta y el último resultado, en ese orden, sin crear nada
  await expect(titulo(page, TITULO_SIN_PREGUNTAS)).toBeVisible(ESPERA);
  const mensaje = "Ya respondiste todas las preguntas de esta evaluación. Si la vuelves a tomar, algunas se repetirán.";
  const texto = (await principal.innerText()).replace(/\s+/g, " ");
  const orden = [mensaje, "¿Quieres volver a tomar el diagnóstico?", "Sí, volver a tomarlo", "Tu último resultado", "Fecha:"].map((parte) => texto.indexOf(parte));
  expect(orden.every((posicion) => posicion >= 0), `salen los cinco bloques: ${orden.join(", ")}`).toBe(true);
  expect(orden, "en este orden: mensaje, pregunta, botones y último resultado con su fecha").toEqual([...orden].sort((a, b) => a - b));
  await expect(page.getByRole("button", { name: "Sí, volver a tomarlo", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "No", exact: true })).toBeVisible();
  const ultimo = diagnosticos.at(-1)!;
  await expect(principal).toContainText(`${banco.nombreA} · Parcial 1`);
  await expect(principal).toContainText(`Fecha: ${formatearDia(diaDelNegocio(new Date()))}`);
  await expectCifras(page, ultimo.pasos.length, ultimo.pasos.filter((p) => p.correcta).length);
  await expect(principal.getByRole("link", { name: /Ver monitores de|Tomar otro diagnóstico/ }), "el resultado de consulta no lleva las salidas del resultado").toHaveCount(0);
  await expectReglasDelProducto(page, "el mensaje de D-51");
  expect(await diagnosticosDe(banco, sesion.id), "no se creó nada").toHaveLength(diagnosticos.length);
  expect(await enCursoDe(banco, sesion.id)).toBeNull();

  // «No» vuelve al selector sin crear nada, con el foco en el título.
  await page.getByRole("button", { name: "No", exact: true }).click();
  await expect(titulo(page, TITULO_DEL_SELECTOR)).toBeFocused();
  expect(await enCursoDe(banco, sesion.id)).toBeNull();
  expect(await diagnosticosDe(banco, sesion.id)).toHaveLength(diagnosticos.length);

  // «Sí, volver a tomarlo» crea uno en curso, marcado como repetido.
  await elegirMateria(page, banco.nombreA);
  await botonEmpezar(page).click();
  await expect(titulo(page, TITULO_SIN_PREGUNTAS)).toBeVisible(ESPERA);
  await page.getByRole("button", { name: "Sí, volver a tomarlo", exact: true }).click();
  await expect(titulo(page, TITULO_DE_LA_PREGUNTA)).toBeVisible(LARGA);
  expect(await enCursoDe(banco, sesion.id)).toMatchObject({ paso: 0, repetido: true });
  const repetidos = await recorrerHastaElResultado(page, indice, () => "correcta");
  elegidas.push(...repetidos.map((p) => p.elegida));
  const idDelRepetido = URL_RESULTADO.exec(page.url())![1];
  const finales = await diagnosticosDe(banco, sesion.id);
  expect(finales).toHaveLength(diagnosticos.length + 1);
  expect(finales.at(-1)).toMatchObject({ id: idDelRepetido, repetido: true });
  // D-53 b: el repetido lo ve solo el monitor; la persona no ve nada.
  await expectCifras(page, repetidos.length, repetidos.length);
  await expectResultadoGuardado(page, banco, idDelRepetido);
  await expect(principal).not.toContainText(/repetid|otra vez|volviste a tomar/i);

  // --- Qué recibió el navegador (criterio 13): nada de la clave de una pregunta, la dificultad, la correcta, la misconcepción de
  // una opción, su texto de error, la solución ni la semilla; y nunca el token de recuperación, las copias de las preguntas ni la
  // marca de falta de material. Los textos de error que sí pueden verse son los de las opciones que la persona eligió.
  // Controles positivos: sin ellos, un vigilante que no leyó nada daría por buena la ausencia de todo. `"enunciado"` viaja en las
  // respuestas de las acciones; `"habilidades"` solo en el último resultado del mensaje de D-51 (la página del resultado es de
  // servidor y no lleva el objeto, solo su dibujo), así que ese cuerpo concreto tiene que haber llegado a la prueba.
  await esperarQueLleguen(todoLoRecibido, '"enunciado"', "el vigilante vio las respuestas de las acciones");
  await esperarQueLleguen(todoLoRecibido, '"habilidades"', "y el último resultado que trae la respuesta de D-51");
  expect(paginaDelResultado, "y el flujo de la página del resultado, leída al recargar").toMatch(/self\.__next_f\.push/);
  expect(paginaDelResultado, "con el título de esa página").toContain("<title>Tu resultado · Calibra</title>");
  const recibido = [desescaparComillas(paginaDelResultado), await todoLoRecibido()].join("\n");
  const textosElegidos = new Set(elegidas.flatMap((o) => (o.error ? [o.error] : [])));
  exigirQueNoLlego(recibido, [
    ...CLAVES_PROHIBIDAS,
    ...valoresProhibidos(indice, textosElegidos),
    ...finales.map((fila) => fila.token_recuperacion),
  ]);
});

test("Recorrido · si falla la red o el servidor al responder, el mensaje conserva la opción y la respuesta se aplica una sola vez", async ({
  page,
  context,
  banco,
  limpieza,
}) => {
  const indice = new Indice(banco.banco);
  await empezarPrueba(page, banco.nombreA);
  const sesion = await esperarSesion(context);
  limpieza.anotar(sesion.id);
  await expect(page.locator(ENUNCIADO)).toBeFocused();

  // Primero se corta la red, después el servidor responde con un error, y a la tercera pasa.
  let intentos = 0;
  await page.route("**/diagnostico", async (ruta) => {
    const peticion = ruta.request();
    if (peticion.method() !== "POST" || peticion.headers()["next-action"] === undefined) return ruta.fallback();
    intentos++;
    if (intentos === 1) return ruta.abort("failed");
    if (intentos === 2) return ruta.fulfill({ status: 500, contentType: "text/plain", body: "falla de prueba" });
    return ruta.fallback();
  });

  const vista = await leerPregunta(page);
  const reconocida = indice.reconocer(vista);
  const letra = reconocida.letraDeLaCorrecta;
  await page.locator(`input[name="opcion"][value="${letra}"]`).check();

  await botonResponder(page).click();
  await expect(alerta(page, ERROR_AL_RESPONDER)).toBeVisible(ESPERA);
  await expect(page.locator(`input[name="opcion"][value="${letra}"]`), "la opción elegida se conserva").toBeChecked();
  await expect(botonResponder(page), "se puede volver a pulsar").toBeEnabled();
  expect(await enCursoDe(banco, sesion.id), "la respuesta no se aplicó").toMatchObject({ paso: 0, npasos: 0 });

  await botonResponder(page).click();
  await expect(alerta(page, ERROR_AL_RESPONDER)).toBeVisible(ESPERA);
  await expect(page.locator(`input[name="opcion"][value="${letra}"]`)).toBeChecked();
  expect(intentos).toBe(2);
  expect(await enCursoDe(banco, sesion.id)).toMatchObject({ paso: 0, npasos: 0 });

  await botonResponder(page).click();
  await expect(regionDeAvance(page)).toHaveText(/^Pregunta 2 de hasta \d+$/, ESPERA);
  await expect(alerta(page, ERROR_AL_RESPONDER), "el mensaje se va con la pregunta siguiente").toHaveCount(0);
  expect(intentos).toBe(3);
  expect(await enCursoDe(banco, sesion.id), "la respuesta se aplicó una sola vez").toMatchObject({ paso: 1, npasos: 1 });
});

test("Fallos con el teclado · «Empezar» y «Responder» siguen enfocados tras un fallo, se reintenta con Enter y un segundo fallo igual se anuncia otra vez", async ({
  page,
  context,
  banco,
  limpieza,
}) => {
  const indice = new Indice(banco.banco);
  await abrirSelector(page);
  const sesion = await esperarSesion(context);
  limpieza.anotar(sesion.id);

  // Mientras `fallando`, cada llamada a una acción falla: la primera con la red cortada, la segunda con un error del servidor, y
  // así sucesivamente. Al apagarlo pasan.
  let fallando = true;
  let llamadas = 0;
  await page.route("**/diagnostico", async (ruta) => {
    const peticion = ruta.request();
    if (peticion.method() !== "POST" || peticion.headers()["next-action"] === undefined) return ruta.fallback();
    if (!fallando) return ruta.fallback();
    llamadas++;
    if (llamadas % 2 === 1) return ruta.abort("failed");
    return ruta.fulfill({ status: 500, contentType: "text/plain", body: "falla de prueba" });
  });

  /**
   * Pulsa Enter sobre el botón enfocado y espera el mensaje de error. Comprueba lo que un fallo no puede estropear: el botón sigue
   * enfocado (con `disabled` caía al body y había que recorrer la página desde el principio) y, si ya había un mensaje igual, se
   * inserta uno nuevo en la página, que es lo que un lector de pantalla vuelve a anunciar.
   */
  async function reintentarConEnter(boton: Locator, mensaje: string, anterior: ElementHandle | null): Promise<ElementHandle> {
    await expect(boton, "antes de pulsar Enter el botón está enfocado").toBeFocused();
    await expect(boton, "y activo (no a mitad de una llamada)").toBeEnabled();
    await page.keyboard.press("Enter");
    const nuevo = alerta(page, mensaje);
    await expect(nuevo).toBeVisible(ESPERA);
    await expect(boton, "tras el fallo el botón sigue enfocado").toBeFocused();
    if (anterior) {
      expect(await anterior.evaluate((el) => el.isConnected), "el mensaje anterior se quitó de la página: el nuevo es otro elemento").toBe(false);
    }
    return (await nuevo.elementHandle())!;
  }

  // --- «Empezar»: de la materia al botón con Tab, y Enter
  await elegirMateria(page, banco.nombreA);
  await page.keyboard.press("Tab");
  await expect(botonEmpezar(page), "Tab desde la materia llega a «Empezar»").toBeFocused();
  const primeroAlEmpezar = await reintentarConEnter(botonEmpezar(page), ERROR_AL_EMPEZAR, null);
  const segundoAlEmpezar = await reintentarConEnter(botonEmpezar(page), ERROR_AL_EMPEZAR, primeroAlEmpezar);
  expect(llamadas).toBe(2);
  expect(await enCursoDe(banco, sesion.id), "no se creó nada").toBeNull();
  expect(await segundoAlEmpezar.evaluate((el) => el.isConnected)).toBe(true);

  fallando = false;
  await expect(botonEmpezar(page)).toBeEnabled();
  await page.keyboard.press("Enter");
  await expect(titulo(page, TITULO_DE_LA_PREGUNTA)).toBeVisible(LARGA);
  await expect(page.locator(ENUNCIADO), "al llegar la pregunta el foco queda en su enunciado").toBeFocused();
  expect(await enCursoDe(banco, sesion.id)).toMatchObject({ paso: 0, npasos: 0 });

  // --- «Responder»: la opción con las flechas, Tab hasta el botón y Enter
  const vista = await leerPregunta(page);
  const letra = indice.reconocer(vista).letraDeLaCorrecta;
  await elegirConTeclado(page, letra);
  await page.keyboard.press("Tab");
  await expect(botonResponder(page), "Tab desde las opciones llega a «Responder»").toBeFocused();

  fallando = true;
  llamadas = 0;
  const primeroAlResponder = await reintentarConEnter(botonResponder(page), ERROR_AL_RESPONDER, null);
  await reintentarConEnter(botonResponder(page), ERROR_AL_RESPONDER, primeroAlResponder);
  expect(llamadas).toBe(2);
  await expect(page.locator(`input[name="opcion"][value="${letra}"]`), "la opción elegida se conserva").toBeChecked();
  expect(await enCursoDe(banco, sesion.id), "la respuesta no se aplicó").toMatchObject({ paso: 0, npasos: 0 });

  fallando = false;
  await expect(botonResponder(page)).toBeEnabled();
  await page.keyboard.press("Enter");
  await expect(regionDeAvance(page)).toHaveText(/^Pregunta 2 de hasta \d+$/, ESPERA);
  await expect(alerta(page, ERROR_AL_RESPONDER), "el mensaje se va con la pregunta siguiente").toHaveCount(0);
  expect(await enCursoDe(banco, sesion.id), "la respuesta se aplicó una sola vez").toMatchObject({ paso: 1, npasos: 1 });
});

test("Otra pestaña y diagnóstico vencido · un paso viejo muestra la pregunta actual sin error y uno vencido manda al selector sin aplicar la letra", async ({
  page,
  context,
  banco,
  limpieza,
}) => {
  const indice = new Indice(banco.banco);
  await empezarPrueba(page, banco.nombreA);
  const sesion = await esperarSesion(context);
  limpieza.anotar(sesion.id);
  const primero = (await enCursoDe(banco, sesion.id))!;
  const vistaUno = await leerPregunta(page);

  // La segunda pestaña ve la misma pregunta pendiente.
  const otra = await context.newPage();
  await otra.goto("/diagnostico");
  await expect(titulo(otra, TITULO_DE_LA_PREGUNTA)).toBeVisible(ESPERA);
  await otra.waitForLoadState("networkidle");
  expect(await leerPregunta(otra)).toEqual(vistaUno);

  // La primera responde; la segunda, que sigue en la pregunta 1, responde con un paso viejo.
  await darPaso(page, indice, "correcta");
  const vistaDos = await leerPregunta(page);
  expect(vistaDos.avance).toMatch(/^Pregunta 2 de hasta/);
  const trampa = indice.reconocer(vistaUno).letraDeUnaTrampa;
  await otra.locator(`input[name="opcion"][value="${trampa}"]`).check();
  await botonResponder(otra).click();
  await expect(regionDeAvance(otra)).toHaveText(vistaDos.avance, ESPERA);
  expect(await leerPregunta(otra), "ve la pregunta que el servidor da como actual").toEqual(vistaDos);
  await expect(otra.locator("main").getByRole("alert"), "y ningún error").toHaveCount(0);
  expect(await enCursoDe(banco, sesion.id), "la letra vieja no se aplicó").toMatchObject({ id: primero.id, paso: 1, npasos: 1 });

  // Pasan más de dos horas sin responder: la pestaña que sigue en la pregunta 2 responde y el diagnóstico ya no está.
  await envejecer(banco, sesion.id);
  await page.locator('input[name="opcion"]').first().check();
  await botonResponder(page).click();
  await expect(alerta(page, DIAGNOSTICO_VENCIDO)).toBeVisible(ESPERA);
  await expect(titulo(page, TITULO_DEL_SELECTOR)).toBeVisible();
  await expect(titulo(page, TITULO_DEL_SELECTOR), "al volver al selector el foco queda en el título").toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Llevas un diagnóstico" }), "no hay otro en curso que avisar").toHaveCount(0);
  expect(await enCursoDe(banco, sesion.id), "la letra no se aplicó a ninguna pregunta").toMatchObject({ id: primero.id, paso: 1, npasos: 1 });

  // Se puede empezar uno nuevo, que parte de cero.
  await elegirMateria(page, banco.nombreA);
  await botonEmpezar(page).click();
  await expect(regionDeAvance(page)).toHaveText(/^Pregunta 1 de hasta \d+$/, LARGA);
  const nuevo = await enCursoDe(banco, sesion.id);
  expect(nuevo).toMatchObject({ paso: 0, npasos: 0 });
  expect(nuevo!.id).not.toBe(primero.id);
});

// ===============================================================================================================
// 4. Recargar y cambiar de materia
// ===============================================================================================================

test("Recargar y cambiar de materia · la pregunta pendiente sigue ahí, el aviso es el exacto y el diagnóstico solo se descarta al pulsar «Empezar»", async ({
  page,
  context,
  banco,
  limpieza,
}) => {
  test.setTimeout(240_000);
  const indice = new Indice(banco.banco);
  const radioDe = (p: Page, nombre: RegExp) => p.getByRole("radiogroup", { name: "Evaluación", exact: true }).getByRole("radio", { name: nombre });

  await conEvaluacionActiva(banco, banco.idParcial2, async () => {
    // --- Un diagnóstico de Parcial 1 con una respuesta dada
    await abrirSelector(page);
    const sesion = await esperarSesion(context);
    limpieza.anotar(sesion.id);
    await elegirMateria(page, banco.nombreA);
    await radioDe(page, /^Parcial 1/).check();
    await botonEmpezar(page).click();
    await expect(titulo(page, TITULO_DE_LA_PREGUNTA)).toBeVisible(LARGA);
    const { paso: respondida } = await darPaso(page, indice, "correcta");
    const vista = await leerPregunta(page);
    expect(vista.avance).toMatch(/^Pregunta 2 de hasta/);
    const d1 = (await enCursoDe(banco, sesion.id))!;
    expect(d1).toMatchObject({ paso: 1, id_evaluacion: banco.idParcial1 });
    // Lo que la página trae con una pregunta pendiente (`inicial.enCurso` viaja en el flujo de la página) también se vigila.
    const textosElegidos = new Set(respondida.elegida.error ? [respondida.elegida.error] : []);
    const prohibidosAlCargar = [...CLAVES_PROHIBIDAS, ...valoresProhibidos(indice, textosElegidos)];

    // --- Recargar: la misma pregunta con las opciones en el mismo orden, sin el selector y sin robar el foco
    const recibidoAlRecargar = await vigilarRespuestas(page);
    await page.reload();
    await expect(titulo(page, TITULO_DE_LA_PREGUNTA)).toBeVisible(ESPERA);
    await page.waitForLoadState("networkidle");
    expect(await leerPregunta(page)).toEqual(vista);
    await expect(titulo(page, TITULO_DEL_SELECTOR)).toHaveCount(0);
    await expect(page.locator(ENUNCIADO), "al recargar no se roba el foco").not.toBeFocused();
    const alRecargar = await recibidoAlRecargar();
    expect(alRecargar, "el vigilante ve la pregunta pendiente en la página recargada").toContain('"enunciado"');
    exigirQueNoLlego(alRecargar, prohibidosAlCargar);

    // --- Otra pestaña del mismo navegador (como cerrar la pestaña y volver): lo mismo
    const otra = await context.newPage();
    const recibidoEnLaOtra = await vigilarRespuestas(otra);
    await otra.goto("/diagnostico");
    await expect(titulo(otra, TITULO_DE_LA_PREGUNTA)).toBeVisible(ESPERA);
    await otra.waitForLoadState("networkidle");
    expect(await leerPregunta(otra)).toEqual(vista);
    const enLaOtra = await recibidoEnLaOtra();
    expect(enLaOtra, "el vigilante ve la pregunta pendiente en la otra pestaña").toContain('"enunciado"');
    exigirQueNoLlego(enLaOtra, prohibidosAlCargar);

    // --- Cambiar de materia: el selector con el aviso exacto y el foco en el título; el diagnóstico no se toca
    await otra.getByRole("button", { name: "Cambiar de materia", exact: true }).click();
    await expect(titulo(otra, TITULO_DEL_SELECTOR)).toBeFocused();
    const aviso = (parte: string) => otra.getByRole("status").filter({ hasText: "Llevas un diagnóstico" }).filter({ hasText: parte });
    const textoDelAviso = (evaluacion: string) =>
      `Llevas un diagnóstico de ${banco.nombreA} · ${evaluacion}. Si empiezas otro de otra Evaluación, se descarta este.`;
    await expect(aviso("Parcial 1")).toHaveText(textoDelAviso("Parcial 1"));
    expect((await enCursoDe(banco, sesion.id))!.id).toBe(d1.id);

    // La misma Evaluación: vuelve a su pregunta pendiente.
    await elegirMateria(otra, banco.nombreA);
    await radioDe(otra, /^Parcial 1/).check();
    await botonEmpezar(otra).click();
    await expect(titulo(otra, TITULO_DE_LA_PREGUNTA)).toBeVisible(LARGA);
    expect(await leerPregunta(otra)).toEqual(vista);
    expect(await enCursoDe(banco, sesion.id)).toMatchObject({ id: d1.id, paso: 1 });

    // Otra Evaluación: hasta pulsar «Empezar» no se toca nada.
    await otra.getByRole("button", { name: "Cambiar de materia", exact: true }).click();
    await elegirMateria(otra, banco.nombreA);
    await radioDe(otra, /^Parcial 2/).check();
    expect(await enCursoDe(banco, sesion.id), "elegir otra Evaluación no descarta el diagnóstico").toMatchObject({ id: d1.id, paso: 1 });
    await botonEmpezar(otra).click();
    await expect(otra.getByText(`${banco.nombreA} · Parcial 2`, { exact: true })).toBeVisible(LARGA);
    const d2 = (await enCursoDe(banco, sesion.id))!;
    expect(d2.id).not.toBe(d1.id);
    expect(d2).toMatchObject({ paso: 0, npasos: 0, id_evaluacion: banco.idParcial2 });

    // --- Reemplazado: la primera pestaña sigue en la pregunta del diagnóstico que ya no es el actual
    await page.locator('input[name="opcion"]').first().check();
    await botonResponder(page).click();
    await expect(alerta(page, DIAGNOSTICO_VENCIDO)).toBeVisible(ESPERA);
    await expect(titulo(page, TITULO_DEL_SELECTOR)).toBeFocused();
    await expect(page.getByRole("status").filter({ hasText: "Llevas un diagnóstico" })).toHaveText(textoDelAviso("Parcial 2"));
    expect(await enCursoDe(banco, sesion.id), "la letra no se aplicó al diagnóstico nuevo").toMatchObject({ id: d2.id, paso: 0, npasos: 0 });
  });
});

test("Cambiar de materia · si la Evaluación en que va ya no se ofrece, «Volver a mi pregunta» devuelve a la pregunta pendiente sin llamar a nada", async ({
  page,
  context,
  banco,
  limpieza,
}) => {
  test.setTimeout(240_000);
  const indice = new Indice(banco.banco);
  const acciones = contarAcciones(page);
  let idDeLaSesion = "";

  // --- Un diagnóstico de Parcial 2, que se apaga después: la pendiente gana aunque su Evaluación ya no esté activa (HU-081)
  await conEvaluacionActiva(banco, banco.idParcial2, async () => {
    await abrirSelector(page);
    const sesion = await esperarSesion(context);
    limpieza.anotar(sesion.id);
    idDeLaSesion = sesion.id;
    await elegirMateria(page, banco.nombreA);
    await page.getByRole("radiogroup", { name: "Evaluación", exact: true }).getByRole("radio", { name: /^Parcial 2/ }).check();
    await botonEmpezar(page).click();
    await expect(titulo(page, TITULO_DE_LA_PREGUNTA)).toBeVisible(LARGA);
  });
  const enMarcha = (await enCursoDe(banco, idDeLaSesion))!;
  expect(enMarcha).toMatchObject({ paso: 0, id_evaluacion: banco.idParcial2 });

  await page.reload();
  await expect(titulo(page, TITULO_DE_LA_PREGUNTA)).toBeVisible(ESPERA);
  await page.waitForLoadState("networkidle");
  const vista = await leerPregunta(page);
  expect(vista.avance).toMatch(/^Pregunta 1 de hasta/);
  const llamadasAntes = acciones.total();

  // --- «Cambiar de materia»: el aviso, y Parcial 2 ya no se ofrece (la materia A solo tiene Parcial 1)
  await page.getByRole("button", { name: "Cambiar de materia", exact: true }).click();
  await expect(titulo(page, TITULO_DEL_SELECTOR)).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Llevas un diagnóstico" })).toHaveText(
    `Llevas un diagnóstico de ${banco.nombreA} · Parcial 2. Si empiezas otro de otra Evaluación, se descarta este.`,
  );
  await elegirMateria(page, banco.nombreA);
  const evaluacion = page.getByRole("radiogroup", { name: "Evaluación", exact: true });
  await expect(evaluacion).toContainText("Parcial 1");
  await expect(evaluacion, "la Evaluación en que va ya no se ofrece").not.toContainText("Parcial 2");

  // --- La salida: sin elegir nada ni llamar a nada, vuelve a la pregunta que sigue en curso, con el foco en su enunciado
  const volver = page.getByRole("button", { name: "Volver a mi pregunta", exact: true });
  await expect(volver).toBeVisible();
  await expectReglas(page, "el selector con «Volver a mi pregunta»");
  await volver.click();
  await expect(titulo(page, TITULO_DE_LA_PREGUNTA)).toBeVisible();
  await expect(page.locator(ENUNCIADO), "al volver a la pregunta el foco queda en su enunciado").toBeFocused();
  expect(await leerPregunta(page), "la misma pregunta, con las opciones en el mismo orden").toEqual(vista);
  await expect(page.getByRole("status").filter({ hasText: "Llevas un diagnóstico" })).toHaveCount(0);
  expect(acciones.total(), "volver no llama a ninguna acción").toBe(llamadasAntes);
  expect(await enCursoDe(banco, idDeLaSesion), "el diagnóstico no se tocó").toMatchObject({ id: enMarcha.id, paso: 0 });

  // --- Y desde ahí se sigue respondiendo
  const { destino } = await darPaso(page, indice, "correcta");
  expect(destino, "Parcial 2 tiene más de una pregunta").toBe("pregunta");
  expect(await enCursoDe(banco, idDeLaSesion)).toMatchObject({ id: enMarcha.id, paso: 1, npasos: 1 });
});

// ===============================================================================================================
// 5. Una pregunta con código
// ===============================================================================================================

test("Pregunta con código · el enunciado va en un div con su bloque enfocable, y un diagnóstico de una sola pregunta dice «1 pregunta»", async ({
  page,
  context,
  banco,
  limpieza,
}) => {
  const indice = new Indice(banco.banco);
  await conEvaluacionActiva(banco, banco.idExamenFinal, async () => {
    await empezarPrueba(page, banco.nombreB);
    const sesion = await esperarSesion(context);
    limpieza.anotar(sesion.id);

    const enunciado = page.locator(ENUNCIADO);
    expect(await enunciado.evaluate((el) => el.tagName), "el enunciado va en un div").toBe("DIV");
    expect(
      await enunciado.evaluate((el) => el.closest("h1, h2, h3, h4, h5, h6, p, label") !== null),
      "y no dentro de un título, un párrafo ni una etiqueta (no caben bloques de código)",
    ).toBe(false);
    const bloque = enunciado.getByRole("region", { name: "Código", exact: true });
    await expect(bloque).toHaveCount(1);
    await expect(bloque).toHaveAttribute("tabindex", "0");
    await bloque.focus();
    await expect(bloque, "el bloque de código se alcanza con el teclado").toBeFocused();
    await expectReglas(page, "la pregunta con código");

    // Una sola pregunta: el primer y único paso. Mal, para que el resultado traiga errores y prerrequisitos.
    const { paso, destino } = await darPaso(page, indice, "trampa");
    expect(destino).toBe("resultado");
    await expect(titulo(page, TITULO_DEL_RESULTADO)).toBeVisible(LARGA);
    await expectCifras(page, 1, paso.correcta ? 1 : 0);
    await expectResultadoGuardado(page, banco, URL_RESULTADO.exec(page.url())![1]);
    await expectReglasDelProducto(page, "el resultado de una pregunta");
  });
});

// ===============================================================================================================
// 6. Un resultado sembrado
// ===============================================================================================================

test("Resultado · un diagnóstico con los cuatro niveles, errores y prerrequisitos se ve con las cifras y el orden de D-53, sin nada de repetido", async ({
  page,
  context,
  banco,
  limpieza,
}) => {
  await abrirSelector(page);
  const sesion = await esperarSesion(context);
  limpieza.anotar(sesion.id);

  // 5 de 8, con repetido = true; la fecha es del 4 de octubre en Bogotá y del 5 en UTC.
  const sembrado = await sembrarDiagnostico(banco.bd, {
    idSesionAnonima: sesion.id,
    idEvaluacion: banco.idParcial1,
    fecha: "2026-10-05T03:30:00+00:00",
    repetido: true,
  });
  const respuesta = await page.goto(`/diagnostico/resultado/${sembrado.id}`);
  expect(respuesta?.status()).toBe(200);
  exigirSinCachePublico(respuesta, "el resultado sembrado");
  await expect(titulo(page, TITULO_DEL_RESULTADO)).toBeVisible(ESPERA);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  const principal = page.locator("main");

  // Encabezado
  await expect(page.getByText(banco.nombreA, { exact: true })).toBeVisible();
  await expect(principal).toContainText(`${banco.nombreA} · Parcial 1`);
  await expect(principal).toContainText(`Fecha: ${formatearDia("2026-10-04")}`);
  expect(formatearDia("2026-10-04")).not.toBe(formatearDia("2026-10-05"));
  await expect(principal.locator("time")).toHaveAttribute("datetime", "2026-10-05T03:30:00.000Z");
  await expectCifras(page, 8, 5);
  await expect(principal).toContainText("Puntaje global: 63 %");

  // Habilidades, en el orden guardado
  const habilidades = page.getByRole("region", { name: "Habilidades", exact: true }).getByRole("listitem");
  await expect(habilidades).toHaveCount(5);
  const esperadas = [
    ["calcula la fuerza neta con", "Lo dominas", "Acertaste 3 de 3"],
    ["aplica la conservación de la energía", "En proceso", "Acertaste 1 de 2"],
    ["interpreta gráficas de posición", "No lo dominas", "Acertaste 0 de 2"],
    ["resuelve problemas con rozamiento", "Sin medir", "No medimos esta habilidad en esta prueba."],
    ["lee un diagrama de fuerzas", "No lo dominas", null],
  ] as const;
  for (const [i, [descripcion, nivel, cifra]] of esperadas.entries()) {
    await expect(habilidades.nth(i)).toContainText(descripcion);
    await expect(habilidades.nth(i)).toContainText(nivel);
    if (cifra) await expect(habilidades.nth(i)).toContainText(cifra);
  }
  await expect(habilidades.nth(0).locator("math"), "la fórmula de una descripción sale como math").toHaveCount(1);
  await expect(habilidades.nth(2).locator("math"), "la fórmula de otra descripción también").toHaveCount(1);
  await expect(habilidades.nth(3), "sin medir: no hay cifras ni motivo").not.toContainText("Acertaste");
  await expect(habilidades.nth(4), "sin respuestas contadas: no hay cifras ni aviso").not.toContainText(/Acertaste|No medimos/);

  // Errores: el confirmado primero, la habilidad solo si es del resultado y cada detalle en su renglón
  const errores = page.getByRole("region", { name: "Errores", exact: true }).getByRole("listitem");
  await expect(errores).toHaveCount(3);
  await expect(errores.nth(0)).toContainText("Error detectado:");
  await expect(errores.nth(0)).toContainText(plano(GUARDADO_DE_EJEMPLO.errores[1].texto));
  await expect(errores.nth(0).locator("p").first().locator("math"), "la fórmula del título del error sale como math").toHaveCount(1);
  await expect(errores.nth(0)).toContainText("Habilidad: interpreta gráficas de posición");
  await expect(errores.nth(0)).toContainText("Revisa qué magnitud va arriba en");
  // Cada texto del banco que dibuja el resultado pasa por TextoDelBanco: una fórmula en la habilidad que nombra el error, en un
  // detalle y en un prerrequisito sale como math, no como `$…$` (el banco real ya trae el caso en un texto de error).
  await expect(errores.nth(0).locator("p", { hasText: "Habilidad:" }).locator("math"), "la habilidad del error").toHaveCount(1);
  await expect(errores.nth(0).locator("p", { hasText: "Revisa qué magnitud" }).locator("math"), "el detalle").toHaveCount(1);
  await expect(errores.nth(0).locator("math"), "título, habilidad y detalle").toHaveCount(3);
  await expect(errores.nth(1)).toContainText("Posible error: confundes energía con potencia");
  await expect(errores.nth(1)).toContainText("Habilidad: aplica la conservación de la energía");
  await expect(errores.nth(2)).toContainText("Posible error: ignoras la fricción");
  await expect(errores.nth(2), "la habilidad de fuera del resultado no se nombra").not.toContainText("Habilidad:");
  await expect(errores.nth(2)).toContainText("La fricción también hace trabajo.");
  await expect(errores.nth(2)).toContainText("Piensa en el sentido del movimiento.");

  // Conviene repasar antes: una lista, con la materia solo si es otra
  const repasar = page.getByRole("region", { name: "Conviene repasar antes", exact: true }).getByRole("listitem");
  await expect(repasar).toHaveCount(2);
  await expect(repasar.nth(0)).toContainText("despeja una incógnita");
  await expect(repasar.nth(0).locator("math"), "la fórmula de un prerrequisito sale como math").toHaveCount(1);
  await expect(repasar.nth(0)).not.toContainText("(");
  await expect(repasar.nth(1)).toContainText("deriva polinomios (Cálculo Diferencial)");

  // Después del resultado
  await expect(page.getByRole("link", { name: `Ver monitores de ${banco.nombreA}`, exact: true })).toHaveAttribute("href", `/monitores?materia=${banco.codigoA}`);
  await expect(page.getByRole("link", { name: "Tomar otro diagnóstico", exact: true })).toHaveAttribute("href", "/diagnostico");

  // Nada de repetido, en pantalla ni en lo que se recibió (D-53 b); ninguna clave interna ni el token (criterio 13)
  await expect(principal).not.toContainText(/repetid|otra vez/i);
  await expect(principal, "ninguna fórmula quedó sin dibujar").not.toContainText("$");
  // Las claves van entre comillas y en el HTML de una página Next las escapa: se desescapan, o el centinela nunca podría dispararse.
  const recibido = desescaparComillas(await respuesta!.text());
  expect(recibido, "el vigilante ve el flujo de la página (y por eso puede ver una clave)").toMatch(/self\.__next_f\.push/);
  exigirQueNoLlego(recibido, [...CLAVES_INTERNAS_DE_EJEMPLO, sembrado.tokenDeRecuperacion, ...CLAVES_PROHIBIDAS]);
  await expectReglasDelProducto(page, "el resultado sembrado");
});

// ===============================================================================================================
// 7. Quién ve el resultado
// ===============================================================================================================

test("Dueño · otra persona, un monitor con una cita que apunta al diagnóstico y un admin abren el resultado y ven 404 sin ningún dato", async ({
  page,
  context,
  browser,
  banco,
  limpieza,
  cuentas,
}) => {
  test.setTimeout(240_000);
  await abrirSelector(page);
  const duena = await esperarSesion(context);
  limpieza.anotar(duena.id);
  const sembrado = await sembrarDiagnostico(banco.bd, { idSesionAnonima: duena.id, idEvaluacion: banco.idParcial1 });
  const ruta = `/diagnostico/resultado/${sembrado.id}`;
  const centinelas = [banco.nombreA, "Puntaje global", "Respondiste 8 preguntas", "calcula la fuerza neta", "confundes energía con potencia", "Conviene repasar antes"];

  /** 404 con el aviso del segmento y ni un dato del resultado, en el HTML ni en la pantalla. */
  async function expectNoEncontrado(pagina: Page, respuesta: Response | null, quien: string): Promise<void> {
    expect(respuesta?.status(), `${quien}: status 404`).toBe(404);
    await expect(titulo(pagina, "No encontramos ese resultado"), quien).toBeVisible(ESPERA);
    await expect(pagina.getByText("Puede que el enlace esté incompleto o que el resultado no se pueda ver desde esta sesión.")).toBeVisible();
    await expect(pagina.getByRole("link", { name: "Hacer el diagnóstico", exact: true })).toHaveAttribute("href", "/diagnostico");
    // El título y el noindex se miran en el HTML que manda el servidor: ya hidratada, la pestaña de un 404 vuelve a decir «Tu
    // resultado · Calibra» y pierde el `robots` (Next vuelve a poner los metadatos de la página; pasa igual en /agendar/reserva/[id]).
    const crudo = await respuesta!.text();
    expect(crudo, `${quien}: el título del segmento`).toContain("<title>No encontramos ese resultado · Calibra</title>");
    expect(crudo, `${quien}: noindex`).toContain('<meta name="robots" content="noindex"/>');
    const pintado = await pagina.content();
    for (const centinela of centinelas) {
      expect(crudo.includes(centinela), `${quien}: el HTML no trae «${centinela}»`).toBe(false);
      expect(pintado.includes(centinela), `${quien}: la pantalla no trae «${centinela}»`).toBe(false);
    }
    expect(pintado).not.toContain(sembrado.tokenDeRecuperacion);
    await expectReglas(pagina, `${quien}: no encontrado`);
  }

  // La dueña, con su sesión: lo ve, con encabezado privado.
  const propia = await page.goto(ruta);
  expect(propia?.status()).toBe(200);
  exigirSinCachePublico(propia, "el resultado de la dueña");
  await expect(titulo(page, TITULO_DEL_RESULTADO)).toBeVisible(ESPERA);
  await expect(page.locator("main")).toContainText(banco.nombreA);

  // Otra persona (otro navegador, sin ningún enlace con la dueña).
  await test.step("otra sesión anónima", async () => {
    const contexto = await nuevoContexto(browser, limpieza);
    try {
      const otra = await contexto.newPage();
      await otra.goto("/diagnostico");
      limpieza.anotar((await esperarSesion(contexto)).id);
      const respuesta = await otra.goto(ruta);
      await expectNoEncontrado(otra, respuesta, "otra sesión anónima");
      exigirSinCachePublico(respuesta, "el 404 de otra sesión");
    } finally {
      await contexto.close();
    }
  });

  // Sin sesión.
  await test.step("sin sesión", async () => {
    const contexto = await nuevoContexto(browser, limpieza);
    try {
      const sola = await contexto.newPage();
      await sinSesionAnonima(sola);
      const respuesta = await sola.goto(ruta);
      await expectNoEncontrado(sola, respuesta, "sin sesión");
      const selector = await sola.goto("/diagnostico");
      exigirSinCachePublico(selector, "/diagnostico, sin sesión");
    } finally {
      await contexto.close();
    }
  });

  // Un admin.
  await test.step("un admin", async () => {
    const admin = await cuentas.crearAdmin();
    const contexto = await nuevoContexto(browser, limpieza);
    try {
      const pagina = await contexto.newPage();
      await pagina.goto("/ingresar");
      await enviarCredenciales(pagina, admin.correo, admin.contrasena);
      await expect(pagina).toHaveURL("/admin", LARGA);
      const respuesta = await pagina.goto(ruta);
      await expectNoEncontrado(pagina, respuesta, "un admin");
    } finally {
      await contexto.close();
    }
  });

  // Un monitor con una cita que apunta al diagnóstico: la política de `diagnostico` le deja leerlo (RN-13), la página no.
  await test.step("un monitor con una cita", async () => {
    const monitor = await cuentas.crearMonitor();
    const certificador = await cuentas.crearAdmin();
    const { rows: leads } = await banco.bd.query<{ id: string }>(
      "insert into public.lead (nombre, correo, acepta_tratamiento_datos, fecha_consentimiento) values ('Lead de HU-009', $1, true, now()) returning id",
      [`e2e-hu009-${sembrado.id}@calibra.test`],
    );
    const idLead = leads[0].id;
    let idMonitoria: string | null = null;
    let idFranja: string | null = null;
    try {
      await banco.bd.query("insert into public.certificado (id_monitor, id_materia, id_admin) values ($1, $2, $3)", [monitor.id, banco.idMateriaA, certificador.id]);
      // Una franja semanal que cae en el día de la cita (dentro de tres semanas) y una cita pendiente de pago que apunta al diagnóstico.
      const { rows: franjas } = await banco.bd.query<{ id: string; fecha: string }>(
        `insert into public.franja (id_monitor, dia, hora, presencial, precio, duracion_min, lugar, abierta_desde)
         values ($1, extract(isodow from current_date + 21)::smallint, time '10:00', true, 20000, 60, 'Salón 900', current_date - 60)
         returning id, (current_date + 21)::text as fecha`,
        [monitor.id],
      );
      idFranja = franjas[0].id;
      const { rows: monitorias } = await banco.bd.query<{ id: string }>(
        `insert into public.monitoria (id_franja, id_monitor, id_materia, id_lead, fecha, estado, valor_total, id_diagnostico)
         values ($1, $2, $3, $4, $5::date, 'pendiente_pago', 20000, $6) returning id`,
        [idFranja, monitor.id, banco.idMateriaA, idLead, franjas[0].fecha, sembrado.id],
      );
      idMonitoria = monitorias[0].id;

      const contexto = await nuevoContexto(browser, limpieza);
      try {
        const pagina = await contexto.newPage();
        await pagina.goto("/ingresar");
        await enviarCredenciales(pagina, monitor.correo, monitor.contrasena);
        await expect(pagina).toHaveURL("/monitor", LARGA);
        const respuesta = await pagina.goto(ruta);
        await expectNoEncontrado(pagina, respuesta, "un monitor con una cita");
      } finally {
        await contexto.close();
      }
    } finally {
      if (idMonitoria) await banco.bd.query("delete from public.monitoria where id = $1", [idMonitoria]);
      if (idFranja) await banco.bd.query("delete from public.franja where id = $1", [idFranja]);
      await banco.bd.query("delete from public.certificado where id_monitor = $1", [monitor.id]);
      await banco.bd.query("delete from public.lead where id = $1", [idLead]);
    }
  });

  // Un id que no es un UUID o que no existe: el mismo 404, sin decir cuál de los casos pasó.
  for (const invalido of ["no-es-un-uuid", "00000000-0000-4000-8000-000000000000"]) {
    const respuesta = await page.goto(`/diagnostico/resultado/${invalido}`);
    await expectNoEncontrado(page, respuesta, `la dirección ${invalido}`);
  }
});

// ---------------------------------------------------------------------------
// HU-010: dejar el contacto al terminar el diagnóstico y quedar como Lead
// ---------------------------------------------------------------------------

const TITULO_DEL_CONTACTO = "Déjanos tu contacto para agendar una monitoría y que Calibra te pueda escribir";
const AUTORIZO = /Autorizo a Calibra a tratar mis datos personales/;
const campoDeContacto = (page: Page, etiqueta: string) => page.getByLabel(etiqueta, { exact: true });
const guardarMisDatos = (page: Page) => page.getByRole("button", { name: "Guardar mis datos" });

/**
 * Borra los Leads de la prueba (por correo y por sesión) con lo que cuelga de ellos: los diagnósticos ligados, el registro de
 * los correos de verificación y el buzón. Va en un `finally`, antes de que `limpieza` borre las sesiones.
 */
async function borrarLeads(admin: SupabaseClient, correos: string[], sesiones: string[]): Promise<void> {
  const ids = new Set<string>();
  const { data: porCorreo } = await admin.from("lead").select("id").in("correo", correos);
  const { data: porSesion } = await admin.from("lead").select("id").in("id_sesion_anonima", sesiones);
  for (const { id } of [...(porCorreo ?? []), ...(porSesion ?? [])] as { id: string }[]) ids.add(id);
  if (ids.size) {
    const { data: enlaces } = await admin.from("verificacion_lead").select("id").in("id_lead", [...ids]);
    const claves = ((enlaces ?? []) as { id: string }[]).map(({ id }) => `verificacion_lead:${id}`);
    if (claves.length) await admin.from("correo_envio").delete().in("clave", claves);
    await admin.from("diagnostico").delete().in("id_lead", [...ids]);
  }
  await admin.from("correo_envio").delete().in("destinatario", correos);
  for (const correo of correos) {
    await fetch(`${variable("MAILPIT_URL")}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`, { method: "DELETE" }).catch(() => {});
  }
  if (ids.size) {
    const { error } = await admin.from("lead").delete().in("id", [...ids]);
    if (error) throw new Error(`borrar los Leads de HU-010: ${error.message}`);
  }
}

test("HU-010 · criterios 1, 2, 4, 5, 6 y 7: debajo del resultado deja su contacto con su campaña y queda como Lead con su diagnóstico", async ({
  page,
  context,
  banco,
  limpieza,
}) => {
  const correo = `e2e-hu010-${randomUUID()}@calibra.test`;
  // Llega por un enlace de campaña (RN-01): la cookie la recuerda para cuando deje su contacto.
  await page.goto("/diagnostico?utm_campaign=feria-hu010");
  await expect(titulo(page, TITULO_DEL_SELECTOR)).toBeVisible(ESPERA);
  const sesion = await esperarSesion(context);
  limpieza.anotar(sesion.id);
  await expect.poll(async () => (await context.cookies()).find((c) => c.name === COOKIE_ORIGEN)?.value).toBe("feria-hu010");

  try {
    const sembrado = await sembrarDiagnostico(banco.bd, { idSesionAnonima: sesion.id, idEvaluacion: banco.idParcial1 });
    const ruta = `/diagnostico/resultado/${sembrado.id}`;
    await page.goto(ruta);
    await expect(titulo(page, TITULO_DEL_RESULTADO)).toBeVisible(ESPERA);
    // Hidratado: el envío pasa por la espera de la sesión anónima (HU-058), como el de una persona.
    await page.waitForLoadState("networkidle");

    await test.step("criterio 4 (P-34): el resultado sale completo y el contacto va después, como paso siguiente", async () => {
      const puntaje = page.getByText("Puntaje global");
      await expect(puntaje).toBeVisible();
      const bloque = page.getByRole("region", { name: TITULO_DEL_CONTACTO });
      await expect(bloque).toBeVisible();
      expect((await bloque.boundingBox())!.y).toBeGreaterThan((await puntaje.boundingBox())!.y);
      await expectReglasDelProducto(page, "el resultado con el formulario de contacto");
    });

    await test.step("criterio 2: con un correo inválido no se envía", async () => {
      await campoDeContacto(page, "Tu nombre").fill("Ana Pérez");
      await campoDeContacto(page, "Tu correo").fill("no-es-un-correo");
      await page.getByLabel(AUTORIZO).check();
      await guardarMisDatos(page).click();
      await expect(page.getByRole("alert").filter({ hasText: /correo/i }).first()).toBeVisible(ESPERA);
      await expect(page).toHaveURL(ruta);
    });

    await test.step("criterio 6: sin aceptar el tratamiento de datos no se guarda nada", async () => {
      await campoDeContacto(page, "Tu correo").fill(correo);
      await page.getByLabel(AUTORIZO).uncheck();
      await guardarMisDatos(page).click();
      await expect(page.getByRole("alert").filter({ hasText: /autoriz/i }).first()).toBeVisible(ESPERA);
      const { data } = await limpieza.admin.from("lead").select("id").eq("correo", correo);
      expect(data).toEqual([]);
    });

    await test.step("criterios 1 y 7: con la autorización queda como Lead nuevo, con su campaña, y su diagnóstico ligado", async () => {
      await campoDeContacto(page, "Tu nombre").fill("Ana Pérez");
      await campoDeContacto(page, "Tu correo").fill(correo);
      await campoDeContacto(page, "Tu teléfono (opcional)").fill("+57 300 123 4567");
      await page.getByLabel(AUTORIZO).check();
      await guardarMisDatos(page).click();
      await expect(page.getByRole("heading", { level: 2, name: "Ya tenemos tu contacto" })).toBeVisible(ESPERA);
      await expect(page).toHaveURL(ruta);

      const { data: leads } = await limpieza.admin.from("lead").select("id, nombre, numero_telefono, origen, estado").eq("correo", correo);
      expect(leads).toEqual([
        expect.objectContaining({ nombre: "Ana Pérez", numero_telefono: "+573001234567", estado: "nuevo", origen: "feria-hu010" }),
      ]);
      const { data: diagnostico } = await limpieza.admin.from("diagnostico").select("id_lead").eq("id", sembrado.id).single();
      expect(diagnostico?.id_lead).toBe((leads as { id: string }[])[0].id);
    });

    await test.step("criterio 5 (D-68 b): ya es Lead: sin formulario y con el enlace para cambiar sus datos, que actualiza el mismo Lead", async () => {
      await expect(guardarMisDatos(page)).toHaveCount(0);
      await expectReglasDelProducto(page, "el resultado de quien ya es Lead");
      await page.getByRole("link", { name: "Cambiar mis datos" }).click();
      await expect(page).toHaveURL(/\/agendar\/contacto\?editar=1/, ESPERA);
      await campoDeContacto(page, "Tu nombre").fill("Ana María Pérez");
      await page.getByLabel(AUTORIZO).check();
      await page.getByRole("button", { name: "Seguir" }).click();
      await expect(page).toHaveURL(ruta, ESPERA);
      const { data } = await limpieza.admin.from("lead").select("nombre").eq("correo", correo);
      expect(data).toEqual([{ nombre: "Ana María Pérez" }]);
    });
  } finally {
    await borrarLeads(limpieza.admin, [correo], [sesion.id]);
  }
});

test("HU-010 · criterio 3 (P-23, D-68 c): con el correo de otro Lead no se liga; el enlace de verificación lleva a /agendar", async ({
  page,
  context,
  banco,
  limpieza,
  cuentas,
}) => {
  const correoDelDueno = `e2e-hu010-${randomUUID()}@calibra.test`;
  const { data: dueno, error } = await limpieza.admin
    .from("lead")
    .insert({ nombre: "Dueña del correo", correo: correoDelDueno, acepta_tratamiento_datos: true, fecha_consentimiento: new Date().toISOString() })
    .select("id")
    .single();
  if (error || !dueno) throw new Error(`insertar el Lead dueño: ${error?.message}`);

  // El `try` empieza aquí: si la sesión no llega, el Lead dueño igual se borra.
  const sesiones: string[] = [];
  try {
    await abrirSelector(page);
    const sesion = await esperarSesion(context);
    limpieza.anotar(sesion.id);
    sesiones.push(sesion.id);
    const sembrado = await sembrarDiagnostico(banco.bd, { idSesionAnonima: sesion.id, idEvaluacion: banco.idParcial1 });
    await page.goto(`/diagnostico/resultado/${sembrado.id}`);
    await expect(titulo(page, TITULO_DEL_RESULTADO)).toBeVisible(ESPERA);
    await page.waitForLoadState("networkidle");
    await campoDeContacto(page, "Tu nombre").fill("Otra Persona");
    await campoDeContacto(page, "Tu correo").fill(correoDelDueno);
    await page.getByLabel(AUTORIZO).check();
    await guardarMisDatos(page).click();
    await expect(page.getByRole("status").filter({ hasText: "Ese correo ya está en Calibra." })).toBeVisible(ESPERA);

    // No se ligó: el diagnóstico sigue sin Lead, y el enlace guardado lleva a /agendar.
    const { data: antes } = await limpieza.admin.from("diagnostico").select("id_lead").eq("id", sembrado.id).single();
    expect(antes?.id_lead).toBeNull();
    const { data: enlaces } = await limpieza.admin.from("verificacion_lead").select("siguiente").eq("id_lead", dueno.id);
    expect(enlaces).toEqual([{ siguiente: "/agendar" }]);

    const mensaje = await cuentas.esperarCorreo(correoDelDueno);
    const enlace = /href="([^"]*\/contacto\/verificar\?[^"]*)"/.exec(mensaje.html)?.[1]?.replaceAll("&amp;", "&");
    expect(enlace, "el correo debía traer el enlace de verificación").toBeTruthy();
    await page.goto(enlace!);
    await page.getByRole("button", { name: "Sí, es mi correo" }).click();
    await expect(page).toHaveURL(/\/agendar(\?|$)/, ESPERA);

    // Al confirmar, la sesión queda ligada al Lead dueño, con su diagnóstico.
    const { data: despues } = await limpieza.admin.from("diagnostico").select("id_lead").eq("id", sembrado.id).single();
    expect(despues?.id_lead).toBe(dueno.id);
  } finally {
    await borrarLeads(limpieza.admin, [correoDelDueno], sesiones);
  }
});
