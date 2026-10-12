// Create (or promote) an admin account for the RAISE admin panel.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-admin.mjs you@example.com 'password'
//
// The service-role key stays on your machine; it is never put in any app.
import { createClient } from "@supabase/supabase-js";

const [email, password] = process.argv.slice(2);
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!email || !password || !url || !key) {
    console.error("Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-admin.mjs <email> <password>");
    process.exit(1);
}
if (password.length < 8) {
    console.error("Use a password of at least 8 characters.");
    process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// app_metadata.role = "admin" is server-only; the signup trigger turns it into an admins row.
const { data, error } = await db.auth.admin.createUser({
    email, password, email_confirm: true, app_metadata: { role: "admin" },
});
let userId = data?.user?.id;
if (error) {
    if (!/already/i.test(error.message)) { console.error(error.message); process.exit(1); }
    const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
    userId = list.users.find((u) => u.email === email)?.id;
    if (!userId) { console.error("User exists but couldn't be found."); process.exit(1); }
    await db.auth.admin.updateUserById(userId, { password, app_metadata: { role: "admin" } });
}
const { error: e2 } = await db.from("admins").upsert({ user_id: userId });
if (e2) { console.error(e2.message); process.exit(1); }
// Auth sets app_metadata just after inserting the user, so the signup trigger may have made a
// customer record for this account. Admins don't need one.
await db.from("customers").delete().eq("user_id", userId);
console.log(`Admin ready: ${email}`);
