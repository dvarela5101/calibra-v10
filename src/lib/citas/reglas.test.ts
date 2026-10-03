import { describe, expect, it } from "vitest";
import {
  citaDeFila,
  confirmacionVigente,
  datosDeConfirmacion,
  momentoDeCita,
  rutaDeCita,
  rutaDeMiCita,
  RUTA_DE_CITAS,
  textoDelDineroAlCancelar,
  textoDelMotivo,
  textoDelReembolso,
  tieneFormaDeTokenDeCita,
  vistaDeCita,
  type Cita,
  type DatosDeConfirmacionCita,
  type FilaDeCita,
} from "./reglas";

const TOKEN = "c".repeat(64);
const HORA = 3_600_000;

// Una sesión de 90 minutos que empieza el 13 de enero de 2020 a las 10:00 a. m. en Bogotá (15:00 UTC).
const INICIO = new Date("2020-01-13T15:00:00.000Z");
const FIN = new Date(INICIO.getTime() + 90 * 60_000);
const CANCELABLE_HASTA = new Date(INICIO.getTime() - 12 * HORA);
const REPORTE_HASTA = new Date(FIN.getTime() + 24 * HORA);

const CITA: Cita = {
  idMonitoria: "00000000-0000-4000-8000-000000000001",
  estado: "confirmada",
  motivoCancelacion: null,
  nombreMonitor: "Camilo Rojas",
  nombreMateria: "Cálculo Integral",
  codigoMateria: "MATE1203",
  fecha: "2020-01-13",
  hora: "10:00:00",
  duracionMin: 90,
  presencial: true,
  valorTotal: 25_000,
  lugar: "Edificio Principal, salón 301",
  enlace: null,
  inicio: INICIO,
  finProgramado: FIN,
  cancelableHasta: CANCELABLE_HASTA,
  reporteHasta: REPORTE_HASTA,
  estadoPago: "en_revision",
  estadoReembolso: null,
  estadoReporte: null,
};

const cita = (cambios: Partial<Cita> = {}): Cita => ({ ...CITA, ...cambios });
const en = (instante: Date, milisegundos: number) => new Date(instante.getTime() + milisegundos);
const plano = (texto: string | null) => (texto ?? "").replace(/[  ]/g, " ");

describe("el enlace del correo (HU-019, D-20)", () => {
  it("la ruta del enlace lleva el token y la de una cita de la sesión, el id", () => {
    expect(RUTA_DE_CITAS).toBe("/cita");
    expect(rutaDeCita(TOKEN)).toBe(`/cita?token=${TOKEN}`);
    expect(rutaDeMiCita(CITA.idMonitoria)).toBe(`/cita/${CITA.idMonitoria}`);
  });

  it("reconoce 64 hexadecimales en minúscula y nada más", () => {
    expect(tieneFormaDeTokenDeCita(TOKEN)).toBe(true);
    expect(tieneFormaDeTokenDeCita("0123456789abcdef".repeat(4))).toBe(true);
    for (const malo of ["A".repeat(64), "c".repeat(63), "c".repeat(65), `${"c".repeat(63)}\n`, `${"c".repeat(63)}g`, "", " ".repeat(64)]) {
      expect(tieneFormaDeTokenDeCita(malo), JSON.stringify(malo)).toBe(false);
    }
    expect(tieneFormaDeTokenDeCita(undefined)).toBe(false);
    expect(tieneFormaDeTokenDeCita(null)).toBe(false);
    // `?token=a&token=b` llega como lista: no es un token.
    expect(tieneFormaDeTokenDeCita([TOKEN, TOKEN])).toBe(false);
  });
});

describe("citaDeFila", () => {
  const FILA: FilaDeCita = {
    id_monitoria: CITA.idMonitoria,
    estado: "confirmada",
    motivo_cancelacion: null,
    nombre_monitor: "Camilo Rojas",
    nombre_materia: "Cálculo Integral",
    codigo_materia: "MATE1203",
    fecha: "2020-01-13",
    hora: "10:00:00",
    duracion_min: 90,
    presencial: true,
    valor_total: 25_000,
    lugar: "Edificio Principal, salón 301",
    enlace: null,
    inicio: "2020-01-13T15:00:00+00:00",
    fin_programado: "2020-01-13T16:30:00+00:00",
    cancelable_hasta: "2020-01-13T03:00:00+00:00",
    reporte_hasta: "2020-01-14T16:30:00+00:00",
    estado_pago: "en_revision",
    estado_reembolso: null,
    estado_reporte: null,
  };

  it("lee las fechas como Date y copia el resto", () => {
    expect(citaDeFila(FILA)).toEqual(CITA);
  });

  it("ignora columnas de más, como el id del Lead", () => {
    expect(citaDeFila({ ...FILA, id_lead: "x" } as FilaDeCita)).toEqual(CITA);
  });

  it("conserva el motivo, el reembolso y el reporte cuando los hay", () => {
    const leida = citaDeFila({
      ...FILA,
      estado: "cancelada",
      motivo_cancelacion: "monitor_no_asistio",
      estado_reembolso: "esperando_llave",
      estado_reporte: "aceptado",
    });
    expect(leida).toMatchObject({ estado: "cancelada", motivoCancelacion: "monitor_no_asistio", estadoReembolso: "esperando_llave", estadoReporte: "aceptado" });
  });

  it.each([
    ["estado", { estado: "archivada" }],
    ["motivo_cancelacion", { motivo_cancelacion: "porque_si" }],
    ["estado_pago", { estado_pago: "pagado" }],
    ["estado_reembolso", { estado_reembolso: "hecho" }],
    ["estado_reporte", { estado_reporte: "perdido" }],
    ["inicio", { inicio: "mañana" }],
    ["fin_programado", { fin_programado: "" }],
    ["cancelable_hasta", { cancelable_hasta: "x" }],
    ["reporte_hasta", { reporte_hasta: "x" }],
  ] as const)("lanza si %s trae un valor desconocido", (_campo, cambios) => {
    expect(() => citaDeFila({ ...FILA, ...cambios })).toThrow();
  });
});

describe("momentoDeCita", () => {
  it("antes del inicio, en curso (con inicio y fin incluidos, P-40) y terminada", () => {
    expect(momentoDeCita(CITA, en(INICIO, -1))).toBe("antes");
    expect(momentoDeCita(CITA, INICIO)).toBe("en_curso");
    expect(momentoDeCita(CITA, FIN)).toBe("en_curso");
    expect(momentoDeCita(CITA, en(FIN, 1))).toBe("terminada");
  });
});

describe("vistaDeCita: confirmada antes del inicio (criterio 2 de HU-019)", () => {
  it("con plazo: dice que está confirmada, hasta cuándo se puede cancelar y cuánto queda, y habilita cancelar", () => {
    const ahora = en(CANCELABLE_HASTA, -4 * HORA);
    const vista = vistaDeCita(CITA, ahora);
    expect(vista).toMatchObject({ tipo: "confirmada", momento: "antes", titulo: "Tu monitoría está confirmada", puedeCancelar: true, puedeReportar: false });
    // 03:00 UTC son las 10:00 p. m. del domingo 12 en Bogotá.
    expect(plano(vista.textoDelPlazo)).toBe("Puedes cancelarla hasta el domingo, 12 de enero de 2020, 10:00 p. m. Quedan 4 h.");
  });

  it("el plazo es inclusivo (P-40): con el límite exacto todavía se puede cancelar, un instante después no", () => {
    expect(vistaDeCita(CITA, CANCELABLE_HASTA).puedeCancelar).toBe(true);
    const tarde = vistaDeCita(CITA, en(CANCELABLE_HASTA, 1));
    expect(tarde.puedeCancelar).toBe(false);
    expect(plano(tarde.textoDelPlazo)).toBe("El plazo para cancelarla terminó el domingo, 12 de enero de 2020, 10:00 p. m.");
  });

  it("sin plazo desde el principio (agendada con poca antelación, RN-37): nunca ofrece cancelar", () => {
    const ahora = en(INICIO, -2 * HORA);
    const vista = vistaDeCita(CITA, ahora);
    expect(vista.puedeCancelar).toBe(false);
    expect(vista.textoDelPlazo).toContain("El plazo para cancelarla terminó");
    expect(vista.titulo).toBe("Tu monitoría está confirmada");
  });

  it("sin plazo y antes del inicio hay que explicar los casos de fuerza mayor (criterio 3 de HU-024); con plazo no", () => {
    expect(vistaDeCita(CITA, en(CANCELABLE_HASTA, -HORA)).mostrarCasosExtremos).toBe(false);
    expect(vistaDeCita(CITA, CANCELABLE_HASTA).mostrarCasosExtremos).toBe(false); // borde inclusivo (P-40)
    expect(vistaDeCita(CITA, en(CANCELABLE_HASTA, 1))).toMatchObject({ puedeCancelar: false, mostrarCasosExtremos: true });
    // Agendada con poca antelación (RN-37): nunca tuvo plazo.
    expect(vistaDeCita(CITA, en(INICIO, -2 * HORA))).toMatchObject({ puedeCancelar: false, mostrarCasosExtremos: true });
  });

  it("muestra el lugar o el enlace (D-21) y el pago en revisión con el texto de D-22 adaptado a la página", () => {
    const vista = vistaDeCita(CITA, en(INICIO, -6 * HORA));
    expect(vista.mostrarLugarYEnlace).toBe(true);
    expect(vista.textoDelPago).toBe("Recibimos tu comprobante. Un admin lo revisa y, si hay algún problema, te avisamos por correo.");
    expect(vista.textoDelMotivo).toBeNull();
    expect(vista.textoDelEstado).toBeNull();
  });

  it("dice del pago lo que toca: aprobado, rechazado o nada si no hay pago", () => {
    const ahora = en(INICIO, -6 * HORA);
    expect(vistaDeCita(cita({ estadoPago: "aprobado" }), ahora).textoDelPago).toBe("Tu pago está aprobado.");
    expect(vistaDeCita(cita({ estadoPago: "rechazado" }), ahora).textoDelPago).toBe("No pudimos verificar tu pago.");
    expect(vistaDeCita(cita({ estadoPago: "sin_pagar" }), ahora).textoDelPago).toBeNull();
  });

  it("si el pago se rechazó deja de mostrar el lugar y el enlace aunque la cita aún figure confirmada (D-21)", () => {
    expect(vistaDeCita(cita({ estadoPago: "rechazado" }), en(INICIO, -6 * HORA)).mostrarLugarYEnlace).toBe(false);
  });
});

describe("vistaDeCita: confirmada en curso o terminada", () => {
  it("en curso: ya empezó, sin plazo para cancelar, con lugar o enlace y ya se puede reportar (RN-64)", () => {
    const vista = vistaDeCita(CITA, en(INICIO, 30 * 60_000));
    expect(vista).toMatchObject({
      tipo: "confirmada",
      momento: "en_curso",
      titulo: "Tu monitoría ya empezó",
      textoDelPlazo: null,
      puedeCancelar: false,
      mostrarCasosExtremos: false,
      puedeReportar: true,
      mostrarLugarYEnlace: true,
    });
  });

  it("terminada: dice que el monitor la marcará como realizada, sin lugar ni enlace, y se puede reportar hasta 24 h después del fin", () => {
    const vista = vistaDeCita(CITA, en(FIN, 60 * 60_000));
    expect(vista).toMatchObject({
      momento: "terminada",
      titulo: "Tu monitoría ya terminó",
      textoDelEstado: "El monitor la marcará como realizada.",
      textoDelPago: null,
      puedeCancelar: false,
      mostrarCasosExtremos: false,
      puedeReportar: true,
      mostrarLugarYEnlace: false,
    });
  });

  it("el reporte tiene borde inclusivo en reporteHasta y no se ofrece si ya hay uno", () => {
    expect(vistaDeCita(CITA, REPORTE_HASTA).puedeReportar).toBe(true);
    expect(vistaDeCita(CITA, en(REPORTE_HASTA, 1)).puedeReportar).toBe(false);
    expect(vistaDeCita(cita({ estadoReporte: "en_revision" }), en(INICIO, 60_000)).puedeReportar).toBe(false);
  });

  it("antes del inicio no se puede reportar", () => {
    expect(vistaDeCita(CITA, en(INICIO, -1)).puedeReportar).toBe(false);
  });
});

describe("vistaDeCita: realizada", () => {
  const realizada = cita({ estado: "realizada" });

  it("dice que se realizó, sin lugar ni enlace, sin cancelar y con reporte hasta 24 h después del fin (RN-62)", () => {
    const vista = vistaDeCita(realizada, en(FIN, 2 * HORA));
    expect(vista).toMatchObject({ tipo: "realizada", momento: null, titulo: "Tu monitoría se realizó", puedeCancelar: false, puedeReportar: true, mostrarLugarYEnlace: false });
    expect(vista.textoDelPlazo).toBeNull();
    expect(vista.textoDelPago).toBeNull();
  });

  it("pasado el plazo del reporte ya no se ofrece", () => {
    expect(vistaDeCita(realizada, en(REPORTE_HASTA, 1)).puedeReportar).toBe(false);
  });
});

describe("vistaDeCita: cancelada", () => {
  it("dice el motivo en palabras, sin lugar ni enlace ni acciones", () => {
    const vista = vistaDeCita(cita({ estado: "cancelada", motivoCancelacion: "pago_rechazado", estadoPago: "rechazado" }), en(INICIO, -6 * HORA));
    expect(vista).toMatchObject({
      tipo: "cancelada",
      momento: null,
      titulo: "Esta monitoría se canceló",
      textoDelMotivo: "No pudimos verificar tu pago, así que la monitoría se canceló y no hay reembolso.",
      puedeCancelar: false,
      puedeReportar: false,
      mostrarLugarYEnlace: false,
    });
  });

  it("dice qué pasa con el reembolso si lo hay", () => {
    const vista = vistaDeCita(cita({ estado: "cancelada", motivoCancelacion: "estudiante", estadoReembolso: "esperando_llave" }), en(INICIO, -6 * HORA));
    expect(vista.textoDelReembolso).toBe("Vamos a devolverte el dinero. Te escribimos al correo del pago para pedirte la llave.");
    expect(vistaDeCita(cita({ estado: "cancelada", motivoCancelacion: "estudiante" }), INICIO).textoDelReembolso).toBeNull();
  });

  it("cancelada por el estudiante con el pago en revisión (P-07): todavía no hay reembolso y se dice qué pasa según se resuelva (D-27)", () => {
    const vista = vistaDeCita(cita({ estado: "cancelada", motivoCancelacion: "estudiante", estadoPago: "en_revision" }), en(INICIO, -6 * HORA));
    expect(vista.textoDelPago).toBe(
      "Tu pago todavía está en revisión. Si se aprueba, te pedimos la llave para devolverte el dinero; si se rechaza, no hay reembolso.",
    );
    expect(vista.textoDelReembolso).toBeNull();
  });

  it("cancelada por el estudiante con el pago rechazado: no hay reembolso", () => {
    const vista = vistaDeCita(cita({ estado: "cancelada", motivoCancelacion: "estudiante", estadoPago: "rechazado" }), en(INICIO, -6 * HORA));
    expect(vista.textoDelPago).toBe("Tu pago no se aprobó, así que no hay reembolso.");
  });

  it("cancelada por el estudiante con el reembolso ya creado, o con un pago que no hay que reembolsar, no dice nada del pago", () => {
    const ahora = en(INICIO, -6 * HORA);
    const estudiante = { estado: "cancelada", motivoCancelacion: "estudiante" } as const;
    // El pago se aprobó después de cancelar (P-07): ya hay reembolso y lo dice textoDelReembolso, no textoDelPago.
    const tarde = vistaDeCita(cita({ ...estudiante, estadoPago: "aprobado", estadoReembolso: "esperando_llave" }), ahora);
    expect(tarde.textoDelPago).toBeNull();
    expect(tarde.textoDelReembolso).toContain("Vamos a devolverte el dinero");
    expect(vistaDeCita(cita({ ...estudiante, estadoPago: "en_revision", estadoReembolso: "esperando_llave" }), ahora).textoDelPago).toBeNull();
    expect(vistaDeCita(cita({ ...estudiante, estadoPago: "aprobado" }), ahora).textoDelPago).toBeNull();
    expect(vistaDeCita(cita({ ...estudiante, estadoPago: "sin_pagar" }), ahora).textoDelPago).toBeNull();
  });

  it("las canceladas por otro motivo no dicen nada del pago: su motivo ya lo explica", () => {
    for (const motivoCancelacion of ["pago_rechazado", "monitor_no_asistio", "diferencia_no_cubierta", "reserva_expirada", null] as const) {
      for (const estadoPago of ["en_revision", "rechazado"] as const) {
        expect(vistaDeCita(cita({ estado: "cancelada", motivoCancelacion, estadoPago }), INICIO).textoDelPago, `${motivoCancelacion} ${estadoPago}`).toBeNull();
      }
    }
  });

  it("una cancelada nunca ofrece cancelar ni explica casos de fuerza mayor", () => {
    expect(vistaDeCita(cita({ estado: "cancelada", motivoCancelacion: "estudiante" }), en(INICIO, -6 * HORA))).toMatchObject({
      puedeCancelar: false,
      mostrarCasosExtremos: false,
    });
  });

  it("textoDelMotivo cubre cada motivo y la ausencia de motivo", () => {
    expect(textoDelMotivo("estudiante")).toBe("La cancelaste tú.");
    expect(textoDelMotivo("monitor_no_asistio")).toBe("El monitor no asistió y se aceptó tu reporte.");
    expect(textoDelMotivo("diferencia_no_cubierta")).toBe("No se cubrió a tiempo la diferencia del pago.");
    expect(textoDelMotivo("reserva_expirada")).toBe("La reserva venció porque el comprobante de pago no llegó a tiempo.");
    expect(textoDelMotivo("pago_rechazado")).toContain("no hay reembolso");
    expect(textoDelMotivo(null)).toBe("La monitoría se canceló.");
  });

  it("textoDelReembolso cubre los tres estados", () => {
    expect(textoDelReembolso("pendiente")).toBe("Recibimos tu llave. Estamos haciendo la devolución del dinero.");
    expect(textoDelReembolso("reembolsado")).toBe("Ya te devolvimos el dinero.");
    expect(textoDelReembolso(null)).toBeNull();
  });
});

describe("vistaDeCita: pendiente de pago", () => {
  it("es solo el respaldo: la página manda estas a la reserva", () => {
    const vista = vistaDeCita(cita({ estado: "pendiente_pago", estadoPago: "sin_pagar", lugar: null }), en(INICIO, -6 * HORA));
    expect(vista).toMatchObject({ tipo: "pendiente_pago", puedeCancelar: false, mostrarCasosExtremos: false, puedeReportar: false, mostrarLugarYEnlace: false });
  });
});

describe("textoDelDineroAlCancelar (HU-024, paso de confirmación)", () => {
  it("con el pago aprobado, que se devuelve completo y se pide la llave por correo", () => {
    expect(textoDelDineroAlCancelar("aprobado")).toBe("Te devolvemos el valor completo: te pedimos la llave por correo.");
  });

  it("con el pago en revisión, el texto de D-27 (el mismo del correo)", () => {
    expect(textoDelDineroAlCancelar("en_revision")).toBe(
      "Tu pago todavía está en revisión. Si se aprueba, te pedimos la llave para devolverte el dinero; si se rechaza, no hay reembolso.",
    );
  });

  it("sin pago aprobado ni en revisión no hay nada que decir del dinero", () => {
    expect(textoDelDineroAlCancelar("rechazado")).toBeNull();
    expect(textoDelDineroAlCancelar("sin_pagar")).toBeNull();
  });
});

describe("lo que muestra la página no lleva comisión ni contacto del monitor (P-37, P-32)", () => {
  it("ningún texto de ninguna vista habla de comisión", () => {
    const casos: Cita[] = [
      CITA,
      cita({ estado: "realizada" }),
      cita({ estado: "cancelada", motivoCancelacion: "monitor_no_asistio", estadoReembolso: "reembolsado" }),
      cita({ estado: "cancelada", motivoCancelacion: "estudiante", estadoPago: "en_revision" }),
      cita({ estado: "cancelada", motivoCancelacion: "estudiante", estadoPago: "rechazado" }),
      cita({ estado: "pendiente_pago" }),
    ];
    for (const caso of casos) {
      for (const ahora of [en(INICIO, -6 * HORA), en(INICIO, 30 * 60_000), en(FIN, HORA)]) {
        const textos = Object.values(vistaDeCita(caso, ahora)).filter((v): v is string => typeof v === "string");
        for (const texto of textos) expect(texto).not.toMatch(/comisi|neto/i);
      }
    }
    for (const estadoPago of ["aprobado", "en_revision", "rechazado", "sin_pagar"] as const) {
      expect(textoDelDineroAlCancelar(estadoPago) ?? "").not.toMatch(/comisi|neto/i);
    }
    expect(Object.keys(CITA).filter((campo) => /comisi|correo|telefono|contacto/i.test(campo))).toEqual([]);
  });
});

describe("la confirmación por correo", () => {
  const D: DatosDeConfirmacionCita = {
    token: TOKEN,
    creadaEn: "2020-01-10T14:00:00.000Z",
    estado: "confirmada",
    grupal: false,
    correoDestino: "ana@calibra.test",
    nombreLead: "Ana",
    nombreMonitor: "Camilo Rojas",
    nombreMateria: "Cálculo Integral",
    inicio: INICIO.toISOString(),
    duracionMin: 90,
    presencial: true,
    lugar: "Edificio Principal, salón 301",
    enlace: null,
    valorTotal: 25_000,
    cancelableHasta: CANCELABLE_HASTA.toISOString(),
  };
  const ENLACE = "https://calibra.test/cita?token=abc";

  describe("confirmacionVigente", () => {
    const antes = en(INICIO, -HORA);

    it("vale mientras la cita siga confirmada, individual y sin empezar", () => {
      expect(confirmacionVigente(D, antes)).toBe(true);
    });

    it("no vale si el admin rechazó el pago (cancelada) o si ya se realizó", () => {
      expect(confirmacionVigente({ ...D, estado: "cancelada" }, antes)).toBe(false);
      expect(confirmacionVigente({ ...D, estado: "realizada" }, antes)).toBe(false);
      expect(confirmacionVigente({ ...D, estado: "pendiente_pago" }, antes)).toBe(false);
    });

    it("no vale para una grupal", () => {
      expect(confirmacionVigente({ ...D, grupal: true }, antes)).toBe(false);
    });

    it("no vale si la sesión ya empezó: el correo llegaría tarde (con el inicio exacto, tampoco)", () => {
      expect(confirmacionVigente(D, en(INICIO, -1))).toBe(true);
      expect(confirmacionVigente(D, INICIO)).toBe(false);
      expect(confirmacionVigente(D, en(INICIO, HORA))).toBe(false);
    });
  });

  describe("datosDeConfirmacion", () => {
    it("arma los datos de la plantilla con el enlace de gestión, sin correo, contacto ni comisión", () => {
      const datos = datosDeConfirmacion(D, ENLACE);
      expect(datos).toEqual({
        nombre: "Ana",
        nombreMonitor: "Camilo Rojas",
        materia: "Cálculo Integral",
        inicio: INICIO.toISOString(),
        duracionMin: 90,
        presencial: true,
        valorTotal: 25_000,
        lugar: "Edificio Principal, salón 301",
        enlaceSesion: null,
        cancelableHasta: CANCELABLE_HASTA.toISOString(),
        enlace: ENLACE,
      });
      expect(Object.keys(datos).filter((campo) => /comisi|correo|telefono|contacto|token/i.test(campo))).toEqual([]);
    });

    it("una virtual lleva el enlace de la videollamada y no el lugar", () => {
      const datos = datosDeConfirmacion({ ...D, presencial: false, lugar: "Edificio", enlace: "https://meet.example/abc" }, ENLACE);
      expect(datos).toMatchObject({ presencial: false, lugar: null, enlaceSesion: "https://meet.example/abc" });
    });

    it("una presencial no lleva el enlace de la videollamada aunque la franja lo traiga", () => {
      expect(datosDeConfirmacion({ ...D, enlace: "https://meet.example/abc" }, ENLACE)).toMatchObject({ lugar: "Edificio Principal, salón 301", enlaceSesion: null });
    });

    it("un lugar o enlace vacío o en blanco queda en null: la plantilla no inventa la línea", () => {
      expect(datosDeConfirmacion({ ...D, lugar: "   " }, ENLACE).lugar).toBeNull();
      expect(datosDeConfirmacion({ ...D, lugar: null }, ENLACE).lugar).toBeNull();
      expect(datosDeConfirmacion({ ...D, presencial: false, enlace: "" }, ENLACE).enlaceSesion).toBeNull();
      expect(datosDeConfirmacion({ ...D, lugar: "  Salón 3  " }, ENLACE).lugar).toBe("Salón 3");
    });

    it("el plazo de cancelación es null si ya había pasado cuando se confirmó la cita (RN-37), y lo decide un dato fijo, no el reloj", () => {
      const tarde = { ...D, creadaEn: en(CANCELABLE_HASTA, 1).toISOString() };
      expect(datosDeConfirmacion(tarde, ENLACE).cancelableHasta).toBeNull();
      // Con el límite exacto todavía se podía cancelar (P-40).
      const justo = { ...D, creadaEn: CANCELABLE_HASTA.toISOString() };
      expect(datosDeConfirmacion(justo, ENLACE).cancelableHasta).toBe(CANCELABLE_HASTA.toISOString());
    });

    it("es determinista: los mismos datos dan los mismos datos de plantilla", () => {
      expect(datosDeConfirmacion(D, ENLACE)).toEqual(datosDeConfirmacion({ ...D }, ENLACE));
    });
  });
});
