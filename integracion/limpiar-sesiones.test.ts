import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DIAS_SESION_ANONIMA } from "@/lib/privacidad/consentimiento";
import { exigirSupabaseLocal, Fixtures } from "./utilidades";

// Pruebas de integración de HU-056 contra el Supabase LOCAL: la limpieza de sesiones anónimas por la puerta real.
// Cada prueba crea su propia sesión anónima con la API de Auth y la envejece por SQL: nunca se envejecen sesiones que
// no creó la prueba, para que el trabajo real de las 03:23 no alcance datos de otras pruebas. No se corre la limpieza
// entera (borraría cualquier otra sesión vencida de la base local): se llama a borrar_sesion_vencida con el id.

const URL_BD = process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

let fx: Fixtures;
let bd: pg.Client;

beforeAll(async () => {
  await exigirSupabaseLocal();
  if (!/@(127\.0\.0\.1|localhost):/.test(URL_BD)) throw new Error(`SUPABASE_DB_URL no es local (${URL_BD}).`);
  bd = new pg.Client({ connectionString: URL_BD });
  await bd.connect();
});

afterAll(async () => {
  await bd?.end();
});

beforeEach(() => {
  fx = new Fixtures();
});

afterEach(async () => {
  await fx.limpiar();
});

/** Lleva toda la actividad de la sesión a hace 100 días: su alta, su inicio y la renovación de su sesión de Auth. */
async function envejecer(id: string): Promise<void> {
  await bd.query(
    `update auth.users set created_at = now() - interval '100 days', last_sign_in_at = now() - interval '100 days'
     where id = $1`,
    [id],
  );
  await bd.query(
    `update auth.sessions
     set created_at = now() - interval '100 days', updated_at = now() - interval '100 days',
         refreshed_at = (now() - interval '100 days') at time zone 'utc'
     where user_id = $1`,
    [id],
  );
}

async function borrar(cliente: pg.Client, id: string): Promise<boolean> {
  const { rows } = await cliente.query<{ borrada: boolean }>(
    "select privado.borrar_sesion_vencida($1, now()) as borrada",
    [id],
  );
  return rows[0].borrada;
}

async function existe(id: string): Promise<boolean> {
  const { rowCount } = await bd.query("select 1 from auth.users where id = $1", [id]);
  return rowCount === 1;
}

describe("HU-056: borrar una sesión anónima vencida", () => {
  it("borra una sesión real de Auth envejecida, su renovación deja de funcionar y se puede crear otra", async () => {
    const { cliente, id } = await fx.crearAnonimo();
    const { materia, evaluacion } = await fx.crearEvaluacion();
    const diagnostico = await fx.crearDiagnostico({ idSesionAnonima: id, idEvaluacion: evaluacion.id, idMateria: materia.id });
    await bd.query("update public.diagnostico set fecha_realizacion = now() - interval '100 days' where id = $1", [
      diagnostico.id,
    ]);

    // Recién creada no vence.
    expect(await borrar(bd, id)).toBe(false);
    expect(await existe(id)).toBe(true);

    await envejecer(id);
    const { rows: vencidas } = await bd.query("select id from privado.sesiones_anonimas_vencidas(now()) where id = $1", [id]);
    expect(vencidas).toHaveLength(1);

    expect(await borrar(bd, id)).toBe(true);
    expect(await existe(id)).toBe(false);
    const { rowCount: diagnosticos } = await bd.query("select 1 from public.diagnostico where id = $1", [diagnostico.id]);
    expect(diagnosticos).toBe(0);

    // Su sesión de Auth se fue con ella: renovarla falla.
    const renovada = await cliente.auth.refreshSession();
    expect(renovada.error).not.toBeNull();

    // Quien vuelve recibe una sesión anónima nueva, con otro usuario.
    const nueva = await fx.crearAnonimo();
    expect(nueva.id).not.toBe(id);
    expect(await existe(nueva.id)).toBe(true);
  });

  it("una visita reciente (la renovación de la sesión de Auth) la salva", async () => {
    const { cliente, id } = await fx.crearAnonimo();
    await envejecer(id);
    // Una visita: el proxy renueva la sesión.
    const renovada = await cliente.auth.refreshSession();
    expect(renovada.error).toBeNull();
    expect(await borrar(bd, id)).toBe(false);
    expect(await existe(id)).toBe(true);
  });

  it("salta la sesión cuyo candado está tomado (alguien está dejando su contacto) y la borra cuando se suelta", async () => {
    const { id } = await fx.crearAnonimo();
    await envejecer(id);

    const otra = new pg.Client({ connectionString: URL_BD });
    await otra.connect();
    try {
      await otra.query("begin");
      // El mismo candado por sesión que toman registrar_lead y confirmar_correo_de_lead.
      await otra.query("select pg_advisory_xact_lock(6801, hashtext($1::text))", [id]);

      expect(await borrar(bd, id)).toBe(false);
      expect(await existe(id)).toBe(true);

      await otra.query("rollback");
      expect(await borrar(bd, id)).toBe(true);
      expect(await existe(id)).toBe(false);
    } finally {
      await otra.query("rollback").catch(() => undefined);
      await otra.end();
    }
  });

  it("no borra la sesión de un Lead aunque esté vencida", async () => {
    const { id } = await fx.crearAnonimo();
    await fx.crearLeadDeSesion(id);
    await envejecer(id);
    expect(await borrar(bd, id)).toBe(false);
    expect(await existe(id)).toBe(true);
  });
});

describe("HU-056: el plazo vive en un solo lugar", () => {
  it("el aviso de privacidad usa el mismo número que public.parametros_retencion()", async () => {
    const { rows } = await bd.query<{ dias: number }>(
      "select sesion_anonima_dias as dias from public.parametros_retencion()",
    );
    expect(rows[0].dias).toBe(DIAS_SESION_ANONIMA);

    // El aviso pinta la constante y no escribe el número a mano.
    const aviso = readFileSync("src/app/privacidad/page.tsx", "utf8");
    expect(aviso).toContain("Sesiones sin contacto: se borran, con sus diagnósticos, a los {DIAS_SESION_ANONIMA} días sin actividad.");
    expect(aviso).not.toMatch(/Sesiones sin contacto: se borran[^.]*\b\d+ días/);
  });
});
