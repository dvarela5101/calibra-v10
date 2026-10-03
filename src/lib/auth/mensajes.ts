/** Mensajes en español para los códigos de error de Supabase Auth que la persona puede ver. */
const MENSAJES: Record<string, string> = {
  invalid_credentials: "Correo o contraseña incorrectos.",
  user_banned: "Tu cuenta está desactivada. Si crees que es un error, escribe al equipo de Calibra.",
  email_not_confirmed: "Confirma tu correo antes de entrar.",
  over_request_rate_limit: "Demasiados intentos seguidos. Espera unos minutos y vuelve a intentarlo.",
  over_email_send_rate_limit: "Ya te enviamos un enlace hace un momento. Revisa tu correo o espera un minuto.",
  weak_password: "La contraseña debe tener al menos 8 caracteres.",
  same_password: "Usa una contraseña distinta de la anterior.",
  otp_expired: "El enlace ya se usó o venció. Pide uno nuevo.",
  // HU-058: Auth rechazó el token de Turnstile (falta, venció o ya se usó).
  captcha_failed: "No pudimos verificar que eres una persona. Recarga la página e intenta de nuevo.",
};

export function mensajeDeError(codigo: string | undefined, porDefecto = "Algo falló. Intenta de nuevo."): string {
  return (codigo && MENSAJES[codigo]) || porDefecto;
}
