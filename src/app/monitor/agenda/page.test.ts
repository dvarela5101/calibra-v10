import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buscarTodos, elementosHijos, leerHtml, porEtiqueta, textoDe, type Nodo } from "../../../../pruebas/arbol-html";
import type { EstadoMonitoria, LugarDeMonitoria, MonitoriaDeAgenda } from "@/lib/agenda/reglas";
import type { ParametrosNegocio } from "@/lib/plazos/parametros";

// HU-022: la agenda del monitor con el enlace «Ver diagnóstico». Sin navegador ni base: la sesión, la agenda y los parámetros son
// inventados y el reloj está quieto. Se fija en qué tarjetas hay enlace y en cuáles no (lo decide `sePuedeVerDiagnostico`), que el
// enlace sea un `a` hijo directo de la tarjeta (las pruebas de la tarjeta cuentan sus `span`) y que la agenda no gane ninguna región de
// estado. Que la agenda se separe en por finalizar, próximas y pasadas ya lo prueban las pruebas de `reglas.ts`.

const datos = vi.hoisted(() => ({ agenda: [] as MonitoriaDeAgenda[], lugares: new Map<string, LugarDeMonitoria>() }));

vi.mock("@/lib/auth/sesion", () => ({ exigirRol: async () => ({ idUsuario: "d0d0d0d0-0000-4000-8000-000000000022", rol: "monitor" }) }));
vi.mock("@/lib/supabase/servidor", () => ({ crearClienteServidor: async () => ({}) }));
vi.mock("@/lib/agenda/servidor", () => ({ cargarAgenda: async () => datos.agenda, cargarLugares: async () => datos.lugares }));
vi.mock("@/lib/plazos/parametros", () => ({ cargarParametros: async () => PARAMETROS }));
// La acción de finalizar es del servidor (usa las cookies y redirige): aquí solo importa el formulario que la lleva.
vi.mock("./acciones", () => ({ finalizar: async () => undefined, guardarLugar: async () => ({ error: null, exito: null }) }));

import MiAgenda from "./page";

const PARAMETROS = { cierreAutomaticoMin: 1440 } as ParametrosNegocio;
const AHORA = new Date("2026-10-20T15:00:00.000Z");
const MIN = 60_000;
const DIA = 24 * 60 * MIN;

const idDe = (nombre: string) => `${nombre.padEnd(8, "0").slice(0, 8)}-0000-4000-8000-000000000022`;

/** Una cita cuya sesión de 60 minutos TERMINA en `fin`. */
function cita(nombre: string, estado: EstadoMonitoria, fin: Date, cambios: Partial<MonitoriaDeAgenda> = {}): MonitoriaDeAgenda {
  const inicio = new Date(fin.getTime() - 60 * MIN);
  return {
    idMonitoria: idDe(nombre),
    fecha: inicio.toISOString().slice(0, 10),
    hora: "10:00:00",
    duracionMin: 60,
    presencial: true,
    nombreMateria: "Física II",
    codigoMateria: "FISI-1528",
    nombreEstudiante: `Estudiante ${nombre}`,
    estado,
    motivoCancelacion: estado === "cancelada" ? "estudiante" : null,
    reservaVencida: false,
    estadoPago: estado === "pendiente_pago" ? "sin_pagar" : "aprobado",
    inicio,
    ...cambios,
  };
}

async function pintar(agenda: MonitoriaDeAgenda[], lugares = new Map<string, LugarDeMonitoria>()): Promise<string> {
  datos.agenda = agenda;
  datos.lugares = lugares;
  return renderToStaticMarkup(await MiAgenda({ params: Promise.resolve({}), searchParams: Promise.resolve({}) }));
}

/** La tarjeta (li) de una cita, la que tiene el renglón de fecha con su id. */
function tarjetaDe(arbol: Nodo, nombre: string): Nodo | undefined {
  return buscarTodos(arbol, (n) => n.etiqueta === "li" && elementosHijos(n).some((h) => h.atributos.id === `cabeza-${idDe(nombre)}`))[0];
}

const enlacesDeDiagnostico = (tarjeta: Nodo) => elementosHijos(tarjeta).filter((h) => h.etiqueta === "a" && textoDe(h) === "Ver diagnóstico");

beforeEach(() => {
  vi.useFakeTimers({ now: AHORA, toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("el enlace «Ver diagnóstico» por estado de la cita (criterio 8)", () => {
  const agenda = [
    cita("confirmpr", "confirmada", new Date(AHORA.getTime() + 2 * DIA)),
    cita("porfinal1", "confirmada", new Date(AHORA.getTime() - 60 * MIN)),
    cita("confvieja", "confirmada", new Date(AHORA.getTime() - 40 * DIA)),
    cita("pendvige1", "pendiente_pago", new Date(AHORA.getTime() + 3 * DIA)),
    cita("pendvenc1", "pendiente_pago", new Date(AHORA.getTime() + 3 * DIA), { reservaVencida: true }),
    cita("cancelad1", "cancelada", new Date(AHORA.getTime() + 3 * DIA)),
    cita("realiz029", "realizada", new Date(AHORA.getTime() - 29 * DIA)),
    cita("realiz031", "realizada", new Date(AHORA.getTime() - 31 * DIA)),
    cita("realizrec", "realizada", new Date(AHORA.getTime() - 5 * MIN)),
    cita("realizlim", "realizada", new Date(AHORA.getTime() - 30 * DIA + MIN)),
    cita("realizexa", "realizada", new Date(AHORA.getTime() - 30 * DIA)),
    cita("confrecha", "confirmada", new Date(AHORA.getTime() + DIA), { estadoPago: "rechazado" }),
  ];
  let arbol: Nodo;

  beforeEach(async () => {
    arbol = leerHtml(await pintar(agenda));
  });

  it.each([
    ["una confirmada próxima", "confirmpr"],
    ["una confirmada que ya empezó y espera finalizarse", "porfinal1"],
    ["una confirmada que sigue sin finalizarse hace 40 días", "confvieja"],
    ["una confirmada con el pago rechazado (P-24)", "confrecha"],
    ["una realizada hace 29 días", "realiz029"],
    ["una realizada que terminó hace 5 minutos", "realizrec"],
    ["una realizada a 30 días menos un minuto", "realizlim"],
  ])("%s lleva el enlace", (_descripcion, nombre) => {
    const tarjeta = tarjetaDe(arbol, nombre);
    expect(tarjeta, "la tarjeta").toBeDefined();
    const enlaces = enlacesDeDiagnostico(tarjeta!);
    expect(enlaces).toHaveLength(1);
    expect(enlaces[0].atributos.href).toBe(`/monitor/agenda/${idDe(nombre)}`);
  });

  it.each([
    ["una reserva por pagar vigente", "pendvige1"],
    ["una reserva por pagar vencida", "pendvenc1"],
    ["una cancelada", "cancelad1"],
    ["una realizada hace 31 días", "realiz031"],
    ["una realizada en el instante exacto de los 30 días", "realizexa"],
  ])("%s no lleva enlace ni aviso que lo explique (M36)", (_descripcion, nombre) => {
    const tarjeta = tarjetaDe(arbol, nombre);
    expect(tarjeta, "la tarjeta").toBeDefined();
    expect(buscarTodos(tarjeta!, (n) => n.etiqueta === "a")).toHaveLength(0);
    expect(textoDe(tarjeta!).toLowerCase()).not.toContain("diagnóstico");
  });

  it("en total, siete enlaces para siete citas visibles", () => {
    const enlaces = porEtiqueta(arbol, "a").filter((a) => textoDe(a) === "Ver diagnóstico");
    expect(enlaces).toHaveLength(7);
    expect(new Set(enlaces.map((a) => a.atributos.href)).size).toBe(7);
  });

  it("el enlace se describe con el renglón de fecha y hora de su tarjeta, que existe (el nombre sigue siendo «Ver diagnóstico»)", () => {
    for (const enlace of porEtiqueta(arbol, "a").filter((a) => textoDe(a) === "Ver diagnóstico")) {
      const idDeLaCabeza = enlace.atributos["aria-describedby"];
      expect(idDeLaCabeza).toMatch(/^cabeza-/);
      const cabeza = buscarTodos(arbol, (n) => n.atributos.id === idDeLaCabeza);
      expect(cabeza, idDeLaCabeza).toHaveLength(1);
      expect(cabeza[0].etiqueta).toBe("span");
      // Y es el de la misma tarjeta.
      expect(enlace.padre).toBe(cabeza[0].padre);
    }
  });

  it("los `id` de las cabezas no se repiten", () => {
    const ids = buscarTodos(arbol, (n) => (n.atributos.id ?? "").startsWith("cabeza-")).map((n) => n.atributos.id);
    expect(ids).toHaveLength(agenda.length);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("la tarjeta no gana ningún `span` (hecho 11, M37)", () => {
  it("el enlace es un `a` hijo directo del `li`, no un `span`, y no está dentro del `span` de la cabeza", async () => {
    const arbol = leerHtml(await pintar([cita("confirmpr", "confirmada", new Date(AHORA.getTime() + 2 * DIA))]));
    const tarjeta = tarjetaDe(arbol, "confirmpr")!;
    const enlace = enlacesDeDiagnostico(tarjeta)[0];
    expect(enlace.padre).toBe(tarjeta);
    expect(enlace.etiqueta).toBe("a");
    for (const hijo of elementosHijos(tarjeta).filter((h) => h.etiqueta === "span")) expect(buscarTodos(hijo, (n) => n.etiqueta === "a")).toHaveLength(0);
  });

  it("los `span` hijos directos de la tarjeta son los mismos con y sin enlace: cabeza, detalle, quién agendó y estado con pago", async () => {
    const arbol = leerHtml(
      await pintar([
        cita("confirmpr", "confirmada", new Date(AHORA.getTime() + 2 * DIA)),
        cita("cancelad1", "cancelada", new Date(AHORA.getTime() + 3 * DIA)),
      ]),
    );
    const spans = (nombre: string) => elementosHijos(tarjetaDe(arbol, nombre)!).filter((h) => h.etiqueta === "span").map(textoDe);
    const conEnlace = spans("confirmpr");
    const sinEnlace = spans("cancelad1");
    expect(conEnlace).toHaveLength(4);
    expect(sinEnlace).toHaveLength(4);
    expect(conEnlace[2]).toBe("Agendó: Estudiante confirmpr");
    expect(conEnlace[3]).toBe("Confirmada · Pago aprobado");
    expect(sinEnlace[3]).toBe("Cancelada: la canceló el estudiante · Pago aprobado");
  });

  it("en «Por finalizar» tiene los mismos cinco `span` de siempre y el enlace va antes del formulario de finalizar", async () => {
    const arbol = leerHtml(await pintar([cita("porfinal1", "confirmada", new Date(AHORA.getTime() - 60 * MIN))]));
    const tarjeta = tarjetaDe(arbol, "porfinal1")!;
    const hijos = elementosHijos(tarjeta);
    expect(hijos.filter((h) => h.etiqueta === "span")).toHaveLength(5);
    expect(textoDe(hijos.filter((h) => h.etiqueta === "span")[4])).toContain("Si no la finalizas, se cierra sola a partir del");
    const posicionDelEnlace = hijos.findIndex((h) => h.etiqueta === "a");
    const posicionDelFormulario = hijos.findIndex((h) => h.etiqueta === "form");
    expect(posicionDelEnlace).toBeGreaterThan(-1);
    expect(posicionDelEnlace).toBeLessThan(posicionDelFormulario);
    // El botón de finalizar sigue describiéndose con la misma cabeza.
    const boton = porEtiqueta(tarjeta, "button")[0];
    expect(boton.atributos["aria-describedby"]).toBe(`cabeza-${idDe("porfinal1")}`);
  });
});

describe("la agenda sigue siendo la agenda", () => {
  it("no gana ninguna región de estado ni de alerta (hecho 11)", async () => {
    const html = await pintar([
      cita("confirmpr", "confirmada", new Date(AHORA.getTime() + 2 * DIA)),
      cita("porfinal1", "confirmada", new Date(AHORA.getTime() - 60 * MIN)),
      cita("realiz029", "realizada", new Date(AHORA.getTime() - 29 * DIA)),
    ]);
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });

  it("sin citas no hay enlaces y las secciones dicen lo de siempre", async () => {
    const html = await pintar([]);
    expect(html).not.toContain("Ver diagnóstico");
    expect(textoDe(leerHtml(html))).toContain("No tienes monitorías próximas.");
    expect(textoDe(leerHtml(html))).toContain("Todavía no tienes monitorías pasadas.");
  });

  it("el enlace también sale en las pasadas que se ven tras «Ver N más»", async () => {
    // Doce realizadas recientes: diez a la vista y dos tras el plegable.
    const doce = Array.from({ length: 12 }, (_, i) => cita(`pasada${String(i).padStart(2, "0")}`, "realizada", new Date(AHORA.getTime() - (i + 1) * DIA)));
    const arbol = leerHtml(await pintar(doce));
    expect(porEtiqueta(arbol, "a").filter((a) => textoDe(a) === "Ver diagnóstico")).toHaveLength(12);
    const plegable = porEtiqueta(arbol, "details")[0];
    expect(porEtiqueta(plegable, "a").filter((a) => textoDe(a) === "Ver diagnóstico")).toHaveLength(2);
  });

  it("la separación y los enlaces usan la misma hora: una confirmada que empieza justo ahora está en «Por finalizar» y lleva enlace", async () => {
    const m = cita("justo000", "confirmada", new Date(AHORA.getTime() + 60 * MIN));
    expect(m.inicio.getTime()).toBe(AHORA.getTime());
    const arbol = leerHtml(await pintar([m]));
    const seccion = buscarTodos(arbol, (n) => n.etiqueta === "section" && n.atributos["aria-labelledby"] === "por-finalizar")[0];
    expect(seccion).toBeDefined();
    expect(porEtiqueta(seccion, "a").filter((a) => textoDe(a) === "Ver diagnóstico")).toHaveLength(1);
  });
});

describe("el lugar o el enlace de cada monitoría (HU-107, D-76)", () => {
  const proxima = cita("presenci", "confirmada", new Date(AHORA.getTime() + 2 * DIA));
  const virtual = cita("virtual1", "confirmada", new Date(AHORA.getTime() + 3 * DIA), { presencial: false });
  const pendiente = cita("pendient", "pendiente_pago", new Date(AHORA.getTime() + 4 * DIA), { presencial: false });
  const cancelada = cita("cancelad", "cancelada", new Date(AHORA.getTime() + 5 * DIA));
  const realizada = cita("realizad", "realizada", new Date(AHORA.getTime() - DIA));

  it("una vigente sin dato dice que falta y ofrece el campo según su modalidad", async () => {
    const arbol = leerHtml(await pintar([proxima, virtual]));
    const presencial = textoDe(tarjetaDe(arbol, "presenci")!);
    expect(presencial).toContain("Aún no has puesto el lugar.");
    expect(presencial).toContain("Lugar de la sesión");
    const enLinea = textoDe(tarjetaDe(arbol, "virtual1")!);
    expect(enLinea).toContain("Aún no has puesto el enlace de la videollamada.");
    expect(enLinea).toContain("Enlace de la videollamada");
  });

  it("con el dato puesto lo muestra y el campo empieza con él", async () => {
    const html = await pintar(
      [proxima, virtual],
      new Map([
        [proxima.idMonitoria, { lugar: "ML-301", enlace: null }],
        [virtual.idMonitoria, { lugar: null, enlace: "https://meet.google.com/abc-defg-hij" }],
      ]),
    );
    expect(textoDe(tarjetaDe(leerHtml(html), "presenci")!)).toContain("Lugar: ML-301");
    expect(textoDe(tarjetaDe(leerHtml(html), "virtual1")!)).toContain("Enlace: https://meet.google.com/abc-defg-hij");
    expect(html).toMatch(/<input[^>]*id="lugar-[^"]*"[^>]*value="ML-301"/);
  });

  it("también en una pendiente de pago vigente; no en una cancelada ni en una realizada", async () => {
    const arbol = leerHtml(await pintar([pendiente, cancelada, realizada]));
    expect(textoDe(tarjetaDe(arbol, "pendient")!)).toContain("Enlace de la videollamada");
    expect(textoDe(tarjetaDe(arbol, "cancelad")!)).not.toContain("Lugar");
    expect(textoDe(tarjetaDe(arbol, "realizad")!)).not.toContain("Lugar");
  });

  it("cada campo tiene su propio id y su descripción es el renglón de fecha de su tarjeta", async () => {
    const html = await pintar([proxima, virtual]);
    for (const m of [proxima, virtual]) {
      expect(html).toContain(`id="lugar-${m.idMonitoria}"`);
      expect(html).toMatch(new RegExp(`<input[^>]*aria-describedby="cabeza-${m.idMonitoria}"`));
    }
  });
});
