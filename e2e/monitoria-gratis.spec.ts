import { randomInt, randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { diaDelNegocio } from "../src/lib/fechas";
import { enviarCredenciales, expect, test as base, usarTurnstileDePrueba, type Cuenta } from "./utilidades";

// HU-116 (D-84): un admin abre la ficha de una monitoría por pagar, la marca como de prueba y queda confirmada sin pago; el
// estudiante abre su cita y ve el precio normal tachado y «Gratis» en verde, sin pago ni comprobante y sin la palabra «prueba»;
// el admin le quita la marca y vuelve a por pagar con su precio. Corre contra el Supabase local y el servidor de Next con la
// configuración de .env.local (`npm run db:env`). La prueba crea y borra su admin, su monitor (con su llave), la materia, la
// franja, el Lead y la monitoría. La monitoría se aparta por la base, `pendiente_pago` y recién creada (la reserva de 10 minutos
// está vigente), y empieza dentro de 30 horas: hay plazo de sobra y ningún proceso programado la toca mientras corre.

const ESPERA = { timeout: 20_000 };
const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const PRECIO = 27_000;

/** Día ISO (1 = lunes ... 7 = domingo) de un día de calendario, como `franja.dia`. */
function diaIso(fecha: string): number {
  const d = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Una sesión que empieza dentro de `horas` horas, con su día y su hora (`HH:MM`) y una duración que no pasa de la medianoche. */
function enHoras(horas: number): { fecha: string; hora: string; duracionMin: number } {
  const inicio = new Date(Math.floor((Date.now() + horas * HORA) / MINUTO) * MINUTO);
  const hora = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(inicio);
  const minutosDelDia = Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));
  return { fecha: diaDelNegocio(inicio), hora, duracionMin: Math.max(1, Math.min(30, 24 * 60 - minutosDelDia)) };
}

type Escenario = {
  admin: Cuenta;
  /** El nombre del monitor lo pone el fixture de cuentas («Monitora de prueba …»): no es texto de la pantalla. */
  nombreMonitor: string;
  idMonitoria: string;
  leerMonitoria(): Promise<{ estado: string; gratis: boolean; valor_total: number }>;
  leerMarcas(): Promise<{ id_admin: string; gratis: boolean }[]>;
  contarPagos(): Promise<number>;
  /** El token del enlace de la cita del estudiante, que anota la confirmación. */
  leerToken(): Promise<string>;
};

const test = base.extend<{ escenario: Escenario }>({
  escenario: async ({ cuentas }, entregar) => {
    const cliente = cuentas.cliente;
    const admin = await cuentas.crearAdmin();
    const monitor = await cuentas.crearMonitor();
    const creados = { monitorias: [] as string[], franjas: [] as string[], leads: [] as string[], materias: [] as string[] };

    async function insertar(tabla: string, fila: Record<string, unknown>): Promise<string> {
      const { data, error } = await cliente.from(tabla).insert(fila).select("id").single();
      if (error) throw new Error(`insertar ${tabla}: ${error.message}`);
      return data.id as string;
    }

    const idMateria = await insertar("materia", { nombre: `Materia e2e gratis ${randomUUID().slice(0, 6)}`, codigo: `E2E-${randomUUID().slice(0, 12)}` });
    creados.materias.push(idMateria);
    const { error: errorCertificado } = await cliente.from("certificado").insert({ id_monitor: monitor.id, id_materia: idMateria, id_admin: admin.id });
    if (errorCertificado) throw new Error(`insertar certificado: ${errorCertificado.message}`);
    const sesion = enHoras(30);
    const idFranja = await insertar("franja", {
      id_monitor: monitor.id,
      dia: diaIso(sesion.fecha),
      hora: sesion.hora,
      duracion_min: sesion.duracionMin,
      presencial: true,
      lugar: `Salón e2e ${randomUUID().slice(0, 6)}`,
      precio: PRECIO,
    });
    creados.franjas.push(idFranja);
    const idLead = await insertar("lead", {
      nombre: `Lead e2e ${randomUUID().slice(0, 6)}`,
      correo: `lead-${randomUUID()}@calibra.test`,
      numero_telefono: `31${randomInt(10_000_000, 99_999_999)}`,
      acepta_tratamiento_datos: true,
      fecha_consentimiento: new Date().toISOString(),
    });
    creados.leads.push(idLead);
    // Se aparta pendiente de pago, como `agendar_monitoria`: la reserva cuenta desde ahora.
    const idMonitoria = await insertar("monitoria", {
      id_franja: idFranja,
      id_monitor: monitor.id,
      id_materia: idMateria,
      id_lead: idLead,
      fecha: sesion.fecha,
      valor_total: PRECIO,
      estado: "pendiente_pago",
    });
    creados.monitorias.push(idMonitoria);

    await entregar({
      admin,
      nombreMonitor: monitor.nombre,
      idMonitoria,
      async leerMonitoria() {
        const { data, error } = await cliente.from("monitoria").select("estado, gratis, valor_total").eq("id", idMonitoria).single();
        if (error) throw new Error(`leer monitoria: ${error.message}`);
        return data;
      },
      async leerMarcas() {
        const { data, error } = await cliente.from("marca_gratis").select("id_admin, gratis").eq("id_monitoria", idMonitoria).order("hecha_en");
        if (error) throw new Error(`leer marca_gratis: ${error.message}`);
        return data ?? [];
      },
      async contarPagos() {
        const { data, error } = await cliente.from("pago").select("id").eq("id_monitoria", idMonitoria);
        if (error) throw new Error(`leer pagos: ${error.message}`);
        return (data ?? []).length;
      },
      async leerToken() {
        const { data, error } = await cliente.from("confirmacion_cita").select("token").eq("id_monitoria", idMonitoria).single();
        if (error) throw new Error(`leer el token de la cita: ${error.message}`);
        return (data as { token: string }).token;
      },
    });

    // Limpieza en el orden de las llaves foráneas, antes de que `cuentas` borre al admin y al monitor. Las marcas, la
    // confirmación y el aviso al monitor se van con la monitoría (cascada).
    const fallos: string[] = [];
    const borrar = async (contexto: string, consulta: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await consulta;
      if (error) fallos.push(`${contexto}: ${error.message}`);
    };
    await borrar("monitorías", cliente.from("monitoria").delete().in("id", creados.monitorias));
    await borrar("franjas", cliente.from("franja").delete().in("id", creados.franjas));
    await borrar("certificados", cliente.from("certificado").delete().eq("id_admin", admin.id));
    await borrar("leads", cliente.from("lead").delete().in("id", creados.leads));
    await borrar("materias", cliente.from("materia").delete().in("id", creados.materias));
    if (fallos.length) throw new Error(`No se pudo limpiar lo que creó la prueba:\n${fallos.join("\n")}`);
  },
});

test.describe.configure({ mode: "default", timeout: 120_000 });

const aviso = (page: Page, texto: string) => page.getByRole("status").filter({ hasText: texto });
const seccionDePrueba = (page: Page) => page.getByRole("region", { name: "Monitoría de prueba", exact: true });

async function entrarComoAdmin(page: Page, admin: Cuenta) {
  await page.goto("/admin");
  await expect(page).toHaveURL("/ingresar?siguiente=%2Fadmin", ESPERA);
  await enviarCredenciales(page, admin.correo, admin.contrasena);
  await expect(page).toHaveURL("/admin", ESPERA);
}

test("el admin marca una monitoría por pagar como de prueba, el estudiante la ve «Gratis» sin pagar, y el admin le quita la marca", async ({
  page,
  browser,
  escenario,
}, testInfo) => {
  const { admin, idMonitoria } = escenario;
  await entrarComoAdmin(page, admin);

  await test.step("la ficha de la monitoría por pagar ofrece marcarla, dentro de una confirmación", async () => {
    await page.goto(`/admin/citas/${idMonitoria}`);
    await expect(page.getByRole("heading", { level: 1, name: "Monitoría de prueba" })).toBeVisible(ESPERA);
    await expect(seccionDePrueba(page)).toContainText("No: se paga el precio normal");
    const abrir = page.locator("summary", { hasText: "Marcar como monitoría de prueba" });
    await expect(abrir).toBeVisible();
    // Cerrada, el botón no se ve; el área táctil del resumen es de 44 px o más.
    await expect(page.getByRole("button", { name: "Sí, marcarla gratis" })).toBeHidden();
    expect((await abrir.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await abrir.click();
    await expect(page.locator("#gratis-consecuencias")).toContainText("queda confirmada sin pago ni comprobante");
  });

  await test.step("al confirmar queda confirmada y gratis, con su precio normal, sin pago y con el registro a nombre del admin", async () => {
    const boton = page.getByRole("button", { name: "Sí, marcarla gratis" });
    expect((await boton.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await boton.click();
    await expect(page).toHaveURL(`/admin/citas/${idMonitoria}?gratis=marcada`, ESPERA);
    await expect(aviso(page, "Marcaste la monitoría como de prueba")).toBeVisible(ESPERA);
    await expect(seccionDePrueba(page)).toContainText("Sí: quien agendó no paga");
    await expect(seccionDePrueba(page)).toContainText("La marcó");
    await expect(seccionDePrueba(page)).toContainText(admin.nombre);
    expect(await escenario.leerMonitoria()).toEqual({ estado: "confirmada", gratis: true, valor_total: PRECIO });
    expect(await escenario.contarPagos()).toBe(0);
    expect(await escenario.leerMarcas()).toEqual([{ id_admin: admin.id, gratis: true }]);
  });

  await test.step("el estudiante abre su cita: confirmada, el precio tachado y «Gratis» en verde, sin pago y sin la palabra «prueba»", async () => {
    const contexto = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      locale: "es-CO",
      timezoneId: "America/Bogota",
      viewport: page.viewportSize() ?? undefined,
    });
    await usarTurnstileDePrueba(contexto);
    const suPagina = await contexto.newPage();
    try {
      await suPagina.goto(`/cita?token=${await escenario.leerToken()}`);
      await expect(suPagina.getByRole("heading", { level: 1, name: "Tu monitoría está confirmada" })).toBeVisible(ESPERA);
      const tachado = suPagina.locator("del");
      await expect(tachado).toContainText("27.000");
      expect(await tachado.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("line-through");
      const gratis = suPagina.getByText("Gratis", { exact: true });
      await expect(gratis).toBeVisible();
      const [color, verde, tamano] = await gratis.evaluate((el) => [
        getComputedStyle(el).color,
        (() => {
          const prueba = document.createElement("span");
          prueba.style.color = "var(--success-text)";
          document.body.append(prueba);
          const c = getComputedStyle(prueba).color;
          prueba.remove();
          return c;
        })(),
        getComputedStyle(el).fontSize,
      ]);
      expect(color).toBe(verde);
      expect(Number.parseFloat(tamano)).toBeGreaterThanOrEqual(14);
      // La palabra «prueba» no sale en la pantalla del estudiante, salvo dentro del nombre de prueba del monitor.
      const principal = (await suPagina.locator("main").innerText()).replace(escenario.nombreMonitor, "");
      expect(principal).toContain("Gratis");
      expect(principal).not.toMatch(/prueba/i);
      expect(principal).not.toMatch(/comprobante|Llave/i);
    } finally {
      await contexto.close();
    }
  });

  await test.step("el admin le quita la marca: vuelve a por pagar con su precio y queda el registro", async () => {
    await page.goto(`/admin/citas/${idMonitoria}`);
    await page.locator("summary", { hasText: "Quitar la marca de prueba" }).click();
    await expect(page.locator("#gratis-consecuencias")).toContainText("tiene 10 minutos desde ahora");
    await page.getByRole("button", { name: "Sí, quitar la marca" }).click();
    await expect(page).toHaveURL(`/admin/citas/${idMonitoria}?gratis=desmarcada`, ESPERA);
    await expect(aviso(page, "Quitaste la marca de prueba")).toBeVisible(ESPERA);
    expect(await escenario.leerMonitoria()).toEqual({ estado: "pendiente_pago", gratis: false, valor_total: PRECIO });
    expect(await escenario.leerMarcas()).toEqual([
      { id_admin: admin.id, gratis: true },
      { id_admin: admin.id, gratis: false },
    ]);
  });
});
