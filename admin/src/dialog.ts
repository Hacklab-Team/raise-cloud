import { esc, icon } from "../../shared/ui";

/** A modal sheet (native <dialog>: focus trap, Escape to close). Removed from the DOM on close. */
export function openSheet(title: string, body: string, foot = ""): HTMLDialogElement {
    const d = document.createElement("dialog");
    d.className = "sheet";
    d.innerHTML = `
      <div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close type="button" aria-label="Close">${icon("x")}</button></div>
      <div class="sheet-body">${body}</div>
      ${foot ? `<div class="sheet-foot">${foot}</div>` : ""}`;
    document.body.append(d);
    d.addEventListener("click", (e) => {
        if (e.target === d || (e.target as HTMLElement).closest("[data-close]")) d.close();
    });
    d.addEventListener("close", () => d.remove());
    d.showModal();
    return d;
}

export function confirmSheet(title: string, message: string, action: string, danger = false): Promise<boolean> {
    return new Promise((resolve) => {
        const d = openSheet(title, `<p>${esc(message)}</p>`,
            `<button class="btn" data-close type="button">Cancel</button><button class="btn ${danger ? "btn--danger" : "btn--primary"}" data-ok type="button">${esc(action)}</button>`);
        let ok = false;
        d.querySelector("[data-ok]")!.addEventListener("click", () => { ok = true; d.close(); });
        d.addEventListener("close", () => resolve(ok));
    });
}
