import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  cambiarEstadoDeLead,
  contarParaContactar,
  leerParaContactar,
  listarLeads,
  listarMaterias,
  listarOrigenes,
  NO_ENCONTRADO,
  YA_DESCARTADO,
  type FiltrosResueltos,
} from "@/lib/leads/admin";
import type { EstadoLead } from "@/lib/leads/estados";
import { SIN_ORIGEN } from "@/lib/leads/filtros";
import { exigirSupabaseLocal, Fixtures, type Cliente } from "./utilidades";

// HU-053 contra el Supabase LOCAL: la lista de Leads del admin, sus filtros, el cambio de estado y la lectura por
// bloques de la descarga. La base es compartida: cada prueba pone a sus Leads un origen único y filtra por él.

let fx: Fixtures;

beforeAll(async () => {
  await exigirSupabaseLocal();
});

beforeEach(() => {
  fx = new Fixtures();
});

afterEach(async () => {
  await fx.limpiar();
});

const origenUnico = () => `hu053-${randomUUID().slice(0, 8)}`;

/** Un Lead con ese origen, fecha, estado y consentimiento de contacto. */
async function lead(datos: { origen: string | null; fecha: string; estado?: EstadoLead; aceptaContacto?: boolean; nombre?: string }) {
  const creado = await fx.crearLead();
  const { error } = await fx.admin
    .from("lead")
    .update({
      origen: datos.origen,
      fecha_creacion: datos.fecha,
      estado: datos.estado ?? "nuevo",
      acepta_contacto: datos.aceptaContacto ?? true,
      nombre: datos.nombre ?? creado.nombre,
    })
    .eq("id", creado.id);
  if (error) throw new Error(`preparar lead: ${error.message}`);
  return creado.id;
}

const filtros = (cambios: Partial<FiltrosResueltos>): FiltrosResueltos => ({
  estado: null,
  origen: null,
  contacto: "todos",
  idMateria: null,
  ...cambios,
});

async function adminConSesion(): Promise<{ cliente: Cliente; id: string }> {
  const cuenta = await fx.crearAdmin();
  return { cliente: await fx.iniciarSesion(cuenta), id: cuenta.id };
}

describe("criterios 1, 3 y 5: la lista, sus filtros y sus páginas", () => {
  it("va del más nuevo al más antiguo, por páginas, y una página de más viene vacía con el total", async () => {
    const origen = origenUnico();
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) ids.push(await lead({ origen, fecha: `2021-01-0${i}T12:00:00Z` }));
    const { cliente } = await adminConSesion();
    const materias = await listarMaterias(cliente);

    const vistos: string[] = [];
    for (const pagina of [1, 2, 3]) {
      const p = await listarLeads(cliente, { filtros: filtros({ origen }), pagina, porPagina: 2, materias });
      expect(p.total).toBe(5);
      vistos.push(...p.leads.map((l) => l.id));
    }
    expect(vistos).toEqual([...ids].reverse());

    const deMas = await listarLeads(cliente, { filtros: filtros({ origen }), pagina: 9, porPagina: 2, materias });
    expect(deMas.leads).toEqual([]);
    expect(deMas.total).toBe(5);
    expect(deMas.totalSinFiltros).toBeGreaterThanOrEqual(5);
  });

  it("filtra por estado y por acepta contacto, y «Sin origen» trae solo los que no tienen", async () => {
    const origen = origenUnico();
    const nuevo = await lead({ origen, fecha: "2021-02-01T00:00:00Z" });
    const contactado = await lead({ origen, fecha: "2021-02-02T00:00:00Z", estado: "contactado" });
    const sinContacto = await lead({ origen, fecha: "2021-02-03T00:00:00Z", aceptaContacto: false });
    const sinOrigen = await lead({ origen: null, fecha: "2021-02-04T00:00:00Z" });
    const { cliente } = await adminConSesion();
    const materias = await listarMaterias(cliente);
    const ids = async (f: Partial<FiltrosResueltos>) =>
      (await listarLeads(cliente, { filtros: filtros(f), porPagina: 1000, materias })).leads.map((l) => l.id);

    expect(await ids({ origen, estado: "contactado" })).toEqual([contactado]);
    expect(await ids({ origen, contacto: "si" })).toEqual([contactado, nuevo]);
    expect(await ids({ origen, contacto: "no" })).toEqual([sinContacto]);
    expect(await ids({ origen })).toEqual([sinContacto, contactado, nuevo]);
    const sinOrigenVistos = await ids({ origen: SIN_ORIGEN, contacto: "todos" });
    expect(sinOrigenVistos).toContain(sinOrigen);
    expect(sinOrigenVistos).not.toContain(nuevo);
    expect(await listarOrigenes(cliente)).toContain(origen);
  });

  it("(D-61 a) la materia sale de diagnósticos y monitorías, sin repetir, y filtra por cualquiera", async () => {
    const origen = origenUnico();
    const { cliente, id: idAdmin } = await adminConSesion();
    const conAmbas = await lead({ origen, fecha: "2021-03-01T00:00:00Z" });
    const sinMateria = await lead({ origen, fecha: "2021-03-02T00:00:00Z" });
    const { materia: a, evaluacion } = await fx.crearEvaluacion();
    await fx.crearDiagnostico({ idLead: conAmbas, idEvaluacion: evaluacion.id, idMateria: a.id });
    await fx.crearDiagnostico({ idLead: conAmbas, idEvaluacion: evaluacion.id, idMateria: a.id });
    const contexto = await fx.crearContextoDeMonitoria(idAdmin);
    const b = contexto.materia;
    // 6-ene-2031 es lunes; cancelada también cuenta.
    await fx.crearMonitoria({ ...contexto, lead: { ...contexto.lead, id: conAmbas } }, { fecha: "2031-01-06", estado: "cancelada" });

    const materias = await listarMaterias(cliente);
    const lista = async (idMateria: string | null) =>
      (await listarLeads(cliente, { filtros: filtros({ origen, idMateria }), porPagina: 1000, materias })).leads;

    const todos = await lista(null);
    expect(todos.map((l) => l.id)).toEqual([sinMateria, conAmbas]);
    expect(todos[1].materias).toEqual([a.nombre, b.nombre].sort((x, y) => x.localeCompare(y, "es")));
    expect(todos[0].materias).toEqual([]);
    expect((await lista(a.id)).map((l) => l.id)).toEqual([conAmbas]);
    expect((await lista(b.id)).map((l) => l.id)).toEqual([conAmbas]);
  });
});

describe("criterios 7 a 10: el admin cambia el estado", () => {
  it("guarda quién y cuándo; repetir el estado no cambia nada; un descartado ya no cambia", async () => {
    const origen = origenUnico();
    const id = await lead({ origen, fecha: "2021-04-01T00:00:00Z" });
    const { cliente, id: idAdmin } = await adminConSesion();
    const materias = await listarMaterias(cliente);
    const elLead = async () => (await listarLeads(cliente, { filtros: filtros({ origen }), materias })).leads[0];

    expect((await elLead()).marcado).toBeNull();
    expect(await cambiarEstadoDeLead(cliente, { idLead: id, estado: "contactado" })).toEqual({ ok: true });
    const marcado = (await elLead()).marcado;
    expect(marcado?.porAdmin).toBe("Admin de prueba");
    const { data: gestion } = await fx.admin.from("lead_gestion").select("id_admin, estado_cambiado_en").eq("id_lead", id).single();
    expect(gestion?.id_admin).toBe(idAdmin);

    // El mismo estado: no da error y no mueve la hora.
    expect(await cambiarEstadoDeLead(cliente, { idLead: id, estado: "contactado" })).toEqual({ ok: true });
    expect((await elLead()).marcado?.en).toEqual(marcado?.en);

    expect(await cambiarEstadoDeLead(cliente, { idLead: id, estado: "descartado" })).toEqual({ ok: true });
    expect(await cambiarEstadoDeLead(cliente, { idLead: id, estado: "nuevo" })).toEqual({ ok: false, error: YA_DESCARTADO });
    expect((await elLead()).estado).toBe("descartado");
  });

  it("un Lead que no existe dice que no se encontró, y quien no es admin no cambia nada", async () => {
    const { cliente } = await adminConSesion();
    expect(await cambiarEstadoDeLead(cliente, { idLead: randomUUID(), estado: "contactado" })).toEqual({ ok: false, error: NO_ENCONTRADO });

    const id = await lead({ origen: origenUnico(), fecha: "2021-05-01T00:00:00Z" });
    const monitor = await fx.iniciarSesion(await fx.crearMonitor());
    expect((await cambiarEstadoDeLead(monitor, { idLead: id, estado: "contactado" })).ok).toBe(false);
    const { data } = await fx.admin.from("lead").select("estado").eq("id", id).single();
    expect(data?.estado).toBe("nuevo");
  });
});

describe("criterios 11 a 14: la descarga para contactar", () => {
  it("recorre la vista por bloques y trae todos, en orden, sin los que no aceptaron ni los descartados", async () => {
    const origen = origenUnico();
    const entran: string[] = [];
    for (let i = 1; i <= 5; i++) entran.push(await lead({ origen, fecha: `2021-06-0${i}T00:00:00Z` }));
    await lead({ origen, fecha: "2021-06-06T00:00:00Z", aceptaContacto: false });
    await lead({ origen, fecha: "2021-06-07T00:00:00Z", estado: "descartado" });
    const { cliente } = await adminConSesion();
    const materias = await listarMaterias(cliente);
    const resueltos = { estado: null, origen, idMateria: null };

    const leidos = await leerParaContactar(cliente, { filtros: resueltos, materias, filasPorBloque: 2 });
    expect(leidos.map((l) => l.id)).toEqual([...entran].reverse());
    expect(await contarParaContactar(cliente, resueltos)).toBe(5);
    expect(await contarParaContactar(cliente, { ...resueltos, estado: "descartado" })).toBe(0);
  });

  it("quien no es admin no lee ningún Lead", async () => {
    const origen = origenUnico();
    await lead({ origen, fecha: "2021-07-01T00:00:00Z" });
    const monitor = await fx.iniciarSesion(await fx.crearMonitor());
    expect(await leerParaContactar(monitor, { filtros: { estado: null, origen, idMateria: null }, materias: [] })).toEqual([]);
    expect((await listarLeads(monitor, { filtros: filtros({ origen }), materias: [] })).total).toBe(0);
  });
});
