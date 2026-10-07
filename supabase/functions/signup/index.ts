// Account sign-up for the SPEctrum Sprint Board.
// Creates the user already confirmed, so people can sign in straight away: no confirmation email,
// which also keeps sign-up clear of the default SMTP's few-emails-per-hour limit.
// Public by design (verify_jwt off): it runs before the person has a session.
// The service-role key stays on the server; the browser only ever gets { ok } or an error message.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  let body: { email?: unknown; password?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
  if (password.length < 6 || password.length > 72) return json({ error: "Use 6 to 72 characters for your password." }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { source: "spectrum-board" },
  });
  if (error) {
    if (/already|registered|exists/i.test(error.message)) {
      return json({ error: "An account with this email already exists. Sign in, or use \"Forgot password?\"." }, 409);
    }
    console.error("signup failed", error.message);
    return json({ error: "Couldn't create the account. Try again in a moment." }, 400);
  }
  return json({ ok: true }, 201);
});
