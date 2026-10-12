import { sb, type Product } from "../sb";
import { esc, icon, timeAgo, toast } from "../../../shared/ui";
import { confirmSheet, openSheet } from "../dialog";

export async function renderProducts(el: HTMLElement): Promise<() => void> {
    let query = "";
    let showHidden = false;
    let products: Product[] = [];
    el.innerHTML = `
      <div class="page-head">
        <h1>Products</h1>
        <div class="meta" id="p-meta"></div>
        <div class="actions"><button class="btn btn--primary" id="add" type="button">${icon("plus")} Add product</button></div>
      </div>
      <div class="toolbar">
        <div class="search">${icon("search")}<input class="field" id="q" placeholder="Name, brand or barcode" autocomplete="off"></div>
        <div class="chips"><button type="button" id="hidden-toggle" aria-pressed="false">Show hidden</button></div>
      </div>
      <section class="panel"><div class="table-wrap"><table class="t">
        <thead><tr><th></th><th>Product</th><th>Barcode</th><th class="r">Price</th><th class="r">Stock</th><th>On sale</th><th>Updated</th><th></th></tr></thead>
        <tbody id="rows"></tbody></table></div></section>`;

    async function load(): Promise<void> {
        const { data, error } = await sb.from("products").select("*").order("title");
        if (error) return toast(error.message, "warn");
        products = (data ?? []) as Product[];
        draw();
    }

    function draw(): void {
        const needle = query.toLowerCase();
        const rows = products.filter((p) => (showHidden || p.active) && (!needle || `${p.title} ${p.brand} ${p.barcode}`.toLowerCase().includes(needle)));
        const hidden = products.filter((p) => !p.active).length;
        document.getElementById("p-meta")!.textContent = `${products.length - hidden} on sale${hidden ? ` · ${hidden} hidden` : ""}`;
        document.getElementById("rows")!.innerHTML = rows.length
            ? rows.map((p) => `
                <tr data-id="${p.id}">
                  <td style="width:44px">${p.image_url ? `<img class="thumb" src="${esc(p.image_url)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="thumb"></span>`}</td>
                  <td><b style="font-weight:600">${esc(p.title)}</b><span class="sub">${esc(p.brand)}</span></td>
                  <td class="mono">${esc(p.barcode)}</td>
                  <td class="r"><input class="inline" data-field="price" type="number" min="0" step="0.5" value="${Number(p.price)}" aria-label="Price of ${esc(p.title)}"></td>
                  <td class="r"><input class="inline" data-field="stock" type="number" min="0" step="1" value="${p.stock ?? ""}" placeholder="—" aria-label="Stock of ${esc(p.title)}"></td>
                  <td><button class="switch" type="button" role="switch" aria-checked="${p.active}" data-toggle aria-label="${p.active ? "Hide" : "Show"} ${esc(p.title)}"></button></td>
                  <td class="sub">${timeAgo(p.updated_at)}</td>
                  <td class="act"><button class="icon-btn" data-edit type="button" aria-label="Edit ${esc(p.title)}">${icon("edit")}</button></td>
                </tr>`).join("")
            : `<tr><td colspan="8"><div class="empty-state"><b>${query ? "No products match" : "No products yet"}</b>${query ? "Try a barcode or brand." : "Add your first product; scan or type its barcode."}</div></td></tr>`;
    }

    async function save(id: string, patch: Partial<Product>, input?: HTMLInputElement): Promise<void> {
        const { data, error } = await sb.from("products").update(patch).eq("id", id).select().single();
        if (error) { toast(error.message, "warn"); return load(); }
        const i = products.findIndex((p) => p.id === id);
        products[i] = data as Product;
        if (input) { input.classList.add("saved"); setTimeout(() => input.classList.remove("saved"), 900); }
        else draw();
    }

    const rowsEl = () => document.getElementById("rows")!;
    await load();

    rowsEl().addEventListener("change", (e) => {
        const input = e.target as HTMLInputElement;
        const id = (input.closest("tr") as HTMLElement)?.dataset.id;
        if (!id || !input.dataset.field) return;
        const v = input.value.trim();
        if (input.dataset.field === "price") {
            const price = Number(v);
            if (!(price >= 0)) return toast("Price must be 0 or more", "warn");
            save(id, { price }, input);
        } else {
            save(id, { stock: v === "" ? null : Math.max(0, Math.floor(Number(v))) }, input);
        }
    });
    rowsEl().addEventListener("keydown", (e) => { if (e.key === "Enter") (e.target as HTMLElement).blur(); });
    rowsEl().addEventListener("click", (e) => {
        const t = e.target as HTMLElement;
        const id = (t.closest("tr") as HTMLElement)?.dataset.id;
        if (!id) return;
        const p = products.find((x) => x.id === id)!;
        if (t.closest("[data-toggle]")) save(id, { active: !p.active }).then(() => toast(p.active ? `${p.title} hidden from kiosks` : `${p.title} back on sale`));
        if (t.closest("[data-edit]")) editProduct(p, load);
    });
    let tm = 0;
    document.getElementById("q")!.addEventListener("input", (e) => {
        clearTimeout(tm);
        tm = window.setTimeout(() => { query = (e.target as HTMLInputElement).value.trim(); draw(); }, 120);
    });
    document.getElementById("hidden-toggle")!.addEventListener("click", (e) => {
        showHidden = !showHidden;
        (e.currentTarget as HTMLElement).setAttribute("aria-pressed", String(showHidden));
        draw();
    });
    document.getElementById("add")!.addEventListener("click", () => editProduct(null, load));
    return () => {};
}

/** Look a barcode up on Open Food Facts to prefill name, brand and image. */
async function lookup(barcode: string): Promise<{ title: string; brand: string; image_url: string } | null> {
    try {
        const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,brands,quantity,image_front_small_url`);
        const d = await r.json();
        if (d.status !== 1 || !d.product?.product_name) return null;
        const p = d.product;
        const title = p.quantity && !p.product_name.includes(p.quantity) ? `${p.product_name} (${p.quantity})` : p.product_name;
        return { title, brand: (p.brands || "").split(",")[0].trim(), image_url: p.image_front_small_url || "" };
    } catch { return null; }
}

function editProduct(p: Product | null, onSaved: () => void): void {
    const d = openSheet(p ? "Edit product" : "Add product", `
        <div><label class="label" for="f-barcode">Barcode</label>
          <div style="display:flex;gap:8px"><input class="field mono" id="f-barcode" inputmode="numeric" maxlength="14" value="${esc(p?.barcode ?? "")}" ${p ? "readonly" : "autofocus"} placeholder="Scan or type the EAN">
          ${p ? "" : `<button class="btn" id="f-lookup" type="button">${icon("search")} Look up</button>`}</div>
          <p class="hint" id="f-hint">${p ? "The barcode can't be changed; hide this product and add a new one instead." : "Look up fills in the name, brand and image from Open Food Facts."}</p></div>
        <div><label class="label" for="f-title">Name</label><input class="field" id="f-title" maxlength="120" value="${esc(p?.title ?? "")}"></div>
        <div class="form-row">
          <div><label class="label" for="f-brand">Brand</label><input class="field" id="f-brand" value="${esc(p?.brand ?? "")}"></div>
          <div><label class="label" for="f-price">Price (₹)</label><input class="field mono" id="f-price" type="number" min="0" step="0.5" value="${p ? Number(p.price) : ""}"></div>
        </div>
        <div class="form-row">
          <div><label class="label" for="f-stock">Stock <span class="mute">(optional)</span></label><input class="field mono" id="f-stock" type="number" min="0" value="${p?.stock ?? ""}"></div>
          <div><label class="label" for="f-image">Image URL</label><input class="field" id="f-image" value="${esc(p?.image_url ?? "")}"></div>
        </div>`,
        `${p ? `<button class="btn btn--danger left" data-delete type="button">${icon("trash")} Delete</button>` : ""}<button class="btn" data-close type="button">Cancel</button><button class="btn btn--primary" data-save type="button">${p ? "Save changes" : "Add product"}</button>`);
    const $ = (id: string) => d.querySelector<HTMLInputElement>("#" + id)!;

    d.querySelector("#f-lookup")?.addEventListener("click", async () => {
        const code = $("f-barcode").value.trim();
        if (!/^\d{6,14}$/.test(code)) return toast("Enter a 6–14 digit barcode first", "warn");
        $("f-hint").textContent = "Looking up…";
        const found = await lookup(code);
        if (!found) { $("f-hint").textContent = "Not found on Open Food Facts; fill the details in yourself."; return; }
        $("f-title").value = found.title; $("f-brand").value = found.brand; $("f-image").value = found.image_url;
        $("f-hint").textContent = "Filled in from Open Food Facts. Set your price.";
        $("f-price").focus();
    });

    d.querySelector("[data-save]")!.addEventListener("click", async () => {
        const row = {
            barcode: $("f-barcode").value.trim(), title: $("f-title").value.trim(), brand: $("f-brand").value.trim(),
            price: Number($("f-price").value), image_url: $("f-image").value.trim(),
            stock: $("f-stock").value === "" ? null : Math.max(0, Math.floor(Number($("f-stock").value))),
        };
        if (!/^\d{6,14}$/.test(row.barcode)) return toast("Barcode must be 6–14 digits", "warn");
        if (!row.title) return toast("Give the product a name", "warn");
        if (!($("f-price").value !== "" && row.price >= 0)) return toast("Set a price", "warn");
        const { error } = p
            ? await sb.from("products").update(row).eq("id", p.id)
            : await sb.from("products").insert(row);
        if (error) return toast(error.code === "23505" ? "A product with this barcode already exists" : error.message, "warn");
        toast(p ? "Product saved" : `${row.title} added`);
        d.close();
        onSaved();
    });

    d.querySelector("[data-delete]")?.addEventListener("click", async () => {
        if (!p) return;
        if (!(await confirmSheet("Delete product?", `${p.title} will be removed. Past orders keep their copy of the name and price. To stop selling it temporarily, hide it instead.`, "Delete", true))) return;
        const { error } = await sb.from("products").delete().eq("id", p.id);
        if (error) return toast(error.message, "warn");
        toast(`${p.title} deleted`);
        d.close();
        onSaved();
    });
}

