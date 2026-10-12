import { sb, KIOSK_URL, isOnline, type Kiosk } from "../sb";
import { esc, icon, timeAgo, toast } from "../../../shared/ui";
import { confirmSheet, openSheet } from "../dialog";

function newKey(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256Hex(text: string): Promise<string> {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function renderKiosks(el: HTMLElement): Promise<() => void> {
    el.innerHTML = `
      <div class="page-head">
        <h1>Kiosks</h1><div class="meta" id="k-meta"></div>
        <div class="actions"><button class="btn btn--primary" id="add" type="button">${icon("plus")} Add kiosk</button></div>
      </div>
      <section class="panel"><div class="table-wrap"><table class="t">
        <thead><tr><th>Kiosk</th><th>Status</th><th>Screen</th><th>Camera</th><th>NFC</th><th>App</th><th>Enabled</th><th></th></tr></thead>
        <tbody id="rows"></tbody></table></div></section>
      <p class="hint" style="margin-top:12px">A kiosk counts as online when it has checked in within the last 90 seconds. Kiosks check in every 30 seconds.</p>`;

    let kiosks: Kiosk[] = [];
    async function load(): Promise<void> {
        const { data, error } = await sb.from("kiosks").select("id, name, active, last_seen, info, created_at").order("created_at");
        if (error) return toast(error.message, "warn");
        kiosks = (data ?? []) as Kiosk[];
        const online = kiosks.filter((k) => k.active && isOnline(k)).length;
        document.getElementById("k-meta")!.textContent = kiosks.length ? `${online} of ${kiosks.filter((k) => k.active).length} online` : "";
        document.getElementById("rows")!.innerHTML = kiosks.length
            ? kiosks.map((k) => {
                const on = k.active && isOnline(k);
                return `<tr data-id="${k.id}">
                  <td><b style="font-weight:600">${esc(k.name)}</b><span class="sub">Added ${timeAgo(k.created_at)}</span></td>
                  <td><span class="status ${on ? "paid" : "cancelled"}">${on ? "Online" : "Offline"}</span><span class="sub">${k.last_seen ? "Seen " + timeAgo(k.last_seen) : "Never connected"}</span></td>
                  <td>${esc(k.info.stage ?? "—")}</td>
                  <td>${esc(k.info.camera ?? "—")}<span class="sub mono">${esc(k.info.resolution ?? "")}</span></td>
                  <td>${k.info.nfc === undefined ? "—" : k.info.nfc ? "Ready" : "Not seen"}</td>
                  <td class="mono sub">${esc(k.info.version ?? "—")}</td>
                  <td><button class="switch" type="button" role="switch" aria-checked="${k.active}" data-toggle aria-label="${k.active ? "Disable" : "Enable"} ${esc(k.name)}"></button></td>
                  <td class="act"><button class="icon-btn" data-key type="button" title="New setup link" aria-label="New setup link for ${esc(k.name)}">${icon("refresh")}</button><button class="icon-btn icon-btn--danger" data-delete type="button" aria-label="Remove ${esc(k.name)}">${icon("trash")}</button></td>
                </tr>`;
            }).join("")
            : `<tr><td colspan="8"><div class="empty-state"><b>No kiosks yet</b>Add a kiosk to get its setup link, then open that link once on the kiosk.</div></td></tr>`;
    }

    function showSetup(name: string, key: string): void {
        const link = `${KIOSK_URL.replace(/\/?$/, "/")}?kiosk=${key}`;
        const d = openSheet(`Set up ${name}`, `
            <p>Open this link once on the kiosk. It saves the key there and removes it from the address bar.</p>
            <div class="secret"><span style="flex:1">${esc(link)}</span><button class="btn" data-copy type="button" style="--h:32px">${icon("copy")} Copy</button></div>
            <p class="callout">This link is shown only now. Anyone with it can act as this kiosk; if it leaks, create a new link and the old one stops working.</p>
            <p class="hint">On a Raspberry Pi kiosk: run <code>bash ~/setup-kiosk.sh '${esc(link)}'</code> instead, so it opens the right page at boot.</p>`,
            `<button class="btn btn--primary" data-close type="button">Done</button>`);
        d.querySelector("[data-copy]")!.addEventListener("click", async () => {
            await navigator.clipboard.writeText(link).catch(() => {});
            toast("Setup link copied");
        });
    }

    async function create(): Promise<void> {
        const d = openSheet("Add kiosk", `
            <div><label class="label" for="k-name">Name</label><input class="field" id="k-name" maxlength="40" placeholder="e.g. Entrance kiosk" autofocus></div>`,
            `<button class="btn" data-close type="button">Cancel</button><button class="btn btn--primary" data-ok type="button">Create</button>`);
        d.querySelector("[data-ok]")!.addEventListener("click", async () => {
            const name = (d.querySelector("#k-name") as HTMLInputElement).value.trim();
            if (!name) return toast("Give the kiosk a name", "warn");
            const key = newKey();
            const { error } = await sb.from("kiosks").insert({ name, key_hash: await sha256Hex(key) });
            if (error) return toast(error.message, "warn");
            d.close();
            await load();
            showSetup(name, key);
        });
    }

    await load();
    document.getElementById("add")!.addEventListener("click", create);
    document.getElementById("rows")!.addEventListener("click", async (e) => {
        const t = e.target as HTMLElement;
        const id = (t.closest("tr") as HTMLElement)?.dataset.id;
        const k = kiosks.find((x) => x.id === id);
        if (!k) return;
        if (t.closest("[data-toggle]")) {
            await sb.from("kiosks").update({ active: !k.active }).eq("id", k.id);
            toast(k.active ? `${k.name} disabled: it will refuse checkouts` : `${k.name} enabled`);
            load();
        } else if (t.closest("[data-key]")) {
            if (!(await confirmSheet("Create a new setup link?", `${k.name}'s current link stops working. You'll need to open the new link on that kiosk.`, "New link"))) return;
            const key = newKey();
            await sb.from("kiosks").update({ key_hash: await sha256Hex(key) }).eq("id", k.id);
            showSetup(k.name, key);
        } else if (t.closest("[data-delete]")) {
            if (!(await confirmSheet(`Remove ${k.name}?`, "Its orders stay in the history. The kiosk stops working until it is added again.", "Remove", true))) return;
            await sb.from("kiosks").delete().eq("id", k.id);
            toast(`${k.name} removed`);
            load();
        }
    });
    const channel = sb.channel("kiosks-page").on("postgres_changes", { event: "*", schema: "public", table: "kiosks" }, () => load()).subscribe();
    const timer = setInterval(load, 30_000);
    return () => { channel.unsubscribe(); clearInterval(timer); };
}
