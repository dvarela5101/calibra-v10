import { formatearDiaConSemana } from "../../src/lib/fechas";
import { abrirPagoDesdeLaBandeja, agendarYPagar, aviso, ESPERA, expect, expectReglasDelProducto, pagoAsignado, tarjetaDeMonitor, test, titulo } from "./escenario";
import { correrHastaQueLlegue } from "./procesos";

// HU-048, criterio 3 (F4): el admin rechaza el pago de una cita que aún no empieza. La monitoría se cancela, la fecha
// vuelve a quedar libre y, al correr los avisos, llegan el correo al pagador y el aviso al monitor, que no trae el
// contacto del estudiante (P-37).

test.describe.configure({ mode: "default" });

test("el admin rechaza el pago: la cita se cancela, la fecha queda libre y salen los dos avisos", async ({ recorrido: r }) => {
  test.setTimeout(150_000);
  const { idMonitoria } = await agendarYPagar(r);
  const fecha = formatearDiaConSemana(r.fechaDeLaReserva);
  const lista = await r.sinSesion();
  const ruta = `/monitores?materia=${encodeURIComponent(r.materia.codigo)}`;

  await test.step("con la reserva confirmada, la fecha ya no sale libre", async () => {
    await lista.goto(ruta);
    await expect(tarjetaDeMonitor(lista, r.monitor.nombre)).toBeVisible(ESPERA);
    await expect(tarjetaDeMonitor(lista, r.monitor.nombre)).not.toContainText(fecha);
  });

  const admin = await r.entrar(r.admin, "/admin");
  await test.step("criterio 3: el admin abre el pago desde su bandeja y lo rechaza con «Sí, rechazar el pago»", async () => {
    const pago = await pagoAsignado(r, idMonitoria);
    await abrirPagoDesdeLaBandeja(admin, pago);
    await admin.locator("summary", { hasText: "Rechazar el pago" }).click();
    await expectReglasDelProducto(admin, "rechazar el pago");
    await admin.getByRole("button", { name: "Sí, rechazar el pago" }).click();
    await expect(aviso(admin, "Rechazaste el pago.")).toBeVisible(ESPERA);
    await expect(titulo(admin, "Pago rechazado")).toBeVisible();

    expect(await r.una("pago", "estado", { id: pago.id })).toEqual({ estado: "rechazado" });
    expect(await r.una("monitoria", "estado, motivo_cancelacion", { id: idMonitoria })).toEqual({ estado: "cancelada", motivo_cancelacion: "pago_rechazado" });
  });

  await test.step("criterio 3: la fecha vuelve a salir libre en la lista de la materia", async () => {
    await lista.reload();
    await expect(tarjetaDeMonitor(lista, r.monitor.nombre)).toContainText(fecha, ESPERA);
  });

  await test.step("criterio 3: corren los avisos; llegan el correo al pagador y el aviso al monitor, sin el contacto del estudiante", async () => {
    await correrHastaQueLlegue(["avisar-rechazos"], r.correoDelLead, /^No pudimos verificar tu pago y la monitoría se canceló$/);
    const alMonitor = await correrHastaQueLlegue(["avisar-monitores"], r.monitor.correo, new RegExp(`^Se canceló tu monitoría de ${r.materia.nombre}$`));
    expect(alMonitor.html).not.toContain(r.correoDelLead);
    expect(alMonitor.html).not.toContain(r.telefonoDelLead);
  });
});
