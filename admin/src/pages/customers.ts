import { sb, type Customer } from "../sb";
import { dateTime, esc, icon, inr, timeAgo, toast } from "../../../shared/ui";
import { confirmSheet, openSheet } from "../dialog";

const formatPass = (id: string) => id.replace(/(.{4})(.{4})(.*)/, "$1-$2-$3");

export async function renderCustomers(el: HTMLElement): Promise<() => void> {
    let query = "";
    let customers: Customer[] = [];
    el.innerHTML = `
      <div class="page-head"><h1>Customers</h1><div class="meta" id="c-meta"></div></div>
      <div class="toolbar"><div class="search">${icon("search")}<input class="field" id="q" placeholder="Name, phone or pass ID" autocomplete="off"></div></div>
      <section class="panel"><div class="table-wrap"><table class="t">
        <thead><tr><th>Customer</th><th>Mobile</th><th>Pass</th><th class="r">Points</th><th>NFC card</th><th class="r">Orders</th><th>Joined</th><th>Status</th></tr></thead>
        <tbody id="rows"></tbody></table></div></section>`;

    async function load(): Promise<void> {
        const { data, error } = await sb.from("customers")
            .select("id, name, phone, pass_id, points, blocked, created_via, created_at, user_id, nfc_cards(count), orders(count)")
            .order("created_at", { ascending: false });
        if (error) return toast(error.message, "warn");
        customers = (data ?? []) as unknown as Customer[];
        draw();
    }

    function draw(): void {
        const needle = query.toLowerCase().replace(/-/g, "");
        const rows = customers.filter((c) => !needle || `${c.name} ${c.phone ?? ""} ${c.pass_id}`.toLowerCase().includes(needle));
        const withApp = customers.filter((c) => c.user_id).length;
        const withCard = customers.filter((c) => c.nfc_cards[0]?.count).length;
        document.getElementById("c-meta")!.textContent = `${customers.length} customers · ${withApp} using the app · ${withCard} with a card`;
        document.getElementById("rows")!.innerHTML = rows.length
            ? rows.map((c) => `
                <tr class="click" data-id="${c.id}">
                  <td><b style="font-weight:600">${esc(c.name)}</b><span class="sub">${c.user_id ? "App account" : c.created_via === "kiosk" ? "Registered at a kiosk" : "No app account"}</span></td>
                  <td class="mono">${c.phone ? esc(c.phone) : "—"}</td>
                  <td class="mono">${esc(formatPass(c.pass_id))}</td>
                  <td class="r num">${c.points}</td>
                  <td>${c.nfc_cards[0]?.count ? `<span class="status paid">Linked</span>` : `<span class="sub">—</span>`}</td>
                  <td class="r num">${c.orders[0]?.count ?? 0}</td>
                  <td class="sub">${timeAgo(c.created_at)}</td>
                  <td>${c.blocked ? `<span class="status blocked">Blocked</span>` : `<span class="status paid">Active</span>`}</td>
                </tr>`).join("")
            : `<tr><td colspan="8"><div class="empty-state"><b>${query ? "No customers match" : "No customers yet"}</b>${query ? "Search by name, mobile or pass ID." : "Customers appear when they sign up in the app or register at a kiosk."}</div></td></tr>`;
    }

    await load();
    let t = 0;
    document.getElementById("q")!.addEventListener("input", (e) => {
        clearTimeout(t);
        t = window.setTimeout(() => { query = (e.target as HTMLInputElement).value.trim(); draw(); }, 120);
    });
    document.getElementById("rows")!.addEventListener("click", (e) => {
        const tr = (e.target as HTMLElement).closest("tr[data-id]") as HTMLElement | null;
        if (tr) openCustomer(customers.find((c) => c.id === tr.dataset.id)!, load);
    });
    return () => {};
}

async function openCustomer(c: Customer, onChange: () => void): Promise<void> {
    const [{ data: orders }, { data: cards }] = await Promise.all([
        sb.from("orders").select("number, status, total, created_at").eq("customer_id", c.id).order("created_at", { ascending: false }).limit(8),
        sb.from("nfc_cards").select("uid_hash, label, linked_at").eq("customer_id", c.id),
    ]);
    const card = (cards ?? [])[0];
    const d = openSheet(c.name, `
        <dl class="kv">
          <dt>Pass ID</dt><dd class="mono">${esc(formatPass(c.pass_id))}</dd>
          <dt>Mobile</dt><dd class="mono">${c.phone ? esc(c.phone) : "—"}</dd>
          <dt>Points</dt><dd><span class="mono" id="pts">${c.points}</span>
              <span style="display:inline-flex;gap:6px;margin-left:12px"><input class="field mono" id="pts-delta" type="number" placeholder="+/-" style="width:84px;height:32px"><button class="btn" id="pts-apply" type="button" style="--h:32px">Adjust</button></span></dd>
          <dt>NFC card</dt><dd>${card ? `Linked ${timeAgo(card.linked_at)} <button class="btn" id="unlink" type="button" style="--h:28px;margin-left:8px">Unlink</button>` : "None"}</dd>
          <dt>Account</dt><dd>${c.user_id ? "Uses the RAISE app" : c.created_via === "kiosk" ? "Kiosk only (can claim the pass in the app)" : "No app account"}</dd>
          <dt>Joined</dt><dd>${esc(dateTime(c.created_at))}</dd>
        </dl>
        <div><p class="label">Recent orders</p>
          ${(orders ?? []).length ? `<table class="lines">${(orders ?? []).map((o) => `<tr><td>#${o.number} · <span class="status ${o.status}">${o.status}</span> <span style="color:var(--mute);font-size:12px">${timeAgo(o.created_at)}</span></td><td>${inr(o.total)}</td></tr>`).join("")}</table>` : `<p class="hint">No orders yet.</p>`}
        </div>`,
        `<button class="btn left" id="reissue" type="button">${icon("refresh")} Re-issue pass</button>
         <button class="btn ${c.blocked ? "" : "btn--danger"}" id="block" type="button">${icon(c.blocked ? "unlock" : "lock")} ${c.blocked ? "Unblock" : "Block"}</button>
         <button class="btn" data-close type="button">Close</button>`);
    const $ = (id: string) => d.querySelector<HTMLElement>("#" + id);

    $("pts-apply")!.addEventListener("click", async () => {
        const delta = Math.trunc(Number(($("pts-delta") as HTMLInputElement).value));
        if (!delta) return;
        const next = Math.max(0, c.points + delta);
        const { error } = await sb.from("customers").update({ points: next }).eq("id", c.id);
        if (error) return toast(error.message, "warn");
        c.points = next; $("pts")!.textContent = String(next); ($("pts-delta") as HTMLInputElement).value = "";
        toast(`${c.name} now has ${next} points`); onChange();
    });
    $("unlink")?.addEventListener("click", async () => {
        if (!(await confirmSheet("Unlink card?", `${c.name}'s card will stop logging them in at every kiosk.`, "Unlink", true))) return;
        const { error } = await sb.from("nfc_cards").delete().eq("customer_id", c.id);
        if (error) return toast(error.message, "warn");
        toast("Card unlinked"); d.close(); onChange();
    });
    $("block")!.addEventListener("click", async () => {
        if (!c.blocked && !(await confirmSheet(`Block ${c.name}?`, "Their pass and card will be refused at every kiosk until unblocked.", "Block", true))) return;
        const { error } = await sb.from("customers").update({ blocked: !c.blocked }).eq("id", c.id);
        if (error) return toast(error.message, "warn");
        toast(c.blocked ? `${c.name} unblocked` : `${c.name} blocked`); d.close(); onChange();
    });
    $("reissue")!.addEventListener("click", async () => {
        if (!(await confirmSheet("Re-issue pass?", "The current QR (on their phone or printed) stops working immediately. They get the new one in the app; kiosk-only customers need a new printout.", "Re-issue"))) return;
        const { data, error } = await sb.rpc("reissue_pass", { target: c.id });
        if (error) return toast(error.message, "warn");
        toast(`New pass ${formatPass(String(data))}`); d.close(); onChange();
    });
}
