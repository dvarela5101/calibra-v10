import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Consentimiento } from "@/lib/privacidad/consentimiento";
import { CORREO_FIJO, CORREO_YA_FIJO, INICIA_SESION_PARA_CAMBIAR } from "./avisos";

// Revisión de HU-032: lo que `registrarContacto` hace con un Lead que tiene cuenta o que otra sesión ya confirmó, sin base.
// El cliente de la llave secreta es inventado: `leer` contesta cada lectura según la tabla y los filtros, `actualizar` anota
// lo que se escribe en `lead` y `rpc` contesta las funciones. Aquí se fija qué se escribe y qué no, y qué mensaje sale con
// cada rechazo del trigger de `lead`; la base de verdad la cubren integracion/cuenta-estudiante.test.ts (K y M) y
// supabase/tests/cuenta_de_estudiante.test.sql.

type Filtro = [columna: string, valor: unknown];

const falsos = vi.hoisted(() => ({
  leer: vi.fn<(tabla: string, filtros: [string, unknown][]) => { data: unknown; error: unknown }>(),
  actualizar: vi.fn<(tabla: string, valores: Record<string, unknown>, filtros: [string, unknown][]) => { error: unknown }>(),
  rpc: vi.fn<(nombre: string, argumentos: Record<string, unknown>) => { data: unknown; error: unknown }>(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  crearClienteAdmin: () => ({
    from: (tabla: string) => ({
      select: () => {
        const filtros: [string, unknown][] = [];
        const cadena = {
          eq: (columna: string, valor: unknown) => {
            filtros.push([columna, valor]);
            return cadena;
          },
          maybeSingle: async () => falsos.leer(tabla, filtros),
        };
        return cadena;
      },
      update: (valores: Record<string, unknown>) => ({
        eq: async (columna: string, valor: unknown) => falsos.actualizar(tabla, valores, [[columna, valor]]),
      }),
    }),
    rpc: async (nombre: string, argumentos: Record<string, unknown>) => falsos.rpc(nombre, argumentos),
  }),
}));
vi.mock("@/lib/correo/servidor", () => ({
  enviarCorreoDesdeServidor: vi.fn(),
  urlDelSitio: (ruta: string) => `https://calibra.test${ruta}`,
}));

import { registrarContacto, type EntradaDeContacto } from "./servidor";

const SESION = "5e5e5e5e-0000-4000-8000-000000000032";
const OTRA_SESION = "0a0a0a0a-0000-4000-8000-000000000032";
const FILA_DEL_LEAD = { id: "1e1e1e1e-0000-4000-8000-000000000032", nombre: "Ana Pérez", correo: "ana@calibra.test", numero_telefono: null };
const CONSENTIMIENTO: Consentimiento = {
  acepta_tratamiento_datos: true,
  fecha_consentimiento: "2026-10-15T12:00:00.000Z",
  acepta_contacto: true,
  version_autorizacion: "2",
};

const entrada = (contacto: Partial<EntradaDeContacto["contacto"]> = {}): EntradaDeContacto => ({
  idSesion: SESION,
  contacto: { nombre: "Ana Pérez Gómez", correo: "ana@calibra.test", numeroTelefono: "+573001234567", ...contacto },
  consentimiento: CONSENTIMIENTO,
  origen: null,
  siguiente: "/agendar",
});

/** Cómo está la base para la sesión: de quién es el Lead y si tiene cuenta (y de quién). */
function baseCon(opciones: { lead?: "propio" | "ligado" | "cuenta" | null; cuentaDelLead?: string | null; errorDeCuenta?: unknown }) {
  const { lead = "propio", cuentaDelLead = null, errorDeCuenta = null } = opciones;
  falsos.leer.mockImplementation((tabla, filtros: Filtro[]) => {
    if (tabla === "estudiante" && filtros.some(([columna]) => columna === "id_lead")) {
      return { data: cuentaDelLead === null ? null : { id: cuentaDelLead }, error: errorDeCuenta };
    }
    if (tabla === "lead" && lead === "propio") return { data: FILA_DEL_LEAD, error: null };
    if (tabla === "lead_sesion" && lead === "ligado") return { data: { lead: FILA_DEL_LEAD }, error: null };
    if (tabla === "estudiante" && lead === "cuenta") return { data: { lead: FILA_DEL_LEAD }, error: null };
    return { data: null, error: null };
  });
}

beforeEach(() => {
  falsos.leer.mockReset();
  falsos.actualizar.mockReset().mockReturnValue({ error: null });
  // El tope de correos de HU-075 deja seguir.
  falsos.rpc.mockReset().mockImplementation((nombre) => ({ data: nombre === "anotar_correo_de_contacto" ? true : null, error: null }));
});

describe("registrarContacto: un Lead con cuenta lo cambia solo su cuenta (HU-032, revisión, hallazgo 2)", () => {
  it.each([
    ["la sesión que creó el Lead", "propio"],
    ["una sesión que confirmó el correo con el enlace de P-23", "ligado"],
  ] as const)("%s no lo cambia si la cuenta es otra: responde que inicie sesión y no escribe ni gasta el tope", async (_quien, lead) => {
    baseCon({ lead, cuentaDelLead: OTRA_SESION });

    expect(await registrarContacto(entrada({ nombre: "Otro Nombre", numeroTelefono: "+573009999999" }))).toEqual({
      resultado: "error",
      error: INICIA_SESION_PARA_CAMBIAR,
    });
    expect(falsos.actualizar).not.toHaveBeenCalled();
    expect(falsos.rpc).not.toHaveBeenCalled();
  });

  it("tampoco con otro correo: el aviso es el de iniciar sesión y no se anota el correo", async () => {
    baseCon({ lead: "propio", cuentaDelLead: OTRA_SESION });

    expect(await registrarContacto(entrada({ correo: "otro@calibra.test" }))).toEqual({ resultado: "error", error: INICIA_SESION_PARA_CAMBIAR });
    expect(falsos.rpc).not.toHaveBeenCalledWith("anotar_correo_de_contacto", expect.anything());
    expect(falsos.actualizar).not.toHaveBeenCalled();
  });

  it("la propia cuenta sí cambia su nombre, su teléfono y su autorización", async () => {
    baseCon({ lead: "cuenta", cuentaDelLead: SESION });

    expect(await registrarContacto(entrada())).toEqual({ resultado: "lead" });
    expect(falsos.actualizar).toHaveBeenCalledTimes(1);
    const [tabla, valores, filtros] = falsos.actualizar.mock.calls[0];
    expect(tabla).toBe("lead");
    expect(valores).toMatchObject({
      nombre: "Ana Pérez Gómez",
      numero_telefono: "+573001234567",
      acepta_contacto: true,
      fecha_consentimiento: CONSENTIMIENTO.fecha_consentimiento,
      version_autorizacion: "2",
    });
    expect(filtros).toEqual([["id", FILA_DEL_LEAD.id]]);
  });

  it("un Lead sin cuenta lo sigue cambiando la sesión que lo creó, y la cuenta se busca por el id del Lead", async () => {
    baseCon({ lead: "propio", cuentaDelLead: null });

    expect(await registrarContacto(entrada())).toEqual({ resultado: "lead" });
    expect(falsos.actualizar).toHaveBeenCalledTimes(1);
    expect(falsos.leer).toHaveBeenCalledWith("estudiante", [["id_lead", FILA_DEL_LEAD.id]]);
  });

  it("si no se puede leer la cuenta del Lead, lanza y no escribe: nunca se toma por «sin cuenta»", async () => {
    baseCon({ lead: "propio", errorDeCuenta: new Error("falló la base") });

    await expect(registrarContacto(entrada())).rejects.toThrow("falló la base");
    expect(falsos.actualizar).not.toHaveBeenCalled();
  });

  it("una sesión sin Lead no consulta ninguna cuenta: crea su Lead como siempre", async () => {
    baseCon({ lead: null });
    falsos.rpc.mockImplementation((nombre) => ({ data: nombre === "registrar_lead" ? FILA_DEL_LEAD.id : true, error: null }));

    expect(await registrarContacto(entrada())).toEqual({ resultado: "lead", idLeadNuevo: FILA_DEL_LEAD.id });
    expect(falsos.leer).not.toHaveBeenCalledWith("estudiante", [["id_lead", expect.anything()]]);
    expect(falsos.actualizar).not.toHaveBeenCalled();
  });
});

describe("registrarContacto: el trigger del correo de un Lead (HU-032, D-55 b y revisión, hallazgo 1)", () => {
  const rechazo = (message: string, code = "23514") => ({ code, message });

  beforeEach(() => {
    baseCon({ lead: "propio" });
  });

  it("el rechazo por tener cuenta (lead_correo_fijo_con_cuenta) da el mensaje del correo de la cuenta, no un error del servidor", async () => {
    falsos.actualizar.mockReturnValue({ error: rechazo("lead_correo_fijo_con_cuenta: el correo de un contacto con cuenta no se cambia") });

    expect(await registrarContacto(entrada({ correo: "otro@calibra.test" }))).toEqual({ resultado: "error", error: CORREO_FIJO });
  });

  it("el rechazo por correo ya confirmado por otra sesión (lead_correo_fijo_confirmado) da su propio mensaje", async () => {
    falsos.actualizar.mockReturnValue({ error: rechazo("lead_correo_fijo_confirmado: otra sesión ya confirmó el correo de este contacto") });

    const resultado = await registrarContacto(entrada({ correo: "otro@calibra.test" }));

    expect(resultado).toEqual({ resultado: "error", error: CORREO_YA_FIJO });
    expect(CORREO_YA_FIJO).not.toBe(CORREO_FIJO);
  });

  it("otro 23514 (el CHECK de normalización) sube como error: no se toma por un correo fijo", async () => {
    const otro = rechazo('new row for relation "lead" violates check constraint "lead_correo_normalizado"');
    falsos.actualizar.mockReturnValue({ error: otro });

    await expect(registrarContacto(entrada({ correo: "OTRO@calibra.test" }))).rejects.toBe(otro);
  });

  it("el nombre del trigger con otro código (no es un 23514) tampoco se toma por el correo fijo", async () => {
    const raro = rechazo("lead_correo_fijo_confirmado: algo", "XX000");
    falsos.actualizar.mockReturnValue({ error: raro });

    await expect(registrarContacto(entrada({ correo: "otro@calibra.test" }))).rejects.toBe(raro);
  });

  it("un correo que ya es de otro Lead (23505) sigue dando su mensaje de siempre", async () => {
    falsos.actualizar.mockReturnValue({ error: { code: "23505", message: "lead_correo_key" } });

    expect(await registrarContacto(entrada({ correo: "otro@calibra.test" }))).toEqual({
      resultado: "error",
      error: "Ese correo ya es de otro contacto de Calibra. Escribe el tuyo.",
    });
  });
});
