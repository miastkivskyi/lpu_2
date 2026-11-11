import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return new Response("Missing user session", { status: 401, headers: cors });
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminSurname = (Deno.env.get("ADMIN_SURNAME") || "").trim();
    const adminPassword = Deno.env.get("ADMIN_PASSWORD") || "";
    const { surname, password } = await req.json();
    if (!adminSurname || !adminPassword) throw new Error("Admin credentials are not configured");
    if (String(surname || "").trim().toLocaleLowerCase("uk") !== adminSurname.toLocaleLowerCase("uk") || String(password || "") !== adminPassword) {
      return new Response("Неправильне прізвище або пароль адміністратора", { status: 401, headers: cors });
    }
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return new Response("Invalid user session", { status: 401, headers: cors });
    const adminClient = createClient(url, serviceKey);
    const { error } = await adminClient.from("lpu_user_profiles").upsert({
      user_id: userData.user.id,
      surname: adminSurname,
      is_admin: true,
    }, { onConflict: "user_id" });
    if (error) throw error;
    return new Response(JSON.stringify({ profile: { surname: adminSurname, is_admin: true } }), {
      status: 200, headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || "Internal error" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
