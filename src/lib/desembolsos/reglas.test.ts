import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agruparDesembolsos,
  avisoDeLlave,
  detallesDeTransferencia,
  esSituacion,
  grupoDe,
  hayMonto,
  partirEn,
  ROTULOS_DE_MONTOS,
  rotulosDeMontos,
  SITUACIONES,
  TEXTOS,
  textoDeSituacion,
  TRANSFERIDOS_A_LA_VISTA,
  type DesembolsoDelMonitor,
  type Situacion,
} from "./reglas";

const id = (n: number) => `d0d0d0d0-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** 11:00 a. m. en Bogotá del 30 de diciembre de 2031. */
const DESDE = new Date("2031-12-30T16:00:00.000Z");

function desembolso(n: number, cambios: Partial<DesembolsoDelMonitor> = {}): DesembolsoDelMonitor {
  return {
    idDesembolso: id(n),
    fecha: "2031-12-01",
    hora: "10:00:00",
    duracionMin: 60,
    nombreMateria: "Cálculo Diferencial",
    situacion: "listo",
    desembolsableDesde: null,
    montos: { bruto: 37_000, comision: 3_700, neto: 33_300 },
    llaveDestino: "llave-m-50",
    referencia: null,
    diaDeTransferencia: null,
    ...cambios,
  };
}

/** Un desembolso de ejemplo en cada situación, con lo que esa situación trae. */
function deEjemplo(situacion: Situacion): DesembolsoDelMonitor {
  switch (situacion) {
    case "en_plazo":
      return desembolso(1, { situacion, desembolsableDesde: DESDE });
    case "transferido":
      return desembolso(2, { situacion, referencia: "REF-50-09", diaDeTransferencia: "2031-12-30" });
    case "anulado":
      return desembolso(3, { situacion, montos: null, llaveDestino: null });
    default:
      return desembolso(4, { situacion });
  }
}

/** Sin tildes ni mayúsculas, para buscar palabras prohibidas. */
const plano = (texto: string) => texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

describe("esSituacion y grupoDe (HU-050)", () => {
  it("reconoce las siete situaciones de la base y ninguna otra", () => {
    expect([...SITUACIONES]).toEqual(["en_plazo", "listo", "pago_en_revision", "pago_rechazado", "en_espera", "transferido", "anulado"]);
    for (const situacion of SITUACIONES) expect(esSituacion(situacion), situacion).toBe(true);
    // Los motivos internos de la base no son situaciones: el monitor no los puede leer (D-59 b).
    for (const otra of ["con_reporte", "pagos_en_revision", "caso_abierto", "sin_pagos_aprobados", "no_realizada", "reporte_en_revision", "Listo", "", null, undefined, 3]) {
      expect(esSituacion(otra), String(otra)).toBe(false);
    }
  });

  it("reparte las siete en sus tres grupos", () => {
    expect(SITUACIONES.map((s) => [s, grupoDe(s)])).toEqual([
      ["en_plazo", "porTransferir"],
      ["listo", "porTransferir"],
      ["pago_en_revision", "porTransferir"],
      ["pago_rechazado", "porTransferir"],
      ["en_espera", "porTransferir"],
      ["transferido", "transferidos"],
      ["anulado", "anulados"],
    ]);
  });
});

describe("agruparDesembolsos (criterio 1 y orden de las notas técnicas)", () => {
  it("pone cada desembolso en su grupo sin perder ni duplicar ninguno ni cambiar la lista que recibe", () => {
    const lista = SITUACIONES.map((s, i) => desembolso(i + 1, { situacion: s, diaDeTransferencia: s === "transferido" ? "2031-12-30" : null }));
    const copia = [...lista];
    const grupos = agruparDesembolsos(lista);
    expect(grupos.porTransferir.map((d) => d.situacion)).toEqual(["en_plazo", "listo", "pago_en_revision", "pago_rechazado", "en_espera"]);
    expect(grupos.transferidos.map((d) => d.situacion)).toEqual(["transferido"]);
    expect(grupos.anulados.map((d) => d.situacion)).toEqual(["anulado"]);
    expect(grupos.porTransferir.length + grupos.transferidos.length + grupos.anulados.length).toBe(lista.length);
    expect(lista).toEqual(copia);
  });

  it("por transferir: el día de la sesión, el más viejo primero; la hora y el id desempatan", () => {
    const { porTransferir } = agruparDesembolsos([
      desembolso(1, { fecha: "2031-12-08" }),
      desembolso(2, { fecha: "2031-12-01", hora: "12:00:00" }),
      desembolso(4, { fecha: "2031-12-01", hora: "10:00:00" }),
      desembolso(3, { fecha: "2031-12-01", hora: "10:00:00" }),
    ]);
    expect(porTransferir.map((d) => d.idDesembolso)).toEqual([id(3), id(4), id(2), id(1)]);
  });

  it("transferidos: el día de la transferencia, el más reciente primero; después el día de la sesión y el id", () => {
    const transferido = (n: number, fecha: string, dia: string) => desembolso(n, { situacion: "transferido", fecha, diaDeTransferencia: dia });
    const { transferidos } = agruparDesembolsos([
      transferido(1, "2031-11-03", "2031-12-30"),
      transferido(2, "2031-11-10", "2031-12-30"),
      transferido(3, "2031-10-27", "2031-12-31"),
      transferido(5, "2031-11-10", "2031-12-29"),
      transferido(4, "2031-11-10", "2031-12-30"),
    ]);
    // 3 (31-dic), luego los del 30-dic con la sesión más reciente primero (2 y 4, por id), luego el 1; el 5 es del 29-dic.
    expect(transferidos.map((d) => d.idDesembolso)).toEqual([id(3), id(2), id(4), id(1), id(5)]);
  });

  it("transferidos: con el mismo día de transferencia y de sesión, la hora más tarde va primero (el id no decide antes que la hora)", () => {
    const transferido = (n: number, hora: string) =>
      desembolso(n, { situacion: "transferido", fecha: "2031-11-10", hora, diaDeTransferencia: "2031-12-30" });
    // La de las 10:00 tiene el id menor: si la hora no desempatara, saldría primero por el id.
    const { transferidos } = agruparDesembolsos([transferido(1, "10:00:00"), transferido(3, "08:00:00"), transferido(2, "12:00:00")]);
    expect(transferidos.map((d) => d.hora)).toEqual(["12:00:00", "10:00:00", "08:00:00"]);
    expect(transferidos.map((d) => d.idDesembolso)).toEqual([id(2), id(1), id(3)]);
  });

  it("anulados: el día de la sesión, el más reciente primero; después la hora y el id", () => {
    const { anulados } = agruparDesembolsos([
      desembolso(1, { situacion: "anulado", fecha: "2031-11-03" }),
      desembolso(2, { situacion: "anulado", fecha: "2031-11-10", hora: "10:00:00" }),
      desembolso(3, { situacion: "anulado", fecha: "2031-11-10", hora: "12:00:00" }),
    ]);
    expect(anulados.map((d) => d.idDesembolso)).toEqual([id(3), id(2), id(1)]);
  });

  it("una lista vacía da tres grupos vacíos", () => {
    expect(agruparDesembolsos([])).toEqual({ porTransferir: [], transferidos: [], anulados: [] });
  });
});

describe("partirEn (criterio 15)", () => {
  const numeros = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

  it("deja a la vista los primeros 10 y el resto aparte, en el mismo orden", () => {
    expect(TRANSFERIDOS_A_LA_VISTA).toBe(10);
    expect(partirEn([], 10)).toEqual({ aLaVista: [], resto: [] });
    expect(partirEn(numeros(10), 10)).toEqual({ aLaVista: numeros(10), resto: [] });
    expect(partirEn(numeros(11), 10)).toEqual({ aLaVista: numeros(10), resto: [11] });
    const grande = partirEn(numeros(25), 10);
    expect(grande.aLaVista).toEqual(numeros(10));
    expect(grande.resto).toEqual(Array.from({ length: 15 }, (_, i) => i + 11));
  });

  it("un corte negativo no corta de atrás hacia adelante", () => {
    expect(partirEn(numeros(3), -1)).toEqual({ aLaVista: [], resto: [1, 2, 3] });
  });
});

describe("textoDeSituacion y detallesDeTransferencia (textos de la HU)", () => {
  it("dice, en cada situación, la frase de la HU", () => {
    expect(textoDeSituacion(deEjemplo("en_plazo"))).toBe("Se puede transferir después del 30 de diciembre de 2031 a las 11:00 a. m.");
    expect(textoDeSituacion(deEjemplo("listo"))).toBe("Listo para transferir. Un admin lo transfiere a tu llave.");
    expect(textoDeSituacion(deEjemplo("pago_en_revision"))).toBe("En espera: un pago de esta monitoría sigue en revisión.");
    expect(textoDeSituacion(deEjemplo("pago_rechazado"))).toBe("En espera: Calibra está resolviendo un pago rechazado de esta monitoría.");
    expect(textoDeSituacion(deEjemplo("en_espera"))).toBe("En espera: Calibra tiene que resolver algo de esta monitoría antes de transferir.");
    expect(textoDeSituacion(deEjemplo("transferido"))).toBe("Transferido el 30 de diciembre de 2031.");
    expect(textoDeSituacion(deEjemplo("anulado"))).toBe(
      "Anulado: la monitoría se canceló porque se aceptó un reporte de inasistencia. No se transfiere.",
    );
  });

  it("la hora de la tarde también cierra con un solo punto", () => {
    const texto = textoDeSituacion({ situacion: "en_plazo", desembolsableDesde: new Date("2031-12-31T03:00:00Z"), diaDeTransferencia: null });
    expect(texto.endsWith("a las 10:00 p. m.")).toBe(true);
    expect(texto).not.toContain("..");
  });

  it("un transferido muestra aparte la referencia que escribió el admin y la llave copiada al crear el desembolso (RN-80)", () => {
    expect(detallesDeTransferencia(deEjemplo("transferido"))).toEqual(["Referencia: REF-50-09", "Llave: llave-m-50"]);
    for (const situacion of SITUACIONES.filter((s) => s !== "transferido")) {
      expect(detallesDeTransferencia(deEjemplo(situacion)), situacion).toEqual([]);
    }
  });

  it("no inventa lo que le falta: un en plazo sin fecha o un transferido sin día lanzan", () => {
    expect(() => textoDeSituacion({ situacion: "en_plazo", desembolsableDesde: null, diaDeTransferencia: null })).toThrow(RangeError);
    expect(() => textoDeSituacion({ situacion: "transferido", desembolsableDesde: null, diaDeTransferencia: null })).toThrow(RangeError);
  });

  it("D-59 b: solo la frase del anulado dice «reporte» o «inasistencia»; el resto no, sin importar tildes ni mayúsculas", () => {
    for (const situacion of SITUACIONES.filter((s) => s !== "anulado")) {
      const d = deEjemplo(situacion);
      const todo = [textoDeSituacion(d), ...detallesDeTransferencia(d), ...rotulosDeMontos(situacion)].join(" ");
      expect(plano(todo), situacion).not.toMatch(/reporte|inasisten/);
    }
    for (const [nombre, texto] of Object.entries(TEXTOS)) {
      if (nombre === "anulado") continue;
      expect(plano(texto), nombre).not.toMatch(/reporte|inasisten/);
    }
    expect(plano(TEXTOS.anulado)).toMatch(/reporte de inasistencia/);
    const aviso = avisoDeLlave(deEjemplo("listo"), "otra-llave", "soporte@calibra.test");
    expect(plano(`${aviso?.cambio} ${TEXTOS.siLaLlaveNoSirve}`)).not.toMatch(/reporte|inasisten/);
  });

  // Los formateadores se crean al cargar `fechas.ts`: se recarga todo con cada zona ya puesta, o usar la zona del
  // servidor (getDate, toLocaleDateString sin timeZone) no haría fallar la prueba. La integración continua corre en
  // Bogotá (ci.yml) y el equipo también, así que allí el error no se vería.
  describe("el día y la hora salen en la zona del negocio, no en la del proceso", () => {
    const zonaOriginal = process.env.TZ;
    afterEach(() => {
      if (zonaOriginal === undefined) delete process.env.TZ;
      else process.env.TZ = zonaOriginal;
      vi.resetModules();
    });

    it("las 22:00 del 30 de diciembre en Bogotá (ya 31 en UTC y 1 de enero en Kiritimati) siguen siendo el 30 a las 10:00 p. m.", async () => {
      const desfases = new Set<number>();
      for (const zona of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"]) {
        process.env.TZ = zona;
        desfases.add(new Date(2031, 11, 30, 10, 0, 0).getTimezoneOffset());
        vi.resetModules();
        const { textoDeSituacion: enEstaZona } = await import("./reglas");
        const medianoche = new Date("2031-12-31T03:00:00.000Z");
        expect(enEstaZona({ situacion: "en_plazo", desembolsableDesde: medianoche, diaDeTransferencia: null }), zona).toBe(
          "Se puede transferir después del 30 de diciembre de 2031 a las 10:00 p. m.",
        );
        // El día de la transferencia ya llega como día de Bogotá: ninguna zona lo corre.
        expect(enEstaZona({ situacion: "transferido", desembolsableDesde: null, diaDeTransferencia: "2031-12-30" }), zona).toBe(
          "Transferido el 30 de diciembre de 2031.",
        );
      }
      // Si el cambio de zona no tuvo efecto, esta prueba no probaría nada.
      expect(desfases.size).toBeGreaterThan(1);
    });
  });
});

describe("rotulosDeMontos (criterio 9, D-59 a)", () => {
  it("en un transferido son los rótulos finales, en el orden total, comisión y neto", () => {
    expect(ROTULOS_DE_MONTOS).toEqual(["Total de la monitoría", "Comisión de Calibra", "Te transferimos"]);
    expect(rotulosDeMontos("transferido")).toEqual(["Total de la monitoría", "Comisión de Calibra", "Te transferimos"]);
  });

  it("en los que se transfieren llevan «Estimado:» delante, porque son el cálculo de ahora", () => {
    for (const situacion of ["en_plazo", "listo", "pago_en_revision", "pago_rechazado", "en_espera"] as const) {
      expect(rotulosDeMontos(situacion), situacion).toEqual([
        "Estimado: total de la monitoría",
        "Estimado: comisión de Calibra",
        "Estimado: te transferimos",
      ]);
    }
  });

  it("«Estimado» no aparece en un transferido", () => {
    expect(rotulosDeMontos("transferido").join(" ")).not.toMatch(/estimado/i);
  });
});

describe("avisoDeLlave (criterio 11, HU-013)", () => {
  const porTransferir = desembolso(1, { llaveDestino: "llave-anterior" });

  it("dice a qué llave se transfiere y que cambió, con el correo si está configurado", () => {
    expect(avisoDeLlave(porTransferir, "llave-nueva", "soporte@calibra.test")).toEqual({
      cambio: "Cambiaste tu llave después de esta monitoría. Los pagos que ya estaban en camino siguen yendo a la anterior: llave-anterior.",
      escribirA: "soporte@calibra.test",
    });
    expect(TEXTOS.siLaLlaveNoSirve).toBe("Si esa llave ya no sirve, escribe a");
  });

  it("sin correo configurado omite esa línea", () => {
    expect(avisoDeLlave(porTransferir, "llave-nueva", null)?.escribirA).toBeNull();
    expect(avisoDeLlave(porTransferir, "llave-nueva", "  ")?.escribirA).toBeNull();
  });

  it("no avisa si las llaves son iguales (con o sin espacios de más)", () => {
    expect(avisoDeLlave(porTransferir, "llave-anterior", "soporte@calibra.test")).toBeNull();
    expect(avisoDeLlave(porTransferir, " llave-anterior ", "soporte@calibra.test")).toBeNull();
  });

  it("no avisa si no se sabe la llave de hoy o la del desembolso", () => {
    expect(avisoDeLlave(porTransferir, null, "soporte@calibra.test")).toBeNull();
    expect(avisoDeLlave(porTransferir, "", "soporte@calibra.test")).toBeNull();
    expect(avisoDeLlave(desembolso(1, { llaveDestino: null }), "llave-nueva", "soporte@calibra.test")).toBeNull();
  });

  it("solo aplica a los que se van a transferir: no a un transferido (su llave ya es la que fue) ni a un anulado", () => {
    for (const situacion of ["en_plazo", "listo", "pago_en_revision", "pago_rechazado", "en_espera"] as const) {
      expect(avisoDeLlave(desembolso(1, { situacion, llaveDestino: "llave-anterior" }), "llave-nueva", null), situacion).not.toBeNull();
    }
    expect(avisoDeLlave(deEjemplo("transferido"), "llave-nueva", "soporte@calibra.test")).toBeNull();
    expect(avisoDeLlave(deEjemplo("anulado"), "llave-nueva", "soporte@calibra.test")).toBeNull();
  });
});

describe("hayMonto (supuesto 5)", () => {
  it("con un bruto mayor que 0 hay cifras", () => {
    expect(hayMonto(desembolso(1))).toBe(true);
  });

  it("un por transferir con bruto 0 no pinta tres ceros", () => {
    expect(hayMonto(desembolso(1, { montos: { bruto: 0, comision: 0, neto: 0 } }))).toBe(false);
  });

  it("un anulado no tiene cifras", () => {
    expect(hayMonto(deEjemplo("anulado"))).toBe(false);
  });

  it("un transferido siempre muestra lo que se transfirió", () => {
    expect(hayMonto(desembolso(1, { situacion: "transferido", montos: { bruto: 0, comision: 0, neto: 0 } }))).toBe(true);
  });
});
