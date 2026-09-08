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
// Llave privada VAPID: no hay forma de configurar secretos de Supabase
// desde las herramientas usadas para armar esto, así que queda embebida
// abajo (nunca llega al navegador -- solo vive en el código de esta
// función, del lado del servidor). Si más adelante se quiere mover a un
// secreto real: reemplazar las dos constantes VAPID_* por
// Deno.env.get("VAPID_PUBLIC_KEY")/("VAPID_PRIVATE_KEY") y correr
// `supabase secrets set` -- pero si se regenera la llave pública, hay
// que actualizarla también en js/depuracion.js (VAPID_PUBLIC_KEY), o
// las suscripciones viejas del navegador dejan de servir.
// =========================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const VAPID_PUBLIC_KEY = "BLFPiseSMlKivquERfG16C4lrY3k-CAedeuECWfscLcJ1VV4XlgcIfAtk0zqeedelXzuS66NfLnrfCruwRHwGhc";
const VAPID_PRIVATE_KEY = "k8b1uEJbvPkWpskt9Y8AZPnbVyPnOC8sLyZSmFro12Q";

webpush.setVapidDetails("mailto:soporte@bimbobakeryusa.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

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

    const adminClient = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const { data: subs, error } = await adminClient
      .from("push_subscripciones")
      .select("id, endpoint, p256dh, auth")
      .eq("ruta_id", ruta_id);

    if (error) return jsonResponse({ error: error.message }, 500);
    if (!subs || !subs.length) return jsonResponse({ ok: true, enviados: 0 });

    const payload = JSON.stringify({
      title: "Bimbo Tools — nuevo mensaje",
      body: String(texto || "").slice(0, 180),
      url: "/bimbotools/mi-territorio.html",
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
          if (statusCode === 404 || statusCode === 410) {
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
