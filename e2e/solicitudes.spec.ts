import { randomInt, randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { enviarCredenciales, expect, test as base, type Cuenta } from "./utilidades";

// HU-062: quien quiere ser monitor deja sus datos desde "Quiero ser monitor", y el admin ve la solicitud y la
// marca. Corre contra el Supabase local con materias, solicitudes y cuentas que crea y borra cada prueba. La
// lista de solicitudes es de todos los admins: de ella solo se comprueba que aparezca la propia. Los teléfonos
// van al azar: las pruebas corren en paralelo y la base devuelve la solicitud abierta con el mismo teléfono.

const ESPERA = { timeout: 20_000 };

type Escenario = {
  /** Una materia con nombre único, para reconocerla entre las demás. */
  materia(): Promise<{ id: string; nombre: string }>;
  /** Un correo único, que la limpieza usa para borrar la solicitud. */
  correo(): string;
  /** Un celular al azar: como lo escribe la persona y como lo guarda la base. */
  telefono(): { escrito: string; guardado: string };
  /** Una solicitud creada como la crea el servidor. */
  solicitud(datos: { nombre: string; correo: string; telefono: string; materias: string[] }): Promise<string>;
  /** Lo que la base guardó con ese correo. */
  guardadas(correo: string): Promise<{ estado: string; numero_telefono: string; id_admin_actualizo: string | null }[]>;
};

const test = base.extend<{ escenario: Escenario }>({
  escenario: async ({ cuentas }, entregar) => {
    const cliente = cuentas.cliente;
    const materias: string[] = [];
    const correos: string[] = [];

    await entregar({
      async materia() {
        const nombre = `Materia e2e aspirantes ${randomUUID().slice(0, 6)}`;
        const { data, error } = await cliente.from("materia").insert({ nombre, codigo: `E2E-${randomUUID().slice(0, 12)}` }).select("id").single();
        if (error) throw new Error(`crear materia: ${error.message}`);
        materias.push(data.id);
        return { id: data.id, nombre };
      },
      correo() {
        const correo = `aspirante-e2e-${randomUUID()}@calibra.test`;
        correos.push(correo);
        return correo;
      },
      telefono() {
        const cifras = `3${String(randomInt(0, 1_000_000_000)).padStart(9, "0")}`;
        return { escrito: `${cifras.slice(0, 3)} ${cifras.slice(3, 6)} ${cifras.slice(6)}`, guardado: `+57${cifras}` };
      },
      async solicitud({ nombre, correo, telefono, materias: ids }) {
        const { data, error } = await cliente.rpc("crear_solicitud_monitor", {
          p_nombre: nombre,
          p_correo: correo,
          p_numero_telefono: telefono,
          p_materias: ids,
          p_fecha_consentimiento: new Date().toISOString(),
        });
        if (error) throw new Error(`crear solicitud: ${error.message}`);
        return data as string;
      },
      async guardadas(correo) {
        const { data, error } = await cliente.from("solicitud_monitor").select("estado, numero_telefono, id_admin_actualizo").eq("correo", correo);
        if (error) throw new Error(`leer solicitudes: ${error.message}`);
        return data ?? [];
      },
    });

    // Las solicitudes antes que las materias, por la llave foránea de sus materias.
    const fallos: string[] = [];
    if (correos.length) {
      const { error } = await cliente.from("solicitud_monitor").delete().in("correo", correos);
      if (error) fallos.push(`solicitud_monitor: ${error.message}`);
    }
    if (materias.length) {
      const { error } = await cliente.from("materia").delete().in("id", materias);
      if (error) fallos.push(`materia: ${error.message}`);
    }
    if (fallos.length) throw new Error(`No se pudo limpiar lo que creó la prueba:\n${fallos.join("\n")}`);
  },
});

test.describe.configure({ mode: "default", timeout: 90_000 });

/** La lista del admin siempre lleva el número de página: sin él, la página redirige a la que corresponde. */
const LISTA = /\/admin\/solicitudes\?pagina=\d+$/;

async function entrar(page: Page, ruta: string, cuenta: Cuenta, destino: string | RegExp = ruta): Promise<void> {
  await page.goto(ruta);
  await expect(page).toHaveURL(`/ingresar?siguiente=${encodeURIComponent(ruta)}`, ESPERA);
  await enviarCredenciales(page, cuenta.correo, cuenta.contrasena);
  await expect(page).toHaveURL(destino, ESPERA);
}

test.describe("Criterios 1 a 3 · el aspirante deja sus datos", () => {
  test("llega desde el pie, el formulario no guarda nada incompleto y, completo, confirma que lo contactarán", async ({ page, escenario }) => {
    const materia = await escenario.materia();
    const correo = escenario.correo();
    const telefono = escenario.telefono();
    const errores: string[] = [];
    page.on("pageerror", (error) => errores.push(error.message));

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("contentinfo").getByRole("link", { name: "Quiero ser monitor" }).click();
    await expect(page).toHaveURL(/\/quiero-ser-monitor$/, ESPERA);
    await expect(page).toHaveTitle("Quiero ser monitor · Calibra");
    await expect(page.getByRole("heading", { level: 1, name: "Quiero ser monitor" })).toBeVisible();

    // La autorización viene desmarcada y enlaza al aviso de privacidad.
    const autorizacion = page.getByRole("checkbox", { name: /Autorizo a Calibra a tratar mis datos personales para contactarme/ });
    await expect(autorizacion).not.toBeChecked();
    await expect(page.getByRole("link", { name: /aviso de privacidad/ })).toHaveAttribute("href", "/privacidad");

    // Sin autorización no se guarda nada.
    await page.getByLabel("Tu nombre").fill("Ana Aspirante e2e");
    await page.getByLabel("Tu teléfono").fill(telefono.escrito);
    await page.getByLabel("Tu correo").fill(correo);
    await page.getByRole("checkbox", { name: materia.nombre }).check();
    await page.getByRole("button", { name: "Enviar solicitud" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "necesitamos tu autorización" })).toBeVisible(ESPERA);
    expect(await escenario.guardadas(correo)).toEqual([]);
    // Lo escrito sigue ahí.
    await expect(page.getByLabel("Tu nombre")).toHaveValue("Ana Aspirante e2e");
    await expect(page.getByRole("checkbox", { name: materia.nombre })).toBeChecked();

    // Con la autorización marcada y un correo que no sirve: el error no le desmarca la autorización.
    await autorizacion.check();
    await page.getByLabel("Tu correo").fill("ana@calibra.test?bcc=otro@calibra.test");
    await page.getByRole("button", { name: "Enviar solicitud" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Escribe un correo válido" })).toBeVisible(ESPERA);
    expect(await escenario.guardadas(correo)).toEqual([]);
    await expect(autorizacion).toBeChecked();

    // Completo: queda guardada y la persona ve que la contactarán para la evaluación presencial.
    await page.getByLabel("Tu correo").fill(correo);
    await page.getByRole("button", { name: "Enviar solicitud" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Recibimos tu solicitud" })).toBeVisible(ESPERA);
    await expect(page.getByText("para agendar tu evaluación presencial")).toBeVisible();
    expect(await escenario.guardadas(correo)).toEqual([{ estado: "nueva", numero_telefono: telefono.guardado, id_admin_actualizo: null }]);
    expect(errores).toEqual([]);
  });

  test("respeta las reglas de accesibilidad del producto", async ({ page, escenario }) => {
    await escenario.materia();
    await page.goto("/quiero-ser-monitor");
    await expect(page.getByRole("button", { name: "Enviar solicitud" })).toBeVisible();

    const medidas = await page.evaluate(() => {
      const conTexto = [...document.body.querySelectorAll<HTMLElement>("*")].filter((el) =>
        [...el.childNodes].some((nodo) => nodo.nodeType === Node.TEXT_NODE && nodo.textContent?.trim()),
      );
      return {
        sinScrollHorizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        menorTexto: Math.min(...conTexto.map((el) => parseFloat(getComputedStyle(el).fontSize))),
        degradados: [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el).backgroundImage.includes("gradient")).length,
      };
    });
    expect(medidas.sinScrollHorizontal).toBe(true);
    expect(medidas.menorTexto).toBeGreaterThanOrEqual(14);
    expect(medidas.degradados).toBe(0);

    // El campo trampa no existe para un lector de pantalla ni para el teclado.
    await expect(page.getByRole("textbox", { name: "Sitio web" })).toHaveCount(0);
    await expect(page.locator("input[name=sitio_web]")).toHaveAttribute("tabindex", "-1");

    // Áreas táctiles: campos, botón y la fila de cada casilla (la etiqueta también la marca). El campo trampa no cuenta.
    const objetivos = "main input:not([type=checkbox]):not([type=hidden]):not([aria-hidden=true] *), main button, main fieldset label";
    for (const objetivo of await page.locator(objetivos).all()) {
      const caja = await objetivo.boundingBox();
      expect(caja?.height ?? 0, await objetivo.evaluate((el) => el.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("Criterio 4 · el admin ve las solicitudes y las marca", () => {
  test("ve la solicitud con sus datos y la marca contactada a su nombre", async ({ page, cuentas, escenario }) => {
    const materia = await escenario.materia();
    const correo = escenario.correo();
    const nombre = `Aspirante e2e ${randomUUID().slice(0, 6)}`;
    const { guardado: telefono } = escenario.telefono();
    await escenario.solicitud({ nombre, correo, telefono, materias: [materia.id] });
    const admin = await cuentas.crearAdmin();

    await entrar(page, "/admin/solicitudes", admin, LISTA);
    await expect(page.getByRole("heading", { level: 1, name: "Solicitudes para ser monitor" })).toBeVisible();
    const tarjeta = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: nombre }) });
    await expect(tarjeta).toBeVisible(ESPERA);
    await expect(tarjeta.getByText("Nueva", { exact: true })).toBeVisible();
    await expect(tarjeta.getByText(materia.nombre)).toBeVisible();
    await expect(tarjeta.getByRole("link", { name: correo })).toHaveAttribute("href", `mailto:${correo}`);
    await expect(tarjeta.getByRole("link", { name: telefono })).toHaveAttribute("href", `tel:${telefono}`);
    // Los tres cambios están, y ninguno marcado: sigue nueva.
    const contactada = tarjeta.getByRole("button", { name: "Marcar contactada" });
    for (const accion of ["Marcar contactada", "Marcar evaluada", "Descartar"]) {
      await expect(tarjeta.getByRole("button", { name: accion })).toHaveAttribute("aria-pressed", "false");
    }

    await contactada.click();
    await expect(tarjeta.getByText("Contactada", { exact: true })).toBeVisible(ESPERA);
    // Se anuncia el cambio, el botón queda marcado y el foco sigue en él.
    await expect(tarjeta.getByRole("status")).toHaveText("Quedó como contactada.");
    await expect(contactada).toHaveAttribute("aria-pressed", "true");
    await expect(contactada).toBeFocused();
    expect(await escenario.guardadas(correo)).toEqual([{ estado: "contactada", numero_telefono: telefono, id_admin_actualizo: admin.id }]);

    // Descartada se cierra, pero la tarjeta no salta de lugar: el foco y el aviso siguen ahí.
    const descartar = tarjeta.getByRole("button", { name: "Descartar" });
    await descartar.click();
    await expect(tarjeta.getByText("Descartada", { exact: true })).toBeVisible(ESPERA);
    await expect(tarjeta.getByRole("status")).toHaveText("Quedó como descartada.");
    await expect(descartar).toHaveAttribute("aria-pressed", "true");
    await expect(contactada).toHaveAttribute("aria-pressed", "false");
    await expect(descartar).toBeFocused();
    expect(await escenario.guardadas(correo)).toEqual([{ estado: "descartada", numero_telefono: telefono, id_admin_actualizo: admin.id }]);

    // Al volver con Atrás se ve el estado nuevo, no el de antes del cambio.
    await page.getByRole("link", { name: "Volver a mi bandeja" }).click();
    await expect(page).toHaveURL("/admin", ESPERA);
    await page.goBack();
    await expect(page).toHaveURL(LISTA, ESPERA);
    await expect(tarjeta.getByText("Descartada", { exact: true })).toBeVisible(ESPERA);
    await expect(descartar).toHaveAttribute("aria-pressed", "true");
  });

  test("se llega desde la bandeja del admin", async ({ page, cuentas }) => {
    const admin = await cuentas.crearAdmin();
    await entrar(page, "/admin", admin);
    await page.getByRole("link", { name: "Solicitudes para ser monitor" }).click();
    await expect(page).toHaveURL(LISTA, ESPERA);
    await expect(page.getByRole("heading", { level: 1, name: "Solicitudes para ser monitor" })).toBeVisible();
  });
});

test.describe("Criterio 5 · nadie más ve las solicitudes", () => {
  test("un monitor que abre la página no llega a la lista", async ({ page, cuentas }) => {
    const monitor = await cuentas.crearMonitor();
    await page.goto("/admin/solicitudes");
    await expect(page).toHaveURL("/ingresar?siguiente=%2Fadmin%2Fsolicitudes", ESPERA);
    await enviarCredenciales(page, monitor.correo, monitor.contrasena);
    await expect(page).toHaveURL("/monitor", ESPERA);

    // Ya con su sesión, la página lo devuelve a su panel.
    await page.goto("/admin/solicitudes");
    await expect(page).toHaveURL("/monitor", ESPERA);
    await expect(page.getByRole("heading", { name: "Solicitudes para ser monitor" })).toHaveCount(0);
  });
});
