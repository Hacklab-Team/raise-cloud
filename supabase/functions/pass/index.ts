// Customer app endpoint (requires a signed-in customer).
//
//   POST { action: "get" }               -> { token, customer }   the customer's pass QR
//   POST { action: "claim", token }      -> { customer }          adopt a pass made at a kiosk
//
// "claim" proves ownership by the pass QR itself: whoever holds a kiosk-made pass can attach
// it to their app account (only if nobody has claimed it yet).
import { admin, cors, HttpError, issuePassToken, json, verifyPassToken } from "../_shared/common.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

async function currentUser(req: Request) {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) throw new HttpError(401, "Sign in first");
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        auth: { persistSession: false },
    });
    const { data, error } = await client.auth.getUser(jwt);
    if (error || !data.user) throw new HttpError(401, "Session expired, sign in again");
    return data.user;
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    try {
        const user = await currentUser(req);
        const body = await req.json().catch(() => ({}));
        const db = admin();

        if (body.action === "get") {
            const { data: c, error } = await db.from("customers")
                .select("id, name, phone, pass_id, points, blocked").eq("user_id", user.id).maybeSingle();
            if (error) throw error;
            if (!c) throw new HttpError(404, "No customer profile for this account");
            return json({ token: await issuePassToken(c.pass_id), customer: c });
        }

        if (body.action === "claim") {
            const passId = await verifyPassToken(body.token);
            if (!passId) throw new HttpError(400, "That isn't a valid RAISE Pass");
            const { data: target } = await db.from("customers").select("id, user_id").eq("pass_id", passId).maybeSingle();
            if (!target) throw new HttpError(404, "Pass not found");
            if (target.user_id === user.id) return json({ customer: target, already: true });
            if (target.user_id) throw new HttpError(409, "This pass already belongs to another account");

            // The account's own auto-created record is replaced, unless it already has history.
            const { data: mine } = await db.from("customers").select("id").eq("user_id", user.id).maybeSingle();
            if (mine) {
                const { count } = await db.from("orders").select("id", { count: "exact", head: true }).eq("customer_id", mine.id);
                if ((count ?? 0) > 0) throw new HttpError(409, "This account already has orders, so it can't take over another pass");
                await db.from("customers").delete().eq("id", mine.id);
            }
            const { data: claimed, error } = await db.from("customers").update({ user_id: user.id })
                .eq("id", target.id).is("user_id", null).select("id, name, phone, pass_id, points").single();
            if (error) throw error;
            return json({ customer: claimed });
        }

        throw new HttpError(400, "Unknown action");
    } catch (e) {
        const status = e instanceof HttpError ? e.status : 500;
        if (status === 500) console.error(e);
        return json({ error: e instanceof Error ? e.message : String(e) }, status);
    }
});
