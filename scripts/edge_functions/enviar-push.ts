// =========================================================
// Edge Function: enviar-push
// La llama automáticamente un trigger de Postgres
// (mensajes_notificar_push, vía pg_net) cada vez que se inserta un
// mensaje admin->IBP -- le manda una notificación push real (Web Push)
// a todos los dispositivos suscritos de esa ruta. Probado en
// Android/Chrome (los IBP usan handhelds Honeywell); en iPhone Safari
// solo funciona si la página se agregó a la pantalla de inicio.
//
// Esto es exactamente lo que está desplegado en el proyecto real
// (obfikwhukpzelsghowcq) -- se deja aquí como referencia, igual que
// invitar-ibp.ts y scripts/mi_territorio_schema.sql. Para redeployarla:
// mcp__Supabase__deploy_edge_function con este archivo como index.ts.
//
// Llaves y nombre: nada va en el código.
//   - VAPID_PRIVATE_KEY y VAPID_SUBJECT ("mailto:correo-de-soporte"):
//     secretos de la Edge Function (Supabase → Edge Functions → Secrets).
//   - Llave pública VAPID y nombre de la app: tabla app_config
//     (claves "vapid_public" y "nombre_app"), la misma que lee el navegador.
// Si se cambia el par de llaves, cada teléfono vuelve a pedir activar los
// avisos solo; las suscripciones viejas se borran al fallar aquí.
// =========================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT");

// app_config: { clave: valor } (vapid_public, nombre_app).
async function leerConfig(adminClient: ReturnType<typeof createClient>) {
  const { data, error } = await adminClient.from("app_config").select("clave, valor");
  if (error) throw new Error(`app_config: ${error.message}`);
  const cfg: Record<string, string> = {};
  (data || []).forEach((f: { clave: string; valor: string }) => (cfg[f.clave] = f.valor));
  return cfg;
}

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const { ruta_id, texto } = body;
    if (!ruta_id) return jsonResponse({ error: "falta ruta_id" }, 400);

    if (!VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
      return jsonResponse({ error: "faltan los secretos VAPID_PRIVATE_KEY / VAPID_SUBJECT" }, 500);
    }
    const adminClient = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const cfg = await leerConfig(adminClient);
    if (!cfg.vapid_public) return jsonResponse({ error: "falta app_config.vapid_public" }, 500);
    webpush.setVapidDetails(VAPID_SUBJECT, cfg.vapid_public.trim(), VAPID_PRIVATE_KEY);
    const { data: subs, error } = await adminClient
      .from("push_subscripciones")
      .select("id, endpoint, p256dh, auth")
      .eq("ruta_id", ruta_id);

    if (error) return jsonResponse({ error: error.message }, 500);
    if (!subs || !subs.length) return jsonResponse({ ok: true, enviados: 0 });

    const payload = JSON.stringify({
      title: cfg.nombre_app ? `${cfg.nombre_app.trim()} — nuevo mensaje` : "Nuevo mensaje",
      body: String(texto || "").slice(0, 180),
      // Relativa a sw.js: abre mi-territorio.html de donde esté publicada la app.
      url: "mi-territorio.html",
    });

    const resultados = await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload
          );
          return { id: s.id, ok: true };
        } catch (e) {
          const statusCode = (e as { statusCode?: number }).statusCode;
          // 404/410 = el navegador ya no reconoce esa suscripción (desinstaló,
          // borró datos, etc.) -- se limpia sola para no reintentar siempre.
          // 403 = la suscripción se hizo con otro par de llaves (se cambiaron).
          if (statusCode === 404 || statusCode === 410 || statusCode === 403) {
            await adminClient.from("push_subscripciones").delete().eq("id", s.id);
          }
          return { id: s.id, ok: false, error: String(e) };
        }
      })
    );

    return jsonResponse({ ok: true, enviados: resultados.length, resultados });
  } catch (e) {
    return jsonResponse({ error: (e as Error).message || "error inesperado" }, 500);
  }
});
