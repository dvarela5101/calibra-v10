import { ZONA_HORARIA_NEGOCIO } from "@/config/regional";
import { diaDelNegocio } from "@/lib/fechas";
import { ETIQUETA_DE_ESTADO, type EstadoLead } from "@/lib/leads/estados";

/** Separador de campos del CSV de Leads (HU-053, D-61 b): Excel en Colombia separa las listas con punto y coma. */
export const SEPARADOR_CSV = ";";

/** Un Lead tal como entra al CSV de «Descargar para contactar» (HU-053, D-61 b). */
export type LeadParaCsv = {
  nombre: string;
  correo: string | null;
  telefono: string | null;
  estado: EstadoLead;
  origen: string | null;
  materias: readonly string[];
  fechaCreacion: Date;
};

/** Encabezados del CSV, en el orden de las columnas (HU-053, D-61 b). */
export const ENCABEZADOS_CSV = ["Nombre", "Correo", "Teléfono", "Estado", "Origen", "Materias", "Dejó su contacto"] as const;

const SALTO = "\r\n";
const MARCA_BOM = "﻿";
const PREFIJO_DE_FORMULA = /^[=+\-@\t\r]/;
const TELEFONO_INTERNACIONAL = /^\+[0-9]{8,15}$/;

const formatoFechaHora = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_HORARIA_NEGOCIO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function fechaHoraDelNegocio(instante: Date): string {
  const p = Object.fromEntries(formatoFechaHora.formatToParts(instante).map((parte) => [parte.type, parte.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** Neutraliza fórmulas (comilla simple delante) y escapa el campo para el CSV (HU-053, D-61 b). */
function celda(valor: string | null, eximirTelefono = false): string {
  let texto = valor ?? "";
  const eximido = eximirTelefono && TELEFONO_INTERNACIONAL.test(texto);
  if (!eximido && PREFIJO_DE_FORMULA.test(texto)) texto = `'${texto}`;
  if (texto.includes(SEPARADOR_CSV) || /["\r\n]/.test(texto)) texto = `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

/**
 * Arma el CSV de Leads para contactar (HU-053, D-61 b): UTF-8 con marca de orden de bytes, filas con CRLF,
 * campos separados con `;`, fórmulas neutralizadas y fecha en la hora de Bogotá. Sin leads trae solo los encabezados.
 */
export function csvDeLeads(leads: readonly LeadParaCsv[]): string {
  const filas = leads.map((lead) =>
    [
      celda(lead.nombre),
      celda(lead.correo),
      celda(lead.telefono, true),
      celda(ETIQUETA_DE_ESTADO[lead.estado]),
      celda(lead.origen),
      celda(lead.materias.join(" / ")),
      celda(fechaHoraDelNegocio(lead.fechaCreacion)),
    ].join(SEPARADOR_CSV),
  );
  const encabezados = ENCABEZADOS_CSV.map((e) => celda(e)).join(SEPARADOR_CSV);
  return MARCA_BOM + [encabezados, ...filas].map((fila) => fila + SALTO).join("");
}

/** Nombre del archivo descargado, con el día de Bogotá y no el del servidor (HU-053, D-61 b). */
export function nombreDelArchivoCsv(ahora: Date): string {
  return `leads-para-contactar-${diaDelNegocio(ahora)}.csv`;
}
