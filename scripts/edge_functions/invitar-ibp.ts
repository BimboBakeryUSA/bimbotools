// =========================================================
// Edge Function: invitar-ibp
// Invita por correo a un IBP (usuario "route") a crear su cuenta
// permanente en Mi Territorio -- solo Admin y Corporativo pueden
// llamarla. Deja su profile listo (role=route, route_code,
// estado=activo) para que en cuanto acepte la invitación y ponga
// su propia contraseña, ya tenga acceso completo a su ruta.
//
// Esto es exactamente lo que está desplegado en el proyecto real
// (obfikwhukpzelsghowcq) -- se deja aquí como referencia, igual que
// scripts/mi_territorio_schema.sql con las tablas/funciones SQL.
// Para redeployarla: mcp__Supabase__deploy_edge_function con este
// archivo como index.ts, o pegarlo en el Dashboard de Supabase ->
// Edge Functions -> invitar-ibp -> editar.
//
// Mismo patrón que la función create-user ya desplegada en este
// proyecto: la llave de servicio (SUPABASE_SERVICE_ROLE_KEY) solo
// vive aquí, nunca en el navegador. SUPABASE_URL y esa llave ya
// están disponibles automáticamente dentro de cualquier Edge
// Function del mismo proyecto -- no hace falta configurar nada.
// =========================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "No autorizado (sin sesión)" }, 401);
    }

    // Cliente con permisos totales (vive solo aquí, en el servidor).
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const jwt = authHeader.replace("Bearer ", "");
    const { data: callerData, error: callerError } = await adminClient.auth.getUser(jwt);

    if (callerError || !callerData?.user) {
      return jsonResponse({ error: "Sesión inválida" }, 401);
    }

    const callerId = callerData.user.id;

    const { data: callerProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", callerId)
      .single();

    if (profileError || !callerProfile) {
      return jsonResponse({ error: "No se encontró tu perfil" }, 403);
    }

    const callerRole = callerProfile.role;
    if (callerRole !== "admin" && callerRole !== "corporativo") {
      return jsonResponse({ error: "No tienes permiso para invitar usuarios" }, 403);
    }

    const body = await req.json();
    const { email, route_code, nombre } = body;

    if (!email || !route_code) {
      return jsonResponse({ error: "Faltan email o route_code" }, 400);
    }

    const { data: ruta, error: rutaError } = await adminClient
      .from("ibps")
      .select("id, propietario")
      .eq("id", route_code)
      .maybeSingle();

    if (rutaError || !ruta) {
      return jsonResponse({ error: `No existe la ruta ${route_code}` }, 400);
    }

    // Manda la invitación real de Supabase -- el correo trae el enlace
    // para que el IBP elija su propia contraseña.
    const { data: invitado, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email);

    if (inviteError || !invitado?.user) {
      return jsonResponse({ error: inviteError?.message || "No se pudo invitar" }, 400);
    }

    // Deja su perfil ya armado -- en cuanto acepte, entra directo a su ruta.
    const { error: insertError } = await adminClient.from("profiles").upsert({
      id: invitado.user.id,
      nombre: nombre || ruta.propietario || null,
      role: "route",
      route_code,
      estado: "activo",
      email,
      creado_por: callerId,
    });

    if (insertError) {
      return jsonResponse({ error: insertError.message }, 400);
    }

    return jsonResponse({ ok: true, user_id: invitado.user.id }, 200);
  } catch (e) {
    return jsonResponse({ error: e.message || "Error inesperado" }, 500);
  }
});
