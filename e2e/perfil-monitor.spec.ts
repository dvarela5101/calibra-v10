import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { diaDelNegocio } from "../src/lib/fechas";
import { MENSAJE_CONTACTO, MENSAJES } from "../src/lib/monitores/perfil";
import { enviarCredenciales, expect, test as base, type Cuenta } from "./utilidades";

// HU-049: el monitor llena su perfil en /monitor/perfil y un visitante lo ve en su tarjeta de /monitores. Corre contra
// el Supabase local con una materia, un monitor certificado y una franja que crea y borra cada prueba. La fila de
// perfil_monitor se crea como la crearía registrar_monitor (HU-013), igual que en e2e/monitores.spec.ts.

const ESPERA = { timeout: 20_000 };
const RUTA = "/monitor/perfil";

function fechaEnDias(dias: number): string {
  const d = new Date(`${diaDelNegocio(new Date())}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

type Escenario = { monitor: Cuenta; codigo: string };

const test = base.extend<{ escenario: Escenario }>({
  escenario: async ({ cuentas }, entregar) => {
    const cliente = cuentas.cliente;
    const admin = await cuentas.crearAdmin();
    const monitor = await cuentas.crearMonitor();
    const codigo = `E2E-${randomUUID().slice(0, 12)}`;
    const { data: materia, error: errorMateria } = await cliente
      .from("materia")
      .insert({ nombre: `Materia e2e perfil ${codigo.slice(4, 10)}`, codigo })
      .select("id")
      .single();
    if (errorMateria) throw new Error(`insertar materia: ${errorMateria.message}`);
    const { error: errorPerfil } = await cliente.from("perfil_monitor").insert({ id_monitor: monitor.id });
    if (errorPerfil) throw new Error(`insertar perfil: ${errorPerfil.message}`);
    const { error: errorCertificado } = await cliente
      .from("certificado")
      .insert({ id_monitor: monitor.id, id_materia: materia.id, id_admin: admin.id });
    if (errorCertificado) throw new Error(`insertar certificado: ${errorCertificado.message}`);
    // Dentro de 2 días: la antelación de 3 h no depende de la hora en que corre la prueba.
    const fecha = fechaEnDias(2);
    const dia = new Date(`${fecha}T12:00:00Z`).getUTCDay() || 7;
    const { data: franja, error: errorFranja } = await cliente
      .from("franja")
      .insert({ id_monitor: monitor.id, dia, hora: "10:00", duracion_min: 60, presencial: true, precio: 25_000, lugar: "Salón e2e" })
      .select("id")
      .single();
    if (errorFranja) throw new Error(`insertar franja: ${errorFranja.message}`);

    await entregar({ monitor, codigo });

    const fallos: string[] = [];
    for (const [contexto, consulta] of [
      ["franja", cliente.from("franja").delete().eq("id", franja.id)],
      ["certificado", cliente.from("certificado").delete().eq("id_admin", admin.id)],
      ["materia", cliente.from("materia").delete().eq("id", materia.id)],
    ] as const) {
      const { error } = await consulta;
      if (error) fallos.push(`${contexto}: ${error.message}`);
    }
    if (fallos.length) throw new Error(`No se pudo limpiar lo que creó la prueba:\n${fallos.join("\n")}`);
  },
});

test.describe.configure({ mode: "default", timeout: 90_000 });

async function entrar(page: Page, monitor: Cuenta): Promise<void> {
  await page.goto(RUTA);
  await expect(page).toHaveURL(`/ingresar?siguiente=${encodeURIComponent(RUTA)}`, ESPERA);
  await enviarCredenciales(page, monitor.correo, monitor.contrasena);
  await expect(page).toHaveURL(RUTA, ESPERA);
}

const vistaPrevia = (page: Page) => page.getByTestId("vista-previa");
const campo = (page: Page, nombre: string) => page.getByLabel(nombre);

test("el monitor llena su perfil, ve la vista previa y un visitante lo ve en su tarjeta, con el HTML como texto", async ({
  page,
  browser,
  escenario,
}) => {
  const { monitor, codigo } = escenario;
  await entrar(page, monitor);

  // Criterio 1: vacío, con el aviso y su enlace en otra pestaña, y la vista previa.
  await expect(page.getByRole("heading", { level: 1, name: "Mi perfil" })).toBeVisible();
  await expect(campo(page, "Carrera (opcional)")).toHaveValue("");
  await expect(campo(page, "Semestre (opcional)")).toHaveValue("");
  await expect(campo(page, "Presentación (opcional)")).toHaveValue("");
  await expect(page.getByText("estudiantes y visitantes ven tu carrera, tu semestre y tu presentación en tu tarjeta")).toBeVisible();
  const aviso = page.getByRole("link", { name: "aviso de privacidad (se abre en otra pestaña)" });
  await expect(aviso).toHaveAttribute("href", "/privacidad");
  await expect(aviso).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("heading", { level: 2, name: "Así te ven los estudiantes" })).toBeVisible();
  await expectReglasDelProducto(page, "editor vacío");

  // Criterios 3 y 4: fuera de los límites o con contacto no se guarda nada y lo escrito se conserva.
  await campo(page, "Carrera (opcional)").fill("Ingeniería de Sistemas");
  await campo(page, "Semestre (opcional)").fill("13");
  await campo(page, "Presentación (opcional)").fill("Trabajé de 2022-2023");
  await page.getByRole("button", { name: "Guardar mi perfil" }).click();
  await expect(page.getByText(MENSAJES.semestre)).toBeVisible(ESPERA);
  await expect(page.getByText(MENSAJE_CONTACTO)).toBeVisible();
  await expect(campo(page, "Semestre (opcional)")).toHaveAttribute("aria-invalid", "true");
  await expect(campo(page, "Carrera (opcional)")).toHaveValue("Ingeniería de Sistemas");
  await expect(campo(page, "Presentación (opcional)")).toHaveValue("Trabajé de 2022-2023");
  await page.reload();
  await expect(campo(page, "Carrera (opcional)")).toHaveValue("", ESPERA);

  // Criterio 2 y 7: se guarda, la vista previa se actualiza, el HTML sale como texto y cada línea es un párrafo.
  const presentacion = "Monitor de Cálculo 2 desde 2024-1, nota 4,8\n<b>Explico</b> con calma <script>window.hackeado=1</script>";
  await campo(page, "Carrera (opcional)").fill("  Ingeniería   de Sistemas ");
  await campo(page, "Semestre (opcional)").fill("6");
  await campo(page, "Presentación (opcional)").fill(presentacion);
  await page.getByRole("button", { name: "Guardar mi perfil" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Guardamos tu perfil" })).toBeVisible(ESPERA);
  await expect(vistaPrevia(page)).toContainText("Ingeniería de Sistemas · 6.º semestre");
  await expect(vistaPrevia(page).getByText("<b>Explico</b> con calma <script>window.hackeado=1</script>")).toBeVisible();
  await expect(vistaPrevia(page).locator("b, script")).toHaveCount(0);
  await page.reload();
  await expect(campo(page, "Carrera (opcional)")).toHaveValue("Ingeniería de Sistemas", ESPERA);
  await expect(campo(page, "Semestre (opcional)")).toHaveValue("6");
  await expect(campo(page, "Presentación (opcional)")).toHaveValue(presentacion);
  await expectReglasDelProducto(page, "editor con perfil");

  // Criterio 6: un visitante lo ve en la tarjeta de la materia.
  const visitante = await browser.newContext();
  const otra = await visitante.newPage();
  await otra.route("**/auth/v1/signup", (ruta) => ruta.abort());
  await otra.goto(`/monitores?materia=${encodeURIComponent(codigo)}`);
  const tarjeta = otra.getByRole("region", { name: monitor.nombre });
  await expect(tarjeta).toContainText("Ingeniería de Sistemas · 6.º semestre", ESPERA);
  await expect(tarjeta.getByText("Monitor de Cálculo 2 desde 2024-1, nota 4,8", { exact: true })).toBeVisible();
  await expect(tarjeta.getByText("<b>Explico</b> con calma <script>window.hackeado=1</script>", { exact: true })).toBeVisible();
  await expect(tarjeta.locator("b, script")).toHaveCount(0);
  expect(await otra.evaluate(() => (window as unknown as { hackeado?: number }).hackeado)).toBeUndefined();
  await expectReglasDelProducto(otra, "tarjeta con perfil");

  // Criterio 5: vaciar un campo lo quita de la tarjeta.
  await campo(page, "Carrera (opcional)").fill("   ");
  await page.getByRole("button", { name: "Guardar mi perfil" }).click();
  await expect(vistaPrevia(page)).not.toContainText("Ingeniería", ESPERA);
  await expect(vistaPrevia(page)).toContainText("6.º semestre");
  await otra.reload();
  await expect(otra.getByRole("region", { name: monitor.nombre })).not.toContainText("Ingeniería", ESPERA);
  await visitante.close();
});

test("el panel lleva a Mi perfil aunque el monitor todavía no tenga certificados", async ({ page, cuentas }) => {
  const monitor = await cuentas.crearMonitor();
  const { error } = await cuentas.cliente.from("perfil_monitor").insert({ id_monitor: monitor.id });
  if (error) throw error;
  await page.goto("/monitor");
  await enviarCredenciales(page, monitor.correo, monitor.contrasena);
  await expect(page).toHaveURL("/monitor", ESPERA);
  await page.getByRole("link", { name: "Mi perfil" }).click();
  await expect(page).toHaveURL(RUTA, ESPERA);
  await expect(page.getByRole("heading", { level: 1, name: "Mi perfil" })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Las reglas del producto (como en e2e/agendar.spec.ts)
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
