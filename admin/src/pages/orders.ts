import { sb, type Order } from "../sb";
import { dateTime, esc, icon, inr, timeAgo, toast } from "../../../shared/ui";
import { confirmSheet, openSheet } from "../dialog";

type Filter = "all" | "paid" | "pending" | "cancelled";

export async function renderOrders(el: HTMLElement): Promise<() => void> {
    let filter: Filter = "all";
    let query = "";
    el.innerHTML = `
      <div class="page-head">
        <h1>Orders</h1>
        <div class="meta" id="orders-meta"></div>
      </div>
      <div class="toolbar">
        <div class="search">${icon("search")}<input class="field" id="q" placeholder="Order number or customer" autocomplete="off"></div>
        <div class="chips" id="chips"></div>
      </div>
      <section class="panel"><div class="table-wrap"><table class="t">
        <thead><tr><th>Order</th><th>Time</th><th>Customer</th><th>Kiosk</th><th class="r">Items</th><th class="r">Total</th><th class="r">Points</th><th>Status</th></tr></thead>
        <tbody id="rows"></tbody></table></div></section>`;

    async function load(): Promise<void> {
        let q = sb.from("orders")
            .select("id, number, status, total, item_count, points_earned, created_at, paid_at, customers(name), kiosks(name)")
            .order("created_at", { ascending: false }).limit(200);
        if (filter !== "all") q = q.eq("status", filter);
        if (/^\d+$/.test(query)) q = q.eq("number", Number(query));
        const [{ data }, counts] = await Promise.all([q, statusCounts()]);
        let orders = (data ?? []) as unknown as Order[];
        if (query && !/^\d+$/.test(query)) {
            const needle = query.toLowerCase();
            orders = orders.filter((o) => (o.customers?.name ?? "guest").toLowerCase().includes(needle));
        }
        document.getElementById("chips")!.innerHTML = (["all", "paid", "pending", "cancelled"] as Filter[])
            .map((f) => `<button type="button" data-f="${f}" aria-pressed="${f === filter}">${f === "all" ? "All" : f[0].toUpperCase() + f.slice(1)}<span class="n">${counts[f]}</span></button>`).join("");
        document.getElementById("orders-meta")!.textContent = `${counts.all} orders · ${inr(counts.revenue)} paid in total`;
        document.getElementById("rows")!.innerHTML = orders.length
            ? orders.map((o) => `
                <tr class="click" data-id="${o.id}">
                  <td class="mono">#${o.number}</td>
                  <td><span title="${esc(dateTime(o.created_at))}">${timeAgo(o.created_at)}</span></td>
                  <td>${o.customers ? esc(o.customers.name) : `<span class="sub">Guest</span>`}</td>
                  <td>${o.kiosks ? esc(o.kiosks.name) : "—"}</td>
                  <td class="r num">${o.item_count}</td>
                  <td class="r num">${inr(o.total)}</td>
                  <td class="r num">${o.points_earned || ""}</td>
                  <td><span class="status ${o.status}">${o.status}</span></td>
                </tr>`).join("")
            : `<tr><td colspan="8"><div class="empty-state"><b>${query || filter !== "all" ? "No matching orders" : "No orders yet"}</b>${query || filter !== "all" ? "Try another search or filter." : "Orders appear here when customers check out at a kiosk."}</div></td></tr>`;
    }

    async function statusCounts() {
        const { data } = await sb.from("orders").select("status, total").limit(5000);
        const rows = data ?? [];
        const c = { all: rows.length, paid: 0, pending: 0, cancelled: 0, revenue: 0 } as Record<Filter, number> & { revenue: number };
        for (const r of rows) { c[r.status as Filter]++; if (r.status === "paid") c.revenue += Number(r.total); }
        return c;
    }

    await load();
    document.getElementById("chips")!.addEventListener("click", (e) => {
        const b = (e.target as HTMLElement).closest("button[data-f]") as HTMLElement | null;
        if (b) { filter = b.dataset.f as Filter; load(); }
    });
    let t = 0;
    document.getElementById("q")!.addEventListener("input", (e) => {
        clearTimeout(t);
        t = window.setTimeout(() => { query = (e.target as HTMLInputElement).value.trim(); load(); }, 200);
    });
    document.getElementById("rows")!.addEventListener("click", (e) => {
        const tr = (e.target as HTMLElement).closest("tr[data-id]") as HTMLElement | null;
        if (tr) openOrder(tr.dataset.id!, load);
    });
    const channel = sb.channel("orders-page").on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => load()).subscribe();
    return () => channel.unsubscribe();
}

export async function openOrder(id: string, onChange?: () => void): Promise<void> {
    const [{ data: o }, { data: items }] = await Promise.all([
        sb.from("orders").select("*, customers(name, pass_id), kiosks(name)").eq("id", id).single(),
        sb.from("order_items").select("barcode, title, unit_price, qty, estimated").eq("order_id", id),
    ]);
    if (!o) return toast("Order not found", "warn");
    const lines = (items ?? []).map((i) => `
        <tr><td>${esc(i.title)}${i.estimated ? ` <span class="status pending">est.</span>` : ""}<br><span class="sub mono" style="font-size:12px;color:var(--mute)">${esc(i.barcode)} · ${i.qty} × ${inr(i.unit_price)}</span></td><td>${inr(i.qty * Number(i.unit_price))}</td></tr>`).join("");
    const d = openSheet(`Order #${o.number}`, `
        <dl class="kv">
          <dt>Status</dt><dd><span class="status ${o.status}">${o.status}</span></dd>
          <dt>Created</dt><dd>${esc(dateTime(o.created_at))}</dd>
          ${o.paid_at ? `<dt>Paid</dt><dd>${esc(dateTime(o.paid_at))}</dd>` : ""}
          <dt>Customer</dt><dd>${o.customers ? `${esc(o.customers.name)} <span class="mono" style="color:var(--mute)">${esc(o.customers.pass_id)}</span>` : "Guest"}</dd>
          <dt>Kiosk</dt><dd>${o.kiosks ? esc(o.kiosks.name) : "—"}</dd>
          ${o.points_earned ? `<dt>Points earned</dt><dd class="mono">${o.points_earned}</dd>` : ""}
        </dl>
        <table class="lines">${lines}<tr class="total"><td>Total · ${o.item_count} items</td><td>${inr(o.total)}</td></tr></table>`,
        o.status === "pending" ? `<button class="btn btn--danger left" data-cancel type="button">Cancel order</button><button class="btn" data-close type="button">Close</button>` : `<button class="btn" data-close type="button">Close</button>`);
    d.querySelector("[data-cancel]")?.addEventListener("click", async () => {
        if (!(await confirmSheet("Cancel this order?", `Order #${o.number} is still awaiting payment. Cancelling it removes it from the open orders.`, "Cancel order", true))) return;
        const { error } = await sb.from("orders").update({ status: "cancelled" }).eq("id", id).eq("status", "pending");
        if (error) return toast(error.message, "warn");
        toast(`Order #${o.number} cancelled`);
        d.close();
        onChange?.();
    });
}
