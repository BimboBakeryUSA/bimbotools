// =========================================================
// Edge Function: asignar-ruta
// Para cuentas que YA EXISTEN (ej. las que ya estaban registradas en otra
// herramienta y se copiaron a este proyecto) -- les asigna role=route +
// route_code sin mandar invitación ni tocar su contraseña. Solo Admin y
// Corporativo pueden llamarla. Para gente que TODAVÍA NO tiene cuenta, sigue
// usando invitar-ibp (esa sí manda el correo de invitación).
//
// Esto es exactamente lo que está desplegado en el proyecto real
// (obfikwhukpzelsghowcq) -- se deja aquí como referencia, igual que
// invitar-ibp.ts y scripts/mi_territorio_schema.sql. Para redeployarla:
// mcp__Supabase__deploy_edge_function con este archivo como index.ts.
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
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

    const { data: callerProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", callerId)
      .single();
    if (profileError || !callerProfile) return jsonResponse({ error: "No se encontró tu perfil" }, 403);
    if (callerProfile.role !== "admin" && callerProfile.role !== "corporativo") {
      return jsonResponse({ error: "No tienes permiso para asignar rutas" }, 403);
    }

    const body = await req.json();
    const { email, route_code, nombre } = body;
    if (!email || !route_code) return jsonResponse({ error: "Faltan email o route_code" }, 400);

    const { data: ruta, error: rutaError } = await adminClient
      .from("ibps")
      .select("id, propietario")
      .eq("id", route_code)
      .maybeSingle();
    if (rutaError || !ruta) return jsonResponse({ error: `No existe la ruta ${route_code}` }, 400);

    // No hay getUserByEmail directo en la API admin -- se busca en la
    // lista (pocos usuarios en este proyecto, alcanza con una página).
    const { data: listado, error: listError } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) return jsonResponse({ error: listError.message }, 500);

    const emailNorm = String(email).trim().toLowerCase();
    const usuario = listado.users.find((u) => (u.email || "").toLowerCase() === emailNorm);
    if (!usuario) {
      return jsonResponse(
        { error: `No encontré ninguna cuenta con el correo ${email} — usa "Invitar IBP" si todavía no tiene cuenta.` },
        404
      );
    }

    const { error: insertError } = await adminClient.from("profiles").upsert({
      id: usuario.id,
      nombre: nombre || ruta.propietario || null,
      role: "route",
      route_code,
      estado: "activo",
      email: usuario.email,
      creado_por: callerId,
    });
    if (insertError) return jsonResponse({ error: insertError.message }, 400);

    return jsonResponse({ ok: true, user_id: usuario.id, email: usuario.email }, 200);
  } catch (e) {
    return jsonResponse({ error: (e as Error).message || "Error inesperado" }, 500);
  }
});
