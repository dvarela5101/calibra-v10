import { describe, expect, it } from "vitest";
import {
  cancelacionDeEstudiante,
  cancelacionVigente,
  datosDeCancelacion,
  esResultadoDeCancelar,
  mensajeDeCancelar,
  RESULTADOS_DE_CANCELAR,
  textoDeFueraDePlazo,
  type DatosDeCancelacionCita,
  type LlaveDeCancelacion,
} from "./cancelar-reglas";

const TOKEN_CITA = "c".repeat(64);
const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
const SITIO = "https://calibra.test";
const url = (ruta: string) => `${SITIO}${ruta}`;

const D: DatosDeCancelacionCita = {
  creadaEn: "2020-01-12T20:00:00.000Z",
  correoDestino: "ana@calibra.test",
  conPagoEnRevision: false,
  reembolsoAOtroContacto: false,
  estado: "cancelada",
  motivo: "estudiante",
  grupal: false,
  nombreLead: "Ana",
  nombreMateria: "Cálculo Integral",
  inicio: "2020-01-13T15:00:00.000Z",
  tokenCita: TOKEN_CITA,
};

const LLAVES: LlaveDeCancelacion[] = [
  { idReembolso: "00000000-0000-4000-8000-000000000001", monto: 15_000, token: TOKEN_A },
  { idReembolso: "00000000-0000-4000-8000-000000000002", monto: 10_000, token: TOKEN_B },
];

describe("los resultados de cancelar (HU-024)", () => {
  it("son los seis que devuelven las puertas de la base, en este orden", () => {
    expect([...RESULTADOS_DE_CANCELAR]).toEqual(["cancelada", "ya_cancelada", "fuera_de_plazo", "no_cancelable", "no_individual", "no_existe"]);
  });

  it("esResultadoDeCancelar reconoce los seis y nada más (ya no existe sin_admin, D-28)", () => {
    for (const resultado of RESULTADOS_DE_CANCELAR) expect(esResultadoDeCancelar(resultado), resultado).toBe(true);
    for (const malo of ["sin_admin", "", "Cancelada", "registrado", null, undefined, 1, ["cancelada"]]) {
      expect(esResultadoDeCancelar(malo), JSON.stringify(malo)).toBe(false);
    }
  });
});

describe("mensajeDeCancelar", () => {
  it("cancelada y ya_cancelada no llevan mensaje: la página ya muestra la cita cancelada", () => {
    expect(mensajeDeCancelar("cancelada")).toBeNull();
    expect(mensajeDeCancelar("ya_cancelada")).toBeNull();
    expect(mensajeDeCancelar("cancelada", "ayuda@calibra.test")).toBeNull();
  });

  it("fuera de plazo: los casos de fuerza mayor los resuelve un admin, con el correo de soporte si lo hay (criterio 3)", () => {
    expect(mensajeDeCancelar("fuera_de_plazo", "ayuda@calibra.test")).toBe(
      "Pasó el plazo para cancelarla. Los casos de fuerza mayor los resuelve un admin: escríbenos a ayuda@calibra.test.",
    );
    expect(mensajeDeCancelar("fuera_de_plazo")).toBe("Pasó el plazo para cancelarla. Los casos de fuerza mayor los resuelve un admin.");
    expect(mensajeDeCancelar("fuera_de_plazo", null)).toBe("Pasó el plazo para cancelarla. Los casos de fuerza mayor los resuelve un admin.");
  });

  it("textoDeFueraDePlazo no promete un canal que no existe: un correo vacío o en blanco cuenta como ninguno", () => {
    for (const vacio of [null, "", "   "]) {
      expect(textoDeFueraDePlazo(vacio), JSON.stringify(vacio)).toBe("Pasó el plazo para cancelarla. Los casos de fuerza mayor los resuelve un admin.");
    }
    expect(textoDeFueraDePlazo("  ayuda@calibra.test  ")).toContain("escríbenos a ayuda@calibra.test.");
    expect(textoDeFueraDePlazo()).not.toContain("escríbenos");
  });

  it("los demás resultados dicen algo a la persona, sin comisión ni nada del monitor", () => {
    for (const resultado of ["no_cancelable", "no_individual", "no_existe"] as const) {
      const mensaje = mensajeDeCancelar(resultado);
      expect(mensaje, resultado).toEqual(expect.any(String));
      expect(mensaje!.length).toBeGreaterThan(0);
      expect(mensaje).not.toMatch(/comisi|neto|monitor@|\.\./i);
    }
    // No distingue "no existe" de "es de otra persona".
    expect(mensajeDeCancelar("no_existe")).not.toMatch(/otra persona|ajena/i);
  });

  it("todo resultado tiene mensaje o es uno de los dos que no lo llevan", () => {
    const sinMensaje = RESULTADOS_DE_CANCELAR.filter((r) => mensajeDeCancelar(r) === null);
    expect(sinMensaje).toEqual(["cancelada", "ya_cancelada"]);
  });
});

describe("cancelacionDeEstudiante", () => {
  it("es cierta solo con la cita cancelada por el estudiante y individual, sin mirar el correo", () => {
    expect(cancelacionDeEstudiante(D)).toBe(true);
    const sinCorreo = { ...D, correoDestino: null };
    expect(cancelacionDeEstudiante(sinCorreo)).toBe(true);
    expect(cancelacionVigente(sinCorreo)).toBe(false);
    expect(cancelacionDeEstudiante({ ...D, estado: "confirmada" })).toBe(false);
    expect(cancelacionDeEstudiante({ ...D, motivo: null })).toBe(false);
    expect(cancelacionDeEstudiante({ ...D, grupal: true })).toBe(false);
  });
});

describe("cancelacionVigente", () => {
  it("vale mientras la cita siga cancelada por el estudiante, individual y con a quién escribirle", () => {
    expect(cancelacionVigente(D)).toBe(true);
  });

  it("no vale si la cita no está cancelada o se canceló por otro motivo", () => {
    expect(cancelacionVigente({ ...D, estado: "confirmada" })).toBe(false);
    expect(cancelacionVigente({ ...D, estado: "pendiente_pago" })).toBe(false);
    expect(cancelacionVigente({ ...D, estado: "realizada" })).toBe(false);
    for (const motivo of ["pago_rechazado", "reserva_expirada", "monitor_no_asistio", "diferencia_no_cubierta", null] as const) {
      expect(cancelacionVigente({ ...D, motivo }), String(motivo)).toBe(false);
    }
  });

  it("no vale para una grupal", () => {
    expect(cancelacionVigente({ ...D, grupal: true })).toBe(false);
  });

  it("no vale sin correo al que escribirle: null, vacío o en blanco", () => {
    for (const correoDestino of [null, "", "   "]) {
      expect(cancelacionVigente({ ...D, correoDestino }), JSON.stringify(correoDestino)).toBe(false);
    }
  });

  it("no depende de la hora: avisar de una cancelación sirve igual al reintentarlo después de la sesión", () => {
    // La cita de ejemplo es de 2020, ya pasada, y la función no recibe el reloj: sigue vigente.
    expect(cancelacionVigente(D)).toBe(true);
  });
});

describe("datosDeCancelacion", () => {
  it("arma los datos de la plantilla: los reembolsos que pide el correo con el enlace de cada llave, y el enlace de la cita", () => {
    expect(datosDeCancelacion(D, LLAVES, url)).toEqual({
      nombre: "Ana",
      materia: "Cálculo Integral",
      inicio: "2020-01-13T15:00:00.000Z",
      reembolsos: [
        { monto: 15_000, enlace: `${SITIO}/reembolso?token=${TOKEN_A}` },
        { monto: 10_000, enlace: `${SITIO}/reembolso?token=${TOKEN_B}` },
      ],
      conPagoEnRevision: false,
      reembolsoAOtroContacto: false,
      enlaceCita: `${SITIO}/cita?token=${TOKEN_CITA}`,
    });
  });

  it("conserva el orden de las llaves (el de la base: fecha de generación y id) y copia los dos avisos", () => {
    const datos = datosDeCancelacion({ ...D, conPagoEnRevision: true, reembolsoAOtroContacto: true }, [...LLAVES].reverse(), url);
    expect(datos.reembolsos.map((r) => r.monto)).toEqual([10_000, 15_000]);
    expect(datos).toMatchObject({ conPagoEnRevision: true, reembolsoAOtroContacto: true });
  });

  it("sin llaves no hay reembolsos que pedir (pago en revisión o pagos de otro contacto)", () => {
    expect(datosDeCancelacion(D, [], url).reembolsos).toEqual([]);
  });

  it("sin token de la cita, el enlace de la cita es null", () => {
    expect(datosDeCancelacion({ ...D, tokenCita: null }, LLAVES, url).enlaceCita).toBeNull();
    expect(datosDeCancelacion({ ...D, tokenCita: "  " }, LLAVES, url).enlaceCita).toBeNull();
  });

  it("los enlaces los arma quien llama con la ruta: la del reembolso y la de la cita", () => {
    const rutas: string[] = [];
    datosDeCancelacion(D, LLAVES.slice(0, 1), (ruta) => {
      rutas.push(ruta);
      return ruta;
    });
    expect(rutas).toEqual([`/reembolso?token=${TOKEN_A}`, `/cita?token=${TOKEN_CITA}`]);
  });

  it("no lleva correo, token ni id de reembolso como campo: solo los enlaces ya armados (D-27)", () => {
    const datos = datosDeCancelacion(D, LLAVES, url);
    expect(Object.keys(datos).sort()).toEqual(
      ["conPagoEnRevision", "enlaceCita", "inicio", "materia", "nombre", "reembolsoAOtroContacto", "reembolsos"].sort(),
    );
    for (const r of datos.reembolsos) expect(Object.keys(r).sort()).toEqual(["enlace", "monto"]);
    expect(JSON.stringify(datos)).not.toContain("ana@calibra.test");
    expect(JSON.stringify(datos)).not.toContain("00000000-0000-4000");
  });

  it("es determinista: los mismos datos dan los mismos datos de plantilla", () => {
    expect(datosDeCancelacion(D, LLAVES, url)).toEqual(datosDeCancelacion({ ...D }, [...LLAVES], url));
  });
});
