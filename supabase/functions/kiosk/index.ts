// Kiosk endpoint. Every request carries the kiosk's device key in `x-kiosk-key`; the key is
// created in the admin panel (shown once) and only its SHA-256 is stored.
//
//   heartbeat  { info }                          keep "online" status + camera/app info
//   identify   { pass } | { card }               -> { customer }   pass QR token or card uid hash
//   register   { name, phone? }                  -> { customer, token }   new customer at the kiosk
//   link_card  { pass, card }                    link an NFC card (uid hash) to a pass
//   checkout   { items: [{barcode, qty, price?, title?}], pass? | customer_id? }  -> { order }
//              (customer_id: for a customer this kiosk identified by NFC card; kiosks are trusted devices)
//   paid       { order_id }                      -> { order, points }  (demo: no gateway yet)
//   cancel     { order_id }
//
// Prices always come from the database. Only barcodes that aren't in the catalog may carry
// a kiosk-supplied (estimated) price, and those are flagged on the order.
import {
    admin, cors, HttpError, isUidHash, issuePassToken, json, POINTS_PER_RUPEE, sha256Hex, verifyPassToken,
} from "../_shared/common.ts";

const db = admin();
const MAX_ESTIMATE = 5000;

async function kioskFor(req: Request) {
    const key = req.headers.get("x-kiosk-key") ?? "";
    if (key.length < 20) throw new HttpError(401, "Kiosk key missing. Set this kiosk up from the admin panel.");
    const { data } = await db.from("kiosks").select("id, name, active").eq("key_hash", await sha256Hex(key)).maybeSingle();
    if (!data) throw new HttpError(401, "Unknown kiosk key");
    if (!data.active) throw new HttpError(403, "This kiosk has been disabled in the admin panel");
    return data;
}

const CUSTOMER_FIELDS = "id, name, pass_id, points, blocked";

async function customerByPass(token: unknown) {
    const passId = await verifyPassToken(token);
    if (!passId) throw new HttpError(400, "That pass isn't valid. It may be forged or damaged.");
    const { data } = await db.from("customers").select(CUSTOMER_FIELDS).eq("pass_id", passId).maybeSingle();
    if (!data) throw new HttpError(404, "This pass was re-issued or removed. Open the RAISE app for your current pass.");
    if (data.blocked) throw new HttpError(403, "This account is blocked. Please ask a staff member.");
    return data;
}

async function withCard(c: { id: string }) {
    const { count } = await db.from("nfc_cards").select("uid_hash", { count: "exact", head: true }).eq("customer_id", c.id);
    return { ...c, has_card: (count ?? 0) > 0 };
}

const actions: Record<string, (body: any, kiosk: { id: string; name: string }) => Promise<unknown>> = {
    async heartbeat(body, kiosk) {
        const info = typeof body.info === "object" && body.info ? body.info : {};
        await db.from("kiosks").update({ last_seen: new Date().toISOString(), info }).eq("id", kiosk.id);
        return { ok: true, name: kiosk.name };
    },

    async identify(body) {
        if (body.pass) return { customer: await withCard(await customerByPass(body.pass)) };
        if (isUidHash(body.card)) {
            const { data: card } = await db.from("nfc_cards").select("customer_id").eq("uid_hash", body.card).maybeSingle();
            if (!card) throw new HttpError(404, "This card isn't linked yet. Log in with your pass QR and link it, or link it in the RAISE app.");
            const { data } = await db.from("customers").select(CUSTOMER_FIELDS).eq("id", card.customer_id).single();
            if (data.blocked) throw new HttpError(403, "This account is blocked. Please ask a staff member.");
            return { customer: { ...data, has_card: true } };
        }
        throw new HttpError(400, "Send a pass or a card");
    },

    async register(body) {
        const name = String(body.name ?? "").trim().slice(0, 60);
        const phone = String(body.phone ?? "").replace(/\D/g, "");
        if (!name) throw new HttpError(400, "Name is required");
        if (phone && phone.length !== 10) throw new HttpError(400, "Mobile number must be 10 digits");
        const { data, error } = await db.from("customers")
            .insert({ name, phone: phone || null, created_via: "kiosk" }).select(CUSTOMER_FIELDS).single();
        if (error) throw error;
        return { customer: { ...data, has_card: false }, token: await issuePassToken(data.pass_id) };
    },

    async link_card(body) {
        if (!isUidHash(body.card)) throw new HttpError(400, "No card read");
        const c = await customerByPass(body.pass);
        const { data: existing } = await db.from("nfc_cards").select("customer_id").eq("uid_hash", body.card).maybeSingle();
        await db.from("nfc_cards").delete().eq("customer_id", c.id);              // one card per customer
        const { error } = await db.from("nfc_cards").upsert({ uid_hash: body.card, customer_id: c.id, linked_at: new Date().toISOString() });
        if (error) throw error;
        return { ok: true, moved: !!existing && existing.customer_id !== c.id };
    },

    async checkout(body, kiosk) {
        const lines = Array.isArray(body.items) ? body.items : [];
        if (!lines.length || lines.length > 200) throw new HttpError(400, "The bill is empty");
        let customer: { id: string } | null = null;
        if (body.pass) customer = await customerByPass(body.pass);
        else if (body.customer_id) {
            const { data } = await db.from("customers").select("id, blocked").eq("id", String(body.customer_id)).maybeSingle();
            if (!data) throw new HttpError(404, "Customer not found");
            if (data.blocked) throw new HttpError(403, "This account is blocked. Please ask a staff member.");
            customer = data;
        }

        const barcodes = [...new Set(lines.map((l: any) => String(l.barcode ?? "")))];
        const { data: products, error } = await db.from("products").select("id, barcode, title, price").in("barcode", barcodes).eq("active", true);
        if (error) throw error;
        const byCode = new Map(products!.map((p) => [p.barcode, p]));

        const items = lines.map((l: any) => {
            const barcode = String(l.barcode ?? "");
            const qty = Math.min(99, Math.max(1, Math.floor(Number(l.qty) || 1)));
            if (!/^[0-9]{6,14}$/.test(barcode)) throw new HttpError(400, `Bad barcode: ${barcode}`);
            const p = byCode.get(barcode);
            if (p) return { product_id: p.id, barcode, title: p.title, unit_price: Number(p.price), qty, estimated: false };
            const price = Math.min(MAX_ESTIMATE, Math.max(0, Number(l.price) || 0));
            return { product_id: null, barcode, title: String(l.title ?? "Unlisted item").slice(0, 120), unit_price: price, qty, estimated: true };
        });
        const total = Math.round(items.reduce((s, i) => s + i.unit_price * i.qty, 0) * 100) / 100;
        const itemCount = items.reduce((s, i) => s + i.qty, 0);

        const { data: order, error: oe } = await db.from("orders").insert({
            customer_id: customer?.id ?? null, kiosk_id: kiosk.id, total, item_count: itemCount,
        }).select("id, number, total, status, created_at").single();
        if (oe) throw oe;
        const { error: ie } = await db.from("order_items").insert(items.map((i) => ({ ...i, order_id: order.id })));
        if (ie) throw ie;
        return { order: { ...order, items } };
    },

    async paid(body, kiosk) {
        const { data: order } = await db.from("orders").select("id, number, total, status, customer_id, kiosk_id")
            .eq("id", String(body.order_id ?? "")).maybeSingle();
        if (!order || order.kiosk_id !== kiosk.id) throw new HttpError(404, "Order not found");
        if (order.status === "paid") return { order, points: 0 };
        if (order.status !== "pending") throw new HttpError(409, "Order was cancelled");

        const points = order.customer_id ? Math.floor(Number(order.total) * POINTS_PER_RUPEE) : 0;
        const { data: updated, error } = await db.from("orders")
            .update({ status: "paid", paid_at: new Date().toISOString(), points_earned: points })
            .eq("id", order.id).eq("status", "pending").select("id, number, total, status, paid_at").single();
        if (error) throw error;
        let balance = null;
        if (order.customer_id && points > 0) {
            const { data: c } = await db.from("customers").select("points").eq("id", order.customer_id).single();
            balance = (c?.points ?? 0) + points;
            await db.from("customers").update({ points: balance }).eq("id", order.customer_id);
        }
        return { order: updated, points, balance };
    },

    async cancel(body, kiosk) {
        await db.from("orders").update({ status: "cancelled" })
            .eq("id", String(body.order_id ?? "")).eq("kiosk_id", kiosk.id).eq("status", "pending");
        return { ok: true };
    },
};

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    try {
        const kiosk = await kioskFor(req);
        const body = await req.json().catch(() => ({}));
        const handler = actions[body.action];
        if (!handler) throw new HttpError(400, "Unknown action");
        return json(await handler(body, kiosk));
    } catch (e) {
        const status = e instanceof HttpError ? e.status : 500;
        if (status === 500) console.error(e);
        const message = e instanceof Error ? e.message : (e as any)?.message ?? String(e);
        return json({ error: message }, status);
    }
});
