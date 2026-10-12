import "../../shared/raise.css";
import "./admin.css";
import { sb, isOnline, type Kiosk } from "./sb";
import { esc, icon, initThemeToggle } from "../../shared/ui";
import { sealSVG } from "../../shared/seal";
import { renderDashboard } from "./pages/dashboard";
import { renderOrders } from "./pages/orders";
import { renderProducts } from "./pages/products";
import { renderCustomers } from "./pages/customers";
import { renderKiosks } from "./pages/kiosks";

const root = document.getElementById("root")!;

type Page = (el: HTMLElement) => Promise<void | (() => void)>;
const ROUTES: Record<string, { label: string; icon: string; render: Page }> = {
    dashboard: { label: "Dashboard", icon: "layout", render: renderDashboard },
    orders: { label: "Orders", icon: "receipt", render: renderOrders },
    products: { label: "Products", icon: "package", render: renderProducts },
    customers: { label: "Customers", icon: "users", render: renderCustomers },
    kiosks: { label: "Kiosks", icon: "monitor", render: renderKiosks },
};

let cleanup: (() => void) | void;
let shellChannel: ReturnType<typeof sb.channel> | null = null;

// ---------------------------------------------------------------- login

function renderLogin(message = ""): void {
    root.innerHTML = `
      <div class="login">
        <div class="art">
          <div class="seal">${sealSVG(false)}</div>
          <span class="brand">RAISE</span>
          <div><h1>Store admin</h1><p>Products and prices, live orders, customers and their cards, and every kiosk on the floor.</p></div>
          <span></span>
        </div>
        <form id="login" autocomplete="on">
          <h2>Sign in</h2>
          ${message ? `<p class="err">${esc(message)}</p>` : ""}
          <div><label class="label" for="email">Email</label><input class="field" id="email" type="email" required autocomplete="username"></div>
          <div><label class="label" for="password">Password</label><input class="field" id="password" type="password" required autocomplete="current-password"></div>
          <button class="btn btn--primary btn--lg" type="submit">${icon("log-in")} Sign in</button>
          <p class="hint">Admin accounts are created with <code>npm run create-admin</code>.</p>
        </form>
      </div>`;
    const form = document.getElementById("login") as HTMLFormElement;
    form.onsubmit = async (e) => {
        e.preventDefault();
        const btn = form.querySelector("button")!;
        btn.disabled = true;
        const { error } = await sb.auth.signInWithPassword({
            email: (document.getElementById("email") as HTMLInputElement).value.trim(),
            password: (document.getElementById("password") as HTMLInputElement).value,
        });
        btn.disabled = false;
        if (error) renderLogin(error.message === "Invalid login credentials" ? "Wrong email or password." : error.message);
    };
}

// ---------------------------------------------------------------- shell

async function renderShell(email: string): Promise<void> {
    root.innerHTML = `
      <div class="shell">
        <header class="top">
          <div class="brand"><b>RAISE</b><span>Admin</span></div>
          <div class="store" id="store-status"><span class="dot"></span><span>Checking kiosks…</span></div>
          <span class="grow"></span>
          <span class="who">${esc(email)}</span>
          <button class="theme-btn" id="theme-btn" type="button"></button>
          <button class="bar-btn" id="sign-out" type="button">${icon("log-out")} Sign out</button>
        </header>
        <nav class="nav" aria-label="Admin sections">
          ${Object.entries(ROUTES).map(([key, r]) => `<a href="#/${key}" data-route="${key}">${icon(r.icon)}${r.label}<span class="count" id="count-${key}"></span></a>`).join("")}
          <div class="sep"></div>
          <a href="${esc((import.meta.env.VITE_KIOSK_URL as string) || "https://raise.bindalvansh01.workers.dev/")}" target="_blank" rel="noopener">${icon("external")}Open kiosk</a>
          <p class="foot">Changes to products and prices reach kiosks within a minute.</p>
        </nav>
        <main class="main" id="page" tabindex="-1"></main>
      </div>`;
    initThemeToggle(document.getElementById("theme-btn")!);
    document.getElementById("sign-out")!.onclick = () => sb.auth.signOut();
    await refreshCounts();
    shellChannel?.unsubscribe();
    shellChannel = sb.channel("shell")
        .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => refreshCounts())
        .on("postgres_changes", { event: "*", schema: "public", table: "kiosks" }, () => refreshCounts())
        .subscribe();
    setInterval(refreshCounts, 30_000);  // kiosks go "offline" without any row changing
    route();
}

async function refreshCounts(): Promise<void> {
    const [pending, products, customers, kiosks] = await Promise.all([
        sb.from("orders").select("id", { count: "exact", head: true }).eq("status", "pending"),
        sb.from("products").select("id", { count: "exact", head: true }).eq("active", true),
        sb.from("customers").select("id", { count: "exact", head: true }),
        sb.from("kiosks").select("id, name, active, last_seen, info, created_at"),
    ]);
    const set = (id: string, text: string, hot = false) => {
        const el = document.getElementById(id);
        if (el) { el.textContent = text; el.classList.toggle("hot", hot); }
    };
    set("count-orders", pending.count ? `${pending.count} open` : "", !!pending.count);
    set("count-products", String(products.count ?? ""));
    set("count-customers", String(customers.count ?? ""));
    const ks = (kiosks.data ?? []) as Kiosk[];
    const live = ks.filter((k) => k.active && isOnline(k)).length;
    const active = ks.filter((k) => k.active).length;
    set("count-kiosks", ks.length ? `${live}/${active}` : "", live > 0);
    const store = document.getElementById("store-status");
    if (store) {
        store.innerHTML = !active
            ? `<span class="dot"></span><span>No kiosks set up yet</span>`
            : `<span class="dot ${live === active ? "on" : live ? "warn" : ""}"></span><span>${live} of ${active} kiosk${active > 1 ? "s" : ""} online</span>`;
    }
}

async function route(): Promise<void> {
    const key = location.hash.replace(/^#\/?/, "") || "dashboard";
    const r = ROUTES[key] ?? ROUTES.dashboard;
    document.querySelectorAll<HTMLAnchorElement>(".nav a[data-route]").forEach((a) => {
        if (a.dataset.route === key) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    document.title = `${r.label} · RAISE Admin`;
    if (typeof cleanup === "function") cleanup();
    const page = document.getElementById("page")!;
    page.innerHTML = "";
    cleanup = await r.render(page);
}
window.addEventListener("hashchange", () => { if (document.getElementById("page")) route(); });

// ---------------------------------------------------------------- auth

async function boot(): Promise<void> {
    const { data } = await sb.auth.getSession();
    await onSession(data.session?.user ?? null);
    sb.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_IN" || event === "SIGNED_OUT") onSession(session?.user ?? null);
    });
}

let shownFor: string | null = null;
let loginMessage = "";
async function onSession(user: { id: string; email?: string } | null): Promise<void> {
    if (!user) { shownFor = null; renderLogin(loginMessage); loginMessage = ""; return; }
    if (shownFor === user.id) return;
    const { data: ok } = await sb.rpc("is_admin");
    if (!ok) {
        loginMessage = "That account isn't a store admin.";
        await sb.auth.signOut();
        return;
    }
    shownFor = user.id;
    await renderShell(user.email ?? "");
}

boot();
