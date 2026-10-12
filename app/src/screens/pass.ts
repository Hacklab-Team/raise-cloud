import QRCode from "qrcode";
import { passApi, formatPass, POINTS_RULE } from "../sb";
import { esc, icon, toast } from "../../../shared/ui";
import { sealSVG, waveBandSVG } from "../../../shared/seal";
import type { AppState } from "../main";

const CACHE_KEY = "raise_pass_token";

export async function renderPass(el: HTMLElement, state: AppState): Promise<void> {
    const c = state.customer;
    el.innerHTML = `
      <div class="passcard" id="pass-card">
        <div class="art">${waveBandSVG(400, 56, 8)}<div class="head"><span>RAISE PASS</span><span class="num">${esc(formatPass(c.pass_id))}</span></div></div>
        <div class="qrwrap" id="qr"><div class="placeholder">${icon("loader", "spin")}</div></div>
        <p class="who">${esc(c.name)}</p>
        <p class="pid">${c.phone ? "••• " + esc(c.phone.slice(-4)) : "&nbsp;"}</p>
        <div class="signed">${sealSVG()}<span class="tag tag--ok">Verified by RAISE</span></div>
      </div>
      ${c.blocked ? `<p class="err">This account is blocked at the kiosks. Please speak to a staff member.</p>` : ""}
      <div class="actions">
        <button class="btn btn--lg" id="print" type="button">${icon("printer")} Print</button>
        <button class="btn btn--lg" id="save" type="button">${icon("download")} Save image</button>
      </div>
      <div class="points">
        <div><p class="lbl">Loyalty points</p><p class="val">${c.points}</p></div>
        <p class="rule">${POINTS_RULE} at checkout</p>
      </div>
      <p class="hint" style="text-align:center">Show this at the kiosk, or tap your linked NFC card. A printed copy works too.</p>`;

    // Cached token first, so the pass shows instantly and offline.
    let token = "";
    try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
        if (cached && cached.pass_id === c.pass_id) token = cached.token;
    } catch { /* ignore */ }
    if (token) await draw(token);
    try {
        const fresh = await passApi<{ token: string }>({ action: "get" });
        if (fresh.token !== token) { token = fresh.token; await draw(token); }
        localStorage.setItem(CACHE_KEY, JSON.stringify({ pass_id: c.pass_id, token }));
    } catch (e) {
        if (!token) document.getElementById("qr")!.innerHTML = `<div class="placeholder">Can't load your pass. Check your connection.</div>`;
        else toast("Offline: showing your saved pass", "warn");
        console.warn(e);
    }

    async function draw(t: string): Promise<void> {
        const url = await QRCode.toDataURL(t, { errorCorrectionLevel: "M", margin: 1, width: 464, color: { dark: "#0f1412", light: "#ffffff" } });
        document.getElementById("qr")!.innerHTML = `<img src="${url}" alt="Your RAISE Pass QR code">`;
        const seal = el.querySelector(".signed .seal");
        seal?.classList.remove("is-drawn"); void (seal as SVGElement | null)?.getBoundingClientRect(); seal?.classList.add("is-drawn");
    }

    document.getElementById("print")!.onclick = () => window.print();
    document.getElementById("save")!.onclick = () => {
        const img = el.querySelector<HTMLImageElement>("#qr img");
        if (!img) return;
        const a = document.createElement("a");
        a.href = img.src; a.download = `raise-pass-${c.pass_id}.png`; a.click();
    };
}
