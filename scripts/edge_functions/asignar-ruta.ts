// =========================================================
// Edge Function: asignar-ruta
// Para cuentas que YA EXISTEN -- les asigna role=route + route_code sin
// mandar invitación ni tocar su contraseña. Solo Admin y Corporativo.
// Para gente sin cuenta todavía, sigue usando invitar-ibp.
//
// Busca la cuenta con la función SQL _buscar_usuario_por_email en vez de
// adminClient.auth.admin.listUsers() -- esa API fallaba en este proyecto
// ("AuthRetryableFetchError: Database error finding users", probablemente
// por los usuarios insertados directo por SQL al copiarlos de otro
// proyecto Supabase).
// =========================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "No autorizado (sin sesión)" }, 401);

    const adminClient = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const jwt = authHeader.replace("Bearer ", "");
    const { data: callerData, error: callerError } = await adminClient.auth.getUser(jwt);
    if (callerError || !callerData?.user) return jsonResponse({ error: "Sesión inválida" }, 401);
    const callerId = callerData.user.id;

    const { data: callerProfile, error: profileError } = await adminClient.from("profiles").select("role").eq("id", callerId).single();
    if (profileError || !callerProfile) return jsonResponse({ error: "No se encontró tu perfil" }, 403);
    if (callerProfile.role !== "admin" && callerProfile.role !== "corporativo") {
      return jsonResponse({ error: "No tienes permiso para asignar rutas" }, 403);
    }

    const body = await req.json();
    const { email, route_code, nombre } = body;
    if (!email || !route_code) return jsonResponse({ error: "Faltan email o route_code" }, 400);

    const { data: ruta, error: rutaError } = await adminClient.from("ibps").select("id, propietario").eq("id", route_code).maybeSingle();
    if (rutaError || !ruta) return jsonResponse({ error: `No existe la ruta ${route_code}` }, 400);

    const { data: userId, error: buscarError } = await adminClient.rpc("_buscar_usuario_por_email", { p_email: email });
    if (buscarError) {
      console.error("asignar-ruta: _buscar_usuario_por_email falló", buscarError);
      return jsonResponse({ error: `No pude buscar la cuenta: ${buscarError.message}` }, 500);
    }
    if (!userId) {
      return jsonResponse({ error: `No encontré ninguna cuenta con el correo ${email} — usa "Invitar IBP" si todavía no tiene cuenta.` }, 404);
    }

    const { error: insertError } = await adminClient.from("profiles").upsert({
      id: userId,
      nombre: nombre || ruta.propietario || null,
      role: "route",
      route_code,
      estado: "activo",
      email,
      creado_por: callerId,
    });
    if (insertError) {
      console.error("asignar-ruta: upsert de perfil falló", insertError);
      return jsonResponse({ error: insertError.message }, 400);
    }

    return jsonResponse({ ok: true, user_id: userId, email }, 200);
  } catch (e) {
    console.error("asignar-ruta: error inesperado", e);
    return jsonResponse({ error: (e as Error).message || String(e) || "Error inesperado" }, 500);
  }
});
