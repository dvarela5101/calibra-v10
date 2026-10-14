import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cargarPerfiles } from "@/lib/disponibilidad/servidor";
import { crearCliente, exigirSupabaseLocal, exito, Fixtures } from "./utilidades";

// HU-049 contra el Supabase LOCAL, por la Data API y con sesiones reales: el `update` del dueño pasa con el grant por
// columna y las políticas de update y de lectura; nadie más lo cambia; y la lectura depende del certificado y de la
// cuenta activa. La fila de perfil_monitor la crea la prueba, como lo haría registrar_monitor (HU-013).

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

async function monitorConPerfil(certificado: boolean) {
  const monitor = await fx.crearMonitor();
  exito(await fx.admin.from("perfil_monitor").insert({ id_monitor: monitor.id }).select().single(), "crear perfil");
  if (certificado) {
    const admin = await fx.crearAdmin();
    const materia = await fx.crearMateria();
    await fx.crearCertificado({ idMonitor: monitor.id, idMateria: materia.id, idAdmin: admin.id });
  }
  return monitor;
}

const PERFIL = { carrera: "Ingeniería Industrial", semestre: 7, presentacion: "Hola\nMonitor de Cálculo 2 desde 2024-1" };

describe("guardar el perfil (HU-049)", () => {
  it("el dueño guarda los tres campos con su sesión y otro monitor no los cambia", async () => {
    const dueno = await monitorConPerfil(true);
    const sesion = await fx.iniciarSesion(dueno);
    const guardado = exito(
      await sesion.from("perfil_monitor").update(PERFIL).eq("id_monitor", dueno.id).select("carrera, semestre, presentacion"),
      "guardar perfil",
    );
    expect(guardado).toEqual([PERFIL]);

    const otro = await fx.iniciarSesion(await monitorConPerfil(true));
    const intento = exito(await otro.from("perfil_monitor").update({ carrera: "Otra" }).eq("id_monitor", dueno.id).select("id_monitor"), "intento");
    expect(intento).toEqual([]);

    const admin = await fx.iniciarSesion(await fx.crearAdmin());
    expect(exito(await admin.from("perfil_monitor").update({ carrera: "Otra" }).eq("id_monitor", dueno.id).select("id_monitor"), "admin")).toEqual([]);

    const anonimo = crearCliente();
    const { error } = await anonimo.from("perfil_monitor").update({ carrera: "Otra" }).eq("id_monitor", dueno.id);
    expect(error?.code).toBe("42501");

    const final = exito(await fx.admin.from("perfil_monitor").select("carrera").eq("id_monitor", dueno.id).single(), "leer");
    expect(final.carrera).toBe(PERFIL.carrera);
  });

  it("los CHECK rechazan lo que la app rechaza (D-58 b) y no guardan nada", async () => {
    const dueno = await monitorConPerfil(true);
    const sesion = await fx.iniciarSesion(dueno);
    const { error } = await sesion
      .from("perfil_monitor")
      .update({ carrera: "Sistemas", presentacion: "Escríbeme al 300 123 4567" })
      .eq("id_monitor", dueno.id);
    expect(error?.code).toBe("23514");
    const fila = exito(await fx.admin.from("perfil_monitor").select("carrera, presentacion").eq("id_monitor", dueno.id).single(), "leer");
    expect(fila).toEqual({ carrera: null, presentacion: null });
  });

  it("nadie crea perfiles por la Data API", async () => {
    const monitor = await fx.crearMonitor();
    const sesion = await fx.iniciarSesion(monitor);
    const { error } = await sesion.from("perfil_monitor").insert({ id_monitor: monitor.id });
    expect(error?.code).toBe("42501");
  });
});

describe("quién ve el perfil (HU-049)", () => {
  it("un visitante ve el del certificado y activo; no el del sin certificado ni el del desactivado", async () => {
    const certificado = await monitorConPerfil(true);
    const sinCertificado = await monitorConPerfil(false);
    const desactivado = await monitorConPerfil(true);
    for (const { id } of [certificado, sinCertificado, desactivado]) {
      exito(await fx.admin.from("perfil_monitor").update(PERFIL).eq("id_monitor", id).select(), "llenar perfil");
    }
    const { error } = await fx.admin.auth.admin.updateUserById(desactivado.id, { ban_duration: "876000h" });
    if (error) throw error;

    const perfiles = await cargarPerfiles(crearCliente(), [certificado.id, sinCertificado.id, desactivado.id]);
    expect([...perfiles.keys()]).toEqual([certificado.id]);
    expect(perfiles.get(certificado.id)).toEqual(PERFIL);

    // El dueño sin certificado ve el suyo.
    const propio = await fx.iniciarSesion(sinCertificado);
    expect(exito(await propio.from("perfil_monitor").select("id_monitor").eq("id_monitor", sinCertificado.id), "propio")).toHaveLength(1);

    // Un admin los ve todos.
    const admin = await fx.iniciarSesion(await fx.crearAdmin());
    const vistos = exito(
      await admin.from("perfil_monitor").select("id_monitor").in("id_monitor", [certificado.id, sinCertificado.id, desactivado.id]),
      "admin",
    );
    expect(vistos).toHaveLength(3);
  });
});
