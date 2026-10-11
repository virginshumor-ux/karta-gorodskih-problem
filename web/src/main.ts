import "./styles/style.css";
import "./styles/extra.css";
import { registerSW } from "virtual:pwa-register";
import { LocalBackend } from "./api/localBackend";
import { SupabaseBackend } from "./api/supabaseBackend";
import { start } from "./app";
import { hasServer } from "./config";
import { toast } from "./ui/dom";

// Crash-free goal (≥ 98 %): an unexpected error never leaves a blank screen.
addEventListener("error", (e) => {
  console.error(e.error ?? e.message);
});
addEventListener("unhandledrejection", (e) => {
  console.error(e.reason);
  toast("Что-то пошло не так. Повторите действие.");
});

void start(hasServer() ? new SupabaseBackend() : new LocalBackend());

if ("serviceWorker" in navigator && location.protocol === "https:") registerSW({ immediate: true });
