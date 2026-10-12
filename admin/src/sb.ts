import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
if (!url || !anonKey) throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in admin/.env.local");

export const sb = createClient(url, anonKey);

/** Where kiosks load the RAISE self-checkout from (used to build kiosk setup links). */
export const KIOSK_URL = (import.meta.env.VITE_KIOSK_URL as string) || "https://raise.bindalvansh01.workers.dev/";

export interface Product {
    id: string; barcode: string; title: string; brand: string; price: number;
    image_url: string; stock: number | null; active: boolean; updated_at: string;
}
export interface Customer {
    id: string; name: string; phone: string | null; pass_id: string; points: number; blocked: boolean;
    created_via: string; created_at: string; user_id: string | null;
    nfc_cards: { count: number }[]; orders: { count: number }[];
}
export interface Order {
    id: string; number: number; status: "pending" | "paid" | "cancelled"; total: number; item_count: number;
    points_earned: number; created_at: string; paid_at: string | null;
    customers: { name: string } | null; kiosks: { name: string } | null;
}
export interface Kiosk {
    id: string; name: string; active: boolean; last_seen: string | null; created_at: string;
    info: { camera?: string; resolution?: string; stage?: string; version?: string; nfc?: boolean };
}

/** A kiosk counts as online if it sent a heartbeat in the last 90 seconds. */
export const isOnline = (k: Kiosk): boolean => !!k.last_seen && Date.now() - new Date(k.last_seen).getTime() < 90_000;
