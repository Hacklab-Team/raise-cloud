// Small UI helpers shared by the admin panel and the customer app.
export { icon } from "./icons";
import { icon } from "./icons";

export const esc = (v: unknown): string =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const inrFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
export const inr = (n: number | string): string => "₹" + inrFmt.format(Number(n) || 0);

export function timeAgo(iso: string | null | undefined): string {
    if (!iso) return "never";
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 45) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export const dateTime = (iso: string): string =>
    new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

let toastTimer = 0;
export function toast(message: string, tone: "ok" | "warn" | "busy" = "ok"): void {
    let el = document.getElementById("toast");
    if (!el) {
        el = document.createElement("div");
        el.id = "toast"; el.className = "toast"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite");
        document.body.append(el);
    }
    el.dataset.tone = tone;
    el.innerHTML = icon(tone === "warn" ? "alert" : tone === "busy" ? "loader" : "check", tone === "busy" ? "spin" : "") + `<span>${esc(message)}</span>`;
    el.classList.add("is-shown");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el!.classList.remove("is-shown"), tone === "warn" ? 4000 : 2400);
}

// Theme: saved choice, else the OS. index.html applies it before first paint.
export function initThemeToggle(btn: HTMLElement): void {
    const root = document.documentElement;
    const paint = () => {
        const dark = root.dataset.theme === "dark";
        btn.innerHTML = icon(dark ? "sun" : "moon");
        btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
        btn.title = btn.getAttribute("aria-label")!;
    };
    btn.onclick = () => {
        root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
        try { localStorage.setItem("raise_theme", JSON.stringify(root.dataset.theme)); } catch { /* private mode */ }
        paint();
    };
    paint();
}

export const THEME_BOOT = `(function(){var t=null;try{t=JSON.parse(localStorage.getItem("raise_theme"))}catch(e){}if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t})();`;
