import type { BrowserContext, Cookie } from "@playwright/test";
import { cookiesDeSesion, esperarSesion, expect, leerSesion, test } from "./utilidades";

// HU-056: quien vuelve con la cookie de una sesión que la limpieza ya borró ve el inicio normal y recibe una sesión
// anónima nueva. La limpieza borra la sesión de Auth; aquí se borra su usuario con la llave secreta, que es lo mismo
// para el navegador. Una sola sesión por prueba: el Auth local limita las altas anónimas por IP.
test.describe.configure({ timeout: 60_000 });
const ESPERA = { timeout: 20_000 };

// Tamaño de cada trozo de la cookie de sesión de @supabase/ssr.
const TROZO = 3180;

/** Reescribe la cookie de sesión con el token ya vencido, como la que trae alguien que vuelve 90 días después. */
async function vencerToken(context: BrowserContext): Promise<void> {
  const trozos = cookiesDeSesion(await context.cookies());
  const bruto = decodeURIComponent(trozos.map((trozo) => trozo.value).join(""));
  const json = bruto.startsWith("base64-") ? Buffer.from(bruto.slice("base64-".length), "base64url").toString("utf8") : bruto;
  const datos = JSON.parse(json) as { expires_at: number; expires_in: number };
  datos.expires_at = Math.floor(Date.now() / 1000) - 3600;
  datos.expires_in = -3600;
  const valor = "base64-" + Buffer.from(JSON.stringify(datos), "utf8").toString("base64url");

  const base = trozos[0];
  const nombre = base.name.replace(/\.\d+$/, "");
  await context.clearCookies({ name: new RegExp(`^${nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\.\\d+)?$`) });
  const partes = valor.length <= TROZO ? [valor] : (valor.match(new RegExp(`.{1,${TROZO}}`, "g")) ?? []);
  const nuevas: Cookie[] = partes.map((parte, i) => ({
    ...base,
    name: partes.length === 1 ? nombre : `${nombre}.${i}`,
    value: parte,
  }));
  await context.addCookies(nuevas);
}

test("quien vuelve con la cookie de una sesión borrada ve el inicio normal y recibe otra sesión", async ({
  page,
  context,
  cuentas,
}) => {
  const errores: string[] = [];
  page.on("pageerror", (error) => errores.push(error.message));

  await page.goto("/");
  const vieja = await esperarSesion(context);

  // La limpieza la borra de Auth (con ella se va su sesión de Auth y su token de renovación). Solo si no se pudo
  // borrar queda anotada para la limpieza de la prueba, que fallaría con un usuario que ya no existe.
  const { error } = await cuentas.cliente.auth.admin.deleteUser(vieja.id);
  if (error) cuentas.borrarAlFinal(vieja.id);
  expect(error).toBeNull();
  await vencerToken(context);

  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Descubre en qué tema fallas antes de tu monitoría" }),
  ).toBeVisible(ESPERA);
  // Ningún mensaje de error. Next.js pone en toda página un anunciador de rutas con role=alert, vacío.
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);

  // El sitio le crea una sesión anónima nueva, con un usuario que existe en Auth.
  await expect
    .poll(
      async () => {
        const id = leerSesion(await context.cookies())?.id;
        return id !== undefined && id !== vieja.id;
      },
      { message: "el navegador debía recibir una sesión nueva", ...ESPERA },
    )
    .toBe(true);
  const nueva = leerSesion(await context.cookies());
  expect(nueva).not.toBeNull();
  cuentas.borrarAlFinal(nueva!.id);
  expect(nueva!.esAnonimo).toBe(true);
  const { data, error: errorNueva } = await cuentas.cliente.auth.admin.getUserById(nueva!.id);
  expect(errorNueva).toBeNull();
  expect(data.user?.id).toBe(nueva!.id);
  expect(errores).toEqual([]);
});
