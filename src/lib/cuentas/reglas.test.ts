import { describe, expect, it } from "vitest";
import type { Rol } from "@/lib/auth/roles";
import {
  COOKIE_SIGUIENTE,
  esResultadoDeCrearEstudiante,
  esResultadoDeTope,
  pantallaDeCuenta,
  PARAMETRO_ENVIADO,
  RUTA_CONFIRMAR_CUENTA,
  RUTA_CONTRASENA,
  RUTA_CREAR_CUENTA,
  rutaDeCrearCuenta,
  rutaDeCrearCuentaEnviada,
  rutaDeRegreso,
  rutaParaCambiarDatos,
  rutaParaIngresar,
  SEGUNDOS_DE_LA_COOKIE,
  TEXTOS,
  tieneFormaDeTokenDeAuth,
  type EntradaDePantalla,
} from "./reglas";

const CON_CORREO = "ana@calibra.test";

/** Una entrada con valores por defecto de «sesión anónima con Lead, con correo y sin cuenta». */
const entrada = (cambios: Partial<EntradaDePantalla> = {}): EntradaDePantalla => ({
  sesion: { rol: "anonimo" },
  hayLead: true,
  correoDelLead: CON_CORREO,
  leadTieneCuenta: false,
  ...cambios,
});

describe("pantallaDeCuenta: la tabla de /cuenta/crear (HU-032, 4.2)", () => {
  it("un Estudiante va a «Mis citas», tenga o no Lead, correo o cuenta", () => {
    for (const hayLead of [true, false]) {
      for (const leadTieneCuenta of [true, false]) {
        expect(pantallaDeCuenta(entrada({ sesion: { rol: "estudiante" }, hayLead, leadTieneCuenta })), `${hayLead}/${leadTieneCuenta}`).toBe(
          "estudiante",
        );
      }
    }
  });

  it("un monitor o un admin ve que está en su cuenta del equipo, con cualquier Lead", () => {
    for (const rol of ["monitor", "admin"] as const) {
      for (const hayLead of [true, false]) {
        expect(pantallaDeCuenta(entrada({ sesion: { rol }, hayLead, leadTieneCuenta: hayLead })), `${rol}/${hayLead}`).toBe("equipo");
      }
    }
  });

  it("con sesión y un Lead que ya tiene cuenta: «ya tienes una cuenta», sea anónima o ya confirmada", () => {
    expect(pantallaDeCuenta(entrada({ leadTieneCuenta: true }))).toBe("ya_tiene_cuenta");
    // Una sesión ligada por P-23 a un Lead con cuenta.
    expect(pantallaDeCuenta(entrada({ leadTieneCuenta: true, correoDelLead: null }))).toBe("ya_tiene_cuenta");
    // Confirmó el correo, quedó sin rol y el Lead ya tiene otro Estudiante: repetir el paso no ayuda.
    expect(pantallaDeCuenta(entrada({ sesion: { rol: null }, leadTieneCuenta: true }))).toBe("ya_tiene_cuenta");
  });

  it("sin rol y no anónima (confirmó y falta crear el Estudiante): «Terminar de crear mi cuenta», con o sin Lead", () => {
    expect(pantallaDeCuenta(entrada({ sesion: { rol: null } }))).toBe("terminar");
    expect(pantallaDeCuenta(entrada({ sesion: { rol: null }, hayLead: false, correoDelLead: null }))).toBe("terminar");
    expect(pantallaDeCuenta(entrada({ sesion: { rol: null }, correoDelLead: null }))).toBe("terminar");
  });

  it("anónima con Lead sin correo: pide agregarlo", () => {
    expect(pantallaDeCuenta(entrada({ correoDelLead: null }))).toBe("sin_correo");
    expect(pantallaDeCuenta(entrada({ correoDelLead: "" }))).toBe("sin_correo");
  });

  it("anónima con Lead y correo: el resumen con «Crear mi cuenta»", () => {
    expect(pantallaDeCuenta(entrada())).toBe("resumen");
  });

  it("anónima sin Lead, o sin sesión todavía: el formulario de contacto", () => {
    expect(pantallaDeCuenta(entrada({ hayLead: false, correoDelLead: null }))).toBe("contacto");
    expect(pantallaDeCuenta(entrada({ sesion: null, hayLead: false, correoDelLead: null }))).toBe("contacto");
  });

  it("el orden importa: ya tiene cuenta gana a terminar, y el equipo a ya tiene cuenta", () => {
    expect(pantallaDeCuenta(entrada({ sesion: { rol: "monitor" }, leadTieneCuenta: true }))).toBe("equipo");
    expect(pantallaDeCuenta(entrada({ sesion: { rol: "estudiante" }, leadTieneCuenta: true }))).toBe("estudiante");
  });

  it("cubre cada combinación de rol con Lead y cuenta sin devolver nada fuera de las siete pantallas", () => {
    const pantallas = new Set(["estudiante", "equipo", "ya_tiene_cuenta", "terminar", "sin_correo", "resumen", "contacto"]);
    const roles: (Rol | null)[] = ["admin", "monitor", "estudiante", "anonimo", null];
    for (const rol of roles) {
      for (const hayLead of [true, false]) {
        for (const leadTieneCuenta of [true, false]) {
          for (const correoDelLead of [CON_CORREO, null]) {
            expect(pantallas.has(pantallaDeCuenta({ sesion: { rol }, hayLead, correoDelLead, leadTieneCuenta })), `${rol}/${hayLead}/${leadTieneCuenta}`).toBe(
              true,
            );
          }
        }
      }
    }
  });
});

describe("las rutas de crear la cuenta (HU-032)", () => {
  it("las constantes son las de la HU", () => {
    expect(RUTA_CREAR_CUENTA).toBe("/cuenta/crear");
    expect(RUTA_CONFIRMAR_CUENTA).toBe("/cuenta/confirmar");
    expect(RUTA_CONTRASENA).toBe("/cuenta/contrasena");
    expect(SEGUNDOS_DE_LA_COOKIE).toBe(24 * 60 * 60);
    expect(COOKIE_SIGUIENTE).toBe("calibra_cuenta_siguiente");
  });

  it("rutaDeCrearCuenta: sin ruta o con «/» queda sin ella; con una interna la codifica una vez", () => {
    expect(rutaDeCrearCuenta(undefined)).toBe("/cuenta/crear");
    expect(rutaDeCrearCuenta("")).toBe("/cuenta/crear");
    expect(rutaDeCrearCuenta("/")).toBe("/cuenta/crear");
    expect(rutaDeCrearCuenta("/privacidad")).toBe("/cuenta/crear?siguiente=%2Fprivacidad");
    expect(rutaDeCrearCuenta("/monitores?materia=X&dia=1#a")).toBe("/cuenta/crear?siguiente=%2Fmonitores%3Fmateria%3DX%26dia%3D1%23a");
  });

  it("las tres ignoran lo externo, lo mal formado y lo que no es texto", () => {
    for (const ruta of ["https://otro.sitio", "//otro.sitio", "/.//otro.sitio", "/\\otro.sitio", "javascript:alert(1)", 42, null, ["/a", "/b"]]) {
      expect(rutaDeCrearCuenta(ruta), String(ruta)).toBe("/cuenta/crear");
      expect(rutaParaIngresar(ruta), String(ruta)).toBe("/ingresar");
      expect(rutaParaCambiarDatos(ruta), String(ruta)).toBe(`/agendar/contacto?editar=1&siguiente=${encodeURIComponent("/cuenta/crear")}`);
    }
  });

  it("rutaParaIngresar lleva la misma ruta de regreso", () => {
    expect(rutaParaIngresar("/privacidad")).toBe("/ingresar?siguiente=%2Fprivacidad");
    expect(rutaParaIngresar("/")).toBe("/ingresar");
  });

  it("rutaParaCambiarDatos vuelve a /cuenta/crear con su propia ruta de regreso, codificada una sola vez", () => {
    expect(rutaParaCambiarDatos("/privacidad")).toBe(`/agendar/contacto?editar=1&siguiente=${encodeURIComponent("/cuenta/crear?siguiente=%2Fprivacidad")}`);
    // Decodificada una vez (lo que hace Next con searchParams), es la ruta de /cuenta/crear con su siguiente.
    const url = new URL(rutaParaCambiarDatos("/privacidad"), "https://calibra.invalid");
    expect(url.searchParams.get("editar")).toBe("1");
    expect(url.searchParams.get("siguiente")).toBe("/cuenta/crear?siguiente=%2Fprivacidad");
  });

  it("rutaDeCrearCuentaEnviada suma el aviso de envío con ? o & según haya ya una consulta", () => {
    expect(rutaDeCrearCuentaEnviada(undefined)).toBe("/cuenta/crear?enviado=1");
    expect(rutaDeCrearCuentaEnviada("/")).toBe("/cuenta/crear?enviado=1");
    expect(rutaDeCrearCuentaEnviada("/privacidad")).toBe("/cuenta/crear?siguiente=%2Fprivacidad&enviado=1");
    expect(rutaDeCrearCuentaEnviada("https://otro.sitio")).toBe("/cuenta/crear?enviado=1");
    expect(PARAMETRO_ENVIADO).toBe("enviado");
  });

  it("con una ruta de 500 caracteres, la de /cuenta/crear pasaría del límite y queda sin ella (no se volvería a la portada)", () => {
    const larga = `/${"a".repeat(499)}`;
    expect(larga).toHaveLength(500);
    expect(rutaDeCrearCuenta(larga)).toBe("/cuenta/crear");
    expect(rutaParaCambiarDatos(larga)).toBe(`/agendar/contacto?editar=1&siguiente=${encodeURIComponent("/cuenta/crear")}`);
    // Una de 501 ya la descarta rutaSiguiente.
    expect(rutaParaIngresar(`/${"a".repeat(500)}`)).toBe("/ingresar");
    // Ninguna dirección que se guarde como ruta de regreso supera los 500 caracteres.
    for (const largo of [10, 100, 200, 300, 499]) expect(rutaDeCrearCuenta(`/${"a".repeat(largo - 1)}`).length).toBeLessThanOrEqual(500);
  });

  it("con «&» y «?» en la ruta, la codificación las deja dentro del valor de siguiente", () => {
    const url = new URL(rutaParaIngresar("/monitores?materia=X&dia=1"), "https://calibra.invalid");
    expect([...url.searchParams.keys()]).toEqual(["siguiente"]);
    expect(url.searchParams.get("siguiente")).toBe("/monitores?materia=X&dia=1");
  });
});

describe("rutaDeRegreso (HU-032, criterio 15)", () => {
  it("sin cookie, vacía o «/», va a «Mis citas»", () => {
    for (const valor of [undefined, null, "", "/", 7]) expect(rutaDeRegreso(valor), String(valor)).toBe("/cita");
  });

  it("con una ruta interna, vuelve a ella, también con su consulta y su ancla", () => {
    expect(rutaDeRegreso("/privacidad")).toBe("/privacidad");
    expect(rutaDeRegreso("/monitores?materia=X#lista")).toBe("/monitores?materia=X#lista");
  });

  it("una externa, mal formada o de los paneles se ignora y va a «Mis citas»", () => {
    for (const valor of ["https://otro.sitio", "//otro.sitio", "/.//otro.sitio", "/\\otro", "/admin", "/admin/pagos", "/monitor", "/admin/../monitor", "/%61dmin"]) {
      expect(rutaDeRegreso(valor), valor).toBe("/cita");
    }
  });

  it("una ruta pública que empieza como un panel se respeta", () => {
    expect(rutaDeRegreso("/monitores")).toBe("/monitores");
  });
});

describe("tieneFormaDeTokenDeAuth", () => {
  it("acepta un token de 20 a 200 caracteres con letras, dígitos, guion y guion bajo, con o sin el prefijo pkce_", () => {
    expect(tieneFormaDeTokenDeAuth("a".repeat(20))).toBe(true);
    expect(tieneFormaDeTokenDeAuth(`pkce_${"a1B2".repeat(15)}`)).toBe(true);
    expect(tieneFormaDeTokenDeAuth("a_b-c".repeat(8))).toBe(true);
    expect(tieneFormaDeTokenDeAuth("a".repeat(200))).toBe(true);
  });

  it("rechaza vacío, corto, largo, con espacios o símbolos y lo que no es texto", () => {
    for (const valor of ["", "a".repeat(19), "a".repeat(201), `${"a".repeat(30)} `, "a".repeat(30) + "&", "a".repeat(30) + "=", "a".repeat(300), null, undefined, 7, ["a".repeat(30)]]) {
      expect(tieneFormaDeTokenDeAuth(valor), String(valor)).toBe(false);
    }
  });
});

describe("las respuestas de la base", () => {
  it("esResultadoDeCrearEstudiante acepta las cinco y nada más", () => {
    for (const valor of ["creada", "no_confirmada", "sin_lead", "ya_tiene_cuenta", "correo_distinto"]) {
      expect(esResultadoDeCrearEstudiante(valor), valor).toBe(true);
    }
    for (const valor of ["", "ok", "CREADA", null, undefined, true, 1, {}]) expect(esResultadoDeCrearEstudiante(valor), String(valor)).toBe(false);
  });

  it("esResultadoDeTope acepta las tres y nada más", () => {
    for (const valor of ["ok", "tope_de_sesion", "tope_global"]) expect(esResultadoDeTope(valor), valor).toBe(true);
    for (const valor of ["", "tope", "creada", "OK", null, undefined, true, 1]) expect(esResultadoDeTope(valor), String(valor)).toBe(false);
  });
});

describe("TEXTOS", () => {
  /** Todos los textos, ya armados: las funciones se llaman con un correo y un correo de soporte de prueba. */
  const todos = [
    ...Object.entries(TEXTOS).flatMap(([clave, valor]) => (typeof valor === "string" ? [[clave, valor] as const] : [])),
    ["avisoEnviado()", TEXTOS.avisoEnviado("zeta@calibra.test")] as const,
    ["soporte(correo)", TEXTOS.soporte("zeta@calibra.test")] as const,
    ["soporte(null)", TEXTOS.soporte(null)] as const,
  ];

  it("no tienen rayas largas ni «undefined» ni «null» ni «[object»", () => {
    for (const [clave, texto] of todos) {
      expect(texto, clave).not.toContain("—");
      expect(texto, clave).not.toContain("–");
      expect(texto, clave).not.toMatch(/undefined|\bnull\b|\[object/);
    }
  });

  it("el aviso de envío nombra el correo y es condicional, igual haya o no cuenta de Auth (RN-12)", () => {
    const aviso = TEXTOS.avisoEnviado("zeta@calibra.test");
    expect(aviso).toContain("Si zeta@calibra.test puede crear una cuenta");
    expect(aviso).toContain("revisa la carpeta de spam");
    expect(aviso).not.toMatch(/ya existe|ya tiene una cuenta con/i);
  });

  it("los textos fijos no llevan correo", () => {
    for (const [clave, texto] of todos.filter(([clave]) => !clave.includes("("))) expect(texto, clave).not.toContain("@");
  });

  it("el mensaje de soporte nombra el correo solo si existe", () => {
    expect(TEXTOS.soporte("ayuda@calibra.test")).toBe("No pudimos activar tu cuenta con estos datos. Escribe a soporte (ayuda@calibra.test) y te ayudamos.");
    expect(TEXTOS.soporte(null)).toBe("No pudimos activar tu cuenta con estos datos. Escribe a soporte y te ayudamos.");
  });
});
