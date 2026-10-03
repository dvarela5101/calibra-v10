import { randomBytes, randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { diaDelNegocio, formatearFechaHora } from "../src/lib/fechas";
import { borrarDesembolsosDeMonitores, test as base, expect } from "./utilidades";

// HU-035 (RN-70, RN-72, D-17): el Lead califica su monitoría individual desde el enlace del correo. Corre contra el
// Supabase local con monitores, materias, Leads, monitorías, pagos e invitaciones que crea y borra cada prueba (nombres
// y correos únicos: las pruebas corren en paralelo y solo se afirma sobre lo propio). El correo en sí lo cubre la prueba
// de integración (`integracion/resenas.test.ts`); aquí se prepara la monitoría realizada por la base, con la llave
// secreta, y el trigger anota la invitación cuyo token trae el enlace.
//
// La página vive en las públicas, que crean una sesión anónima en el navegador: se aborta esa alta (como en las demás
// pruebas) para no gastar cupo de Auth y porque la reseña no necesita sesión.

const ESPERA = { timeout: 20_000 };
const RUTA = "/resena";

const TITULO_NO_SIRVE = "Este enlace no sirve";
const TITULO_YA_CALIFICASTE = "Ya calificaste esta monitoría";
const TITULO_NO_SE_PUEDE = "No se puede calificar";
const MENSAJE_SIN_CALIFICACION = "Elige una calificación de 1 a 5.";

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
// Fixture `escenario`: lo que crea cada prueba, que se borra al terminar
// ---------------------------------------------------------------------------
type Realizada = {
  idPago: string;
  token: string;
  monitor: string;
  materia: string;
  /** Lo que la página muestra como «Sesión»: el inicio de la monitoría. */
  sesion: string;
};

type Escenario = {
  /** Una individual realizada hace una semana (a las 10:00 de Bogotá) con su pago en ese estado y su invitación. */
  realizada(estadoDelPago: "aprobado" | "rechazado"): Promise<Realizada>;
  /** Lo que dice la base de la reseña de ese pago. */
  resenasDe(idPago: string): Promise<{ calificacion: number; comentario: string | null; fecha: string }[]>;
};

const test = base.extend<{ escenario: Escenario }>({
  escenario: async ({ cuentas, page }, entregar) => {
    const cliente = cuentas.cliente;
    const monitores: string[] = [];
    const materias: string[] = [];
    const leads: string[] = [];
    const pagos: string[] = [];
    const comprobantes: string[] = [];
    let idAdmin: string | undefined;

    // La página es pública y crea una sesión anónima en el navegador: no se necesita, y gasta cupo del Auth local.
    await page.route("**/auth/v1/signup", (ruta) => ruta.abort());

    async function insertar(tabla: string, fila: Record<string, unknown>) {
      const { data, error } = await cliente.from(tabla).insert(fila).select().single();
      if (error) throw new Error(`insertar ${tabla}: ${error.message}`);
      return data as { id: string };
    }

    await entregar({
      async realizada(estadoDelPago) {
        idAdmin ??= (await cuentas.crearAdmin()).id;
        const monitor = await cuentas.crearMonitor();
        monitores.push(monitor.id);
        const nombreMateria = `Materia e2e reseña ${randomUUID().slice(0, 6)}`;
        const materia = await insertar("materia", { nombre: nombreMateria, codigo: `E2E-${randomUUID().slice(0, 12)}` });
        materias.push(materia.id);
        await insertar("certificado", { id_monitor: monitor.id, id_materia: materia.id, id_admin: idAdmin });

        const fecha = sumarDias(diaDelNegocio(new Date()), -7);
        const franja = await insertar("franja", {
          id_monitor: monitor.id,
          dia: diaIso(fecha),
          hora: "10:00",
          duracion_min: 60,
          presencial: true,
          precio: 25_000,
          lugar: "Edificio ML, salón 101",
        });
        const lead = await insertar("lead", {
          nombre: `Lead e2e reseña ${randomUUID().replaceAll("-", "").slice(0, 8)}`,
          correo: `lead-${randomUUID()}@calibra.test`,
          acepta_tratamiento_datos: true,
          fecha_consentimiento: new Date().toISOString(),
        });
        leads.push(lead.id);
        const monitoria = await insertar("monitoria", {
          id_franja: franja.id,
          id_monitor: monitor.id,
          id_materia: materia.id,
          id_lead: lead.id,
          fecha,
          valor_total: 25_000,
          estado: "confirmada",
        });
        // pago.comprobante es una llave foránea a los comprobantes que el servidor ya revisó (HU-059).
        const comprobante = `${randomUUID()}/${randomUUID()}.png`;
        const { error: errorComprobante } = await cliente.from("comprobante_revisado").insert({ ruta: comprobante, tipo: "image/png" });
        if (errorComprobante) throw new Error(`insertar comprobante_revisado: ${errorComprobante.message}`);
        comprobantes.push(comprobante);
        const pago = await insertar("pago", {
          id_monitoria: monitoria.id,
          monto: 25_000,
          nombre_pagador: `Pagador e2e ${randomUUID().slice(0, 8)}`,
          contacto: `pagador-${randomUUID()}@calibra.test`,
          id_admin: idAdmin,
          comprobante,
          estado: "aprobado",
          fecha_revision: new Date().toISOString(),
        });
        pagos.push(pago.id);

        // Pasa a realizada: el trigger anota la invitación (con el pago aprobado, que es cuando se anota).
        const { error: errorEstado } = await cliente
          .from("monitoria")
          .update({ estado: "realizada", fecha_finalizacion: new Date().toISOString() })
          .eq("id", monitoria.id);
        if (errorEstado) throw new Error(`pasar la monitoría a realizada: ${errorEstado.message}`);
        if (estadoDelPago === "rechazado") {
          const { error } = await cliente.from("pago").update({ estado: "rechazado" }).eq("id", pago.id);
          if (error) throw new Error(`rechazar el pago: ${error.message}`);
        }

        const { data, error } = await cliente.from("invitacion_resena").select("token").eq("id_pago", pago.id).single();
        if (error) throw new Error(`leer la invitación: ${error.message}`);
        return {
          idPago: pago.id,
          token: (data as { token: string }).token,
          monitor: monitor.nombre,
          materia: nombreMateria,
          sesion: formatearFechaHora(new Date(`${fecha}T15:00:00Z`)),
        };
      },
      async resenasDe(idPago) {
        const { data, error } = await cliente.from("resena").select("calificacion, comentario, fecha").eq("id_pago", idPago);
        if (error) throw new Error(`leer reseñas: ${error.message}`);
        return data as { calificacion: number; comentario: string | null; fecha: string }[];
      },
    });

    // Limpieza, antes de que la fixture `cuentas` borre a los monitores y al admin: de las filas dependientes hacia las
    // cuentas. La reseña cuelga del pago sin cascada; la invitación se va con el pago. Se intenta todo y se avisa de lo
    // que falle.
    const fallos: string[] = [];
    const borrar = async (contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await consulta;
      if (error) fallos.push(`${contexto}: ${error.message}`);
    };
    if (pagos.length) {
      await borrar("reseñas", cliente.from("resena").delete().in("id_pago", pagos));
      await borrar("pagos", cliente.from("pago").delete().in("id", pagos));
    }
    if (comprobantes.length) await borrar("comprobantes revisados", cliente.from("comprobante_revisado").delete().in("ruta", comprobantes));
    if (monitores.length) {
      // HU-028: la que pasó a realizada tiene su desembolso, que no cae con la monitoría.
      await borrar("desembolsos", borrarDesembolsosDeMonitores(cliente, monitores));
      await borrar("monitorías", cliente.from("monitoria").delete().in("id_monitor", monitores));
      await borrar("franjas", cliente.from("franja").delete().in("id_monitor", monitores));
      await borrar("certificados", cliente.from("certificado").delete().in("id_monitor", monitores));
    }
    if (leads.length) await borrar("leads", cliente.from("lead").delete().in("id", leads));
    if (materias.length) await borrar("materias", cliente.from("materia").delete().in("id", materias));
    if (fallos.length) throw new Error(`No se pudo limpiar lo que creó la prueba:\n${fallos.join("\n")}`);
  },
});

test.describe.configure({ mode: "default", timeout: 90_000 });

// ---------------------------------------------------------------------------
// Ayudas de página
// ---------------------------------------------------------------------------
const titulo = (page: Page, nombre: string) => page.getByRole("heading", { level: 1, name: nombre });
const calificacion = (page: Page, n: number) => page.getByRole("radio", { name: String(n), exact: true });
const botonEnviar = (page: Page) => page.getByRole("button", { name: "Enviar calificación" });

/** Abre el enlace y espera a que el formulario (cliente) esté hidratado: un envío antes de eso recargaría la página. */
async function abrirEnlace(page: Page, token: string): Promise<void> {
  await page.goto(`${RUTA}?token=${token}`);
  await expect(titulo(page, "Califica tu monitoría")).toBeVisible(ESPERA);
  await page.waitForLoadState("networkidle");
}

/** El texto que se ve, con los espacios duros como espacios normales. */
const textoVisible = async (page: Page) => (await page.locator("body").innerText()).replace(/\s/g, " ");

// ---------------------------------------------------------------------------
// Criterios 1 y 2 · calificar desde el enlace
// ---------------------------------------------------------------------------
test.describe("Criterio 2 · el Lead califica desde el enlace", () => {
  test("ve el monitor, la materia y la fecha; sin elegir calificación el envío falla; con 4 y un comentario queda guardada la reseña del pago; al volver al enlace ya calificó", async ({
    page,
    escenario,
  }) => {
    const r = await escenario.realizada("aprobado");

    await test.step("el enlace muestra el monitor, la materia y cuándo fue la sesión", async () => {
      await abrirEnlace(page, r.token);
      await expect(page.getByText("Tu opinión ayuda a otros estudiantes a escoger monitor.")).toBeVisible();
      const texto = await textoVisible(page);
      expect(texto).toContain(r.monitor);
      expect(texto).toContain(r.materia);
      expect(texto).toContain(r.sesion.replace(/\s/g, " "));
      // Las cinco opciones y el comentario, que es opcional.
      for (const n of [1, 2, 3, 4, 5]) await expect(calificacion(page, n)).toHaveCount(1);
      await expect(page.getByLabel("Comentario (opcional)")).toBeVisible();
    });

    await test.step("enviar sin elegir calificación muestra el error y no guarda nada", async () => {
      await page.getByLabel("Comentario (opcional)").fill("Lo escribo, pero me falta la nota");
      await botonEnviar(page).click();
      await expect(page.getByRole("alert").filter({ hasText: MENSAJE_SIN_CALIFICACION })).toBeVisible(ESPERA);
      // Lo escrito se conserva.
      await expect(page.getByLabel("Comentario (opcional)")).toHaveValue("Lo escribo, pero me falta la nota");
      expect(await escenario.resenasDe(r.idPago)).toEqual([]);
    });

    await test.step("elige 4, escribe un comentario y envía: Gracias por calificar, y la reseña queda ligada al pago", async () => {
      await page.getByLabel("Comentario (opcional)").fill("Explica con calma y llegó puntual.");
      await page.locator("label").filter({ has: calificacion(page, 4) }).click();
      await expect(calificacion(page, 4)).toBeChecked();
      const desde = Date.now();
      await botonEnviar(page).click();

      await expect(page.getByRole("heading", { name: "Gracias por calificar" })).toBeVisible(ESPERA);
      await expect(page.getByText("Guardamos tu calificación.")).toBeVisible();
      await expect(botonEnviar(page)).toHaveCount(0);

      const [resena, ...otras] = await escenario.resenasDe(r.idPago);
      expect(otras).toEqual([]);
      expect(resena).toMatchObject({ calificacion: 4, comentario: "Explica con calma y llegó puntual." });
      expect(new Date(resena.fecha).getTime()).toBeGreaterThanOrEqual(desde - 60_000);
      expect(new Date(resena.fecha).getTime()).toBeLessThanOrEqual(Date.now() + 60_000);
    });

    await test.step("al recargar el enlace dice Ya calificaste esta monitoría y no ofrece el formulario", async () => {
      await page.goto(`${RUTA}?token=${r.token}`);
      await expect(titulo(page, TITULO_YA_CALIFICASTE)).toBeVisible(ESPERA);
      await expect(page.getByText("Ya dejaste tu calificación de esta monitoría.")).toBeVisible();
      await expect(botonEnviar(page)).toHaveCount(0);
      expect(await escenario.resenasDe(r.idPago)).toHaveLength(1);
    });
  });

  test("el comentario es opcional: solo con la calificación queda guardada la reseña, sin comentario", async ({ page, escenario }) => {
    const r = await escenario.realizada("aprobado");
    await abrirEnlace(page, r.token);

    await page.locator("label").filter({ has: calificacion(page, 5) }).click();
    await botonEnviar(page).click();

    await expect(page.getByRole("heading", { name: "Gracias por calificar" })).toBeVisible(ESPERA);
    expect(await escenario.resenasDe(r.idPago)).toMatchObject([{ calificacion: 5, comentario: null }]);
  });
});

// ---------------------------------------------------------------------------
// Criterio 3 · lo que no permite reseñar
// ---------------------------------------------------------------------------
test.describe("Criterio 3 · enlaces que no permiten reseñar", () => {
  test("un token inventado, uno incompleto o la ruta sin token dicen Este enlace no sirve", async ({ page }) => {
    const inventado = randomBytes(32).toString("hex");
    for (const ruta of [`${RUTA}?token=${inventado}`, `${RUTA}?token=abc`, RUTA, `${RUTA}?token=${inventado}&token=${inventado}`]) {
      await page.goto(ruta);
      await expect(titulo(page, TITULO_NO_SIRVE), ruta).toBeVisible(ESPERA);
      await expect(page.getByText("Está incompleto o no lo reconocemos."), ruta).toBeVisible();
      await expect(botonEnviar(page), ruta).toHaveCount(0);
    }
  });

  test("un pago rechazado dice No se puede calificar y no deja reseñar", async ({ page, escenario }) => {
    const r = await escenario.realizada("rechazado");

    await page.goto(`${RUTA}?token=${r.token}`);

    await expect(titulo(page, TITULO_NO_SE_PUEDE)).toBeVisible(ESPERA);
    await expect(page.getByText("Esta monitoría no se puede calificar.")).toBeVisible();
    await expect(botonEnviar(page)).toHaveCount(0);
    expect(await escenario.resenasDe(r.idPago)).toEqual([]);
  });

  test("si el pago se rechaza mientras el formulario está abierto, al enviar dice que no se puede calificar y no guarda la reseña", async ({
    page,
    escenario,
    cuentas,
  }) => {
    const r = await escenario.realizada("aprobado");
    await abrirEnlace(page, r.token);
    const { error } = await cuentas.cliente.from("pago").update({ estado: "rechazado" }).eq("id", r.idPago);
    expect(error).toBeNull();

    await page.locator("label").filter({ has: calificacion(page, 2) }).click();
    await botonEnviar(page).click();

    await expect(page.getByText("Esta monitoría no se puede calificar.")).toBeVisible(ESPERA);
    expect(await escenario.resenasDe(r.idPago)).toEqual([]);
  });

  test("la página no se indexa ni filtra el enlace por el Referer", async ({ page }) => {
    await page.goto(`${RUTA}?token=${randomBytes(32).toString("hex")}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  });
});

// ---------------------------------------------------------------------------
// Las reglas del producto sobre la página abierta (las mismas de finalizar.spec.ts)
// ---------------------------------------------------------------------------
test.describe("Reglas del producto en la página de reseña", () => {
  test("con el formulario, el error y los resultados a la vista, el texto mide 14 px o más, las áreas táctiles (los cinco radios y el botón) 44 px o más y no hay desbordamiento a 390 px", async ({
    page,
    escenario,
  }) => {
    const r = await escenario.realizada("aprobado");

    await test.step("el formulario con el error de validación", async () => {
      await abrirEnlace(page, r.token);
      await botonEnviar(page).click();
      await expect(page.getByRole("alert").filter({ hasText: MENSAJE_SIN_CALIFICACION })).toBeVisible(ESPERA);
      await expectReglasDelProducto(page, "formulario con error");

      // Cada opción de calificación y el botón se pueden tocar sin errar.
      const medidas = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map((radio) => {
          const caja = (radio.closest("label") ?? radio).getBoundingClientRect();
          return { ancho: Math.round(caja.width), alto: Math.round(caja.height) };
        }),
      );
      expect(medidas).toHaveLength(5);
      for (const medida of medidas) {
        expect(medida.alto, "alto de la opción").toBeGreaterThanOrEqual(44);
        expect(medida.ancho, "ancho de la opción").toBeGreaterThanOrEqual(44);
      }
      const boton = await botonEnviar(page).boundingBox();
      expect(boton?.height ?? 0).toBeGreaterThanOrEqual(44);
    });

    await test.step("Gracias por calificar", async () => {
      await page.locator("label").filter({ has: calificacion(page, 3) }).click();
      await botonEnviar(page).click();
      await expect(page.getByRole("heading", { name: "Gracias por calificar" })).toBeVisible(ESPERA);
      await expectReglasDelProducto(page, "gracias por calificar");
    });

    await test.step("Ya calificaste esta monitoría", async () => {
      await page.goto(`${RUTA}?token=${r.token}`);
      await expect(titulo(page, TITULO_YA_CALIFICASTE)).toBeVisible(ESPERA);
      await expectReglasDelProducto(page, "ya calificaste");
    });

    await test.step("Este enlace no sirve", async () => {
      await page.goto(`${RUTA}?token=${randomBytes(32).toString("hex")}`);
      await expect(titulo(page, TITULO_NO_SIRVE)).toBeVisible(ESPERA);
      await expectReglasDelProducto(page, "enlace que no sirve");
    });
  });
});

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
  expect(medidas.menorTexto, `${donde}: ningún texto por debajo de 14 px`).toBeGreaterThanOrEqual(14);
  expect(medidas.degradados, `${donde}: sin degradados`).toBe(0);
  expect(medidas.tactilesChicos, `${donde}: áreas táctiles de 44 px o más`).toEqual([]);
  expect(medidas.controlesSinNombre, `${donde}: todo control tiene nombre`).toEqual([]);
}

/** Texto, áreas táctiles (enlaces, botones, campos), degradados y nombres. */
async function medir(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const caja = el.getBoundingClientRect();
      return caja.width > 0 && caja.height > 0;
    };
    const conTexto = [...document.body.querySelectorAll<HTMLElement>("*")].filter(
      (el) => visible(el) && [...el.childNodes].some((nodo) => nodo.nodeType === Node.TEXT_NODE && nodo.textContent?.trim()),
    );
    const controles = [...document.querySelectorAll<HTMLElement>("a, button, select, summary, textarea, input:not([type=hidden])")].filter(visible);
    // Los enlaces dentro de una frase son texto corrido: quedan fuera.
    const tocables = controles.filter((el) => !(el.tagName === "A" && el.closest("label, p")));
    return {
      sinScrollHorizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
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
