import { sb, type Product } from "../sb";
import { esc, icon, inr, toast } from "../../../shared/ui";
import type { AppState } from "../main";

interface ListRow { product_id: string; qty: number; checked: boolean }

export async function renderShop(el: HTMLElement, state: AppState): Promise<void> {
    let view: "list" | "browse" = "list";
    let query = "";
    const [{ data: products }, { data: list }] = await Promise.all([
        sb.from("products").select("id, barcode, title, brand, price, image_url").eq("active", true).order("title"),
        sb.from("shopping_list").select("product_id, qty, checked").order("added_at"),
    ]);
    const catalog = (products ?? []) as Product[];
    const byId = new Map(catalog.map((p) => [p.id, p]));
    const rows = new Map(((list ?? []) as ListRow[]).map((r) => [r.product_id, r]));

    el.innerHTML = `
      <h1>Shopping</h1>
      <div class="seg" role="tablist" aria-label="Shopping">
        <button role="tab" data-v="list">My list</button>
        <button role="tab" data-v="browse">Browse store</button>
      </div>
      <div id="body"></div>`;

    const thumb = (p: Product) => p.image_url ? `<img src="${esc(p.image_url)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="ph"></span>`;

    function draw(): void {
        el.querySelectorAll<HTMLButtonElement>("[data-v]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.v === view)));
        const body = document.getElementById("body")!;
        if (view === "list") {
            const items = [...rows.values()].filter((r) => byId.has(r.product_id));
            const total = items.reduce((s, r) => s + Number(byId.get(r.product_id)!.price) * r.qty, 0);
            const left = items.filter((r) => !r.checked).length;
            body.innerHTML = items.length ? `
              <section class="card">
                <div class="card-head"><h2>${left ? `${left} to pick up` : "All picked up"}</h2><span class="meta">${items.length} item${items.length > 1 ? "s" : ""}</span></div>
                <ul class="items">${items.map((r) => {
                    const p = byId.get(r.product_id)!;
                    return `<li class="item ${r.checked ? "done" : ""}" data-id="${p.id}">
                      ${thumb(p)}
                      <div><div class="t">${esc(p.title)}</div><div class="s">${r.qty} × ${inr(p.price)}</div></div>
                      <button class="check" type="button" role="checkbox" aria-checked="${r.checked}" data-check aria-label="Picked up ${esc(p.title)}">${icon("check")}</button>
                    </li>`;
                }).join("")}</ul>
                <div class="list-total"><span>Estimated total at today's prices</span><b>${inr(total)}</b></div>
              </section>
              <button class="btn btn--ghost" id="clear-done" type="button" style="align-self:center">Clear picked-up items</button>`
            : `<div class="empty">${icon("list")}<h3>Your list is empty</h3><p>Browse the store and add what you need. Prices are the store's live prices.</p><button class="btn btn--primary" id="go-browse" type="button">Browse store</button></div>`;
        } else {
            const needle = query.toLowerCase();
            const found = catalog.filter((p) => !needle || `${p.title} ${p.brand}`.toLowerCase().includes(needle));
            body.innerHTML = `
              <div class="search">${icon("search")}<input class="field" id="q" placeholder="Search ${catalog.length} products" value="${esc(query)}" autocomplete="off"></div>
              <section class="card"><ul class="items">${found.length ? found.map((p) => {
                  const inList = rows.has(p.id);
                  return `<li class="item" data-id="${p.id}">${thumb(p)}
                    <div><div class="t">${esc(p.title)}</div><div class="s"><span class="price">${inr(p.price)}</span> · ${esc(p.brand)}</div></div>
                    <button class="add-btn ${inList ? "on" : ""}" type="button" data-toggle aria-pressed="${inList}">${inList ? icon("check") + " Added" : icon("plus") + " Add"}</button></li>`;
              }).join("") : `<li class="empty"><h3>No products match</h3><p>Try a brand name.</p></li>`}</ul></section>`;
            const q = document.getElementById("q") as HTMLInputElement;
            q.oninput = () => { query = q.value; const pos = q.selectionStart; draw(); const n = document.getElementById("q") as HTMLInputElement; n.focus(); n.setSelectionRange(pos, pos); };
        }
    }

    el.addEventListener("click", async (e) => {
        const t = e.target as HTMLElement;
        const v = t.closest<HTMLElement>("[data-v]");
        if (v) { view = v.dataset.v as "list" | "browse"; return draw(); }
        if (t.closest("#go-browse")) { view = "browse"; return draw(); }
        const id = t.closest<HTMLElement>("[data-id]")?.dataset.id;
        if (t.closest("#clear-done")) {
            const done = [...rows.values()].filter((r) => r.checked).map((r) => r.product_id);
            if (!done.length) return toast("Nothing is ticked yet");
            await sb.from("shopping_list").delete().in("product_id", done);
            done.forEach((d) => rows.delete(d)); return draw();
        }
        if (!id) return;
        if (t.closest("[data-toggle]")) {
            if (rows.has(id)) {
                await sb.from("shopping_list").delete().eq("product_id", id);
                rows.delete(id);
            } else {
                const { error } = await sb.from("shopping_list").insert({ customer_id: state.customer.id, product_id: id, qty: 1 });
                if (error) return toast(error.message, "warn");
                rows.set(id, { product_id: id, qty: 1, checked: false });
                toast(`${byId.get(id)!.title} added to your list`);
            }
            return draw();
        }
        if (t.closest("[data-check]")) {
            const r = rows.get(id)!;
            r.checked = !r.checked;
            draw();
            await sb.from("shopping_list").update({ checked: r.checked }).eq("product_id", id);
        }
    });
    draw();
}
