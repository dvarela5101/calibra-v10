import { randomUUID } from "node:crypto";
import type { BrowserContext, Page } from "@playwright/test";
import { COOKIE_ORIGEN } from "../src/lib/leads/origen";
import { esperarSesion, expect, test as base, variable, type SesionEnCookie } from "./utilidades";

// HU-068 (D-3, P-21 a P-23): el visitante deja su contacto al agendar y queda como Lead. Corre contra el Supabase
// local (Auth, base y Mailpit) con visitantes y Leads que crea y borra cada prueba.
//
// Cada navegador que abre una página pública gasta una sesión anónima, y el Auth local solo deja crear 30 por hora
// por IP (`[auth.rate_limit]` de supabase/config.toml), que el resto de la suite ya casi agota. Por eso un solo
// visitante recorre todo el flujo principal, y la prueba de accesibilidad mide las páginas sin crear sesión.

const ESPERA = { timeout: 20_000 };

/** Siempre con `siguiente`: a dónde sigue quien deja su contacto (aquí, una página que existe y no pide sesión). */
const FORMULARIO = "/agendar/contacto?siguiente=/privacidad";
const SIGUIENTE = "/privacidad";
const AUTORIZO = /Autorizo a Calibra a tratar mis datos personales/;
const TITULO_CONFIRMAR = "Confirma que este correo es tuyo";
const TITULO_SIN_ENLACE = "Este enlace ya no sirve";

// ---------------------------------------------------------------------------
// Fixture `contactos`: correos, sesiones y Leads de la prueba, que se borran al terminar
// ---------------------------------------------------------------------------
type FilaDeLead = {
  id: string;
  id_sesion_anonima: string | null;
  nombre: string;
  correo: string | null;
  numero_telefono: string | null;
  origen: string | null;
  estado: string;
  acepta_tratamiento_datos: boolean;
  acepta_contacto: boolean;
};

type Contactos = {
  /** Un correo que solo existe en esta prueba: si queda como Lead, se borra al terminar. */
  correo(): string;
  /** Espera la sesión anónima que el navegador recibe al abrir una página pública, y la borra al terminar. */
  sesion(context: BrowserContext): Promise<SesionEnCookie>;
  /** Un Lead que ya existe y que no es de ninguna sesión de la prueba: lo borra la fixture. */
  crearLead(datos: { nombre: string; correo: string }): Promise<FilaDeLead>;
  leadsConCorreo(correo: string): Promise<FilaDeLead[]>;
  leadsDeSesion(idSesion: string): Promise<FilaDeLead[]>;
  sesionesLigadasA(idLead: string): Promise<{ id_sesion: string }[]>;
  enlacesDe(idLead: string): Promise<{ id: string; siguiente: string; usada_en: string | null }[]>;
};

const test = base.extend<{ contactos: Contactos }>({
  contactos: async ({ cuentas }, entregar) => {
    const cliente = cuentas.cliente;
    const correos: string[] = [];
    const sesiones: string[] = [];

    async function leer<T>(consulta: PromiseLike<{ data: T[] | null; error: { message: string } | null }>, contexto: string): Promise<T[]> {
      const { data, error } = await consulta;
      if (error) throw new Error(`${contexto}: ${error.message}`);
      return data ?? [];
    }

    await entregar({
      correo() {
        const correo = `e2e-${randomUUID()}@calibra.test`;
        correos.push(correo);
        return correo;
      },
      async sesion(context) {
        const sesion = await esperarSesion(context);
        cuentas.borrarAlFinal(sesion.id);
        sesiones.push(sesion.id);
        return sesion;
      },
      async crearLead({ nombre, correo }) {
        const { data, error } = await cliente
          .from("lead")
          .insert({ nombre, correo, acepta_tratamiento_datos: true, fecha_consentimiento: new Date().toISOString() })
          .select()
          .single();
        if (error) throw new Error(`insertar lead: ${error.message}`);
        return data as FilaDeLead;
      },
      leadsConCorreo: (correo) => leer<FilaDeLead>(cliente.from("lead").select("*").eq("correo", correo), "leer Leads por correo"),
      leadsDeSesion: (idSesion) => leer<FilaDeLead>(cliente.from("lead").select("*").eq("id_sesion_anonima", idSesion), "leer Leads por sesión"),
      sesionesLigadasA: (idLead) => leer(cliente.from("lead_sesion").select("id_sesion").eq("id_lead", idLead), "leer las sesiones ligadas"),
      enlacesDe: (idLead) => leer(cliente.from("verificacion_lead").select("id, siguiente, usada_en").eq("id_lead", idLead).order("creada_en"), "leer los enlaces"),
    });

    // Limpieza, antes de que la fixture `cuentas` borre las sesiones (al borrar una, su Lead ya no se encontraría por
    // ella): el registro de correos por su clave y por destinatario, el buzón y los Leads, que se llevan en cascada
    // sus enlaces y las sesiones ligadas.
    const fallos: string[] = [];
    const borrar = async (contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await consulta;
      if (error) fallos.push(`${contexto}: ${error.message}`);
    };
    const ids = new Set<string>();
    if (correos.length) for (const { id } of await leer<{ id: string }>(cliente.from("lead").select("id").in("correo", correos), "buscar Leads por correo")) ids.add(id);
    if (sesiones.length) for (const { id } of await leer<{ id: string }>(cliente.from("lead").select("id").in("id_sesion_anonima", sesiones), "buscar Leads por sesión")) ids.add(id);
    if (ids.size) {
      const enlaces = await leer<{ id: string }>(cliente.from("verificacion_lead").select("id").in("id_lead", [...ids]), "buscar enlaces");
      if (enlaces.length) {
        await borrar("correo_envio por clave", cliente.from("correo_envio").delete().in("clave", enlaces.map(({ id }) => `verificacion_lead:${id}`)));
      }
    }
    if (correos.length) {
      await borrar("correo_envio por destinatario", cliente.from("correo_envio").delete().in("destinatario", correos));
      for (const correo of correos) {
        await fetch(`${variable("MAILPIT_URL")}/api/v1/search?query=${encodeURIComponent(`to:"${correo}"`)}`, { method: "DELETE" }).catch(
          (error: unknown) => fallos.push(`buzón de ${correo}: ${String(error)}`),
        );
      }
    }
    if (ids.size) await borrar("leads", cliente.from("lead").delete().in("id", [...ids]));
    if (fallos.length) throw new Error(`No se pudo limpiar lo que creó la prueba:\n${fallos.join("\n")}`);
  },
});

test.describe.configure({ mode: "default", timeout: 90_000 });

const alerta = (page: Page, texto: string) => page.getByRole("alert").filter({ hasText: texto });
const estado = (page: Page, texto: string) => page.getByRole("status").filter({ hasText: texto });
const campo = (page: Page, etiqueta: string) => page.getByLabel(etiqueta, { exact: true });
const seguir = (page: Page) => page.getByRole("button", { name: "Seguir" });

/** Abre una página y espera a que termine de cargar e hidratarse: el formulario y la sesión anónima llegan después. */
async function abrir(page: Page, ruta: string): Promise<void> {
  await page.goto(ruta);
  await page.waitForLoadState("networkidle");
}

// ---------------------------------------------------------------------------
// Criterios 1, 2, 4, 5 y 6: dejar el contacto y quedar como Lead
// ---------------------------------------------------------------------------
test.describe("Criterios 1, 2, 4, 5 y 6 · dejar el contacto al agendar", () => {
  test("un visitante que llegó por una campaña deja su contacto, queda como Lead con su origen y no se le vuelve a pedir", async ({
    page,
    context,
    contactos,
  }) => {
    const correo = contactos.correo();
    const nombre = "Ana Pérez";

    // Llega por un enlace de campaña (RN-01): la campaña queda recordada para cuando deje su contacto.
    await abrir(page, "/?utm_campaign=feria-2026");
    const sesion = await contactos.sesion(context);
    expect(sesion.esAnonimo).toBe(true);
    await expect
      .poll(async () => (await context.cookies()).find((cookie) => cookie.name === COOKIE_ORIGEN)?.value, {
        message: "la campaña debía quedar guardada en la cookie",
      })
      .toBe("feria-2026");

    await test.step("abre el formulario de agendar: todavía no es Lead", async () => {
      await abrir(page, FORMULARIO);
      await expect(page.getByRole("heading", { level: 1, name: "Tus datos para agendar" })).toBeVisible(ESPERA);
      await expect(campo(page, "Tu nombre")).toHaveValue("");
      await expect(page.getByLabel(AUTORIZO)).not.toBeChecked();
      expect(await contactos.leadsDeSesion(sesion.id)).toEqual([]);
    });

    await test.step("sin el nombre, o con un correo que no es correo, no se envía y no se guarda nada", async () => {
      await seguir(page).click();
      await expect(alerta(page, "Escribe tu nombre.")).toBeVisible(ESPERA);

      await campo(page, "Tu nombre").fill(nombre);
      await campo(page, "Tu correo").fill("ana@");
      await seguir(page).click();
      await expect(alerta(page, "Escribe un correo válido")).toBeVisible(ESPERA);
      // Lo escrito se conserva: solo hay que corregir el correo.
      await expect(campo(page, "Tu nombre")).toHaveValue(nombre);
      expect(await contactos.leadsDeSesion(sesion.id)).toEqual([]);
      await expectReglasDelProducto(page, "el formulario con un error");
    });

    await test.step("con todo completo pero sin autorizar el tratamiento de datos, no se guarda nada (RN-13)", async () => {
      await campo(page, "Tu correo").fill(correo);
      await campo(page, "Tu teléfono (opcional)").fill("300 123 4567");
      await seguir(page).click();

      await expect(alerta(page, "necesitamos tu autorización para tratar tus datos")).toBeVisible(ESPERA);
      await expect(page).toHaveURL(/\/agendar\/contacto/);
      expect(await contactos.leadsConCorreo(correo)).toEqual([]);
      expect(await contactos.leadsDeSesion(sesion.id)).toEqual([]);
    });

    const lead = await test.step("al autorizar, queda como Lead con su origen y sigue al paso de agendar", async () => {
      await page.getByLabel(AUTORIZO).check();
      await seguir(page).click();

      await expect(page).toHaveURL(SIGUIENTE, ESPERA);
      const [creado, ...otros] = await contactos.leadsConCorreo(correo);
      expect(otros, "el correo debía tener un solo Lead").toEqual([]);
      expect(creado).toMatchObject({
        nombre,
        correo,
        numero_telefono: "+573001234567",
        // La sesión anónima de este navegador quedó ligada al Lead.
        id_sesion_anonima: sesion.id,
        origen: "feria-2026",
        estado: "nuevo",
        acepta_tratamiento_datos: true,
        acepta_contacto: false,
      });
      return creado;
    });

    await test.step("ya es Lead: al volver a agendar no se le pide el contacto", async () => {
      await page.goto(FORMULARIO);
      await expect(page).toHaveURL(SIGUIENTE, ESPERA);
      await expect(page.getByRole("heading", { level: 1, name: "Aviso de privacidad" })).toBeVisible();
      await expect(page.getByLabel("Tu nombre")).toHaveCount(0);
    });

    await test.step("con editar=1 ve sus datos y, si cambia algo, se actualiza el mismo Lead", async () => {
      await abrir(page, `${FORMULARIO}&editar=1`);
      await expect(page.getByRole("heading", { level: 1, name: "Cambia tus datos" })).toBeVisible(ESPERA);
      await expect(campo(page, "Tu nombre")).toHaveValue(nombre);
      await expect(campo(page, "Tu correo")).toHaveValue(correo);
      await expect(campo(page, "Tu teléfono (opcional)")).toHaveValue("+573001234567");

      await campo(page, "Tu nombre").fill("Ana María Pérez");
      await campo(page, "Tu teléfono (opcional)").fill("+1 212 555 0100");
      await page.getByLabel(AUTORIZO).check();
      await seguir(page).click();

      await expect(page).toHaveURL(SIGUIENTE, ESPERA);
      const deLaSesion = await contactos.leadsDeSesion(sesion.id);
      expect(deLaSesion, "no debía crearse otro Lead").toHaveLength(1);
      expect(deLaSesion[0]).toMatchObject({ id: lead.id, nombre: "Ana María Pérez", correo, numero_telefono: "+12125550100", origen: "feria-2026" });
    });
  });
});

// ---------------------------------------------------------------------------
// Criterio 3 (P-23): un correo que ya es de otro Lead
// ---------------------------------------------------------------------------
test.describe("Criterio 3 (P-23) · el correo de otro Lead no se liga hasta confirmarlo", () => {
  test("otra sesión que escribe ese correo recibe el aviso, el enlace llega al dueño y solo al confirmarlo queda ligada", async ({
    page,
    context,
    cuentas,
    contactos,
  }) => {
    const correoDelDueno = contactos.correo();
    const dueno = await contactos.crearLead({ nombre: "Ana Pérez", correo: correoDelDueno });

    // Una persona que no es Ana abre el formulario en su navegador (una sesión anónima nueva) y escribe el correo de Ana.
    await abrir(page, FORMULARIO);
    const sesion = await contactos.sesion(context);
    await expect(page.getByRole("heading", { level: 1, name: "Tus datos para agendar" })).toBeVisible(ESPERA);

    await test.step("la sesión nueva no se liga: se le avisa que llegó un enlace al dueño del correo", async () => {
      await campo(page, "Tu nombre").fill("Otra Persona");
      await campo(page, "Tu correo").fill(`  ${correoDelDueno.toUpperCase()}  `);
      await page.getByLabel(AUTORIZO).check();
      await seguir(page).click();

      await expect(estado(page, "Ese correo ya está en Calibra.")).toBeVisible(ESPERA);
      await expect(page).toHaveURL(/\/agendar\/contacto\?siguiente=/);
      await expect(campo(page, "Tu nombre")).toHaveValue("Otra Persona");
      await expectReglasDelProducto(page, "el formulario con el aviso de verificación");

      // No se creó otro Lead ni se ligó la sesión: solo hay un enlace sin usar, que vuelve a la ruta pedida.
      expect(await contactos.leadsDeSesion(sesion.id)).toEqual([]);
      expect(await contactos.leadsConCorreo(correoDelDueno)).toHaveLength(1);
      expect(await contactos.sesionesLigadasA(dueno.id)).toEqual([]);
      expect(await contactos.enlacesDe(dueno.id)).toEqual([expect.objectContaining({ siguiente: SIGUIENTE, usada_en: null })]);
    });

    // El correo llega al dueño, con su nombre y sin nada de quien lo pidió.
    const correo = await cuentas.esperarCorreo(correoDelDueno);
    expect(correo.asunto).toBe("Confirma tu correo para agendar en Calibra");
    expect(correo.html).toContain("Hola, Ana Pérez.");
    expect(correo.html).not.toContain("Otra Persona");
    const enlace = /href="([^"]*\/contacto\/verificar\?[^"]*)"/.exec(correo.html)?.[1]?.replaceAll("&amp;", "&");
    expect(enlace, "el correo debía traer el enlace de verificación").toBeTruthy();

    await test.step("abrir el enlace no cambia nada: confirmar es un botón, para que un revisor de enlaces no lo gaste", async () => {
      await page.goto(enlace!);
      await expect(page.getByRole("heading", { level: 1, name: TITULO_CONFIRMAR })).toBeVisible(ESPERA);
      await expect(page.getByRole("button", { name: "Sí, es mi correo" })).toBeVisible();
      expect(await contactos.sesionesLigadasA(dueno.id)).toEqual([]);
      expect((await contactos.enlacesDe(dueno.id))[0].usada_en).toBeNull();
      await expectReglasDelProducto(page, "la página para confirmar el correo");
    });

    await test.step("al confirmar, este navegador queda ligado al Lead y sigue donde iba", async () => {
      await page.getByRole("button", { name: "Sí, es mi correo" }).click();

      await expect(page).toHaveURL(SIGUIENTE, ESPERA);
      expect(await contactos.sesionesLigadasA(dueno.id)).toEqual([{ id_sesion: sesion.id }]);
      expect((await contactos.enlacesDe(dueno.id))[0].usada_en).not.toBeNull();
      // Sigue sin tener un Lead propio: es el de Ana.
      expect(await contactos.leadsDeSesion(sesion.id)).toEqual([]);
    });

    await test.step("ya es Lead: no se le vuelve a pedir el contacto, y el enlace no sirve dos veces", async () => {
      await page.goto(FORMULARIO);
      await expect(page).toHaveURL(SIGUIENTE, ESPERA);

      await page.goto(enlace!);
      await expect(page.getByRole("heading", { level: 1, name: TITULO_SIN_ENLACE })).toBeVisible(ESPERA);
      await expect(page.getByRole("button", { name: "Sí, es mi correo" })).toHaveCount(0);
      expect(await contactos.sesionesLigadasA(dueno.id)).toEqual([{ id_sesion: sesion.id }]);
    });
  });

  test("un enlace inventado o a medias no confirma nada", async ({ page }) => {
    // No crea sesión: solo se mira lo que dice la página.
    await page.route("**/auth/v1/signup", (ruta) => ruta.abort());
    for (const token of ["basura-que-no-existe", "a".repeat(64)]) {
      await page.goto(`/contacto/verificar?token=${token}`);
      await expect(page.getByRole("heading", { level: 1, name: TITULO_SIN_ENLACE })).toBeVisible(ESPERA);
      await expect(page.getByRole("button", { name: "Sí, es mi correo" })).toHaveCount(0);
    }
    await page.goto("/contacto/verificar");
    await expect(page.getByRole("heading", { level: 1, name: TITULO_SIN_ENLACE })).toBeVisible(ESPERA);
  });
});

// ---------------------------------------------------------------------------
// Accesibilidad del producto
// ---------------------------------------------------------------------------
test.describe("Accesibilidad", () => {
  test("el formulario de contacto y la página de confirmación respetan las reglas de accesibilidad del producto", async ({ page }) => {
    // Solo se miden las páginas: sin sesión anónima, para no gastar una de las 30 por hora que admite el Auth local.
    await page.route("**/auth/v1/signup", (ruta) => ruta.abort());

    await abrir(page, "/agendar/contacto");
    await expect(page.getByRole("heading", { level: 1, name: "Tus datos para agendar" })).toBeVisible(ESPERA);
    await expectReglasDelProducto(page, "el formulario de contacto");

    await abrir(page, `/contacto/verificar?token=${"0".repeat(64)}`);
    await expect(page.getByRole("heading", { level: 1, name: TITULO_SIN_ENLACE })).toBeVisible(ESPERA);
    await expectReglasDelProducto(page, "la página de un enlace que ya no sirve");
  });
});

// ---------------------------------------------------------------------------
// Las reglas del producto sobre la página abierta
// ---------------------------------------------------------------------------
async function expectReglasDelProducto(page: Page, donde: string): Promise<void> {
  const medidas = await medir(page);
  expect(medidas.sinScrollHorizontal, `${donde}: sin scroll horizontal`).toBe(true);
  expect(medidas.menorTexto, `${donde}: ningún texto por debajo de 14 px`).toBeGreaterThanOrEqual(14);
  expect(medidas.degradados, `${donde}: sin degradados`).toBe(0);
  expect(medidas.tactilesChicos, `${donde}: áreas táctiles de 44 px o más`).toEqual([]);
  expect(medidas.controlesSinNombre, `${donde}: todo control tiene nombre`).toEqual([]);
}

/** Texto, áreas táctiles, degradados y nombres. De las casillas cuenta su etiqueta, que también las marca. */
async function medir(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const caja = el.getBoundingClientRect();
      return caja.width > 0 && caja.height > 0;
    };
    const conTexto = [...document.body.querySelectorAll<HTMLElement>("*")].filter((el) =>
      [...el.childNodes].some((nodo) => nodo.nodeType === Node.TEXT_NODE && nodo.textContent?.trim()),
    );
    const controles = [...document.querySelectorAll<HTMLElement>("a, button, select, input:not([type=hidden])")].filter(visible);
    // Los enlaces dentro de una frase (el aviso de privacidad de la casilla) son texto corrido: quedan fuera.
    const tocables = controles
      .filter((el) => !(el.tagName === "A" && el.closest("label, p")))
      .map((el) => (el instanceof HTMLInputElement && el.type === "checkbox" ? (el.labels?.[0] ?? el) : el));
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
