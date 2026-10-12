// Shared helpers for the RAISE Edge Functions.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-kiosk-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

export class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
}

/** Service-role client: bypasses row-level security. Server-side only. */
export function admin(): SupabaseClient {
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(text: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", enc.encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- RAISE Pass v2
//
// QR content: RAISE2.<pass_id>.<signature>
//   pass_id    opaque 10-char ID (no name, phone or points in the QR)
//   signature  HMAC-SHA256(PASS_SECRET, "raise-pass-v2:" + pass_id), first 16 bytes, base64url
// The secret never leaves the server, so passes can't be forged from the page code.
// Static by design (printable); revoke by re-issuing the pass_id from the admin panel.

let hmacKey: Promise<CryptoKey> | null = null;
function passKey(): Promise<CryptoKey> {
    const secret = Deno.env.get("PASS_SECRET");
    if (!secret || secret.length < 32) throw new HttpError(500, "PASS_SECRET is not configured");
    hmacKey ??= crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return hmacKey;
}

async function passSignature(passId: string): Promise<string> {
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await passKey(), enc.encode("raise-pass-v2:" + passId)));
    return b64url(mac.slice(0, 16));
}

export async function issuePassToken(passId: string): Promise<string> {
    return `RAISE2.${passId}.${await passSignature(passId)}`;
}

/** Returns the pass_id if the token is genuine, else null. Constant-time compare. */
export async function verifyPassToken(token: unknown): Promise<string | null> {
    const m = /^RAISE2\.([0-9A-Z]{10})\.([A-Za-z0-9_-]{22})$/.exec(String(token ?? "").trim());
    if (!m) return null;
    const expected = await passSignature(m[1]);
    if (expected.length !== m[2].length) return null;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ m[2].charCodeAt(i);
    return diff === 0 ? m[1] : null;
}

/** Card UIDs are stored only as sha256("raise-nfc:" + uid) - same scheme as the kiosk. */
export function isUidHash(v: unknown): v is string {
    return typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
}

export const POINTS_PER_RUPEE = 1 / 10; // 1 point for every ₹10 paid
