/** Bottom sheet. Tap outside or press Escape to close. Returns a close function. */
export function openSheet(html: string, onClose?: () => void): { el: HTMLElement; close: () => void } {
    const wrap = document.createElement("div");
    wrap.className = "sheet";
    wrap.innerHTML = `<div class="panel" role="dialog" aria-modal="true">${html}</div>`;
    document.body.append(wrap);
    const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey); onClose?.(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    wrap.addEventListener("click", (e) => { if (e.target === wrap || (e.target as HTMLElement).closest("[data-close]")) close(); });
    document.addEventListener("keydown", onKey);
    return { el: wrap.querySelector(".panel") as HTMLElement, close };
}
