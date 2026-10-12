import "../../shared/raise.css";
import "./app.css";
import { registerSW } from "virtual:pwa-register";
import { sb, type Customer } from "./sb";
import { esc, icon, initThemeToggle, toast } from "../../shared/ui";
import { renderPass } from "./screens/pass";
import { renderShop } from "./screens/shop";
import { renderOrders } from "./screens/orders";
import { renderAccount } from "./screens/account";

registerSW({ immediate: true });

const root = document.getElementById("root")!;

export interface AppState { customer: Customer; refresh: () => Promise<void> }
type Screen = (el: HTMLElement, state: AppState) => Promise<void | (() => void)>;

const TABS: Record<string, { label: string; icon: string; render: Screen }> = {
    pass: { label: "Pass", icon: "qr", render: renderPass },
    shop: { label: "Shop", icon: "list", render: renderShop },
    orders: { label: "Orders", icon: "receipt", render: renderOrders },
    account: { label: "Account", icon: "user", render: renderAccount },
};

let state: AppState | null = null;
let cleanup: void | (() => void);

// ---------------------------------------------------------------- auth screens

function renderAuth(mode: "in" | "up" = "in", message = ""): void {
    root.innerHTML = `
      <section class="auth">
        <div style="display:flex;flex-direction:column;gap:8px">
          <span class="brand">RAISE</span>
          <h1>Your pass to<br>skip the queue.</h1>
          <p class="mute">Show your pass at the kiosk, collect points, keep every receipt.</p>
        </div>
        <div class="seg" role="tablist" style="position:static">
          <button role="tab" data-mode="in" aria-selected="${mode === "in"}">Sign in</button>
          <button role="tab" data-mode="up" aria-selected="${mode === "up"}">Create account</button>
        </div>
        ${message ? `<p class="err">${esc(message)}</p>` : ""}
        <form id="auth-form" autocomplete="on">
          ${mode === "up" ? `
            <div><label class="label" for="name">Full name</label><input class="field" id="name" required maxlength="60" autocomplete="name" placeholder="Rahul Sharma"></div>
            <div><label class="label" for="phone">Mobile number <span class="mute">(optional)</span></label><input class="field mono" id="phone" inputmode="numeric" pattern="[0-9]{10}" maxlength="10" autocomplete="tel-national" placeholder="10 digits"></div>` : ""}
          <div><label class="label" for="email">Email</label><input class="field" id="email" type="email" required autocomplete="email"></div>
          <div><label class="label" for="password">Password</label><input class="field" id="password" type="password" required minlength="8" autocomplete="${mode === "up" ? "new-password" : "current-password"}"></div>
          <button class="btn btn--primary btn--lg" type="submit">${mode === "up" ? "Create my pass" : "Sign in"}</button>
        </form>
        <p class="hint">Registered at a kiosk? Create an account, then go to Account → Claim a kiosk pass to keep your points.</p>
      </section>`;
    root.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) => (b.onclick = () => renderAuth(b.dataset.mode as "in" | "up")));
    const form = document.getElementById("auth-form") as HTMLFormElement;
    form.onsubmit = async (e) => {
        e.preventDefault();
        const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? "";
        const btn = form.querySelector("button")!;
        btn.disabled = true;
        const { error } = mode === "up"
            ? await sb.auth.signUp({ email: val("email"), password: val("password"), options: { data: { name: val("name"), phone: val("phone") } } })
            : await sb.auth.signInWithPassword({ email: val("email"), password: val("password") });
        btn.disabled = false;
        if (error) renderAuth(mode, error.message === "Invalid login credentials" ? "Wrong email or password." : error.message);
    };
}

// ---------------------------------------------------------------- app shell

async function loadCustomer(): Promise<Customer | null> {
    const { data } = await sb.from("customers").select("id, name, phone, pass_id, points, blocked").maybeSingle();
    return data as Customer | null;
}

async function renderApp(): Promise<void> {
    const customer = await loadCustomer();
    if (!customer) { renderAuth("in", "This account has no RAISE customer profile."); await sb.auth.signOut(); return; }
    state = {
        customer,
        refresh: async () => {
            const c = await loadCustomer();
            if (c && state) { state.customer = c; paintPoints(); }
        },
    };
    root.innerHTML = `
      <header class="top"><b>RAISE</b><span class="pts"><b id="pts">${customer.points}</b> points</span><button class="theme-btn" id="theme-btn" type="button"></button></header>
      <main class="view" id="view"></main>
      <nav class="nav" aria-label="Sections">
        ${Object.entries(TABS).map(([k, t]) => `<a class="tab" href="#/${k}" data-tab="${k}">${icon(t.icon)}${t.label}<span class="badge" id="badge-${k}" hidden></span></a>`).join("")}
      </nav>`;
    initThemeToggle(document.getElementById("theme-btn")!);
    subscribeOrders(customer.id);
    route();
}

function paintPoints(): void {
    const el = document.getElementById("pts");
    if (el && state) el.textContent = String(state.customer.points);
}

// Live: when this customer pays at a kiosk, the points and receipts update here.
let ordersChannel: ReturnType<typeof sb.channel> | null = null;
function subscribeOrders(customerId: string): void {
    ordersChannel?.unsubscribe();
    ordersChannel = sb.channel("my-orders")
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "orders", filter: `customer_id=eq.${customerId}` }, async (payload) => {
            const o = payload.new as { number: number; status: string; points_earned: number };
            if (o.status === "paid") {
                toast(o.points_earned ? `Order #${o.number} paid · +${o.points_earned} points` : `Order #${o.number} paid`);
                await state?.refresh();
                if (location.hash.includes("orders")) route();
            }
        })
        .subscribe();
}

async function route(): Promise<void> {
    if (!state) return;
    const key = location.hash.replace(/^#\/?/, "") || "pass";
    const tab = TABS[key] ?? TABS.pass;
    document.querySelectorAll<HTMLAnchorElement>(".tab").forEach((a) => {
        if (a.dataset.tab === key) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    if (typeof cleanup === "function") cleanup();
    const view = document.getElementById("view")!;
    view.innerHTML = "";
    window.scrollTo(0, 0);
    cleanup = await tab.render(view, state);
}
window.addEventListener("hashchange", route);

// ---------------------------------------------------------------- boot

let shownFor: string | null = null;
async function onUser(userId: string | null): Promise<void> {
    if (!userId) { shownFor = null; state = null; ordersChannel?.unsubscribe(); renderAuth(); return; }
    if (shownFor === userId) return;
    shownFor = userId;
    await renderApp();
}

sb.auth.getSession().then(({ data }) => onUser(data.session?.user.id ?? null));
sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT") onUser(session?.user.id ?? null);
});
