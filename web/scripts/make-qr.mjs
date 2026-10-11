// QR codes for the README: node web/scripts/make-qr.mjs <site url> <apk url>
import QRCode from "qrcode";
import { fileURLToPath } from "node:url";

const [site, apk] = process.argv.slice(2);
if (!site || !apk) {
  console.error("usage: node web/scripts/make-qr.mjs <site url> <apk url>");
  process.exit(1);
}
const docs = fileURLToPath(new URL("../../docs/", import.meta.url));
const opts = { width: 480, margin: 2, color: { dark: "#0b5d66", light: "#ffffff" } };
await QRCode.toFile(docs + "qr-site.png", site, opts);
await QRCode.toFile(docs + "qr-apk.png", apk, opts);
console.log("docs/qr-site.png, docs/qr-apk.png");
