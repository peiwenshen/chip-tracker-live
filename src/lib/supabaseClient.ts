// src/lib/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  console.error("VITE_SUPABASE_URL is not defined");
  throw new Error("Missing environment variable: VITE_SUPABASE_URL");
}

if (!supabaseAnonKey) {
  console.error("VITE_SUPABASE_ANON_KEY is not defined");
  throw new Error("Missing environment variable: VITE_SUPABASE_ANON_KEY");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default supabase;