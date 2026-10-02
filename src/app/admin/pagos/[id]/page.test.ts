import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PagoParaRevisar } from "@/lib/admin/pagos";
import { MENSAJES_DE_REVISION } from "@/lib/admin/pagos-reglas";
import RevisarPago from "./page";

// Sin navegador ni base: la revisión de un pago con la sesión y el pago inventados, y se lee el HTML. Aquí se fija
// qué ve cada admin (criterio 1, supuestos 1, 7 y 8), qué consecuencias se leen antes de rechazar según la monitoría
// (criterio 3, P-24) y que al pintar no se firma ningún enlace (criterio 6). El recorrido con la base lo cubre
// e2e/revisar-pagos.spec.ts.

const ID = "6a6a6a6a-0000-4000-8000-000000000020";
const YO = "a0a0a0a0-0000-4000-8000-000000000020";
const OTRO = "a0a0a0a0-0000-4000-8000-000000002001";

const rutas = vi.hoisted(() => ({ pedidas: [] as string[] }));
const datos = vi.hoisted(() => ({ pago: null as PagoParaRevisar | null, falla: null as Error | null }));
const firmar = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/sesion", () => ({
  exigirRol: async (_rol: string, ruta: string) => {
    rutas.pedidas.push(ruta);
    return { idUsuario: YO, rol: "admin" };
  },
}));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => ({}) }));
vi.mock("@/lib/admin/pagos", () => ({
  cargarPagoParaRevisar: async () => {
    if (datos.falla) throw datos.falla;
    return datos.pago;
  },
  revisarPago: vi.fn(),
  avisarRechazoAlPagador: vi.fn(),
}));
vi.mock("@/lib/comprobantes/almacenamiento", () => ({ enlaceDeComprobanteDePago: firmar }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: () => {
    throw new Error("redirect");
  },
}));

const AHORA = new Date("2030-01-07T14:00:00.000Z");
/** 10:00 en Bogotá: una hora después de AHORA. */
const INICIO = new Date("2030-01-07T15:00:00.000Z");

function pago(cambios: Partial<Omit<PagoParaRevisar, "monitoria">> = {}, monitoria: Partial<PagoParaRevisar["monitoria"]> = {}): PagoParaRevisar {
  return {
    id: ID,
    monto: 32_000,
    nombrePagador: "Camila Rojas",
    contacto: "camila@uniandes.edu.co",
    referencia: null,
    estado: "en_revision",
    idAdmin: YO,
    nombreAdmin: "Admin Uno",
    revisionHasta: new Date("2030-01-07T14:30:00.000Z"),
    restante: { texto: "Quedan 30 min", vencido: false },
    fechaRevision: null,
    observaciones: null,
    monitoria: {
      estado: "confirmada",
      motivoCancelacion: null,
      fecha: "2030-01-07",
      hora: "10:00:00",
      duracionMin: 60,
      nombreMateria: "Cálculo Diferencial",
      nombreMonitor: "Andrés Gómez",
      inicio: INICIO,
      grupal: false,
      ...monitoria,
    },
    ...cambios,
  };
}

async function pintar(p: PagoParaRevisar | null, consulta: Record<string, string> = {}, id = ID): Promise<string> {
  datos.pago = p;
  return renderToStaticMarkup(await RevisarPago({ params: Promise.resolve({ id }), searchParams: Promise.resolve(consulta) }));
}

/** El texto visible: sin etiquetas y con los espacios normalizados (`\s` incluye los duros). */
const texto = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

beforeEach(() => {
  vi.useFakeTimers({ now: AHORA, toFake: ["Date"] });
  rutas.pedidas = [];
  datos.falla = null;
  firmar.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Revisión de un pago (HU-020): lo que ve el admin (criterio 1)", () => {
  it("pagador, contacto, monto, referencia, monitoría y tiempo restante", async () => {
    const html = await pintar(pago());
    const t = texto(html);
    for (const dato of [
      "Revisar el pago",
      "Pagador Camila Rojas",
      "Contacto camila@uniandes.edu.co",
      "Monto $ 32.000",
      "Referencia Sin referencia",
      "Estado En revisión",
      "Tiempo para revisarlo Quedan 30 min",
      "Materia Cálculo Diferencial",
      "Monitor Andrés Gómez",
      "Fecha 7 de enero de 2030",
      "Hora 10:00 a 11:00",
      "Estado Confirmada",
    ]) {
      expect(t, dato).toContain(dato);
    }
    expect(html).toContain('<time dateTime="2030-01-07T14:30:00.000Z">Quedan 30 min</time>');
    expect(rutas.pedidas).toEqual([`/admin/pagos/${ID}`]);
  });

  it("criterio 6: el comprobante es un enlace a su ruta, que firma al tocarlo; al pintar no se firma nada", async () => {
    const html = await pintar(pago());
    expect(html).toContain(`<a href="/admin/pagos/${ID}/comprobante" target="_blank" rel="noopener noreferrer"`);
    expect(texto(html)).toContain("Ver comprobante");
    expect(texto(html)).toContain("vence a los 60 segundos");
    expect(firmar).not.toHaveBeenCalled();
    expect(html).not.toMatch(/token=|storage\/v1|sign\//);
  });

  it("con referencia la muestra tal cual", async () => {
    expect(texto(await pintar(pago({ referencia: "M12345678" })))).toContain("Referencia M12345678");
  });

  it("un plazo vencido lo dice con palabras, y el asignado todavía puede revisarlo (supuesto 1, sin escalamiento hasta HU-034)", async () => {
    const html = await pintar(pago({ restante: { texto: "Vencido hace 5 min", vencido: true } }));
    expect(texto(html)).toContain("Tiempo para revisarlo Vencido hace 5 min");
    expect(texto(html)).toContain("Aprobar pago");
  });

  it("escapa lo que viene de la base", async () => {
    const html = await pintar(pago({ nombrePagador: '<img src=x onerror="alert(1)">', estado: "rechazado", observaciones: "<script>alert(2)</script>" }));
    // El único <img> es el logo de la pantalla.
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("Revisión de un pago: aprobar y rechazar (criterios 2, 3 y 7, supuesto 7)", () => {
  it("el asignado ve Aprobar y, dentro del rechazo, las consecuencias antes del botón de confirmar", async () => {
    const html = await pintar(pago());
    const t = texto(html);
    expect(t).toContain("Aprobar pago");
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Rechazar el pago<\/summary>/);
    const consecuencias =
      "Se cancela la monitoría del 7 de enero de 2030 y esa fecha queda libre para otra persona. Un pago rechazado no se reembolsa. Le avisamos a Camila Rojas por correo, a camila@uniandes.edu.co.";
    expect(t).toContain(consecuencias);
    expect(t.indexOf(consecuencias)).toBeLessThan(t.indexOf("Sí, rechazar el pago"));
    expect(t).toContain("Observaciones (opcionales)");
    expect(html).not.toMatch(/<textarea[^>]*required/);
    // La decisión viaja con el pago; quién revisa lo pone la sesión, no el formulario.
    expect(html.match(new RegExp(`name="id_pago" value="${ID}"`, "g"))).toHaveLength(2);
    expect(html).toContain('name="decision" value="aprobar"');
    expect(html).toContain('name="decision" value="rechazar"');
    expect(html).not.toContain(YO);
  });

  it("P-24: una confirmada en su inicio exacto ya empezó (P-40): no se cancela y las observaciones son obligatorias", async () => {
    const html = await pintar(pago({}, { inicio: AHORA }));
    const t = texto(html);
    expect(t).toContain("La sesión ya empezó, así que la monitoría no se cancela y el pago queda fuera del desembolso del monitor.");
    expect(t).not.toContain("Se cancela la monitoría");
    expect(t).not.toContain("Observaciones (opcionales)");
    expect(t).toContain("Obligatorias: escribe qué se hará con ese cobro, si cobrarlo por fuera o asumirlo.");
    expect(html).toMatch(/<textarea[^>]*required/);
  });

  it("un milisegundo antes del inicio, todavía se cancela", async () => {
    const t = texto(await pintar(pago({}, { inicio: new Date(AHORA.getTime() + 1) })));
    expect(t).toContain("Se cancela la monitoría");
  });

  it("P-24: una realizada tampoco se cancela", async () => {
    const html = await pintar(pago({}, { estado: "realizada" }));
    expect(texto(html)).toContain("La monitoría ya se realizó, así que no se cancela");
    expect(html).toMatch(/<textarea[^>]*required/);
  });

  it("con la cita ya cancelada por el estudiante, solo cambia el pago y no se le escribe al pagador", async () => {
    const t = texto(await pintar(pago({}, { estado: "cancelada", motivoCancelacion: "estudiante" })));
    expect(t).toContain("Estado Cancelada: la canceló el estudiante");
    expect(t).toContain("La monitoría ya estaba cancelada: solo cambia el pago. Un pago rechazado no se reembolsa y al pagador no le escribimos.");
    expect(t).toContain("Aprobar pago");
  });
});

describe("Revisión de un pago: quién revisa (supuestos 1 y 8)", () => {
  it("otro admin ve el pago y a quién está asignado, sin acciones", async () => {
    const html = await pintar(pago({ idAdmin: OTRO, nombreAdmin: "Admin Dos" }));
    const t = texto(html);
    expect(t).toContain("Este pago está asignado a Admin Dos. Solo esa persona puede aprobarlo o rechazarlo.");
    expect(t).toContain("Pagador Camila Rojas");
    expect(t).toContain("Ver comprobante");
    expect(html).not.toContain("<form");
    expect(t).not.toContain("Aprobar pago");
    expect(t).not.toContain("Rechazar el pago");
  });

  it("el pago de una grupal no se revisa aquí todavía (HU-038)", async () => {
    const html = await pintar(pago({}, { grupal: true }));
    expect(texto(html)).toContain(MENSAJES_DE_REVISION.no_individual);
    expect(html).not.toContain("<form");
  });
});

describe("Revisión de un pago: después de revisar", () => {
  const RECHAZADO = pago(
    { estado: "rechazado", fechaRevision: new Date("2030-01-07T14:10:00.000Z"), observaciones: "Se cobra por fuera.\nLlamar el lunes." },
    { estado: "cancelada", motivoCancelacion: "pago_rechazado" },
  );

  it("un pago revisado muestra cómo quedó y cuándo, con sus observaciones, sin acciones", async () => {
    const html = await pintar(RECHAZADO);
    const t = texto(html);
    expect(t).toContain("Pago rechazado");
    expect(t).toContain("Estado Rechazado");
    expect(t).toContain("Revisado lunes, 7 de enero de 2030, 9:10 a. m.");
    expect(t).toContain("Observaciones Se cobra por fuera. Llamar el lunes.");
    expect(t).toContain("Estado Cancelada: el pago fue rechazado");
    expect(t).not.toContain("Tiempo para revisarlo");
    expect(html).not.toContain("<form");
    expect(t).toContain("Volver a mi bandeja");
  });

  it("tras rechazar, el mensaje de éxito es un role=status y dice si el correo salió", async () => {
    const html = await pintar(RECHAZADO, { revisado: "rechazado", correo: "enviado" });
    expect(html).toMatch(/<p role="status"[^>]*>Rechazaste el pago\. Ya no aparece en tu bandeja\. Le avisamos al pagador por correo\.<\/p>/);
  });

  it("si el correo no salió, se lo dice al admin como alerta", async () => {
    const html = await pintar(RECHAZADO, { revisado: "rechazado", correo: "por_reintentar" });
    expect(html).toMatch(/<p role="alert"[^>]*>El correo a camila@uniandes\.edu\.co no salió todavía\./);
  });

  it("tras aprobar, el éxito; y un enlace viejo no anuncia una aprobación que no pasó", async () => {
    const aprobado = await pintar(pago({ estado: "aprobado", fechaRevision: new Date("2030-01-07T14:10:00.000Z") }), { revisado: "aprobado" });
    expect(aprobado).toMatch(/<p role="status"[^>]*>Aprobaste el pago\. Ya no aparece en tu bandeja\.<\/p>/);
    expect(texto(aprobado)).toContain("Pago aprobado");
    const sinRevisar = await pintar(pago(), { revisado: "aprobado" });
    expect(sinRevisar).not.toContain('role="status"');
    expect(texto(sinRevisar)).not.toContain("Aprobaste");
  });

  it("lo que cambió mientras el admin miraba vuelve como alerta", async () => {
    const html = await pintar(RECHAZADO, { error: "ya_revisado" });
    expect(html).toMatch(/<p role="alert"[^>]*>Este pago ya se revisó, y una revisión no se puede cambiar\.<\/p>/);
    expect(texto(html)).toContain(MENSAJES_DE_REVISION.ya_revisado);
  });
});

describe("Revisión de un pago: lo que no existe", () => {
  it("un id que no es un uuid es un 404, sin leer nada", async () => {
    await expect(pintar(pago(), {}, "no-es-un-id")).rejects.toThrow("notFound");
  });

  it("un pago que no existe (o que la sesión no puede leer) es un 404", async () => {
    await expect(pintar(null)).rejects.toThrow("notFound");
  });

  it("un error de la base no es un 404: lo dice y deja volver a la bandeja", async () => {
    datos.falla = new Error("se cayó la base");
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = texto(await pintar(pago()));
    espia.mockRestore();
    expect(t).toContain("No pudimos cargar el pago");
    expect(t).toContain("Volver a mi bandeja");
  });
});
