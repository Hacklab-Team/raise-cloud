import { readBarcodes, prepareZXingModule } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { sb, passApi, formatPass } from "../sb";
import { esc, icon, timeAgo, toast } from "../../../shared/ui";
import { openSheet } from "../sheet";
import type { AppState } from "../main";

// Web NFC (Android Chrome only). Minimal typing for what we use.
interface NDEFReadingEvent extends Event { serialNumber: string }
declare class NDEFReader extends EventTarget {
    scan(options?: { signal?: AbortSignal }): Promise<void>;
    onreading: ((e: NDEFReadingEvent) => void) | null;
    onreadingerror: ((e: Event) => void) | null;
}
const hasWebNFC = "NDEFReader" in window;

/** Same scheme as the kiosk: sha256("raise-nfc:" + uid in lowercase hex). */
async function uidHash(serial: string): Promise<string> {
    const uid = serial.replace(/[^0-9a-f]/gi, "").toLowerCase();
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("raise-nfc:" + uid));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) } });

export async function renderAccount(el: HTMLElement, state: AppState): Promise<void> {
    const c = state.customer;
    const [{ data: cards }, { data: auth }] = await Promise.all([
        sb.from("nfc_cards").select("uid_hash, label, linked_at"),
        sb.auth.getUser(),
    ]);
    const card = (cards ?? [])[0];
    el.innerHTML = `
      <h1>Account</h1>
      <section class="card">
        <dl class="dl">
          <dt>Name</dt><dd>${esc(c.name)}</dd>
          <dt>Mobile</dt><dd class="mono">${c.phone ? esc(c.phone) : "—"}</dd>
          <dt>Email</dt><dd>${esc(auth.user?.email ?? "")}</dd>
          <dt>Pass ID</dt><dd class="mono">${esc(formatPass(c.pass_id))}</dd>
        </dl>
      </section>
      <button class="btn" id="edit" type="button">${icon("edit")} Edit name and mobile</button>

      <section class="card">
        <div class="row-card">
          <span class="ico">${icon("nfc")}</span>
          <div><div class="t">${card ? "NFC card linked" : "NFC card"}</div>
            <div class="s">${card ? `Tap it on any RAISE kiosk to log in · linked ${timeAgo(card.linked_at)}` : hasWebNFC ? "Link a card to log in with a tap" : "Link a card at any RAISE kiosk after scanning your pass"}</div></div>
          ${card ? `<button class="btn btn--danger" id="unlink" type="button">Unlink</button>` : hasWebNFC ? `<button class="btn btn--primary" id="link" type="button">Link</button>` : ""}
        </div>
      </section>

      <section class="card">
        <div class="row-card">
          <span class="ico">${icon("qr")}</span>
          <div><div class="t">Claim a kiosk pass</div><div class="s">Registered at a kiosk? Scan that pass to keep its points here.</div></div>
          <button class="btn" id="claim" type="button">Claim</button>
        </div>
      </section>

      <button class="btn btn--danger btn--lg" id="sign-out" type="button" style="margin-top:var(--s4)">${icon("log-out")} Sign out</button>`;

    document.getElementById("sign-out")!.onclick = () => sb.auth.signOut();

    document.getElementById("edit")!.onclick = () => {
        const s = openSheet(`
          <h3>Edit details</h3>
          <div><label class="label" for="e-name">Full name</label><input class="field" id="e-name" maxlength="60" value="${esc(c.name)}"></div>
          <div><label class="label" for="e-phone">Mobile number</label><input class="field mono" id="e-phone" inputmode="numeric" maxlength="10" value="${esc(c.phone ?? "")}" placeholder="10 digits"></div>
          <button class="btn btn--primary btn--lg" id="e-save" type="button">Save</button>
          <button class="btn btn--ghost" data-close type="button">Cancel</button>`);
        s.el.querySelector("#e-save")!.addEventListener("click", async () => {
            const name = (s.el.querySelector("#e-name") as HTMLInputElement).value.trim();
            const phone = (s.el.querySelector("#e-phone") as HTMLInputElement).value.replace(/\D/g, "");
            if (!name) return toast("Enter your name", "warn");
            if (phone && phone.length !== 10) return toast("Mobile number must be 10 digits", "warn");
            const { error } = await sb.from("customers").update({ name, phone: phone || null }).eq("id", c.id);
            if (error) return toast(error.message, "warn");
            s.close(); toast("Details saved");
            await state.refresh(); renderAccount(el, state);
        });
    };

    document.getElementById("unlink")?.addEventListener("click", async () => {
        if (!confirm("Unlink your NFC card? It will stop logging you in at the kiosks.")) return;
        const { error } = await sb.from("nfc_cards").delete().eq("customer_id", c.id);
        if (error) return toast(error.message, "warn");
        toast("Card unlinked"); renderAccount(el, state);
    });

    document.getElementById("link")?.addEventListener("click", async () => {
        const ctrl = new AbortController();
        const s = openSheet(`<h3>Link your card</h3><p>Hold your NFC card against the back of your phone.</p>
          <p class="hint">${icon("loader", "spin")} Waiting for a card…</p><button class="btn btn--ghost" data-close type="button">Cancel</button>`, () => ctrl.abort());
        try {
            const reader = new NDEFReader();
            await reader.scan({ signal: ctrl.signal });
            reader.onreading = async (e) => {
                ctrl.abort();
                const { error } = await sb.from("nfc_cards").insert({ uid_hash: await uidHash(e.serialNumber), customer_id: c.id });
                s.close();
                if (error) return toast(error.code === "23505" ? "That card is already linked to another account" : error.message, "warn");
                toast("Card linked. Tap it at any kiosk to log in.");
                renderAccount(el, state);
            };
        } catch (err) {
            s.close();
            toast(err instanceof Error && err.name === "NotAllowedError" ? "Allow NFC access to link a card" : "NFC isn't available on this phone", "warn");
        }
    });

    document.getElementById("claim")!.onclick = () => claimFlow(state);
}

function claimFlow(state: AppState): void {
    let stream: MediaStream | null = null;
    let stopped = false;
    const s = openSheet(`
      <h3>Claim a kiosk pass</h3>
      <p class="mute" style="font-size:14px">Point the camera at the pass QR from the kiosk (printout or photo).</p>
      <div class="scanbox"><video id="cam" playsinline muted></video></div>
      <details><summary class="hint" style="cursor:pointer">Can't scan? Paste the pass code</summary>
        <input class="field mono" id="paste" placeholder="RAISE2.…" style="margin-top:8px"><button class="btn" id="paste-ok" type="button" style="margin-top:8px">Claim</button></details>
      <button class="btn btn--ghost" data-close type="button">Cancel</button>`, () => { stopped = true; stream?.getTracks().forEach((t) => t.stop()); });

    async function claim(token: string): Promise<void> {
        stopped = true; stream?.getTracks().forEach((t) => t.stop());
        try {
            await passApi({ action: "claim", token: token.trim() });
            s.close();
            toast("Pass claimed. Its points are now in your account.");
            localStorage.removeItem("raise_pass_token");
            await state.refresh();
            location.hash = "#/pass";
        } catch (e) {
            toast(e instanceof Error ? e.message : "Couldn't claim that pass", "warn");
            stopped = false; startCamera();
        }
    }

    s.el.querySelector("#paste-ok")!.addEventListener("click", () => claim((s.el.querySelector("#paste") as HTMLInputElement).value));

    async function startCamera(): Promise<void> {
        const video = s.el.querySelector("#cam") as HTMLVideoElement;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        } catch {
            toast("Camera unavailable. Paste the pass code instead.", "warn");
            return;
        }
        video.srcObject = stream;
        await video.play().catch(() => {});
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        const tick = async () => {
            if (stopped) return;
            if (video.videoWidth) {
                canvas.width = video.videoWidth; canvas.height = video.videoHeight;
                ctx.drawImage(video, 0, 0);
                const results = await readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), { formats: ["QRCode"], tryHarder: true, maxNumberOfSymbols: 1 });
                const hit = results.find((r) => r.isValid && r.text.startsWith("RAISE2."));
                if (hit) return claim(hit.text);
            }
            setTimeout(tick, 150);
        };
        tick();
    }
    startCamera();
}
