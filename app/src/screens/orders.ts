import { sb, type Order } from "../sb";
import { dateTime, esc, icon, inr } from "../../../shared/ui";
import { openSheet } from "../sheet";
import type { AppState } from "../main";

export async function renderOrders(el: HTMLElement, state: AppState): Promise<void> {
    const { data } = await sb.from("orders")
        .select("id, number, status, total, item_count, points_earned, created_at, paid_at")
        .neq("status", "cancelled").order("created_at", { ascending: false }).limit(100);
    const orders = (data ?? []) as Order[];
    const paid = orders.filter((o) => o.status === "paid");
    const spent = paid.reduce((s, o) => s + Number(o.total), 0);

    el.innerHTML = `
      <h1>Orders</h1>
      <section class="card">
        <div class="card-head"><h2>Receipts</h2><span class="meta">${paid.length ? `${paid.length} paid · ${inr(spent)}` : ""}</span></div>
        ${orders.length ? `<ul class="items" style="list-style:none;margin:0;padding:0">${orders.map((o) => `
          <li><button class="tx" type="button" data-id="${o.id}">
            <span class="ico">${icon("receipt")}</span>
            <span><div class="t">Order #${o.number}${o.status === "pending" ? ` <span class="status pending" style="font-size:11px;color:var(--warn)">awaiting payment</span>` : ""}</div>
            <div class="s">${esc(dateTime(o.created_at))} · ${o.item_count} item${o.item_count > 1 ? "s" : ""}</div></span>
            <span class="amt">${inr(o.total)}${o.points_earned ? `<small>+${o.points_earned} pts</small>` : ""}</span>
          </button></li>`).join("")}</ul>`
        : `<div class="empty">${icon("receipt")}<h3>No receipts yet</h3><p>Check out at a RAISE kiosk with your pass or card and your receipt appears here instantly.</p></div>`}
      </section>`;

    el.addEventListener("click", async (e) => {
        const id = (e.target as HTMLElement).closest<HTMLElement>("[data-id]")?.dataset.id;
        if (!id) return;
        const o = orders.find((x) => x.id === id)!;
        const { data: items } = await sb.from("order_items").select("title, unit_price, qty, estimated").eq("order_id", id);
        openSheet(`
          <h3>Order #${o.number}</h3>
          <p class="mute" style="font-size:13px">${esc(dateTime(o.paid_at ?? o.created_at))} · ${o.status === "paid" ? "Paid" : "Awaiting payment"}</p>
          ${(items ?? []).map((i) => `<div class="rcpt-row"><span>${esc(i.title)} × ${i.qty}${i.estimated ? " (est.)" : ""}</span><span>${inr(Number(i.unit_price) * i.qty)}</span></div>`).join("")}
          <div class="rcpt-row" style="border:0;font-weight:700"><span>Total</span><span>${inr(o.total)}</span></div>
          ${o.points_earned ? `<p class="hint">You earned ${o.points_earned} points on this order.</p>` : ""}
          <button class="btn btn--block" data-close type="button">Close</button>`);
    });
    void state;
}
