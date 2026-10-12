// End-to-end check of the RAISE backend: access rules, the `pass` and `kiosk` Edge Functions,
// orders, points, NFC cards and pass claiming. Creates its own test data (prefixed "E2E").
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/e2e.mjs
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";

const URL_ = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SERVICE) { console.error("Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const sha = (t) => createHash("sha256").update(t).digest("hex");
let failures = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) failures++; };

async function kiosk(key, action, body = {}) {
    const r = await fetch(`${URL_}/functions/v1/kiosk`, {
        method: "POST",
        headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json", "x-kiosk-key": key },
        body: JSON.stringify({ action, ...body }),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function newCustomerClient(tag) {
    const c = createClient(URL_, ANON, opts);
    const email = `e2e-${tag}-${Date.now()}@raise.test`;
    const { error } = await c.auth.signUp({ email, password: "e2e-password-123", options: { data: { name: `E2E ${tag}`, phone: "9811122233" } } });
    if (error) throw error;
    return c;
}

// ---------------------------------------------------------------- catalog + RLS basics
const anon = createClient(URL_, ANON, opts);
const { data: products } = await anon.from("products").select("barcode, price").eq("active", true);
check("anyone can read the catalog", (products?.length ?? 0) > 0, `${products?.length} products`);
const { data: anonOrders } = await anon.from("orders").select("id");
check("anonymous users see no orders", (anonOrders ?? []).length === 0);
const { error: anonWrite } = await anon.from("products").update({ price: 1 }).eq("barcode", products[0].barcode).select();
const { data: priceAfter } = await anon.from("products").select("price").eq("barcode", products[0].barcode).single();
check("anonymous users can't change prices", Number(priceAfter.price) === Number(products[0].price), anonWrite?.message ?? "no rows updated");

// ---------------------------------------------------------------- customer app
const alice = await newCustomerClient("alice");
const { data: me } = await alice.from("customers").select("*").single();
check("signup creates a customer with a pass", !!me?.pass_id && me.name === "E2E alice", me?.pass_id);
const { data: passResp, error: passErr } = await alice.functions.invoke("pass", { body: { action: "get" } });
check("pass function issues a RAISE2 token", /^RAISE2\.[0-9A-Z]{10}\.[A-Za-z0-9_-]{22}$/.test(passResp?.token ?? ""), passErr?.message ?? passResp?.token);
const aliceToken = passResp.token;

await alice.from("customers").update({ points: 99999 }).eq("id", me.id);
const { data: mePts } = await alice.from("customers").select("points").single();
check("customers can't set their own points", mePts.points === 0, `points = ${mePts.points}`);
const { error: nameErr } = await alice.from("customers").update({ name: "E2E Alice B" }).eq("id", me.id);
check("customers can edit their name", !nameErr, nameErr?.message);

const bob = await newCustomerClient("bob");
const { data: bobSees } = await bob.from("customers").select("id");
check("customers only see themselves", bobSees.length === 1 && bobSees[0].id !== me.id);

// ---------------------------------------------------------------- kiosk
const key = randomBytes(24).toString("base64url");
const { data: k } = await admin.from("kiosks").insert({ name: "E2E kiosk", key_hash: sha(key) }).select().single();
check("no key is refused", (await kiosk("", "heartbeat")).status === 401);
check("wrong key is refused", (await kiosk(randomBytes(24).toString("base64url"), "heartbeat")).status === 401);
const hb = await kiosk(key, "heartbeat", { info: { camera: "E2E cam", stage: "identify" } });
check("heartbeat updates the kiosk", hb.status === 200 && hb.body.name === "E2E kiosk");

const id1 = await kiosk(key, "identify", { pass: aliceToken });
check("kiosk identifies a pass", id1.status === 200 && id1.body.customer?.id === me.id, id1.body.error);
const forged = aliceToken.slice(0, -4) + (aliceToken.endsWith("AAAA") ? "BBBB" : "AAAA");
check("forged pass is rejected", (await kiosk(key, "identify", { pass: forged })).status === 400);

const card = sha("raise-nfc:" + "04a3b2c1d0e580");
check("unknown card is 404", (await kiosk(key, "identify", { card })).status === 404);
const link = await kiosk(key, "link_card", { pass: aliceToken, card });
check("kiosk links an NFC card", link.status === 200, link.body.error);
const id2 = await kiosk(key, "identify", { card });
check("card logs the customer in", id2.status === 200 && id2.body.customer?.id === me.id && id2.body.customer.has_card === true);
const { data: aliceCards } = await alice.from("nfc_cards").select("uid_hash");
check("customer sees their linked card", aliceCards.length === 1);

// checkout: the kiosk claims a catalog item costs ₹1, the server must use the real price
const item = products.find((p) => Number(p.price) > 5);
const co = await kiosk(key, "checkout", {
    customer_id: me.id,
    items: [{ barcode: item.barcode, qty: 3, price: 1 }, { barcode: "4006381333931", qty: 1, price: 50, title: "E2E unlisted pen" }],
});
const expected = Number(item.price) * 3 + 50;
check("checkout uses database prices", co.status === 200 && Number(co.body.order.total) === expected, `total ${co.body.order?.total}, expected ${expected}`);
check("unlisted item is flagged as estimated", co.body.order?.items?.some((i) => i.estimated && i.barcode === "4006381333931"));
const paid = await kiosk(key, "paid", { order_id: co.body.order.id });
const expectPts = Math.floor(expected / 10);
check("payment awards points", paid.status === 200 && paid.body.points === expectPts, `+${paid.body.points}`);
const { data: aliceOrders } = await alice.from("orders").select("number, status, points_earned");
check("customer sees the paid order", aliceOrders.length === 1 && aliceOrders[0].status === "paid");
const { data: aliceItems } = await alice.from("order_items").select("title");
check("customer sees the order's items", aliceItems.length === 2);
const { data: bobOrders } = await bob.from("orders").select("id");
check("other customers don't see it", bobOrders.length === 0);
const { data: alicePts } = await alice.from("customers").select("points").single();
check("points balance updated", alicePts.points === expectPts, `${alicePts.points}`);

// ---------------------------------------------------------------- kiosk registration + claim
const reg = await kiosk(key, "register", { name: "E2E Kiosk Kim", phone: "9876500000" });
check("kiosk registers a customer", reg.status === 200 && reg.body.token?.startsWith("RAISE2."), reg.body.error);
const kim = await newCustomerClient("kim");
const { data: claimResp, error: claimErr } = await kim.functions.invoke("pass", { body: { action: "claim", token: reg.body.token } });
check("app account claims the kiosk pass", !claimErr && claimResp?.customer?.id === reg.body.customer.id, claimErr?.message);
const { data: kimMe } = await kim.from("customers").select("id, name").single();
check("claimed pass is now the account's customer", kimMe?.id === reg.body.customer.id, kimMe?.name);
const { error: stealErr } = await bob.functions.invoke("pass", { body: { action: "claim", token: reg.body.token } });
check("a claimed pass can't be claimed again", !!stealErr);

// ---------------------------------------------------------------- admin controls
await admin.from("customers").update({ blocked: true }).eq("id", me.id);
check("blocked customer is refused at the kiosk", (await kiosk(key, "identify", { pass: aliceToken })).status === 403);
await admin.from("kiosks").update({ active: false }).eq("id", k.id);
check("disabled kiosk is refused", (await kiosk(key, "heartbeat")).status === 403);

// ---------------------------------------------------------------- clean up
await admin.from("orders").delete().eq("kiosk_id", k.id);
await admin.from("kiosks").delete().eq("id", k.id);
const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
for (const u of users.users.filter((u) => u.email?.startsWith("e2e-"))) await admin.auth.admin.deleteUser(u.id);
await admin.from("customers").delete().like("name", "E2E%");

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
