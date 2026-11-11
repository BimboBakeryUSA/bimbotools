// =========================================================
// Edge Function: sincronizar-cuenta (se publica en el proyecto de INVENTARIO)
// Recibe la copia de una cuenta desde el proyecto de catálogo (trigger en
// scripts/sync_cuentas/2_catalogo.sql) y la deja igual aquí: misma
// contraseña y, si es nueva, su perfil con rol. La lógica de la base de
// datos está en scripts/sync_cuentas/1_inventario.sql (sync_aplicar_cuenta).
//
// Secreto de la función (Supabase → Edge Functions → Secrets):
//   SYNC_SECRET  el mismo valor que sync.config 'secreto' en catálogo.
// Sin ese secreto en el encabezado x-sync-secret, no hace nada.
// =========================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SYNC_SECRET = Deno.env.get("SYNC_SECRET");

const ROLES = ["admin", "msl", "zsl", "ibp"];

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

function iguales(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  if (!SYNC_SECRET) return json({ error: "falta el secreto SYNC_SECRET" }, 500);
  if (!iguales(req.headers.get("x-sync-secret") || "", SYNC_SECRET)) return json({ error: "no autorizado" }, 401);

  try {
    const b = await req.json();
    const email = String(b.email || "").trim().toLowerCase();
    const rol = String(b.rol || "");
    if (!email || !ROLES.includes(rol)) return json({ ok: false, motivo: "no se copia" });

    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const args = {
      p_email: email,
      p_hash: b.password_hash ? String(b.password_hash) : null,
      p_confirmada: !!b.confirmada,
      p_nombre: b.nombre ? String(b.nombre) : null,
      p_rol: rol,
      p_nuevo: false,
    };

    let { data, error } = await admin.rpc("sync_aplicar_cuenta", args);
    if (error) return json({ error: error.message }, 500);

    if (data && data.falta_crear) {
      // No existe aquí: se crea (con una contraseña al azar que en seguida se
      // reemplaza por la de catálogo) y se aplica todo.
      const { error: errCrear } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        password: crypto.randomUUID() + "Aa1!",
      });
      if (errCrear && !/already|registered|exists/i.test(errCrear.message)) {
        return json({ error: errCrear.message }, 500);
      }
      ({ data, error } = await admin.rpc("sync_aplicar_cuenta", { ...args, p_nuevo: true }));
      if (error) return json({ error: error.message }, 500);
    }
    return json(data);
  } catch (e) {
    return json({ error: (e as Error).message || "error inesperado" }, 500);
  }
});
