// =====================================================================
//  CONFIGURACIÓN — completá estos dos datos con los de tu proyecto Supabase
//  (Supabase → Project Settings → API)
//  La "anon key" es pública por diseño: la seguridad la dan las reglas
//  de la base de datos (supabase/esquema.sql). NUNCA pongas acá la
//  "service_role key".
// =====================================================================
export const CONFIG = {
  SUPABASE_URL: 'https://TU-PROYECTO.supabase.co',
  SUPABASE_ANON_KEY: 'PEGAR_ACA_LA_ANON_KEY',

  // Cada legajo se convierte internamente en un usuario de Supabase con
  // este dominio (ej.: 12345@usuarios.firma-policia-salta.app). No se
  // envían correos: hay que desactivar "Confirm email" en Supabase.
  DOMINIO_USUARIOS: 'usuarios.firma-policia-salta.app',

  INSTITUCION: 'Policía de la Provincia de Salta',

  // Cierre automático de sesión por inactividad (minutos)
  MINUTOS_INACTIVIDAD: 20,
};
