import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { diaDelNegocio, formatearDia } from "../src/lib/fechas";
import { nombreDelDia } from "../src/lib/franjas/reglas";
import { enviarCredenciales, expect, test as base, type Cuenta } from "./utilidades";

// HU-015: el monitor abre, edita y cierra sus franjas semanales. Corre contra el Supabase local (Auth y
// base) con cuentas y datos que crea y borra cada prueba. Las fechas salen de la zona del negocio.

const ESPERA = { timeout: 20_000 };

// ---------------------------------------------------------------------------
// Fechas (America/Bogota, nunca la zona de la máquina que corre la prueba)
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

// ---------------------------------------------------------------------------
// Escenario: monitores certificados y franjas con monitorías, que la prueba borra al terminar
// ---------------------------------------------------------------------------
type Escenario = {
  /** Un monitor con un certificado (en una materia de prueba). */
  monitorCertificado(): Promise<Cuenta>;
  /** Franja abierta con el cliente de confianza (no pasa por las reglas del monitor). Devuelve su id. */
  franja(monitor: Cuenta, datos: { dia: number; hora: string; duracionMin?: number; precio?: number }): Promise<string>;
  /** Una monitoría confirmada en esa franja, en una fecha que cae en su día. */
  agendar(monitor: Cuenta, idFranja: string, fecha: string): Promise<void>;
};

const test = base.extend<{ escenario: Escenario }>({
  escenario: async ({ cuentas }, entregar) => {
    const cliente = cuentas.cliente;
    const monitores: string[] = [];
    const materias: string[] = [];
    const leads: string[] = [];
    const materiaDe = new Map<string, string>();
    let idAdmin: string | undefined;
    let idLead: string | undefined;

    async function insertar(tabla: string, fila: Record<string, unknown>) {
      const { data, error } = await cliente.from(tabla).insert(fila).select().single();
      if (error) throw new Error(`insertar ${tabla}: ${error.message}`);
      return data as { id: string };
    }

    await entregar({
      async monitorCertificado() {
        idAdmin ??= (await cuentas.crearAdmin()).id;
        const monitor = await cuentas.crearMonitor();
        monitores.push(monitor.id);
        const materia = await insertar("materia", { nombre: "Materia e2e", codigo: `E2E-${randomUUID().slice(0, 12)}` });
        materias.push(materia.id);
        materiaDe.set(monitor.id, materia.id);
        await insertar("certificado", { id_monitor: monitor.id, id_materia: materia.id, id_admin: idAdmin });
        return monitor;
      },
      async franja(monitor, datos) {
        const franja = await insertar("franja", {
          id_monitor: monitor.id,
          dia: datos.dia,
          hora: datos.hora,
          presencial: true,
          lugar: "Edificio ML, salón 101",
          precio: datos.precio ?? 25_000,
          duracion_min: datos.duracionMin ?? 60,
        });
        return franja.id;
      },
      async agendar(monitor, idFranja, fecha) {
        if (!idLead) {
          const lead = await insertar("lead", {
            nombre: "Lead e2e",
            correo: `lead-${randomUUID()}@calibra.test`,
            acepta_tratamiento_datos: true,
            fecha_consentimiento: new Date().toISOString(),
          });
          idLead = lead.id;
          leads.push(lead.id);
        }
        await insertar("monitoria", {
          id_franja: idFranja,
          id_monitor: monitor.id,
          id_materia: materiaDe.get(monitor.id),
          id_lead: idLead,
          fecha,
          valor_total: 25_000,
          estado: "confirmada",
        });
      },
    });

    // Limpieza, antes de que la fixture `cuentas` borre a los monitores y al admin: de las filas
    // dependientes hacia las cuentas. Las franjas que abrió la interfaz se buscan por monitor.
    const fallos: string[] = [];
    const borrar = async (contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await consulta;
      if (error) fallos.push(`${contexto}: ${error.message}`);
    };
    if (monitores.length) {
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

/** Entra por /ingresar a la ruta pedida: sin sesión, la página protegida manda a iniciar sesión. */
async function entrar(page: Page, ruta: string, monitor: Cuenta): Promise<void> {
  await page.goto(ruta);
  await expect(page).toHaveURL(`/ingresar?siguiente=${encodeURIComponent(ruta)}`, ESPERA);
  await enviarCredenciales(page, monitor.correo, monitor.contrasena);
  await expect(page).toHaveURL(ruta, ESPERA);
}

const estado = (page: Page, texto: string) => page.getByRole("status").filter({ hasText: texto });
const alerta = (page: Page, texto: string) => page.getByRole("alert").filter({ hasText: texto });

// ---------------------------------------------------------------------------
// Criterios 1 y 2: abrir una franja y cambiarle el precio
// ---------------------------------------------------------------------------
test.describe("Criterios 1 y 2 · abrir una franja y cambiar su precio", () => {
  test("el monitor abre una franja presencial desde Mis franjas, la ve en Abiertas y le cambia el precio", async ({
    page,
    cuentas,
    escenario,
  }) => {
    const monitor = await escenario.monitorCertificado();

    // Desde su panel llega a "Mis franjas".
    await entrar(page, "/monitor", monitor);
    await page.getByRole("link", { name: "Mis franjas" }).click();
    await expect(page).toHaveURL("/monitor/franjas", ESPERA);
    await expect(page.getByRole("heading", { level: 1, name: "Mis franjas" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Abiertas (0)" })).toBeVisible();
    await expect(page.getByText("Todavía no tienes franjas abiertas.")).toBeVisible();

    // El formulario: día, hora, duración, precio con separador de miles, modalidad y lugar.
    await page.getByLabel("Día de la semana").selectOption({ label: "Martes" });
    await page.getByLabel("Hora de inicio").fill("14:00");
    await page.getByLabel("Duración (minutos)").fill("90");
    await page.getByLabel("Precio por persona (pesos)").fill("25.000");
    await page.getByRole("radio", { name: "Presencial" }).check();
    await page.getByLabel("Lugar", { exact: true }).fill("Edificio ML, salón 101");
    await page.getByRole("button", { name: "Abrir franja" }).click();

    await expect(estado(page, "Abriste la franja. Ya aparece en tu lista.")).toBeVisible(ESPERA);
    await expect(page.getByRole("heading", { level: 2, name: "Abiertas (1)" })).toBeVisible(ESPERA);
    const tarjeta = page.getByRole("link", { name: /Martes, 14:00 a 15:30/ });
    await expect(tarjeta).toBeVisible();
    await expect(tarjeta).toContainText("Presencial · Edificio ML, salón 101");
    await expect(tarjeta).toContainText(/\$\s25\.000/);

    const { data: abiertas } = await cuentas.cliente.from("franja").select("*").eq("id_monitor", monitor.id);
    expect(abiertas).toHaveLength(1);
    expect(abiertas![0]).toMatchObject({
      dia: 2,
      hora: "14:00:00",
      duracion_min: 90,
      precio: 25_000,
      presencial: true,
      lugar: "Edificio ML, salón 101",
      enlace: null,
      cerrada_desde: null,
      abierta_desde: hoy(),
    });

    // Criterio 2: abre el detalle, cambia el precio y lo guarda.
    await tarjeta.click();
    await expect(page).toHaveURL(new RegExp(`/monitor/franjas/${abiertas![0].id}$`), ESPERA);
    await expect(page.getByRole("heading", { level: 1, name: "Martes, 14:00 a 15:30" })).toBeVisible();
    await expect(page.getByText("No tiene monitorías agendadas.")).toBeVisible();
    const precio = page.getByLabel("Precio por persona (pesos)");
    await expect(precio).toHaveValue("25000");
    await precio.fill("30.000");
    await page.getByRole("button", { name: "Guardar cambios" }).click();

    await expect(estado(page, "Guardamos los cambios. Las monitorías ya agendadas conservan su precio.")).toBeVisible(ESPERA);
    const { data: guardada } = await cuentas.cliente.from("franja").select("precio, dia, hora, duracion_min").eq("id", abiertas![0].id).single();
    expect(guardada).toEqual({ precio: 30_000, dia: 2, hora: "14:00:00", duracion_min: 90 });

    // La lista ya muestra el precio nuevo.
    await page.getByRole("link", { name: "Volver a mis franjas" }).click();
    await expect(page).toHaveURL("/monitor/franjas", ESPERA);
    await expect(page.getByRole("link", { name: /Martes, 14:00 a 15:30/ })).toContainText(/\$\s30\.000/, ESPERA);
  });

  test("una franja virtual pide el enlace de la videollamada y solo lo acepta por https", async ({ page, cuentas, escenario }) => {
    const monitor = await escenario.monitorCertificado();
    await entrar(page, "/monitor/franjas", monitor);
    // La modalidad es un campo controlado por React: hay que esperar a que la página termine de hidratarse.
    await page.waitForLoadState("networkidle");

    await page.getByLabel("Día de la semana").selectOption({ label: "Jueves" });
    await page.getByLabel("Hora de inicio").fill("18:00");
    await page.getByLabel("Duración (minutos)").fill("60");
    await page.getByLabel("Precio por persona (pesos)").fill("30.000");
    await page.getByRole("radio", { name: "Virtual" }).check();
    await expect(page.getByLabel("Lugar", { exact: true })).toHaveCount(0);

    await page.getByLabel("Enlace de la videollamada").fill("http://meet.example.com/abc");
    await page.getByRole("button", { name: "Abrir franja" }).click();
    await expect(alerta(page, "Escribe el enlace de la videollamada completo, que empiece por https://.")).toBeVisible(ESPERA);
    const { data: sinFranjas } = await cuentas.cliente.from("franja").select("id").eq("id_monitor", monitor.id);
    expect(sinFranjas).toEqual([]);

    // Se conserva lo escrito: solo hay que corregir el enlace.
    await expect(page.getByLabel("Hora de inicio")).toHaveValue("18:00");
    await page.getByLabel("Enlace de la videollamada").fill("https://meet.example.com/abc-defg");
    await page.getByRole("button", { name: "Abrir franja" }).click();

    await expect(estado(page, "Abriste la franja. Ya aparece en tu lista.")).toBeVisible(ESPERA);
    const tarjeta = page.getByRole("link", { name: /Jueves, 18:00 a 19:00/ });
    await expect(tarjeta).toBeVisible(ESPERA);
    await expect(tarjeta).toContainText("Virtual");
    await expect(tarjeta).toContainText(/\$\s30\.000/);
    const { data } = await cuentas.cliente.from("franja").select("presencial, enlace, lugar").eq("id_monitor", monitor.id).single();
    expect(data).toEqual({ presencial: false, enlace: "https://meet.example.com/abc-defg", lugar: null });
  });
});

// ---------------------------------------------------------------------------
// Criterio 3: franja con monitorías futuras (P-30)
// ---------------------------------------------------------------------------
test.describe("Criterio 3 · una franja con monitorías no cambia de horario y solo se cierra después de la última", () => {
  test("el horario queda fijo, cerrar desde una fecha con monitorías se rechaza y cerrar desde el mínimo funciona", async ({
    page,
    cuentas,
    escenario,
  }) => {
    const monitor = await escenario.monitorCertificado();
    const dia = diaIso(hoy());
    const idFranja = await escenario.franja(monitor, { dia, hora: "16:00", duracionMin: 60 });
    // Mismo día de la semana que hoy: hoy + 7 es una fecha válida para la franja.
    const fecha = sumarDias(hoy(), 7);
    await escenario.agendar(monitor, idFranja, fecha);
    const minimo = sumarDias(fecha, 1);

    await entrar(page, `/monitor/franjas/${idFranja}`, monitor);
    await expect(page.getByRole("heading", { level: 1, name: `${nombreDelDia(dia)}, 16:00 a 17:00` })).toBeVisible();
    await expect(page.getByText(`Tiene 1 monitoría agendada; la última es el ${formatearDia(fecha)}.`)).toBeVisible();

    // El día, la hora y la duración no se editan: no hay campos, solo la explicación. La modalidad tampoco.
    await expect(page.getByLabel("Día de la semana")).toHaveCount(0);
    await expect(page.getByLabel("Hora de inicio")).toHaveCount(0);
    await expect(page.getByLabel("Duración (minutos)")).toHaveCount(0);
    await expect(page.getByText(/Como ya tiene monitorías, el día, la hora y la duración no se cambian/)).toBeVisible();
    await expect(page.getByRole("radio", { name: "Presencial" })).toBeDisabled();
    await expect(page.getByRole("radio", { name: "Virtual" })).toBeDisabled();
    await expect(page.getByText("Tiene monitorías agendadas: la modalidad no cambia hasta que pasen.")).toBeVisible();

    // Lo que sí se puede: el precio sigue editable y guarda sin tocar el horario.
    await page.getByLabel("Precio por persona (pesos)").fill("27.000");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(estado(page, "Guardamos los cambios.")).toBeVisible(ESPERA);
    const { data: franja } = await cuentas.cliente.from("franja").select("precio, hora, duracion_min, dia").eq("id", idFranja).single();
    expect(franja).toEqual({ precio: 27_000, hora: "16:00:00", duracion_min: 60, dia });

    // Cerrar: la fecha mínima que ofrece el formulario es el día siguiente a la última monitoría.
    const cierre = page.getByLabel("Cerrar desde");
    await expect(cierre).toHaveAttribute("min", minimo);
    await expect(cierre).toHaveValue(minimo);

    // Desde el día de la monitoría, la base lo rechaza y la franja sigue abierta. (Desde hoy también: lo cubre
    // integracion/franjas.test.ts. Aquí un solo intento, porque los dos errores dicen lo mismo y el segundo
    // se confundiría con el aviso del primero.)
    await cierre.fill(fecha);
    await page.getByRole("button", { name: "Cerrar la franja" }).click();
    await expect(alerta(page, "No puedes cerrarla desde esa fecha: tiene monitorías agendadas ese día o después.")).toBeVisible(ESPERA);
    await expect(page).toHaveURL(new RegExp(`/monitor/franjas/${idFranja}$`));
    const { data: abierta } = await cuentas.cliente.from("franja").select("cerrada_desde").eq("id", idFranja).single();
    expect(abierta).toEqual({ cerrada_desde: null });

    // Desde el mínimo sí: vuelve a la lista con el aviso y la franja queda marcada como que se cierra.
    await cierre.fill(minimo);
    await page.getByRole("button", { name: "Cerrar la franja" }).click();
    await expect(page).toHaveURL("/monitor/franjas?cerrada=1", ESPERA);
    await expect(estado(page, "Cerraste la franja. Las monitorías que ya tenía se mantienen.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Abiertas (1)" })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(`${nombreDelDia(dia)}, 16:00 a 17:00`) })).toContainText(
      `Se cierra desde el ${formatearDia(minimo)}`,
    );

    const { data: cerrada } = await cuentas.cliente.from("franja").select("cerrada_desde").eq("id", idFranja).single();
    expect(cerrada).toEqual({ cerrada_desde: minimo });
    const { data: monitorias } = await cuentas.cliente.from("monitoria").select("fecha, estado").eq("id_franja", idFranja);
    expect(monitorias).toEqual([{ fecha, estado: "confirmada" }]);
  });
});

// ---------------------------------------------------------------------------
// Criterio 4: sin certificado no hay franjas
// ---------------------------------------------------------------------------
test.describe("Criterio 4 · un monitor sin certificados no abre franjas", () => {
  test("el panel no ofrece Mis franjas y la página explica que hace falta un certificado, sin formulario", async ({
    page,
    cuentas,
  }) => {
    const monitor = await cuentas.crearMonitor();

    await entrar(page, "/monitor", monitor);
    await expect(page.getByText("Aún no tienes materias certificadas")).toBeVisible();
    await expect(page.getByRole("link", { name: "Mis franjas" })).toHaveCount(0);

    // Aunque llegue a la página por la dirección, no hay cómo abrir una franja.
    await page.goto("/monitor/franjas");
    await expect(page.getByRole("heading", { level: 1, name: "Mis franjas" })).toBeVisible(ESPERA);
    await expect(page.getByRole("heading", { level: 2, name: "Abiertas (0)" })).toBeVisible();
    await expect(
      page.getByText("Para abrir franjas necesitas al menos un certificado. Un admin te certifica después de tu evaluación presencial."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir franja" })).toHaveCount(0);
    await expect(page.getByLabel("Hora de inicio")).toHaveCount(0);
    await expect(page.getByLabel("Precio por persona (pesos)")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Cada monitor ve solo sus franjas
// ---------------------------------------------------------------------------
test.describe("Las franjas son de cada monitor", () => {
  test("otro monitor no las ve en su lista y el detalle de una ajena da 404", async ({ page, escenario }) => {
    const dueno = await escenario.monitorCertificado();
    const otro = await escenario.monitorCertificado();
    const ajena = await escenario.franja(dueno, { dia: 3, hora: "09:00" });

    await entrar(page, "/monitor/franjas", otro);
    await expect(page.getByRole("heading", { level: 2, name: "Abiertas (0)" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Miércoles/ })).toHaveCount(0);

    const respuesta = await page.goto(`/monitor/franjas/${ajena}`);
    expect(respuesta?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "No encontramos esta página" })).toBeVisible();
    await expect(page.getByLabel("Precio por persona (pesos)")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cerrar la franja" })).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Accesibilidad del producto
// ---------------------------------------------------------------------------
test.describe("Accesibilidad", () => {
  test("la lista y el detalle respetan las reglas de accesibilidad del producto", async ({ page, escenario }) => {
    const monitor = await escenario.monitorCertificado();
    const dia = diaIso(hoy());
    const idFranja = await escenario.franja(monitor, { dia, hora: "16:00" });
    await escenario.agendar(monitor, idFranja, sumarDias(hoy(), 7));

    await entrar(page, "/monitor/franjas", monitor);
    await expect(page.getByRole("heading", { level: 2, name: "Abiertas (1)" })).toBeVisible();
    const lista = await medir(page);

    await page.getByRole("link", { name: new RegExp(nombreDelDia(dia)) }).click();
    await expect(page).toHaveURL(new RegExp(`/monitor/franjas/${idFranja}$`), ESPERA);
    await expect(page.getByRole("heading", { level: 2, name: "Cerrar" })).toBeVisible();
    const detalle = await medir(page);

    for (const [pagina, medidas] of [
      ["lista", lista],
      ["detalle", detalle],
    ] as const) {
      expect(medidas.sinScrollHorizontal, `${pagina}: sin scroll horizontal`).toBe(true);
      expect(medidas.menorTexto, `${pagina}: ningún texto por debajo de 14 px`).toBeGreaterThanOrEqual(14);
      expect(medidas.degradados, `${pagina}: sin degradados`).toBe(0);
      expect(medidas.tactilesChicos, `${pagina}: áreas táctiles de 44 px o más`).toEqual([]);
      expect(medidas.controlesSinNombre, `${pagina}: todo control tiene nombre`).toEqual([]);
    }
  });
});

/** Las reglas del producto sobre la página abierta: texto, áreas táctiles, degradados y nombres. */
async function medir(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const caja = el.getBoundingClientRect();
      return caja.width > 0 && caja.height > 0;
    };
    const conTexto = [...document.body.querySelectorAll<HTMLElement>("*")].filter((el) =>
      [...el.childNodes].some((nodo) => nodo.nodeType === Node.TEXT_NODE && nodo.textContent?.trim()),
    );
    // Enlaces, botones y campos; de los radios cuenta su etiqueta, que es lo que se toca.
    const tocables = [
      ...document.querySelectorAll<HTMLElement>("a, button, select, input:not([type=hidden]):not([type=radio]), label:has(input[type=radio])"),
    ].filter(visible);
    const controles = [...document.querySelectorAll<HTMLElement>("a, button, select, input:not([type=hidden])")].filter(visible);
    return {
      sinScrollHorizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      menorTexto: Math.min(...conTexto.map((el) => parseFloat(getComputedStyle(el).fontSize))),
      degradados: [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el).backgroundImage.includes("gradient")).length,
      tactilesChicos: tocables
        .map((el) => ({ texto: (el.textContent || el.id || el.tagName).trim().slice(0, 40), alto: Math.round(el.getBoundingClientRect().height) }))
        .filter((el) => el.alto < 44),
      controlesSinNombre: controles
        .filter((el) => {
          const etiqueta = (el as HTMLInputElement).labels?.length ?? 0;
          return !(el.textContent?.trim() || el.getAttribute("aria-label") || etiqueta);
        })
        .map((el) => el.outerHTML.slice(0, 80)),
    };
  });
}
