import { getRaw, type Settings } from "./github";

const TYPES: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", csv: "text/csv", txt: "text/plain", ofx: "text/plain", qfx: "text/plain",
};

/** Ouvre un justificatif du dépôt privé dans un nouvel onglet (sans le rendre public). */
export async function openDocument(s: Settings, path: string) {
  const win = window.open("", "_blank"); // ouvert de suite pour éviter le bloqueur de popups
  const res = await getRaw(s, path);
  if (!res) {
    win?.close();
    throw new Error(`Fichier introuvable : ${path}`);
  }
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const blob = new Blob([await res.arrayBuffer()], { type: TYPES[ext] ?? "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  if (win) win.location.href = url;
  else window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
