import { beforeEach, describe, expect, it, vi } from "vitest";
import { FILA_DE_EJEMPLO } from "../../../pruebas/diagnostico-sembrado";
import { CLAVES_DEL_RESULTADO, proyectarResultado } from "./mostrar";

// HU-031: el enlace de resultados sin base ni proveedor. El cliente de Supabase y el envío son inventados; lo que se fija es
// cuándo se consulta, qué correo se arma, a qué diagnóstico va la clave y que el token nunca va al registro. El recorrido
// real (Mailpit, `correo_envio`, reintentos) lo cubren integracion/recuperar-resultados.test.ts y la e2e.

const falsos = vi.hoisted(() => ({ despues: [] as (() => Promise<unknown>)[] }));

vi.mock("next/server", () => ({ after: (tarea: () => Promise<unknown>) => falsos.despues.push(tarea) }));
vi.mock("@/lib/supabase/admin", () => ({
  crearClienteAdmin: () => {
    throw new Error("Las pruebas pasan su propio cliente.");
  },
}));
vi.mock("@/lib/correo/servidor", () => ({
  enviarCorreoDesdeServidor: () => {
    throw new Error("Las pruebas pasan su propio envío.");
  },
  urlDelSitio: (ruta: string) => `https://calibra.test${ruta}`,
}));

import {
  leerResultadoPorToken,
  mandarEnlaceDeResultados,
  mandarEnlaceDelUltimoDiagnostico,
  programarEnlace,
  reconstruirRecuperacion,
  tieneFormaDeTokenDeResultados,
  type DependenciasDelEnlace,
} from "./recuperacion";

type Cliente = NonNullable<DependenciasDelEnlace["cliente"]>;

const TOKEN = "ab".repeat(32);
const ID_DIAGNOSTICO = "d1000000-0000-4000-8000-000000000031";
const ID_LEAD = "1e000000-0000-4000-8000-000000000031";

/** Un cliente con una sola respuesta por consulta, que anota lo que se le pidió. */
function clienteFalso(respuestas: { rpc?: unknown; fila?: unknown; error?: { code: string } | null }) {
  const llamadas: { metodo: string; args: unknown[] }[] = [];
  const consulta = {
    select: (...args: unknown[]) => (llamadas.push({ metodo: "select", args }), consulta),
    eq: (...args: unknown[]) => (llamadas.push({ metodo: "eq", args }), consulta),
    order: (...args: unknown[]) => (llamadas.push({ metodo: "order", args }), consulta),
    limit: (...args: unknown[]) => (llamadas.push({ metodo: "limit", args }), consulta),
    maybeSingle: async () => ({ data: respuestas.fila ?? null, error: respuestas.error ?? null }),
  };
  const cliente = {
    rpc: vi.fn(async (...args: unknown[]) => {
      llamadas.push({ metodo: "rpc", args });
      return { data: respuestas.rpc ?? [], error: respuestas.error ?? null };
    }),
    from: (...args: unknown[]) => (llamadas.push({ metodo: "from", args }), consulta),
  };
  return { cliente: cliente as unknown as Cliente, llamadas };
}

/** Todas las claves de un valor, también las anidadas. */
function claves(valor: unknown, encontradas = new Set<string>()): Set<string> {
  if (Array.isArray(valor)) for (const elemento of valor) claves(elemento, encontradas);
  else if (valor && typeof valor === "object") {
    for (const [clave, anidado] of Object.entries(valor)) {
      encontradas.add(clave);
      claves(anidado, encontradas);
    }
  }
  return encontradas;
}

const FILA_DEL_CORREO = {
  token_recuperacion: TOKEN,
  evaluacion: { materia: { nombre: "Cálculo Integral" } },
  lead: { nombre: "Ana Pérez", correo: " ana@calibra.test " },
};

beforeEach(() => {
  falsos.despues = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("tieneFormaDeTokenDeResultados", () => {
  it("solo 64 hexadecimales en minúscula, en una cadena", () => {
    expect(tieneFormaDeTokenDeResultados(TOKEN)).toBe(true);
    for (const valor of [undefined, "", TOKEN.toUpperCase(), TOKEN.slice(1), `${TOKEN}0`, ` ${TOKEN}`, [TOKEN, TOKEN], ID_DIAGNOSTICO, "g".repeat(64)]) {
      expect(tieneFormaDeTokenDeResultados(valor)).toBe(false);
    }
  });
});

describe("leerResultadoPorToken", () => {
  it("un token sin la forma no consulta la base", async () => {
    const { cliente } = clienteFalso({});
    for (const token of [undefined, "", "abc", [TOKEN, TOKEN], ID_DIAGNOSTICO]) {
      await expect(leerResultadoPorToken(token, cliente)).resolves.toBeNull();
    }
    expect(cliente.rpc).not.toHaveBeenCalled();
  });

  it("con fila, la proyección de HU-009 y nada más", async () => {
    const { cliente } = clienteFalso({ rpc: [FILA_DE_EJEMPLO] });
    const resultado = await leerResultadoPorToken(TOKEN, cliente);
    expect(cliente.rpc).toHaveBeenCalledExactlyOnceWith("resultado_por_token", { p_token: TOKEN });
    expect(resultado).toEqual(proyectarResultado(FILA_DE_EJEMPLO));
    expect([...claves(resultado)].filter((clave) => !CLAVES_DEL_RESULTADO.includes(clave))).toEqual([]);
    expect(JSON.stringify(resultado)).not.toContain(TOKEN);
  });

  it("sin fila (no existe o no tiene Lead), null", async () => {
    const { cliente } = clienteFalso({ rpc: [] });
    await expect(leerResultadoPorToken(TOKEN, cliente)).resolves.toBeNull();
  });

  it("si la base falla lanza con el código, sin el token", async () => {
    const { cliente } = clienteFalso({ error: { code: "57014" } });
    const error = await leerResultadoPorToken(TOKEN, cliente).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("57014");
    expect((error as Error).message).not.toContain(TOKEN);
  });
});

describe("reconstruirRecuperacion", () => {
  it("arma el correo al Lead con el enlace del token, siempre el mismo (D-20)", async () => {
    const { cliente } = clienteFalso({ fila: FILA_DEL_CORREO });
    const esperado = {
      destinatario: "ana@calibra.test",
      datos: { nombre: "Ana Pérez", materia: "Cálculo Integral", enlace: `https://calibra.test/resultados?token=${TOKEN}` },
    };
    await expect(reconstruirRecuperacion(ID_DIAGNOSTICO, cliente)).resolves.toEqual(esperado);
    await expect(reconstruirRecuperacion(ID_DIAGNOSTICO, cliente)).resolves.toEqual(esperado);
  });

  it("sin diagnóstico, sin Lead o con un Lead sin correo, null", async () => {
    for (const fila of [null, { ...FILA_DEL_CORREO, lead: null }, { ...FILA_DEL_CORREO, lead: { nombre: "Ana", correo: null } }, { ...FILA_DEL_CORREO, lead: { nombre: "Ana", correo: "  " } }]) {
      const { cliente } = clienteFalso({ fila });
      await expect(reconstruirRecuperacion(ID_DIAGNOSTICO, cliente)).resolves.toBeNull();
    }
  });

  it("una entidad que no es UUID no consulta", async () => {
    const { cliente, llamadas } = clienteFalso({ fila: FILA_DEL_CORREO });
    await expect(reconstruirRecuperacion("no-es-un-id", cliente)).resolves.toBeNull();
    expect(llamadas).toHaveLength(0);
  });
});

describe("mandarEnlaceDeResultados", () => {
  it("manda la plantilla con la clave del diagnóstico", async () => {
    const { cliente } = clienteFalso({ fila: FILA_DEL_CORREO });
    const enviar = vi.fn(async () => ({ ok: true as const, idEnvio: "x", omitido: false }));
    await mandarEnlaceDeResultados(ID_DIAGNOSTICO.toUpperCase(), { cliente, enviar: enviar as never });
    expect(enviar).toHaveBeenCalledExactlyOnceWith({
      plantilla: "recuperacion_diagnostico",
      datos: { nombre: "Ana Pérez", materia: "Cálculo Integral", enlace: `https://calibra.test/resultados?token=${TOKEN}` },
      destinatario: "ana@calibra.test",
      entidad: ID_DIAGNOSTICO,
    });
  });

  it("sin a quién mandarlo no llama al envío", async () => {
    const { cliente } = clienteFalso({ fila: { ...FILA_DEL_CORREO, lead: null } });
    const enviar = vi.fn();
    await expect(mandarEnlaceDeResultados(ID_DIAGNOSTICO, { cliente, enviar: enviar as never })).resolves.toBeNull();
    expect(enviar).not.toHaveBeenCalled();
  });

  it("un envío que no sale queda en el log sin el token", async () => {
    const { cliente } = clienteFalso({ fila: FILA_DEL_CORREO });
    const enviar = vi.fn(async () => ({ ok: false as const, motivo: "fallo_del_proveedor", error: "x", intentos: 3 }));
    await mandarEnlaceDeResultados(ID_DIAGNOSTICO, { cliente, enviar: enviar as never });
    const registro = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(registro).toContain(ID_DIAGNOSTICO);
    expect(registro).not.toContain(TOKEN);
  });
});

describe("mandarEnlaceDelUltimoDiagnostico", () => {
  it("pide el más reciente del Lead: fecha y, en empate, id, de mayor a menor", async () => {
    const { cliente, llamadas } = clienteFalso({ fila: { id: ID_DIAGNOSTICO } });
    const enviar = vi.fn();
    // La segunda lectura (la del correo) devuelve la misma fila falsa, sin Lead: no se manda nada, y aquí no importa.
    await mandarEnlaceDelUltimoDiagnostico(ID_LEAD, { cliente, enviar: enviar as never });
    expect(llamadas.slice(0, 6)).toEqual([
      { metodo: "from", args: ["diagnostico"] },
      { metodo: "select", args: ["id"] },
      { metodo: "eq", args: ["id_lead", ID_LEAD] },
      { metodo: "order", args: ["fecha_realizacion", { ascending: false }] },
      { metodo: "order", args: ["id", { ascending: false }] },
      { metodo: "limit", args: [1] },
    ]);
    expect(llamadas).toContainEqual({ metodo: "eq", args: ["id", ID_DIAGNOSTICO] });
  });

  it("sin diagnósticos no manda nada", async () => {
    const { cliente } = clienteFalso({ fila: null });
    const enviar = vi.fn();
    await expect(mandarEnlaceDelUltimoDiagnostico(ID_LEAD, { cliente, enviar: enviar as never })).resolves.toBeNull();
    expect(enviar).not.toHaveBeenCalled();
  });
});

describe("programarEnlace", () => {
  it("deja la tarea para después de responder y un fallo solo queda en el log", async () => {
    const tarea = vi.fn(async () => {
      throw new Error("se cayó el proveedor");
    });
    programarEnlace(tarea);
    expect(tarea).not.toHaveBeenCalled();
    expect(falsos.despues).toHaveLength(1);
    await expect(falsos.despues[0]()).resolves.toBeUndefined();
    expect(tarea).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("enlace de resultados"), "se cayó el proveedor");
  });
});
