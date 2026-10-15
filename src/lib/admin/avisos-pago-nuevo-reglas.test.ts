import { describe, expect, it } from "vitest";
import { claveDeCorreo } from "@/lib/correo/enviar";
import {
  correoDeAvisoDePagoNuevo,
  entidadDeAvisoDePagoNuevo,
  partirEntidadDeAvisoDePagoNuevo,
  tieneBaneoVigente,
  type AdminParaElAviso,
  type PagoParaElAvisoDePagoNuevo,
} from "./avisos-pago-nuevo-reglas";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const PAGO: PagoParaElAvisoDePagoNuevo = { estado: "en_revision", nombrePagador: "Ana Pérez", monto: 25_000 };
const UNO: AdminParaElAviso = { id: id(1), nombre: "Admin Uno", correo: "uno@calibra.test" };
const DOS: AdminParaElAviso = { id: id(2), nombre: "Admin Dos", correo: "dos@calibra.test" };
const ENLACE = `https://calibra.test/admin/pagos/${id(10)}`;

describe("la entidad del aviso de pago nuevo (HU-034)", () => {
  it("es <id_pago>:<id_admin> y se parte de vuelta", () => {
    const entidad = entidadDeAvisoDePagoNuevo(id(10), id(1));
    expect(entidad).toBe(`${id(10)}:${id(1)}`);
    expect(partirEntidadDeAvisoDePagoNuevo(entidad)).toEqual({ idPago: id(10), idAdmin: id(1) });
  });

  it("es ASCII imprimible: sirve de Idempotency-Key, y cada admin tiene su clave por pago", () => {
    expect(claveDeCorreo("aviso_admin_pago_nuevo", entidadDeAvisoDePagoNuevo(id(10), id(1)))).toBe(`aviso_admin_pago_nuevo:${id(10)}:${id(1)}`);
    expect(claveDeCorreo("aviso_admin_pago_nuevo", entidadDeAvisoDePagoNuevo(id(10), id(1)))).not.toBe(
      claveDeCorreo("aviso_admin_pago_nuevo", entidadDeAvisoDePagoNuevo(id(10), id(2))),
    );
  });

  it.each(["", id(10), `${id(10)}:`, `:${id(1)}`, `${id(10)}:no-es-un-id`, `no-es-un-id:${id(1)}`, `${id(10)}:${id(1)}:1`, `${id(10)} :${id(1)}`])(
    "no acepta %j",
    (entidad) => {
      expect(partirEntidadDeAvisoDePagoNuevo(entidad)).toBeNull();
    },
  );
});

describe("tieneBaneoVigente (la ventana de desactivarCuenta)", () => {
  const AHORA = new Date("2026-10-14T12:00:00.000Z");

  it("un baneo que termina después de ahora está vigente", () => {
    expect(tieneBaneoVigente("2126-10-14T12:00:00.000Z", AHORA)).toBe(true);
    expect(tieneBaneoVigente("2026-10-14T12:00:00.001Z", AHORA)).toBe(true);
  });

  it("sin baneo, o con uno que ya terminó (o termina justo ahora), la cuenta cuenta como activa", () => {
    for (const valor of [null, undefined, "", "2026-10-14T12:00:00.000Z", "2026-10-14T11:59:59.999Z", "2020-01-01T00:00:00.000Z"]) {
      expect(tieneBaneoVigente(valor, AHORA), String(valor)).toBe(false);
    }
  });

  it("un valor que no es una fecha no se toma por un baneo", () => {
    expect(tieneBaneoVigente("no es una fecha", AHORA)).toBe(false);
  });
});

describe("correoDeAvisoDePagoNuevo (criterio 5)", () => {
  it("el destinatario es el responsable: va a su correo y nombreResponsable es nulo", () => {
    expect(correoDeAvisoDePagoNuevo({ pago: PAGO, destinatario: UNO, responsable: UNO, enlace: ENLACE })).toEqual({
      destinatario: "uno@calibra.test",
      datos: { nombreAdmin: "Admin Uno", nombrePagador: "Ana Pérez", monto: 25_000, nombreResponsable: null, enlace: ENLACE },
    });
  });

  it("el responsable es otro: el correo dice su nombre", () => {
    expect(correoDeAvisoDePagoNuevo({ pago: PAGO, destinatario: DOS, responsable: UNO, enlace: ENLACE })).toEqual({
      destinatario: "dos@calibra.test",
      datos: { nombreAdmin: "Admin Dos", nombrePagador: "Ana Pérez", monto: 25_000, nombreResponsable: "Admin Uno", enlace: ENLACE },
    });
  });

  it("solo lleva lo que dice la HU: sin contacto del pagador, comprobante ni comisión", () => {
    const correo = correoDeAvisoDePagoNuevo({
      pago: { ...PAGO, contacto: "ana@calibra.test", comision: 5_000 } as PagoParaElAvisoDePagoNuevo,
      destinatario: DOS,
      responsable: UNO,
      enlace: ENLACE,
    });
    expect(Object.keys(correo!.datos).sort()).toEqual(["enlace", "monto", "nombreAdmin", "nombrePagador", "nombreResponsable"]);
    expect(JSON.stringify(correo)).not.toContain("ana@calibra.test");
  });

  it.each(["aprobado", "rechazado"] as const)("es nulo si el pago ya está %s", (estado) => {
    expect(correoDeAvisoDePagoNuevo({ pago: { ...PAGO, estado }, destinatario: DOS, responsable: UNO, enlace: ENLACE })).toBeNull();
  });
});
