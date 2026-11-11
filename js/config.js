// ============================================================================
// Configuración común: conexión a Supabase (pública: la llave publicable
// viaja al navegador por diseño; los permisos los pone RLS en Postgres).
// El nombre de la app y demás textos de la empresa NO van en el código:
// vienen de la tabla app_config de Supabase (ver js/marca.js y
// scripts/app_config.sql).
// ============================================================================

window.APP_CONFIG = {
  supabaseUrl: "https://obfikwhukpzelsghowcq.supabase.co",
  supabaseKey: "sb_publishable_-qW3XyldNJgpOk6BLReC3A_HIyZHrHM",
};
