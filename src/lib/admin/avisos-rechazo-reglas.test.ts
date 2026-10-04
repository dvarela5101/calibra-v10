import { describe, expect, it } from "vitest";
import { CASOS_DE_AVISO_DE_RECHAZO, correoDeRechazoSinReembolso, esCasoDeAvisoDeRechazo } from "./avisos-rechazo-reglas";
import { correoDeRechazo, type PagoParaElCorreo } from "./pagos-reglas";

const PAGO: PagoParaElCorreo = {
  estado: "rechazado",
  contacto: "ana@calibra.test",
  nombrePagador: "Ana",
  monto: 25_000,
  monitoria: { estado: "cancelada", motivoCancelacion: "estudiante", fecha: "2026-10-06" },
};

describe("los casos del aviso de rechazo (HU-076)", () => {
  it("son los dos que anota la base", () => {
    expect([...CASOS_DE_AVISO_DE_RECHAZO]).toEqual(["cita_cancelada", "cita_ya_cancelada"]);
    expect(esCasoDeAvisoDeRechazo("cita_cancelada")).toBe(true);
    expect(esCasoDeAvisoDeRechazo("cita_ya_cancelada")).toBe(true);
  });

  it.each(["", "p24", "cancelada", "CITA_CANCELADA", null, undefined, 1])("no reconoce %j", (valor) => {
    expect(esCasoDeAvisoDeRechazo(valor)).toBe(false);
  });
});

describe("correoDeRechazoSinReembolso (criterio 5, D-39 d)", () => {
  it("va a pago.contacto con los datos del pago y el contacto de soporte", () => {
    expect(correoDeRechazoSinReembolso(PAGO, "ayuda@calibra.test")).toEqual({
      destinatario: "ana@calibra.test",
      datos: { nombre: "Ana", monto: 25_000, fechaSesion: "2026-10-06", contactoSoporte: "ayuda@calibra.test" },
    });
  });

  it("sin contacto de soporte no pone la clave", () => {
    const correo = correoDeRechazoSinReembolso(PAGO, null);
    expect(correo).not.toBeNull();
    expect("contactoSoporte" in correo!.datos).toBe(false);
    expect("contactoSoporte" in correoDeRechazoSinReembolso(PAGO, "")!.datos).toBe(false);
  });

  it("es nulo si el pago no está rechazado", () => {
    for (const estado of ["en_revision", "aprobado"] as const) {
      expect(correoDeRechazoSinReembolso({ ...PAGO, estado }, null), estado).toBeNull();
    }
  });

  it("es nulo si no hay monitoría o no está cancelada por el estudiante", () => {
    expect(correoDeRechazoSinReembolso({ ...PAGO, monitoria: null }, null)).toBeNull();
    expect(correoDeRechazoSinReembolso({ ...PAGO, monitoria: { ...PAGO.monitoria!, estado: "confirmada", motivoCancelacion: null } }, null)).toBeNull();
    expect(correoDeRechazoSinReembolso({ ...PAGO, monitoria: { ...PAGO.monitoria!, estado: "realizada", motivoCancelacion: null } }, null)).toBeNull();
    for (const motivoCancelacion of ["pago_rechazado", "monitor_no_asistio", "diferencia_no_cubierta", null] as const) {
      expect(correoDeRechazoSinReembolso({ ...PAGO, monitoria: { ...PAGO.monitoria!, motivoCancelacion } }, null), String(motivoCancelacion)).toBeNull();
    }
  });

  it("no se pisa con el correo de la cita cancelada por el rechazo: cada caso tiene el suyo", () => {
    expect(correoDeRechazo(PAGO, null)).toBeNull();
    const porRechazo = { ...PAGO, monitoria: { ...PAGO.monitoria!, motivoCancelacion: "pago_rechazado" as const } };
    expect(correoDeRechazo(porRechazo, null)).not.toBeNull();
    expect(correoDeRechazoSinReembolso(porRechazo, null)).toBeNull();
  });
});
