import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
if (!url || !anonKey) throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in app/.env.local");

export const sb = createClient(url, anonKey);

export interface Customer { id: string; name: string; phone: string | null; pass_id: string; points: number; blocked: boolean }
export interface Product { id: string; barcode: string; title: string; brand: string; price: number; image_url: string }
export interface Order {
    id: string; number: number; status: "pending" | "paid" | "cancelled"; total: number; item_count: number;
    points_earned: number; created_at: string; paid_at: string | null;
}

/** Calls the `pass` Edge Function with the signed-in session. */
export async function passApi<T>(body: Record<string, unknown>): Promise<T> {
    const { data, error } = await sb.functions.invoke("pass", { body });
    if (error) {
        let message = error.message;
        try { message = (await (error as { context?: Response }).context?.json())?.error ?? message; } catch { /* keep generic */ }
        throw new Error(message);
    }
    return data as T;
}

export const formatPass = (id: string) => id.replace(/(.{4})(.{4})(.*)/, "$1-$2-$3");
export const POINTS_RULE = "1 point for every ₹10";
