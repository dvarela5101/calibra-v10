import { describe, expect, it } from "vitest";
import { AVISO_SIN_VERIFICACION, TEXTO_REINTENTAR_VERIFICACION, TEXTO_VERIFICANDO } from "./textos";

// Las pruebas e2e buscan estos textos tal cual: si cambian aquí, hay que cambiarlas allá.
describe("textos del CAPTCHA", () => {
  it("son los de la interfaz", () => {
    expect(AVISO_SIN_VERIFICACION).toBe("No pudimos verificar tu navegador. Revisa tu conexión y vuelve a intentarlo.");
    expect(TEXTO_REINTENTAR_VERIFICACION).toBe("Reintentar la verificación");
    expect(TEXTO_VERIFICANDO).toBe("Verificando…");
  });
});
