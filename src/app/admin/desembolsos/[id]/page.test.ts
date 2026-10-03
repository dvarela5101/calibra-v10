import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesembolsoParaEjecutar } from "@/lib/admin/desembolsos";
import { MENSAJE_DE_CAMBIO, MENSAJES_DE_EJECUCION, MENSAJES_DE_MOTIVO, type MotivoParaNoEjecutar } from "@/lib/admin/desembolsos-reglas";
import EjecutarUnDesembolso from "./page";

// Sin navegador ni base: la página de un desembolso con la sesión y el desembolso inventados, y se lee el HTML. Aquí
// se fija qué ve el admin en cada estado (criterios 2, 3 y 4), que nunca ve el bruto ni la comisión (supuesto 4) y que
// el formulario solo sale cuando la base dice que se puede ejecutar. El recorrido con la base lo cubre la e2e.

const ID = "d0d0d0d0-0000-4000-8000-000000000028";
const YO = "a0a0a0a0-0000-4000-8000-000000000028";
const OTRO = "a0a0a0a0-0000-4000-8000-000000002801";

const rutas = vi.hoisted(() => ({ pedidas: [] as string[] }));
const datos = vi.hoisted(() => ({ desembolso: null as DesembolsoParaEjecutar | null, falla: null as Error | null }));

vi.mock("@/lib/auth/sesion", () => ({
  exigirRol: async (_rol: string, ruta: string) => {
    rutas.pedidas.push(ruta);
    return { idUsuario: YO, rol: "admin" };
  },
}));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => ({}) }));
vi.mock("@/lib/admin/desembolsos", () => ({
  cargarDesembolso: async () => {
    if (datos.falla) throw datos.falla;
    return datos.desembolso;
  },
  ejecutarDesembolso: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: () => {
    throw new Error("redirect");
  },
}));

/** 9:00 en Bogotá del 10 de enero de 2030. */
const AHORA = new Date("2030-01-10T14:00:00.000Z");

function desembolso(
  cambios: Partial<Omit<DesembolsoParaEjecutar, "monitoria">> = {},
  monitoria: Partial<DesembolsoParaEjecutar["monitoria"]> = {},
): DesembolsoParaEjecutar {
  return {
    id: ID,
    estado: "pendiente",
    motivo: null,
    montoNeto: 22_500,
    llaveDestino: "3001234567",
    desembolsableDesde: new Date("2030-01-07T16:00:00.000Z"),
    nombreMonitor: "Andrés Gómez",
    monitoria: {
      estado: "realizada",
      motivoCancelacion: null,
      fecha: "2030-01-06",
      hora: "10:00:00",
      duracionMin: 60,
      nombreMateria: "Cálculo Diferencial",
      ...monitoria,
    },
    ejecucion: null,
    ...cambios,
  };
}

const DESEMBOLSADO = desembolso({
  estado: "desembolsado",
  motivo: "desembolsado",
  ejecucion: { idAdmin: YO, nombreAdmin: "Admin Uno", referencia: "M12345678", fecha: new Date("2030-01-09T17:00:00.000Z") },
});

async function pintar(d: DesembolsoParaEjecutar | null, consulta: Record<string, string> = {}, id = ID): Promise<string> {
  datos.desembolso = d;
  return renderToStaticMarkup(await EjecutarUnDesembolso({ params: Promise.resolve({ id }), searchParams: Promise.resolve(consulta) }));
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
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Ejecutar un desembolso (HU-028): uno ejecutable (criterio 4)", () => {
  it("muestra el monitor, la monitoría, cuándo es ejecutable, el neto a transferir y la llave con su botón para copiarla", async () => {
    const html = await pintar(desembolso());
    const t = texto(html);
    for (const dato of [
      "Ejecutar el desembolso",
      "Monitor Andrés Gómez",
      "Estado Pendiente",
      "Ejecutable Después del lunes, 7 de enero de 2030, 11:00 a. m.",
      "Materia Cálculo Diferencial",
      "Fecha 6 de enero de 2030",
      "Hora 10:00 a 11:00",
      "Estado Realizada",
      "Transferir $ 22.500",
      "Llave del monitor",
      "Copiar llave",
    ]) {
      expect(t, dato).toContain(dato);
    }
    expect(html).toMatch(/<input id="llave-destino" readOnly=""[^>]*value="3001234567"/);
    expect(rutas.pedidas).toEqual([`/admin/desembolsos/${ID}`]);
  });

  it("el formulario pide la referencia y la fecha (hoy por defecto, entre el día de la sesión y hoy) y lleva oculto el neto que se ve", async () => {
    const html = await pintar(desembolso());
    expect(html).toMatch(/<input id="referencia" type="text" maxLength="100"[^>]*required=""[^>]*name="referencia" value=""/);
    expect(html).toMatch(/<input id="fecha" type="date" min="2030-01-06" max="2030-01-10"[^>]*name="fecha" value="2030-01-10"/);
    expect(html).toContain(`<input type="hidden" name="id_desembolso" value="${ID}"/>`);
    expect(html).toContain('<input type="hidden" name="neto_esperado" value="22500"/>');
    expect(html).toContain('<input type="hidden" name="fecha_sesion" value="2030-01-06"/>');
    // Quién ejecuta lo pone la sesión, no el formulario.
    expect(html).not.toContain(YO);
  });

  it("la confirmación dice qué se registra antes del botón de confirmar", async () => {
    const html = await pintar(desembolso());
    const t = texto(html);
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Registrar la transferencia<\/summary>/);
    const consecuencias = "Registra la transferencia de $ 22.500 a 3001234567. No se puede deshacer.";
    expect(t).toContain(consecuencias);
    expect(t.indexOf(consecuencias)).toBeLessThan(t.indexOf("Sí, registrar la transferencia"));
  });

  it("supuesto 4: nunca habla de bruto ni de comisión", async () => {
    for (const d of [desembolso(), DESEMBOLSADO, desembolso({ motivo: "pagos_en_revision" })]) {
      const html = (await pintar(d)).toLowerCase();
      expect(html).not.toContain("comisi");
      expect(html).not.toContain("bruto");
    }
  });

  it("escapa lo que viene de la base", async () => {
    const html = await pintar(desembolso({ nombreMonitor: '<img src=x onerror="alert(1)">', llaveDestino: "<script>alert(2)</script>" }));
    // El único <img> es el logo de la pantalla.
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
    // El único <script> es el que React pone para reenviar el formulario si se envía antes de hidratar.
    expect(html).not.toContain("<script>alert");
    expect(html).toContain('value="&lt;script&gt;alert(2)&lt;/script&gt;"');
    expect(html).toContain("a &lt;script&gt;alert(2)&lt;/script&gt;. No se puede deshacer.");
  });
});

describe("Ejecutar un desembolso: lo que no se puede ejecutar (criterios 2 y 3)", () => {
  it.each(["antes_de_plazo", "con_reporte", "pagos_en_revision", "sin_pagos_aprobados", "no_realizada"] as const)(
    "%s: dice por qué en palabras, sin formulario ni botón para copiar la llave",
    async (motivo: MotivoParaNoEjecutar) => {
      const html = await pintar(desembolso({ motivo }));
      const t = texto(html);
      expect(t).toContain(MENSAJES_DE_MOTIVO[motivo]);
      expect(html).not.toContain("<form");
      expect(t).not.toContain("Transferir $");
      expect(t).not.toContain("Copiar llave");
      expect(t).toContain("Llave destino 3001234567");
      expect(t).toContain("Ejecutable Después del lunes, 7 de enero de 2030, 11:00 a. m.");
    },
  );

  it("D-39: con un pago en revisión dice que espera esa revisión", async () => {
    expect(texto(await pintar(desembolso({ motivo: "pagos_en_revision" })))).toContain("Espera la revisión de un pago de esta monitoría");
  });

  it("P-28: un anulado lo dice y no se ejecuta, aunque la base lo haya leído ejecutable un instante antes", async () => {
    for (const motivo of ["anulado", null] as const) {
      const html = await pintar(desembolso({ estado: "anulado", motivo }, { estado: "cancelada", motivoCancelacion: "monitor_no_asistio" }));
      const t = texto(html);
      expect(t).toContain("Desembolso anulado");
      expect(t).toContain("Estado Anulado");
      expect(t).toContain(MENSAJES_DE_MOTIVO.anulado);
      expect(t).toContain("Estado Cancelada");
      expect(t).not.toContain("Ejecutable Después");
      expect(html).not.toContain("<form");
    }
  });
});

describe("Ejecutar un desembolso: después de registrarlo", () => {
  it("un desembolsado muestra el monto transferido, la llave, la referencia, la fecha y quién, sin formulario", async () => {
    const html = await pintar(DESEMBOLSADO);
    const t = texto(html);
    expect(t).toContain("Desembolso registrado");
    expect(t).toContain("Estado Desembolsado");
    expect(t).toContain("Monto transferido $ 22.500");
    expect(t).toContain("Llave destino 3001234567");
    expect(t).toContain("Referencia M12345678");
    expect(t).toContain("Fecha de la transferencia 9 de enero de 2030");
    expect(html).toContain('<time dateTime="2030-01-09">');
    expect(t).toContain("Registrado por Admin Uno");
    expect(t).not.toContain("Ejecutable Después");
    expect(html).not.toContain("<form");
    expect(t).toContain("Volver a mi bandeja");
  });

  it("tras registrarla, el éxito es un role=status; un enlace viejo o el de otro admin no lo anuncia", async () => {
    const exito = await pintar(DESEMBOLSADO, { ejecutado: "desembolsado" });
    expect(exito).toMatch(/<p role="status"[^>]*>Registraste la transferencia\. El desembolso ya no aparece en la bandeja\.<\/p>/);
    const sinRegistrar = await pintar(desembolso(), { ejecutado: "desembolsado" });
    expect(sinRegistrar).not.toContain("Registraste");
    const deOtro = await pintar(desembolso({ ...DESEMBOLSADO, ejecucion: { ...DESEMBOLSADO.ejecucion!, idAdmin: OTRO } }), { ejecutado: "desembolsado" });
    expect(deOtro).not.toContain("Registraste");
  });

  it("si otro admin ya lo registró, la alerta pide no transferirlo otra vez", async () => {
    const html = await pintar(DESEMBOLSADO, { error: "ya_desembolsado" });
    expect(html).toContain(`<p role="alert" class="`);
    expect(texto(html)).toContain(MENSAJES_DE_EJECUCION.ya_desembolsado);
  });

  it("lo que cambió mientras el admin miraba vuelve como alerta, con el motivo una sola vez", async () => {
    const t = texto(await pintar(desembolso({ motivo: "con_reporte" }), { error: "con_reporte" }));
    expect(t).toContain(MENSAJE_DE_CAMBIO);
    expect(t.split(MENSAJES_DE_MOTIVO.con_reporte)).toHaveLength(2);
  });
});

describe("Ejecutar un desembolso: lo que no existe", () => {
  it("un id que no es un uuid es un 404, sin leer nada", async () => {
    await expect(pintar(desembolso(), {}, "no-es-un-id")).rejects.toThrow("notFound");
  });

  it("un desembolso que no existe (o que la sesión no puede leer) es un 404", async () => {
    await expect(pintar(null)).rejects.toThrow("notFound");
  });

  it("un error de la base no es un 404: lo dice y deja volver a la bandeja", async () => {
    datos.falla = new Error("se cayó la base");
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = texto(await pintar(desembolso()));
    espia.mockRestore();
    expect(t).toContain("No pudimos cargar el desembolso");
    expect(t).toContain("Volver a mi bandeja");
  });
});
