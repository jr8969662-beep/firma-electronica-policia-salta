// =====================================================================
//  CONFIGURACIÓN — completá estos dos datos con los de tu proyecto Supabase
//  (Supabase → Project Settings → API)
//  La "anon key" es pública por diseño: la seguridad la dan las reglas
//  de la base de datos (supabase/esquema.sql). NUNCA pongas acá la
//  "service_role key".
// =====================================================================
export const CONFIG = {
  SUPABASE_URL: 'https://awlrmkbdidoikeqtpesl.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3bHJta2JkaWRvaWtlcXRwZXNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyMDU5MjQsImV4cCI6MjEwODc4MTkyNH0.OQ_DCQtLjyRjn81x1VY1F9O2qKHQ-pzuu4DRh5j_O-w',

  // Cada legajo se convierte internamente en un usuario de Supabase con
  // este dominio (ej.: 12345@usuarios.firma-policia-salta.app). No se
  // envían correos: hay que desactivar "Confirm email" en Supabase.
  DOMINIO_USUARIOS: 'usuarios.firma-policia-salta.app',

  INSTITUCION: 'Policía de la Provincia de Salta',

  // Cierre automático de sesión por inactividad (minutos)
  MINUTOS_INACTIVIDAD: 20,
};
