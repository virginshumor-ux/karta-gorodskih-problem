// Builds the site for e2e and serves it. Mode "local" = standalone demo backend (no server env),
// mode "server" = built against the Supabase from VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (CI: `supabase start`).
import { build, preview } from "vite";

const [mode = "local", port = "4173"] = process.argv.slice(2);
if (mode === "local") {
  process.env.VITE_SUPABASE_URL = "";
  process.env.VITE_SUPABASE_ANON_KEY = "";
}
const outDir = `dist-e2e-${mode}`;
await build({ logLevel: "warn", build: { outDir, sourcemap: false } });
const server = await preview({ build: { outDir }, preview: { port: Number(port), strictPort: true, host: "127.0.0.1" } });
server.printUrls();
