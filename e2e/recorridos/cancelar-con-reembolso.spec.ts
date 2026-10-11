import { formatearDiaConSemana } from "../../src/lib/fechas";
import { abrirPagoDesdeLaBandeja, agendarYPagar, aviso, ESPERA, expect, expectReglasDelProducto, hoy, pagoAsignado, PRECIO, tarjetaDeMonitor, test, titulo } from "./escenario";
import { correrHastaQueLlegue, enlaceDelCorreo } from "./procesos";

// HU-048, criterio 6 (F5): el Lead cancela una cita confirmada con el pago aprobado y más de 12 horas de plazo, desde
// el enlace de su correo de confirmación. Se le pide la llave por correo, la entrega en su enlace y un admin que no es
// el asignado registra la transferencia (D-26 lo asigna al primer admin activo; D-48 deja registrarla a cualquiera).

test.describe.configure({ mode: "default" });

test("el Lead cancela a tiempo, entrega su llave y otro admin le devuelve el dinero", async ({ recorrido: r }) => {
  test.setTimeout(180_000);
  const { idMonitoria } = await agendarYPagar(r);

  const admin = await r.entrar(r.admin, "/admin");
  await test.step("el admin aprueba el pago", async () => {
    const pago = await pagoAsignado(r, idMonitoria);
    await abrirPagoDesdeLaBandeja(admin, pago);
    await admin.getByRole("button", { name: "Aprobar pago" }).click();
    await expect(aviso(admin, "Aprobaste el pago.")).toBeVisible(ESPERA);
  });

  const page = r.visitante;
  await test.step("criterio 6: desde el enlace del correo de confirmación, cancela con «Sí, cancelar»", async () => {
    const confirmacion = await correrHastaQueLlegue(["confirmar-citas"], r.correoDelLead, new RegExp(`^Tu monitoría de ${r.materia.nombre} está confirmada$`));
    await page.goto(enlaceDelCorreo(confirmacion.html, "/cita"));
    await expect(titulo(page, "Tu monitoría está confirmada")).toBeVisible(ESPERA);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Cancelar mi monitoría", exact: true }).click();
    await expectReglasDelProducto(page, "cancelar la cita");
    await page.getByRole("button", { name: "Sí, cancelar", exact: true }).click();
    await expect(titulo(page, "Esta monitoría se canceló")).toBeVisible(ESPERA);
    expect(await r.una("monitoria", "estado, motivo_cancelacion", { id: idMonitoria })).toEqual({ estado: "cancelada", motivo_cancelacion: "estudiante" });
  });

  const lista = await r.sinSesion();
  await test.step("criterio 6: la fecha vuelve a salir libre", async () => {
    await lista.goto(`/monitores?materia=${encodeURIComponent(r.materia.codigo)}`);
    await expect(tarjetaDeMonitor(lista, r.monitor.nombre)).toContainText(formatearDiaConSemana(r.fechaDeLaReserva), ESPERA);
  });

  let reembolso = { id: "", id_admin: "" };
  await test.step("criterio 6: hay un reembolso por el monto del pago esperando la llave; llega el correo que la pide", async () => {
    const { id: idPago } = await r.una<{ id: string }>("pago", "id", { id_monitoria: idMonitoria });
    reembolso = await r.una("reembolso", "id, id_admin, monto, estado", { id_pago: idPago });
    expect(reembolso).toMatchObject({ monto: PRECIO, estado: "esperando_llave" });
    expect(reembolso.id_admin).not.toBe(r.admin.id);

    const correo = await correrHastaQueLlegue(["avisar-cancelaciones"], r.correoDelLead, new RegExp(`^Cancelaste tu monitoría de ${r.materia.nombre}$`));
    await page.goto(enlaceDelCorreo(correo.html, "/reembolso"));
    await expect(titulo(page, "Envíanos tu llave")).toBeVisible(ESPERA);
    await page.waitForLoadState("networkidle");
    await expectReglasDelProducto(page, "llave del reembolso");
  });

  const llave = `llave-${r.correoDelLead.slice(10, 18)}`;
  await test.step("criterio 6: entrega su llave con «Enviar mi llave»; la llave no vuelve a aparecer", async () => {
    await page.getByLabel("Tu llave").fill(llave);
    await page.getByRole("button", { name: "Enviar mi llave", exact: true }).click();
    await expect(titulo(page, "Recibimos tu llave")).toBeVisible(ESPERA);
    expect(await r.una("reembolso", "estado, llave_destino", { id: reembolso.id })).toEqual({ estado: "pendiente", llave_destino: llave });
    await page.reload();
    await expect(page.locator("body")).not.toContainText(llave);
  });

  await test.step("criterio 6: un admin que no es el asignado lo abre desde «De otros admins» y registra la transferencia (D-48)", async () => {
    await admin.goto("/admin");
    const deOtros = admin.getByRole("region", { name: /Reembolsos/ }).getByRole("list", { name: /^De otros admins/ });
    await deOtros.locator(`a[href="/admin/reembolsos/${reembolso.id}"]`).click();
    await expect(admin).toHaveURL(`/admin/reembolsos/${reembolso.id}`, ESPERA);
    await expect(admin.getByLabel("Llave de quien pagó")).toHaveValue(llave);
    await expectReglasDelProducto(admin, "reembolso");

    await admin.locator("summary", { hasText: "Registrar la transferencia" }).click();
    await admin.getByLabel("Referencia de la transferencia").fill("REC-REEMBOLSO-1");
    await admin.getByLabel("Fecha de la transferencia").fill(hoy());
    await admin.getByRole("button", { name: "Sí, registrar la transferencia" }).click();
    await expect(aviso(admin, "Registraste la transferencia.")).toBeVisible(ESPERA);
    expect(await r.una("reembolso", "estado, id_admin_registro", { id: reembolso.id })).toEqual({ estado: "reembolsado", id_admin_registro: r.admin.id });
  });
});
