import { sb, isOnline, type Kiosk, type Order } from "../sb";
import { esc, inr, timeAgo } from "../../../shared/ui";
import { openOrder } from "./orders";

export async function renderDashboard(el: HTMLElement): Promise<() => void> {
    const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
    el.innerHTML = `
      <div class="page-head">
        <h1>Today</h1>
        <div class="meta"><span>${esc(today)}</span><span id="live-note"><span class="dot on" style="display:inline-block;vertical-align:middle;margin-right:6px"></span>Live</span></div>
      </div>
      <dl class="panel strip" id="strip"></dl>
      <div class="grid-2">
        <section class="panel">
          <div class="panel-head"><h2>Latest orders</h2><div class="meta"><a href="#/orders">All orders</a></div></div>
          <div class="table-wrap"><table class="t"><thead><tr><th>Order</th><th>Customer</th><th>Kiosk</th><th class="r">Items</th><th class="r">Total</th><th>Status</th></tr></thead><tbody id="latest"></tbody></table></div>
        </section>
        <div class="stack">
          <section class="panel"><div class="panel-head"><h2>Kiosks</h2><div class="meta" id="kiosk-meta"></div></div><ul class="feed" id="kiosks"></ul></section>
          <section class="panel"><div class="panel-head"><h2>Best sellers today</h2><div class="meta">by units</div></div><ul class="bars" id="top"></ul></section>
        </div>
      </div>`;

    let known = new Set<string>();

    async function load(flashNew = false): Promise<void> {
        const [sales, latest, kiosks, top] = await Promise.all([
            sb.from("sales_today").select("*").single(),
            sb.from("orders").select("id, number, status, total, item_count, points_earned, created_at, paid_at, customers(name), kiosks(name)").order("created_at", { ascending: false }).limit(12),
            sb.from("kiosks").select("id, name, active, last_seen, info, created_at").order("name"),
            sb.rpc("top_products", { days: 1, max_rows: 5 }),
        ]);

        const s = sales.data ?? { paid_orders: 0, revenue: 0, items_sold: 0, open_orders: 0, customers: 0 };
        const avg = s.paid_orders ? Number(s.revenue) / s.paid_orders : 0;
        document.getElementById("strip")!.innerHTML = `
          <div><dt>Revenue</dt><dd>${inr(s.revenue)}</dd></div>
          <div><dt>Paid orders</dt><dd>${s.paid_orders}</dd></div>
          <div><dt>Average basket</dt><dd>${inr(Math.round(avg))}</dd></div>
          <div><dt>Items sold</dt><dd>${s.items_sold}</dd></div>
          <div><dt>Open at a kiosk</dt><dd>${s.open_orders}<small>${s.open_orders ? "awaiting payment" : "none"}</small></dd></div>`;

        const orders = (latest.data ?? []) as unknown as Order[];
        document.getElementById("latest")!.innerHTML = orders.length
            ? orders.map((o) => `
                <tr class="click ${flashNew && !known.has(o.id) ? "new" : ""}" data-id="${o.id}">
                  <td><span class="mono">#${o.number}</span><span class="sub">${timeAgo(o.created_at)}</span></td>
                  <td>${o.customers ? esc(o.customers.name) : `<span class="sub">Guest</span>`}</td>
                  <td>${o.kiosks ? esc(o.kiosks.name) : "—"}</td>
                  <td class="r num">${o.item_count}</td>
                  <td class="r num">${inr(o.total)}</td>
                  <td><span class="status ${o.status}">${o.status}</span></td>
                </tr>`).join("")
            : `<tr><td colspan="6"><div class="empty-state"><b>No orders yet today</b>Orders appear here the moment a customer presses Pay at a kiosk.</div></td></tr>`;
        known = new Set(orders.map((o) => o.id));

        const ks = (kiosks.data ?? []) as Kiosk[];
        const online = ks.filter((k) => k.active && isOnline(k)).length;
        document.getElementById("kiosk-meta")!.textContent = ks.length ? `${online} of ${ks.filter((k) => k.active).length} online` : "";
        document.getElementById("kiosks")!.innerHTML = ks.length
            ? ks.map((k) => {
                const on = k.active && isOnline(k);
                return `<li><span class="dot ${on ? "on" : ""}"></span>
                  <div><div>${esc(k.name)}</div><div class="sub">${!k.active ? "Disabled" : on ? esc(k.info.stage ? "On " + k.info.stage + " screen" : "Online") : "Last seen " + timeAgo(k.last_seen)}</div></div>
                  <span class="sub">${esc(k.info.camera ?? "")}</span></li>`;
            }).join("")
            : `<li style="grid-template-columns:1fr"><div class="empty-state" style="padding:var(--s5)"><b>No kiosks yet</b><a href="#/kiosks">Add your first kiosk</a> to get a setup link.</div></li>`;

        const rows = (top.data ?? []) as { barcode: string; title: string; qty: number; revenue: number }[];
        const max = Math.max(1, ...rows.map((r) => Number(r.qty)));
        document.getElementById("top")!.innerHTML = rows.length
            ? rows.map((r) => `<li><span>${esc(r.title)}</span><span class="mono">${r.qty} · ${inr(r.revenue)}</span><span class="bar"><i style="width:${(Number(r.qty) / max) * 100}%"></i></span></li>`).join("")
            : `<li><div class="empty-state" style="padding:var(--s4) 0"><b>Nothing sold yet</b>Best sellers rank here by units once orders are paid.</div></li>`;
    }

    await load();
    document.getElementById("latest")!.addEventListener("click", (e) => {
        const tr = (e.target as HTMLElement).closest("tr[data-id]") as HTMLElement | null;
        if (tr) openOrder(tr.dataset.id!);
    });

    const channel = sb.channel("dashboard")
        .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => load(true))
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "kiosks" }, () => load())
        .subscribe();
    const timer = setInterval(() => load(), 30_000);
    return () => { channel.unsubscribe(); clearInterval(timer); };
}
