import { GoogleAuth } from "google-auth-library";
import { writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Source optionnelle : récupère les fichiers déposés dans un dossier Google Drive
 * (ex. scans faits avec l'appli Drive mobile) vers inbox/, puis les déplace dans
 * le dossier « Traités ». Activée si GDRIVE_SERVICE_ACCOUNT_JSON et
 * GDRIVE_INBOX_FOLDER_ID sont définis (secrets GitHub).
 */
export async function pullFromDrive(inboxDir: string): Promise<number> {
  const creds = process.env.GDRIVE_SERVICE_ACCOUNT_JSON;
  const inbox = process.env.GDRIVE_INBOX_FOLDER_ID;
  const done = process.env.GDRIVE_DONE_FOLDER_ID;
  if (!creds || !inbox) return 0;

  const auth = new GoogleAuth({
    credentials: JSON.parse(creds),
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const api = "https://www.googleapis.com/drive/v3/files";
  const q = encodeURIComponent(
    `'${inbox}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
  );
  const list = await auth.fetch<{ files: { id: string; name: string; mimeType: string }[] }>(
    `${api}?q=${q}&fields=files(id,name,mimeType)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true`,
  );

  let count = 0;
  for (const f of list.data.files) {
    const isGoogleDoc = f.mimeType.startsWith("application/vnd.google-apps.");
    const url = isGoogleDoc
      ? `${api}/${f.id}/export?mimeType=application/pdf`
      : `${api}/${f.id}?alt=media&supportsAllDrives=true`;
    const res = await auth.fetch<ArrayBuffer>({ url, responseType: "arraybuffer" });
    const name = `drive-${f.id.slice(0, 8)}-${f.name.replace(/[^\w.\-]+/g, "_")}${isGoogleDoc ? ".pdf" : ""}`;
    await writeFile(path.join(inboxDir, name), Buffer.from(res.data));
    if (done) {
      await auth.fetch(`${api}/${f.id}?addParents=${done}&removeParents=${inbox}&supportsAllDrives=true`, {
        method: "PATCH",
      });
    }
    count++;
  }
  return count;
}
