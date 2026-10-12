import type { Page } from "@playwright/test";
import { abrirPagoDesdeLaBandeja, agendarYPagar, aviso, dato, ESPERA, expect, expectReglasDelProducto, hoy, pagoAsignado, pesos, PRECIO, sumarDias, test, titulo } from "./escenario";
import { correrHastaQueLlegue, enlaceDelCorreo } from "./procesos";

// HU-048, criterios 1, 2, 4 y 5 (F3, F4 y F8): una misma monitoría, de la lista de monitores al desembolso del monitor.
// El visitante agenda y paga; llegan la confirmación y el aviso al monitor; el admin aprueba el pago; el monitor la
// marca realizada; y, pasada la ventana de reporte, el admin registra la transferencia. Solo la base mueve el reloj.

test.describe.configure({ mode: "default" });

test("agendar, pagar, confirmar, aprobar, finalizar y desembolsar la misma monitoría", async ({ recorrido: r }) => {
  test.setTimeout(180_000);
  const { idMonitoria } = await agendarYPagar(r);

  await test.step("criterio 4: corren las confirmaciones y los avisos; llegan el correo al Lead y el aviso al monitor", async () => {
    const confirmacion = await correrHastaQueLlegue(["confirmar-citas"], r.correoDelLead, new RegExp(`^Tu monitoría de ${r.materia.nombre} está confirmada$`));
    // D-22: dice qué pasa con el pago en revisión.
    expect(confirmacion.html).toContain("Recibimos tu comprobante. Un admin lo revisa");
    await correrHastaQueLlegue(["avisar-monitores"], r.monitor.correo, new RegExp(`^Tienes una monitoría confirmada de ${r.materia.nombre}$`));

    const cita = await r.sinSesion();
    await cita.goto(enlaceDelCorreo(confirmacion.html, "/cita"));
    await expect(titulo(cita, "Tu monitoría está confirmada")).toBeVisible(ESPERA);
    // D-21: con la cita confirmada se ve el lugar.
    await expect(dato(cita, "Lugar")).toHaveText(r.franja.lugar);
    await expectReglasDelProducto(cita, "cita");
  });

  const admin = await r.entrar(r.admin, "/admin");
  await test.step("criterio 2: el admin abre el pago desde su bandeja, ve el comprobante y lo aprueba", async () => {
    const pago = await pagoAsignado(r, idMonitoria);
    await admin.reload();
    await expectReglasDelProducto(admin, "bandeja del admin");
    await abrirPagoDesdeLaBandeja(admin, pago);
    await expect(admin.getByRole("link", { name: "Ver comprobante" })).toHaveAttribute("href", `/admin/pagos/${pago.id}/comprobante`);
    await expectReglasDelProducto(admin, "revisar el pago");
    await admin.getByRole("button", { name: "Aprobar pago" }).click();
    await expect(aviso(admin, "Aprobaste el pago.")).toBeVisible(ESPERA);

    const enBase = await r.una<{ estado: string; id_admin: string; fecha_revision: string | null }>("pago", "estado, id_admin, fecha_revision", { id: pago.id });
    expect(enBase).toMatchObject({ estado: "aprobado", id_admin: r.admin.id });
    expect(enBase.fecha_revision).not.toBeNull();
    await admin.goto("/admin");
    await expect(admin.locator(`a[href="/admin/pagos/${pago.id}"]`)).toHaveCount(0);
  });

  const monitor = await r.entrar(r.monitor, "/monitor/agenda");
  await test.step("criterio 2: el monitor ve la monitoría en su agenda con el pago aprobado", async () => {
    await expect(monitor.getByRole("listitem").filter({ hasText: "Agendó: Lead del recorrido" })).toContainText("Pago aprobado", ESPERA);
    await expectReglasDelProducto(monitor, "agenda del monitor");
  });

  let desembolso = { id: "", monto_neto: 0, monto_bruto: 0, comision: 0, llave_destino: "" };
  await test.step("criterio 5: salto de reloj, la base pone la monitoría en la sesión que empezó hace 90 minutos; el monitor la marca realizada", async () => {
    await r.moverA(idMonitoria, r.sesion.fecha);
    await monitor.reload();
    await monitor.getByRole("region", { name: /^Por finalizar/ }).getByRole("button", { name: "Marcar como realizada" }).click();
    await expect(aviso(monitor, "Marcaste la monitoría como realizada.")).toBeVisible(ESPERA);
    expect(await r.una<{ estado: string }>("monitoria", "estado", { id: idMonitoria })).toEqual({ estado: "realizada" });

    const { llave } = await r.una<{ llave: string }>("monitor_privado", "llave", { id_monitor: r.monitor.id });
    desembolso = await r.una("desembolso", "id, monto_neto, monto_bruto, comision, llave_destino, estado", { id_monitoria: idMonitoria });
    expect(desembolso).toMatchObject({ estado: "pendiente", llave_destino: llave, monto_bruto: PRECIO });
  });

  await test.step("criterio 5: antes de 24 horas del fin, la página del desembolso dice por qué no se puede ejecutar", async () => {
    await admin.goto(`/admin/desembolsos/${desembolso.id}`);
    await expect(admin.getByText("Todavía no se puede transferir: la ventana para reportar inasistencia no ha terminado.")).toBeVisible(ESPERA);
    await expect(admin.getByRole("button", { name: "Sí, registrar la transferencia" })).toHaveCount(0);
    await expectSinComision(admin, desembolso);
  });

  await test.step("criterio 5: salto de reloj, dos semanas atrás; el admin lo abre desde «Desembolsos ejecutables» y registra la transferencia", async () => {
    await r.moverA(idMonitoria, sumarDias(r.sesion.fecha, -14));
    await admin.goto("/admin");
    await admin.getByRole("region", { name: /Desembolsos ejecutables/ }).locator(`a[href="/admin/desembolsos/${desembolso.id}"]`).click();
    await expect(admin).toHaveURL(`/admin/desembolsos/${desembolso.id}`, ESPERA);
    await expect(admin.getByRole("heading", { level: 2, name: `Transferir ${pesos(desembolso.monto_neto)}` })).toBeVisible(ESPERA);
    await expect(admin.getByLabel("Llave del monitor")).toHaveValue(desembolso.llave_destino);
    await expectReglasDelProducto(admin, "desembolso");
    await expectSinComision(admin, desembolso);

    await admin.locator("summary", { hasText: "Registrar la transferencia" }).click();
    await admin.getByLabel("Referencia de la transferencia").fill("REC-DESEMBOLSO-1");
    await admin.getByLabel("Fecha de la transferencia").fill(hoy());
    await admin.getByRole("button", { name: "Sí, registrar la transferencia" }).click();
    await expect(aviso(admin, "Registraste la transferencia.")).toBeVisible(ESPERA);
    expect(await r.una("desembolso", "estado, id_admin", { id: desembolso.id })).toEqual({ estado: "desembolsado", id_admin: r.admin.id });

    await expectSinComision(admin, desembolso);
  });
});

/** La página del desembolso no muestra la comisión ni el bruto (CLAUDE.md: solo el monitor ve la comisión, D-59). */
async function expectSinComision(admin: Page, desembolso: { monto_bruto: number; comision: number }): Promise<void> {
  const cuerpo = admin.locator("body");
  await expect(cuerpo).not.toContainText(/comisi[oó]n/i);
  await expect(cuerpo).not.toContainText(/bruto/i);
  await expect(cuerpo).not.toContainText(pesos(desembolso.monto_bruto));
  await expect(cuerpo).not.toContainText(pesos(desembolso.comision));
}
