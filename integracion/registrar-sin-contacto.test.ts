import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leerContacto } from "@/lib/leads/reglas";
import { listarLeads, listarMaterias, registrarSinContacto, YA_NO_ACEPTA, NO_ENCONTRADO } from "@/lib/leads/admin";
import { registrarContacto, type EntradaDeContacto } from "@/lib/leads/servidor";
import { CASILLA_CONTACTO, CASILLA_TRATAMIENTO, leerConsentimiento, MARCADA } from "@/lib/privacidad/consentimiento";
import { crearCliente, exigirSupabaseLocal, Fixtures, type Cliente } from "./utilidades";

// HU-089 contra el Supabase LOCAL, con sesiones reales y la Data API: un admin activo registra que un Lead pidió no
// recibir mensajes; nadie más puede. Si la persona vuelve a aceptar contacto (HU-068), el registro se borra. La base es
// compartida: cada Lead lleva un origen único y la lista se filtra por él.

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

/** Lo que manda el formulario de contacto de HU-068, con o sin la casilla de novedades. */
function entrada(idSesion: string, correo: string, quiereNovedades: boolean, origen: string): EntradaDeContacto {
  const formulario = new FormData();
  formulario.set("nombre", "Ana Pérez");
  formulario.set("correo", correo);
  formulario.set("numero_telefono", "");
  formulario.set(CASILLA_TRATAMIENTO, MARCADA);
  if (quiereNovedades) formulario.set(CASILLA_CONTACTO, MARCADA);
  const contacto = leerContacto(formulario);
  const consentimiento = leerConsentimiento(formulario);
  if (!contacto.ok || !consentimiento.ok) throw new Error("El contacto de la prueba no es válido");
  return { idSesion, contacto: contacto.datos, consentimiento: consentimiento.consentimiento, origen, siguiente: "/agendar/fecha" };
}

/** Una sesión anónima que deja su contacto aceptando novedades: un Lead con `acepta_contacto`. */
async function leadQueAcepta() {
  const sesion = await fx.crearAnonimo();
  const origen = `hu089-${randomUUID().slice(0, 8)}`;
  const correo = `lead-hu089-${randomUUID()}@calibra.test`;
  expect(await registrarContacto(entrada(sesion.id, correo, true, origen))).toEqual({ resultado: "lead" });
  const lead = (await fx.admin.from("lead").select("id, estado, acepta_contacto").eq("id_sesion_anonima", sesion.id).single()).data;
  if (!lead) throw new Error("No se creó el Lead");
  fx.registrarLead(lead.id);
  return { ...lead, sesion, origen, correo };
}

async function adminConSesion(): Promise<Cliente> {
  return fx.iniciarSesion(await fx.crearAdmin());
}

async function enLaLista(admin: Cliente, origen: string) {
  const materias = await listarMaterias(admin);
  const p = await listarLeads(admin, { filtros: { estado: null, origen, contacto: "todos", idMateria: null }, materias });
  return p.leads[0];
}

describe("criterios 3 y 6: un admin activo registra el pedido", () => {
  it("apaga acepta_contacto, guarda quién y cuándo, y no cambia el estado; repetirlo dice que ya no acepta", async () => {
    const lead = await leadQueAcepta();
    const admin = await adminConSesion();

    expect(await registrarSinContacto(admin, lead.id)).toEqual({ ok: true });
    const visto = await enLaLista(admin, lead.origen);
    expect(visto.aceptaContacto).toBe(false);
    expect(visto.estado).toBe(lead.estado);
    expect(visto.sinContacto?.porAdmin).toBe("Admin de prueba");

    expect(await registrarSinContacto(admin, lead.id)).toEqual({ ok: false, error: YA_NO_ACEPTA });
    expect((await enLaLista(admin, lead.origen)).sinContacto?.en).toEqual(visto.sinContacto?.en);
    expect(await registrarSinContacto(admin, randomUUID())).toEqual({ ok: false, error: NO_ENCONTRADO });
  });
});

describe("criterio 9: nadie más registra", () => {
  it("un monitor, un estudiante, la sesión dueña del Lead y anon no cambian nada", async () => {
    const lead = await leadQueAcepta();
    const monitor = await fx.iniciarSesion(await fx.crearMonitor());
    const estudiante = await fx.iniciarSesion(await fx.crearEstudiante());

    for (const cliente of [monitor, estudiante, lead.sesion.cliente]) {
      expect((await cliente.rpc("registrar_sin_contacto", { p_id_lead: lead.id })).data).toBe("no_autorizado");
      expect((await cliente.from("lead_sin_contacto").select("id_lead")).data ?? []).toEqual([]);
    }
    const { error } = await crearCliente().rpc("registrar_sin_contacto", { p_id_lead: lead.id });
    expect(error).not.toBeNull();

    const { data } = await fx.admin.from("lead").select("acepta_contacto").eq("id", lead.id).single();
    expect(data?.acepta_contacto).toBe(true);
  });
});

describe("criterio 7: si la persona vuelve a dejar su contacto", () => {
  it("con la casilla, vuelve a aceptar y el registro se borra; sin ella, queda apagado sin decir que lo pidió", async () => {
    const lead = await leadQueAcepta();
    const admin = await adminConSesion();
    expect(await registrarSinContacto(admin, lead.id)).toEqual({ ok: true });

    expect(await registrarContacto(entrada(lead.sesion.id, lead.correo, true, lead.origen))).toEqual({ resultado: "lead" });
    let visto = await enLaLista(admin, lead.origen);
    expect(visto.aceptaContacto).toBe(true);
    expect(visto.sinContacto).toBeNull();
    expect((await fx.admin.from("lead_sin_contacto").select("id_lead").eq("id_lead", lead.id)).data).toEqual([]);

    expect(await registrarContacto(entrada(lead.sesion.id, lead.correo, false, lead.origen))).toEqual({ resultado: "lead" });
    visto = await enLaLista(admin, lead.origen);
    expect(visto.aceptaContacto).toBe(false);
    expect(visto.sinContacto).toBeNull();
  });
});
