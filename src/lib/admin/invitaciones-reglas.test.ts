import { describe, expect, it } from "vitest";
import {
  AVISO_DE_DATOS,
  claveDeRechazoAlCancelar,
  claveDeRechazoAlInvitar,
  esClaveDeErrorDeInvitar,
  esResultadoDeCancelar,
  leerInvitacion,
  leerRegistroDeAdmin,
  MENSAJES_DE_CANCELAR,
  MENSAJES_DE_INVITAR,
  RESULTADOS_DE_CANCELAR,
  rutaDeRegistroDeAdmin,
  RUTA_REGISTRO_DE_ADMIN,
} from "./invitaciones-reglas";

const formulario = (campos: Record<string, string | Blob>) => {
  const datos = new FormData();
  for (const [campo, valor] of Object.entries(campos)) datos.set(campo, valor);
  return datos;
};

const BUENO = { correo: "nuevo@calibra.test", correo_repetido: "nuevo@calibra.test", entiendo: "si" };

describe("leerInvitacion (HU-072, criterios 2 y 3)", () => {
  it("con el correo dos veces y la casilla marcada devuelve el correo normalizado", () => {
    expect(leerInvitacion(formulario(BUENO))).toEqual({ ok: true, correo: "nuevo@calibra.test" });
  });

  it("compara los dos correos ya normalizados: mayúsculas y espacios distintos son el mismo correo", () => {
    expect(leerInvitacion(formulario({ ...BUENO, correo: "  Nuevo@Calibra.Test ", correo_repetido: "nuevo@CALIBRA.test" }))).toEqual({
      ok: true,
      correo: "nuevo@calibra.test",
    });
  });

  it.each([
    ["distinto", "otro@calibra.test"],
    ["vacío", ""],
    ["con otra letra", "nuevo@calibra.tes"],
  ])("un correo repetido %s es correos_distintos", (_caso, repetido) => {
    expect(leerInvitacion(formulario({ ...BUENO, correo_repetido: repetido }))).toEqual({ ok: false, error: "correos_distintos" });
  });

  it("sin el campo del correo repetido también son correos_distintos", () => {
    expect(leerInvitacion(formulario({ correo: BUENO.correo, entiendo: "si" }))).toEqual({ ok: false, error: "correos_distintos" });
  });

  it("un correo repetido que no es un correo no pasa aunque el primero sea válido", () => {
    expect(leerInvitacion(formulario({ ...BUENO, correo_repetido: "nuevo" }))).toEqual({ ok: false, error: "correos_distintos" });
  });

  it.each([
    ["sin el campo", undefined],
    ["con otro valor", "on"],
    ["vacía", ""],
    ["en mayúsculas", "SI"],
  ])("la casilla %s es sin_aviso", (_caso, entiendo) => {
    const campos: Record<string, string> = { correo: BUENO.correo, correo_repetido: BUENO.correo_repetido };
    if (entiendo !== undefined) campos.entiendo = entiendo;
    expect(leerInvitacion(formulario(campos))).toEqual({ ok: false, error: "sin_aviso" });
  });

  it("los dos errores juntos tienen su propia clave", () => {
    expect(leerInvitacion(formulario({ correo: BUENO.correo, correo_repetido: "otro@calibra.test" }))).toEqual({
      ok: false,
      error: "correos_distintos_y_sin_aviso",
    });
  });

  it.each([
    ["vacío", ""],
    ["sin arroba", "nuevo.calibra.test"],
    ["con una cabecera colada", "a@x.co?bcc=b@y.co"],
    ["con &", "a&b@x.co"],
    ["con una barra", "a/b@x.co"],
    ["con un signo de interrogación", "a?b@x.co"],
    ["de 255 caracteres", `${"a".repeat(242)}@calibra.test`],
  ])("un correo %s es correo_invalido, y gana sobre los demás errores", (_caso, correo) => {
    expect(leerInvitacion(formulario({ ...BUENO, correo }))).toEqual({ ok: false, error: "correo_invalido" });
    expect(leerInvitacion(formulario({ correo, correo_repetido: "otro@calibra.test" }))).toEqual({ ok: false, error: "correo_invalido" });
  });

  it("un correo de 254 caracteres, el largo máximo, sí vale", () => {
    const correo = `${"a".repeat(241)}@calibra.test`;
    expect(correo).toHaveLength(254);
    expect(leerInvitacion(formulario({ ...BUENO, correo, correo_repetido: correo }))).toEqual({ ok: true, correo });
  });

  it("un archivo en vez del correo es correo_invalido", () => {
    expect(leerInvitacion(formulario({ ...BUENO, correo: new Blob(["x"]) }))).toEqual({ ok: false, error: "correo_invalido" });
  });

  it("sin ningún campo es correo_invalido", () => {
    expect(leerInvitacion(new FormData())).toEqual({ ok: false, error: "correo_invalido" });
  });
});

describe("los textos de invitar y de cancelar", () => {
  it("cada clave que puede salir de leerInvitacion tiene su mensaje", () => {
    for (const clave of ["correo_invalido", "correos_distintos", "sin_aviso", "correos_distintos_y_sin_aviso"] as const) {
      expect(esClaveDeErrorDeInvitar(clave), clave).toBe(true);
      expect(MENSAJES_DE_INVITAR[clave].length).toBeGreaterThan(10);
    }
  });

  it("los textos fijados por la HU salen tal cual", () => {
    expect(MENSAJES_DE_INVITAR.correos_distintos).toBe("Los dos correos no coinciden. Escríbelos de nuevo.");
    expect(MENSAJES_DE_INVITAR.sin_aviso).toBe("Marca la casilla para confirmar que la persona podrá ver esos datos personales.");
    expect(MENSAJES_DE_INVITAR.es_admin_desactivado).toContain("«Reactivar»");
    expect(MENSAJES_DE_INVITAR.es_monitor).toBe("Ese correo ya tiene una cuenta de monitor.");
    expect(MENSAJES_DE_CANCELAR.no_abierta).toBe("Esa invitación ya no está abierta.");
    expect(MENSAJES_DE_CANCELAR.no_encontrada).toBe("Esa invitación ya no está abierta.");
  });

  it("ningún mensaje lleva un correo, un marcador sin llenar ni una raya larga", () => {
    for (const texto of [...Object.values(MENSAJES_DE_INVITAR), ...Object.values(MENSAJES_DE_CANCELAR), AVISO_DE_DATOS]) {
      expect(texto).not.toMatch(/@|undefined|null|NaN|\{\{|[—–]/);
    }
  });

  it("la casilla nombra los datos que va a ver la persona", () => {
    expect(AVISO_DE_DATOS).toMatch(/estudiantes/);
    expect(AVISO_DE_DATOS).toMatch(/quienes pagan/);
    expect(AVISO_DE_DATOS).toMatch(/monitores/);
    expect(AVISO_DE_DATOS).toMatch(/llaves de pago/);
  });

  it("la clave del rechazo de invitar no choca con la de «Subir» y «Bajar»", () => {
    expect(claveDeRechazoAlInvitar("sin_permiso")).toBe("sin_permiso_invitar");
    expect(claveDeRechazoAlInvitar("es_admin")).toBe("es_admin");
    expect(claveDeRechazoAlInvitar("es_admin_desactivado")).toBe("es_admin_desactivado");
    expect(claveDeRechazoAlInvitar("es_monitor")).toBe("es_monitor");
    for (const motivo of ["es_admin", "es_admin_desactivado", "es_monitor", "sin_permiso"] as const) {
      expect(esClaveDeErrorDeInvitar(claveDeRechazoAlInvitar(motivo))).toBe(true);
    }
  });

  it("la clave del rechazo de cancelar tiene su mensaje", () => {
    expect(claveDeRechazoAlCancelar("sin_permiso")).toBe("sin_permiso_cancelar");
    expect(claveDeRechazoAlCancelar("no_abierta")).toBe("no_abierta");
    expect(claveDeRechazoAlCancelar("no_encontrada")).toBe("no_encontrada");
    for (const resultado of ["no_abierta", "no_encontrada", "sin_permiso"] as const) {
      expect(MENSAJES_DE_CANCELAR[claveDeRechazoAlCancelar(resultado)]).toBeTruthy();
    }
  });

  it("una clave que no es de invitar no se reconoce, tampoco las del prototipo de los objetos", () => {
    for (const valor of ["", "nada", undefined, 3, "constructor", "toString", "__proto__"]) {
      expect(esClaveDeErrorDeInvitar(valor), String(valor)).toBe(false);
    }
  });

  it("reconoce los cuatro resultados de cancelar y nada más", () => {
    for (const resultado of RESULTADOS_DE_CANCELAR) expect(esResultadoDeCancelar(resultado)).toBe(true);
    for (const valor of ["", "cancelado", "no_encontrado", null, undefined, 1, true]) expect(esResultadoDeCancelar(valor)).toBe(false);
  });
});

describe("rutaDeRegistroDeAdmin", () => {
  it("es /admins/registro con el token en la consulta", () => {
    expect(RUTA_REGISTRO_DE_ADMIN).toBe("/admins/registro");
    expect(rutaDeRegistroDeAdmin("abc123")).toBe("/admins/registro?token=abc123");
  });
});

describe("leerRegistroDeAdmin (HU-072, criterio 7)", () => {
  const registro = { nombre: "Ana Pérez", contrasena: "12345678", confirmacion: "12345678" };

  it("devuelve el nombre sin espacios de sobra y la contraseña tal cual", () => {
    expect(leerRegistroDeAdmin(formulario({ ...registro, nombre: "  Ana   Pérez \n" }))).toEqual({
      ok: true,
      datos: { nombre: "Ana Pérez", contrasena: "12345678" },
    });
  });

  it("un nombre con saltos de línea queda en una sola línea", () => {
    const lectura = leerRegistroDeAdmin(formulario({ ...registro, nombre: "Ana\r\nPérez" }));
    expect(lectura).toEqual({ ok: true, datos: { nombre: "Ana Pérez", contrasena: "12345678" } });
  });

  it.each(["", "   ", "\n\t"])("el nombre %j pide escribirlo", (nombre) => {
    expect(leerRegistroDeAdmin(formulario({ ...registro, nombre }))).toEqual({ ok: false, error: "Escribe tu nombre." });
  });

  it("acepta un nombre de 120 caracteres y rechaza uno de 121", () => {
    expect(leerRegistroDeAdmin(formulario({ ...registro, nombre: "a".repeat(120) })).ok).toBe(true);
    expect(leerRegistroDeAdmin(formulario({ ...registro, nombre: "a".repeat(121) }))).toEqual({
      ok: false,
      error: "El nombre es demasiado largo.",
    });
  });

  it("la contraseña pide 8 caracteres: 7 no, 8 sí", () => {
    expect(leerRegistroDeAdmin(formulario({ ...registro, contrasena: "1234567", confirmacion: "1234567" }))).toEqual({
      ok: false,
      error: "La contraseña debe tener al menos 8 caracteres.",
    });
    expect(leerRegistroDeAdmin(formulario({ ...registro, contrasena: "12345678", confirmacion: "12345678" })).ok).toBe(true);
  });

  it("las dos contraseñas tienen que coincidir", () => {
    expect(leerRegistroDeAdmin(formulario({ ...registro, confirmacion: "87654321" }))).toEqual({
      ok: false,
      error: "Las dos contraseñas no coinciden.",
    });
    expect(leerRegistroDeAdmin(formulario({ nombre: "Ana", contrasena: "12345678" }))).toEqual({
      ok: false,
      error: "Las dos contraseñas no coinciden.",
    });
  });

  it("no recorta la contraseña: un espacio al final es parte de ella", () => {
    const lectura = leerRegistroDeAdmin(formulario({ ...registro, contrasena: "12345678 ", confirmacion: "12345678 " }));
    expect(lectura).toEqual({ ok: true, datos: { nombre: "Ana Pérez", contrasena: "12345678 " } });
  });
});
