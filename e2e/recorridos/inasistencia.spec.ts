import { abrirPagoDesdeLaBandeja, agendarYPagar, aviso, ESPERA, expect, expectReglasDelProducto, pagoAsignado, PRECIO, sumarDias, test } from "./escenario";
import { correrHastaQueLlegue, enlaceDelCorreo } from "./procesos";

// HU-048, criterio 7 (F5 y F8, D-37): la sesión empezó hace 90 minutos, el monitor la marcó realizada y el Lead reporta
// que el monitor no llegó. Mientras el reporte siga en revisión, el desembolso no se puede ejecutar, aunque hayan pasado
// 24 horas. El admin asignado lo acepta: la monitoría se cancela, el desembolso se anula y se reembolsa el pago.
//
// Orden de los saltos de reloj: se finaliza y se reporta con la sesión de hace 90 minutos (la ventana de reporte está
// abierta), y solo después la base mueve la fecha dos semanas atrás. Moverla antes cerraría la ventana.

test.describe.configure({ mode: "default" });

const OBSERVACION = "El estudiante esperó en el salón y el monitor no llegó.";

test("el Lead reporta que el monitor no llegó, el reporte frena el desembolso y el admin lo acepta", async ({ recorrido: r }) => {
  test.setTimeout(180_000);
  const { idMonitoria } = await agendarYPagar(r);

  const admin = await r.entrar(r.admin, "/admin");
  let idPago = "";
  await test.step("el admin aprueba el pago", async () => {
    const pago = await pagoAsignado(r, idMonitoria);
    idPago = pago.id;
    await abrirPagoDesdeLaBandeja(admin, pago);
    await admin.getByRole("button", { name: "Aprobar pago" }).click();
    await expect(aviso(admin, "Aprobaste el pago.")).toBeVisible(ESPERA);
  });
  const confirmacion = await correrHastaQueLlegue(["confirmar-citas"], r.correoDelLead, new RegExp(`^Tu monitoría de ${r.materia.nombre} está confirmada$`));

  await test.step("salto de reloj: la base pone la monitoría en la sesión que empezó hace 90 minutos; el monitor la marca realizada", async () => {
    await r.moverA(idMonitoria, r.sesion.fecha);
    const monitor = await r.entrar(r.monitor, "/monitor/agenda");
    await monitor.getByRole("region", { name: /^Por finalizar/ }).getByRole("button", { name: "Marcar como realizada" }).click();
    await expect(aviso(monitor, "Marcaste la monitoría como realizada.")).toBeVisible(ESPERA);
  });

  const page = r.visitante;
  let idReporte = "";
  await test.step("criterio 7: el Lead abre su enlace, toca «El monitor no llegó» y confirma con «Sí, reportar»", async () => {
    await page.goto(enlaceDelCorreo(confirmacion.html, "/cita"));
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "El monitor no llegó" }).click();
    await expectReglasDelProducto(page, "reportar la inasistencia");
    await page.getByRole("button", { name: "Sí, reportar" }).click();
    await expect(page.getByText("Recibimos tu reporte. Un admin lo está revisando")).toBeVisible(ESPERA);

    const reporte = await r.una<{ id: string; estado: string; id_admin: string | null }>("reporte_inasistencia", "id, estado, id_admin", { id_monitoria: idMonitoria });
    expect(reporte.estado).toBe("en_revision");
    expect(reporte.id_admin).not.toBeNull();
    idReporte = reporte.id;
    await r.asignarReporte(idReporte);
  });

  let idDesembolso = "";
  await test.step("criterio 7: salto de reloj, dos semanas atrás; con el reporte en revisión el desembolso no es ejecutable", async () => {
    await r.moverA(idMonitoria, sumarDias(r.sesion.fecha, -14));
    ({ id: idDesembolso } = await r.una<{ id: string }>("desembolso", "id", { id_monitoria: idMonitoria }));
    await admin.goto("/admin");
    await expect(admin.getByRole("region", { name: /Reportes en revisión/ })).toBeVisible(ESPERA);
    await expect(admin.locator(`a[href="/admin/desembolsos/${idDesembolso}"]`)).toHaveCount(0);
  });

  await test.step("criterio 7: el admin asignado abre el reporte desde «Reportes en revisión» y lo acepta con una observación", async () => {
    await admin.getByRole("region", { name: /Reportes en revisión/ }).locator(`a[href="/admin/reportes/${idReporte}"]`).click();
    await expect(admin).toHaveURL(`/admin/reportes/${idReporte}`, ESPERA);
    await admin.locator("summary", { hasText: "Aceptar el reporte" }).click();
    await expectReglasDelProducto(admin, "resolver el reporte");
    await admin.locator("#aceptar-observaciones").fill(OBSERVACION);
    await admin.getByRole("button", { name: "Sí, aceptar el reporte" }).click();
    await expect(aviso(admin, "Aceptaste el reporte.")).toBeVisible(ESPERA);

    expect(await r.una("monitoria", "estado, motivo_cancelacion", { id: idMonitoria })).toEqual({ estado: "cancelada", motivo_cancelacion: "monitor_no_asistio" });
    expect(await r.una("desembolso", "estado", { id: idDesembolso })).toEqual({ estado: "anulado" });
    // D-37: el motivo es el texto base y las observaciones del admin.
    expect(await r.una("reembolso", "monto, motivo", { id_pago: idPago })).toEqual({
      monto: PRECIO,
      motivo: `El monitor no asistió a la monitoría. ${OBSERVACION}`,
    });
  });

  await test.step("criterio 7: el monitor recibe su correo sin el contacto del estudiante y el Lead, el pedido de llave que dice que se aceptó", async () => {
    const alMonitor = await correrHastaQueLlegue(
      ["avisar-monitores"],
      r.monitor.correo,
      new RegExp(`^Se aceptó un reporte de inasistencia en tu monitoría de ${r.materia.nombre}$`),
    );
    expect(alMonitor.html).not.toContain(r.correoDelLead);
    expect(alMonitor.html).not.toContain(r.telefonoDelLead);
    const llave = await correrHastaQueLlegue(["pedir-llaves"], r.correoDelLead, /^Necesitamos tu llave para devolverte /);
    expect(llave.html).toContain("lo aceptamos");
    expect(llave.html).toContain("/reembolso?token=");
  });
});
