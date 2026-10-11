import type { NextRequest } from "next/server";
import { exigirRol } from "@/lib/auth/sesion";
import { leerParaContactar, listarMaterias } from "@/lib/leads/admin";
import { csvDeLeads, nombreDelArchivoCsv } from "@/lib/leads/csv";
import { leerFiltrosDeLeads } from "@/lib/leads/filtros";
import { resumenDeError } from "@/lib/leads/reglas";
import { crearClienteServidor } from "@/lib/supabase/servidor";

/**
 * HU-053 (D-61 b y c): «Descargar para contactar». Un CSV con los leads que cumplen los filtros de estado, origen y
 * materia de la pantalla, en su mismo orden. Quién entra lo decide la vista `lead_para_contactar` (aceptaron contacto
 * y no están descartados), no esta ruta: el filtro «Acepta contacto» de la dirección se ignora. Con la sesión del
 * admin; sin ella, `exigirRol` lleva a ingresar y vuelve a la lista. Sin leads, el archivo trae solo los encabezados.
 */
export async function GET(request: NextRequest) {
  await exigirRol("admin", "/admin/leads");
  const supabase = await crearClienteServidor();
  if (!supabase) return new Response("No pudimos preparar el archivo.", { status: 503 });

  try {
    const materias = await listarMaterias(supabase);
    const parametros = Object.fromEntries(request.nextUrl.searchParams);
    const filtros = leerFiltrosDeLeads(parametros, materias.map((m) => m.codigo));
    const idMateria = materias.find((m) => m.codigo === filtros.materia)?.id ?? null;
    const leads = await leerParaContactar(supabase, {
      filtros: { estado: filtros.estado, origen: filtros.origen, idMateria },
      materias,
    });
    const csv = csvDeLeads(
      leads.map((lead) => ({
        nombre: lead.nombre,
        correo: lead.correo,
        telefono: lead.numeroTelefono,
        estado: lead.estado,
        origen: lead.origen,
        materias: lead.materias,
        fechaCreacion: lead.fechaCreacion,
      })),
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${nombreDelArchivoCsv(new Date())}"`,
        // Trae datos personales: que ningún caché lo guarde.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    // Solo el código y el mensaje: nunca nombres, correos ni teléfonos.
    console.error("[admin] no se pudo armar la descarga de leads:", resumenDeError(error));
    return new Response("No pudimos preparar el archivo. Recarga la página; si sigue igual, avisa al equipo.", {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
