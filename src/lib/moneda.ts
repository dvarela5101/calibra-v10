import { LOCALE } from "@/config/regional";

const formatoPesos = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

/** Un monto en pesos enteros, como lo ve una persona: `$ 25.000`. */
export function formatearPesos(monto: number): string {
  return formatoPesos.format(monto);
}
