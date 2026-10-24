// Génère les icônes PWA à partir de public/favicon.svg : node scripts/icons.mjs
import sharp from "sharp";
const svg = await import("node:fs/promises").then((fs) => fs.readFile("public/favicon.svg"));
await sharp(svg).resize(192, 192).png().toFile("public/pwa-192.png");
await sharp(svg).resize(512, 512).png().toFile("public/pwa-512.png");
await sharp(svg).resize(180, 180).png().toFile("public/apple-touch-icon.png");
// Maskable : contenu dans la zone sûre (80 %) sur fond plein.
const inner = await sharp(svg).resize(400, 400).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#2a78d6" } })
  .composite([{ input: inner, top: 56, left: 56 }]).png().toFile("public/pwa-maskable-512.png");
console.log("Icônes générées");
