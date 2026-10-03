import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { diaDelNegocio, formatearDiaConSemana } from "../src/lib/fechas";
import { formatearPesos } from "../src/lib/moneda";
import { esperarSesion, expect, test as base, type Cuenta } from "./utilidades";

// HU-016: los monitores certificados de una materia y sus fechas libres, en /monitores. Corre contra el Supabase
// local con materias, monitores y franjas que crea y borra cada prueba. Las pruebas corren en paralelo: solo se
// afirma sobre lo propio (materias con código único), nunca sobre el total de la lista.
// La mayoría no necesita sesión: bloquean el alta anónima para no gastar el cupo por IP de Supabase Auth.

const ESPERA = { timeout: 20_000 };

const hoy = () => diaDelNegocio(new Date());

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function diaIso(fecha: string): number {
  const dia = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  return dia === 0 ? 7 : dia;
}

type Materia = { id: string; nombre: string; codigo: string };
type Franja = { id: string };
type Contacto = { telefono: string; llave: string };

type Escenario = {
  materia(): Promise<Materia>;
  /** Un monitor con teléfono, correo y llave únicos (monitor_privado). */
  monitor(): Promise<Cuenta & Contacto>;
  certificar(idMonitor: string, idMateria: string): Promise<void>;
  /** Franja semanal que abre hoy, en el día de `fecha`, a las 10:00, presencial, con un lugar único. */
  franja(idMonitor: string, fecha: string, datos?: { precio?: number; duracionMin?: number; presencial?: boolean }): Promise<Franja & { lugar: string }>;
  /** Una monitoría de esa franja y fecha (ocupa la fecha si no está cancelada). */
  agendar(franja: Franja, idMonitor: string, idMateria: string, fecha: string, estado: "confirmada" | "cancelada"): Promise<void>;
};

const test = base.extend<{ escenario: Escenario }>({
  escenario: async ({ cuentas }, entregar) => {
    const cliente = cuentas.cliente;
    const admin = await cuentas.crearAdmin();
    const creados = { materias: [] as string[], franjas: [] as string[], monitorias: [] as string[], leads: [] as string[], monitores: [] as string[] };

    await entregar({
      async materia() {
        const nombre = `Materia e2e monitores ${randomUUID().slice(0, 6)}`;
        const codigo = `E2E-${randomUUID().slice(0, 12)}`;
        const { data, error } = await cliente.from("materia").insert({ nombre, codigo }).select("id").single();
        if (error) throw new Error(`insertar materia: ${error.message}`);
        creados.materias.push(data.id as string);
        return { id: data.id as string, nombre, codigo };
      },
      async monitor() {
        const monitor = await cuentas.crearMonitor();
        creados.monitores.push(monitor.id);
        const contacto = { telefono: `300${Math.floor(1_000_000 + Math.random() * 8_999_999)}`, llave: `llave-${randomUUID()}` };
        // La fixture ya le crea `monitor_privado`: se cambia por este contacto, único en la prueba.
        const { error } = await cliente
          .from("monitor_privado")
          .upsert({ id_monitor: monitor.id, numero_telefono: contacto.telefono, correo: monitor.correo, llave: contacto.llave });
        if (error) throw new Error(`guardar monitor_privado: ${error.message}`);
        return { ...monitor, ...contacto };
      },
      async certificar(idMonitor, idMateria) {
        const { error } = await cliente.from("certificado").insert({ id_monitor: idMonitor, id_materia: idMateria, id_admin: admin.id });
        if (error) throw new Error(`insertar certificado: ${error.message}`);
      },
      async franja(idMonitor, fecha, datos = {}) {
        const presencial = datos.presencial ?? true;
        const lugar = `Salón secreto ${randomUUID().slice(0, 8)}`;
        const { data, error } = await cliente
          .from("franja")
          .insert({
            id_monitor: idMonitor,
            dia: diaIso(fecha),
            hora: "10:00",
            duracion_min: datos.duracionMin ?? 60,
            presencial,
            precio: datos.precio ?? 25_000,
            lugar: presencial ? lugar : null,
            enlace: presencial ? null : `https://meet.example/${randomUUID()}`,
          })
          .select("id")
          .single();
        if (error) throw new Error(`insertar franja: ${error.message}`);
        creados.franjas.push(data.id as string);
        return { id: data.id as string, lugar };
      },
      async agendar(franja, idMonitor, idMateria, fecha, estado) {
        const { data: lead, error: errorLead } = await cliente
          .from("lead")
          .insert({ nombre: "Lead e2e", correo: `lead-${randomUUID()}@calibra.test`, acepta_tratamiento_datos: true, fecha_consentimiento: new Date().toISOString() })
          .select("id")
          .single();
        if (errorLead) throw new Error(`insertar lead: ${errorLead.message}`);
        creados.leads.push(lead.id as string);
        const { data, error } = await cliente
          .from("monitoria")
          .insert({
            id_franja: franja.id,
            id_monitor: idMonitor,
            id_materia: idMateria,
            id_lead: lead.id,
            fecha,
            valor_total: 25_000,
            estado,
            motivo_cancelacion: estado === "cancelada" ? "estudiante" : null,
          })
          .select("id")
          .single();
        if (error) throw new Error(`insertar monitoria: ${error.message}`);
        creados.monitorias.push(data.id as string);
      },
    });

    // Limpieza en orden, antes de que `cuentas` borre a los monitores y al admin.
    const fallos: string[] = [];
    const borrar = async (contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await consulta;
      if (error) fallos.push(`${contexto}: ${error.message}`);
    };
    if (creados.monitorias.length) await borrar("monitorías", cliente.from("monitoria").delete().in("id", creados.monitorias));
    if (creados.leads.length) await borrar("leads", cliente.from("lead").delete().in("id", creados.leads));
    if (creados.franjas.length) await borrar("franjas", cliente.from("franja").delete().in("id", creados.franjas));
    await borrar("certificados", cliente.from("certificado").delete().eq("id_admin", admin.id));
    if (creados.materias.length) await borrar("materias", cliente.from("materia").delete().in("id", creados.materias));
    if (fallos.length) throw new Error(`No se pudo limpiar lo que creó la prueba:\n${fallos.join("\n")}`);
  },
});

test.describe.configure({ mode: "default", timeout: 90_000 });

/** Sin alta anónima: estas pruebas no necesitan sesión y así no gastan el cupo por IP de Supabase Auth. */
async function sinSesionAnonima(page: Page) {
  await page.route("**/auth/v1/signup", (ruta) => ruta.abort());
}

const tarjetaDe = (page: Page, nombre: string) => page.getByRole("region", { name: nombre });
// Next tiene su propio role="alert" (el anunciador de rutas): se busca por el texto.
const alerta = (page: Page, texto: string) => page.getByRole("alert").filter({ hasText: texto });

test.describe("Criterios 1, 2 y 4 · la lista de una materia", () => {
  test("sin sesión, el enlace con la materia muestra solo a sus certificados, sus fechas libres con hora, duración, modalidad y precio, y nada privado", async ({
    page,
    escenario,
  }) => {
    await sinSesionAnonima(page);
    const materia = await escenario.materia();
    const otraMateria = await escenario.materia();
    const certificado = await escenario.monitor();
    const deOtraMateria = await escenario.monitor();
    await escenario.certificar(certificado.id, materia.id);
    await escenario.certificar(deOtraMateria.id, otraMateria.id);
    // Dentro de 2 días o más: la antelación de 3 h no depende de la hora en que corre la prueba.
    const primera = sumarDias(hoy(), 2);
    const franja = await escenario.franja(certificado.id, primera, { precio: 32_000, duracionMin: 90 });
    await escenario.franja(deOtraMateria.id, primera);
    // RN-33: la segunda fecha está ocupada; la tercera tuvo una monitoría cancelada y sigue libre.
    await escenario.agendar(franja, certificado.id, materia.id, sumarDias(primera, 7), "confirmada");
    await escenario.agendar(franja, certificado.id, materia.id, sumarDias(primera, 14), "cancelada");

    await page.goto(`/monitores?materia=${encodeURIComponent(materia.codigo)}`);

    await expect(page).toHaveTitle("Monitores certificados · Calibra");
    await expect(page.getByRole("heading", { level: 1, name: `Monitores de ${materia.nombre}` })).toBeVisible(ESPERA);
    await expect(tarjetaDe(page, deOtraMateria.nombre)).toHaveCount(0);
    const tarjeta = tarjetaDe(page, certificado.nombre);
    await expect(tarjeta).toBeVisible();
    const fechas = tarjeta.getByRole("listitem");
    await expect(fechas).toHaveCount(3);
    for (const [i, fecha] of [primera, sumarDias(primera, 14), sumarDias(primera, 21)].entries()) {
      await expect(fechas.nth(i)).toContainText(formatearDiaConSemana(fecha));
      await expect(fechas.nth(i)).toContainText(`10:00 a 11:30 (90 min) · Presencial · ${formatearPesos(32_000)}`);
      await expect(fechas.nth(i).locator("time")).toHaveAttribute("datetime", fecha);
    }
    await expect(tarjeta).not.toContainText(formatearDiaConSemana(sumarDias(primera, 7)));

    // Criterio 4 y D-5: ni el teléfono, el correo o la llave del monitor, ni el lugar de la franja.
    const html = await page.content();
    for (const secreto of [certificado.telefono, certificado.correo, certificado.llave, franja.lugar]) {
      expect(html).not.toContain(secreto);
    }
  });

  test("las listas vacías lo dicen: una materia sin certificados y una con certificados pero sin fechas libres", async ({ page, escenario }) => {
    await sinSesionAnonima(page);
    const sinCertificados = await escenario.materia();
    const sinFechas = await escenario.materia();
    const monitor = await escenario.monitor();
    await escenario.certificar(monitor.id, sinFechas.id);

    await page.goto(`/monitores?materia=${encodeURIComponent(sinCertificados.codigo)}`);
    await expect(page.getByRole("status")).toHaveText("Todavía no hay monitores certificados en esta materia. Vuelve pronto o elige otra.", ESPERA);

    await page.goto(`/monitores?materia=${encodeURIComponent(sinFechas.codigo)}`);
    await expect(page.getByRole("status")).toContainText("no tienen fechas libres en las próximas 4 semanas", ESPERA);
    await expect(tarjetaDe(page, monitor.nombre)).toHaveCount(0);

    // Desde ahí se cambia de materia.
    await page.getByRole("link", { name: "Cambiar de materia" }).click();
    await expect(page).toHaveURL("/monitores", ESPERA);
  });
});

test.describe("Criterio 3 · sin materia en el enlace, el visitante la elige (D-3)", () => {
  test("desde el inicio llega a elegir materia; ve la suya y no una sin monitores; al tocarla ve su lista; una desconocida lo dice", async ({
    page,
    escenario,
  }) => {
    await sinSesionAnonima(page);
    const materia = await escenario.materia();
    const vacia = await escenario.materia();
    const monitor = await escenario.monitor();
    await escenario.certificar(monitor.id, materia.id);
    await escenario.franja(monitor.id, sumarDias(hoy(), 3));

    await page.goto("/");
    await page.getByRole("link", { name: "Ver monitores certificados" }).click();
    await expect(page).toHaveURL("/monitores", ESPERA);
    await expect(page.getByRole("heading", { level: 1, name: "Elige tu materia" })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(vacia.nombre) })).toHaveCount(0);

    await page.getByRole("link", { name: new RegExp(materia.nombre) }).click();
    await expect(page).toHaveURL(`/monitores?materia=${encodeURIComponent(materia.codigo)}`, ESPERA);
    await expect(page.getByRole("heading", { level: 1, name: `Monitores de ${materia.nombre}` })).toBeVisible();
    await expect(tarjetaDe(page, monitor.nombre)).toBeVisible();

    await page.goto(`/monitores?materia=${"X".repeat(60)}`);
    await expect(alerta(page, "No encontramos esa materia")).toHaveText("No encontramos esa materia. Elige una de la lista.", ESPERA);
    await page.goto("/monitores?materia=NO-EXISTE-E2E");
    await expect(alerta(page, "No encontramos esa materia")).toHaveText("No encontramos esa materia. Elige una de la lista.", ESPERA);
    await expect(page.getByRole("heading", { level: 1, name: "Elige tu materia" })).toBeVisible();
  });

  test("con la sesión anónima que nace en el navegador, la lista es la misma", async ({ page, context, escenario, cuentas }) => {
    const materia = await escenario.materia();
    const monitor = await escenario.monitor();
    await escenario.certificar(monitor.id, materia.id);
    await escenario.franja(monitor.id, sumarDias(hoy(), 2));
    const ruta = `/monitores?materia=${encodeURIComponent(materia.codigo)}`;

    // Primera visita, sin cookie: la página corre como anon. Luego nace la sesión anónima y se recarga.
    await page.goto(ruta);
    const antes = await tarjetaDe(page, monitor.nombre).innerText();
    const sesion = await esperarSesion(context);
    cuentas.borrarAlFinal(sesion.id);
    await page.reload();
    await expect(tarjetaDe(page, monitor.nombre)).toBeVisible(ESPERA);
    expect(await tarjetaDe(page, monitor.nombre).innerText()).toBe(antes);
  });
});

test.describe("Accesibilidad", () => {
  test("elegir materia y la lista respetan las reglas de accesibilidad del producto", async ({ page, escenario }) => {
    await sinSesionAnonima(page);
    const materia = await escenario.materia();
    const monitor = await escenario.monitor();
    await escenario.certificar(monitor.id, materia.id);
    await escenario.franja(monitor.id, sumarDias(hoy(), 2));
    // Una segunda franja para que haya más de 6 fechas y se vea "Ver N fechas más".
    await escenario.franja(monitor.id, sumarDias(hoy(), 3), { presencial: false });

    for (const ruta of ["/monitores", `/monitores?materia=${encodeURIComponent(materia.codigo)}`]) {
      await page.goto(ruta);
      await page.waitForLoadState("networkidle");
      const medidas = await medir(page);
      expect(medidas.sinScrollHorizontal, `${ruta}: sin scroll horizontal`).toBe(true);
      expect(medidas.menorTexto, `${ruta}: ningún texto por debajo de 14 px`).toBeGreaterThanOrEqual(14);
      expect(medidas.degradados, `${ruta}: sin degradados`).toBe(0);
      expect(medidas.tactilesChicos, `${ruta}: áreas táctiles de 44 px o más`).toEqual([]);
      expect(medidas.controlesSinNombre, `${ruta}: todo control tiene nombre`).toEqual([]);
    }
    // Las fechas de más quedan en "Ver N fechas más" y se ven al abrirlo.
    const tarjeta = tarjetaDe(page, monitor.nombre);
    const resumen = tarjeta.getByText(/^Ver \d+ fechas? más$/);
    const extra = Number((await resumen.innerText()).match(/\d+/)![0]);
    await expect(tarjeta.getByRole("listitem").filter({ visible: true })).toHaveCount(6);
    await resumen.click();
    await expect(tarjeta.getByRole("listitem").filter({ visible: true })).toHaveCount(6 + extra);
  });
});

/** Las reglas del producto sobre la página abierta: texto, áreas táctiles, degradados y nombres (como en franjas.spec.ts). */
async function medir(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const caja = el.getBoundingClientRect();
      return caja.width > 0 && caja.height > 0;
    };
    const conTexto = [...document.body.querySelectorAll<HTMLElement>("*")].filter((el) =>
      [...el.childNodes].some((nodo) => nodo.nodeType === Node.TEXT_NODE && nodo.textContent?.trim()),
    );
    // Enlaces, botones, campos y el resumen de "Ver N fechas más".
    const tocables = [...document.querySelectorAll<HTMLElement>("a, button, select, summary, input:not([type=hidden])")].filter(visible);
    return {
      sinScrollHorizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      menorTexto: Math.min(...conTexto.map((el) => parseFloat(getComputedStyle(el).fontSize))),
      degradados: [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el).backgroundImage.includes("gradient")).length,
      tactilesChicos: tocables
        .map((el) => ({ texto: (el.textContent || el.id || el.tagName).trim().slice(0, 40), alto: Math.round(el.getBoundingClientRect().height) }))
        .filter((el) => el.alto < 44),
      controlesSinNombre: tocables
        .filter((el) => {
          const etiqueta = (el as HTMLInputElement).labels?.length ?? 0;
          return !(el.textContent?.trim() || el.getAttribute("aria-label") || etiqueta);
        })
        .map((el) => el.outerHTML.slice(0, 80)),
    };
  });
}
