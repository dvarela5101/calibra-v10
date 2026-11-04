import { randomInt, randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { correoUnico, enviarCredenciales, expect, test as base, type Cuenta } from "./utilidades";

// HU-124 (D-90): la bandeja del admin avisa de los monitores sin certificado y de las solicitudes nuevas. Otras pruebas en
// paralelo crean monitores y solicitudes, así que no se esperan totales exactos: cada prueba busca a los suyos por nombre.

const ESPERA = { timeout: 20_000 };

type Escenario = {
  materia(): Promise<{ id: string; nombre: string }>;
  solicitud(datos: { nombre: string; correo?: string; materias: string[] }): Promise<{ id: string; correo: string }>;
};

const test = base.extend<{ escenario: Escenario }>({
  escenario: async ({ cuentas }, entregar) => {
    const cliente = cuentas.cliente;
    const materias: string[] = [];
    const solicitudes: string[] = [];
    await entregar({
      async materia() {
        const nombre = `Materia e2e bandeja ${randomUUID().slice(0, 6)}`;
        const { data, error } = await cliente.from("materia").insert({ nombre, codigo: `E2E-${randomUUID().slice(0, 12)}` }).select("id").single();
        if (error) throw new Error(`insertar materia: ${error.message}`);
        materias.push(data.id as string);
        return { id: data.id as string, nombre };
      },
      async solicitud({ nombre, correo = correoUnico(), materias: idsDeMaterias }) {
        const { data, error } = await cliente.rpc("crear_solicitud_monitor", {
          p_nombre: nombre,
          p_correo: correo,
          p_numero_telefono: `+573${String(randomInt(0, 1_000_000_000)).padStart(9, "0")}`,
          p_materias: idsDeMaterias,
          p_fecha_consentimiento: new Date().toISOString(),
        });
        if (error) throw new Error(`crear solicitud: ${error.message}`);
        solicitudes.push(data as string);
        return { id: data as string, correo };
      },
    });
    if (solicitudes.length) await cliente.from("solicitud_monitor").delete().in("id", solicitudes);
    await cliente.from("certificado").delete().in("id_materia", materias);
    if (materias.length) await cliente.from("materia").delete().in("id", materias);
  },
});

async function entrarComoAdmin(page: Page, admin: Cuenta) {
  await page.goto("/admin");
  await expect(page).toHaveURL("/ingresar?siguiente=%2Fadmin", ESPERA);
  await enviarCredenciales(page, admin.correo, admin.contrasena);
  await expect(page).toHaveURL("/admin", ESPERA);
}

test("el monitor que se registró sale en la bandeja con su contacto y, con su primer certificado, ya no", async ({ page, cuentas, escenario }) => {
  const admin = await cuentas.crearAdmin();
  const monitor = await cuentas.crearMonitor();
  const materia = await escenario.materia();
  await escenario.solicitud({ nombre: monitor.nombre, correo: monitor.correo, materias: [materia.id] });

  await entrarComoAdmin(page, admin);
  const seccion = page.getByRole("region", { name: /Monitores por certificar/ });
  const fila = seccion.getByRole("listitem").filter({ hasText: monitor.nombre });
  await expect(fila).toBeVisible(ESPERA);
  await expect(fila).toContainText(`Pidió ${materia.nombre}`);
  await expect(fila).toContainText("Se registró el");
  await expect(fila.getByRole("link", { name: "3001234567" })).toHaveAttribute("href", "tel:3001234567");
  await expect(fila.getByRole("link", { name: monitor.correo })).toHaveAttribute("href", `mailto:${monitor.correo}`);
  await expect(page.getByRole("navigation", { name: "Resumen de tu bandeja" }).getByRole("link", { name: /Monitores por certificar/ })).toHaveAttribute(
    "href",
    "#por-certificar",
  );

  await fila.getByRole("link", { name: "Ir a certificar" }).click();
  await expect(page).toHaveURL("/admin/certificados", ESPERA);

  const { error } = await cuentas.cliente.from("certificado").insert({ id_monitor: monitor.id, id_materia: materia.id, id_admin: admin.id });
  expect(error).toBeNull();
  await page.goto("/admin");
  await expect(page.getByRole("region", { name: /Monitores por certificar/ }).getByText(monitor.nombre)).toHaveCount(0, ESPERA);
});

test("la solicitud nueva sale en la bandeja y, marcada como contactada, ya no", async ({ page, cuentas, escenario }) => {
  const admin = await cuentas.crearAdmin();
  const materia = await escenario.materia();
  const nombre = `Aspirante bandeja ${randomUUID().slice(0, 6)}`;
  const solicitud = await escenario.solicitud({ nombre, materias: [materia.id] });

  await entrarComoAdmin(page, admin);
  const fila = page.getByRole("region", { name: /Solicitudes por contactar/ }).getByRole("listitem").filter({ hasText: nombre });
  await expect(fila).toBeVisible(ESPERA);
  await expect(fila).toContainText(`Pidió ${materia.nombre}`);
  await expect(fila.getByRole("link", { name: solicitud.correo })).toHaveAttribute("href", `mailto:${solicitud.correo}`);

  await fila.getByRole("link", { name: "Abrir las solicitudes" }).click();
  // La lista abre en la página de la solicitud abierta más antigua (HU-062).
  await expect(page).toHaveURL(/\/admin\/solicitudes(\?pagina=\d+)?$/, ESPERA);

  const { error } = await cuentas.cliente.from("solicitud_monitor").update({ estado: "contactada" }).eq("id", solicitud.id);
  expect(error).toBeNull();
  await page.goto("/admin");
  await expect(page.getByRole("region", { name: /Solicitudes por contactar/ }).getByText(nombre)).toHaveCount(0, ESPERA);
});

test("en un teléfono, la fila no se sale de la pantalla y sus enlaces miden 44 px o más", async ({ page, cuentas }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const admin = await cuentas.crearAdmin();
  const monitor = await cuentas.crearMonitor();

  await entrarComoAdmin(page, admin);
  const fila = page.getByRole("region", { name: /Monitores por certificar/ }).getByRole("listitem").filter({ hasText: monitor.nombre });
  await expect(fila).toBeVisible(ESPERA);
  const caja = await fila.boundingBox();
  expect(caja!.x + caja!.width).toBeLessThanOrEqual(390);
  for (const nombre of ["3001234567", monitor.correo, "Ir a certificar"]) {
    const enlace = await fila.getByRole("link", { name: nombre }).boundingBox();
    expect(enlace!.height, nombre).toBeGreaterThanOrEqual(44);
  }
});
