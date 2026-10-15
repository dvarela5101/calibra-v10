import { describe, expect, it } from "vitest";
import { avisoDeVerificacion, CORREO_FIJO, type EnvioDeVerificacion } from "./avisos";

const ENVIOS: EnvioDeVerificacion[] = ["enviado", "frenado", "fallido"];

// Los textos que tenía `agendar/contacto/acciones.ts` antes de HU-032 (AVISO_DE_VERIFICACION), copiados literalmente: el
// de «agendando» tiene que seguir siendo idéntico.
const DE_AGENDAR: Record<EnvioDeVerificacion, string> = {
  enviado:
    "Ese correo ya está en Calibra. Si es tuyo, te llega un enlace para confirmarlo: ábrelo en este navegador y sigues agendando aquí. El enlace vence en 24 horas. Si no te llega en unos minutos, revisa la carpeta de spam.",
  frenado:
    "Ese correo ya está en Calibra y ya le mandamos varios enlaces para confirmarlo en la última hora. Busca el más reciente en ese correo (también en spam) o vuelve a intentarlo en una hora.",
  fallido: "Ese correo ya está en Calibra, pero no pudimos mandarte el enlace para confirmarlo. Intenta de nuevo en unos minutos.",
};

describe("avisoDeVerificacion (HU-068, HU-032)", () => {
  it("«agendando» es idéntico al texto de antes, caracter por caracter", () => {
    for (const envio of ENVIOS) expect(avisoDeVerificacion(envio, "agendando"), envio).toBe(DE_AGENDAR[envio]);
  });

  it("«creando tu cuenta» solo cambia el final del primero: «sigues creando tu cuenta aquí»", () => {
    expect(avisoDeVerificacion("enviado", "creando tu cuenta")).toBe(
      DE_AGENDAR.enviado.replace("sigues agendando aquí", "sigues creando tu cuenta aquí"),
    );
    expect(avisoDeVerificacion("enviado", "creando tu cuenta")).toContain("sigues creando tu cuenta aquí");
    expect(avisoDeVerificacion("enviado", "creando tu cuenta")).not.toContain("agendando");
  });

  it("los otros dos son los mismos en las dos variantes", () => {
    for (const envio of ["frenado", "fallido"] as const) {
      expect(avisoDeVerificacion(envio, "creando tu cuenta"), envio).toBe(avisoDeVerificacion(envio, "agendando"));
    }
  });

  it("ninguno dice si el correo tiene cuenta (RN-12)", () => {
    for (const envio of ENVIOS) {
      for (const seguir of ["agendando", "creando tu cuenta"] as const) {
        expect(avisoDeVerificacion(envio, seguir), `${envio}/${seguir}`).not.toMatch(/tiene (una )?cuenta|ya tienes/i);
      }
    }
  });
});

describe("CORREO_FIJO (D-55 b)", () => {
  it("dice que el correo es el de la cuenta, que no se cambia aquí y que escriba a soporte, sin rayas largas", () => {
    expect(CORREO_FIJO).toBe("Tu correo es el de tu cuenta y no se puede cambiar aquí. Si necesitas cambiarlo, escribe a soporte.");
    expect(CORREO_FIJO).not.toContain("—");
  });
});
