export interface Settings {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

export const WORKFLOW_FILE = "process.yml";

export class GitHubError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function headers(s: Settings, accept = "application/vnd.github+json"): HeadersInit {
  return { Authorization: `Bearer ${s.token}`, Accept: accept, "X-GitHub-Api-Version": "2022-11-28" };
}

const base = (s: Settings) => `https://api.github.com/repos/${s.owner}/${s.repo}`;
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

async function check(res: Response): Promise<Response> {
  if (res.ok) return res;
  let msg = res.statusText;
  try {
    msg = (await res.json()).message ?? msg;
  } catch {
    /* corps vide */
  }
  const hint =
    res.status === 401 ? " — jeton invalide ou expiré" : res.status === 403 ? " — droits insuffisants sur le jeton" : "";
  throw new GitHubError(res.status, `GitHub ${res.status} : ${msg}${hint}`);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const utf8ToBase64 = (s: string) => bytesToBase64(new TextEncoder().encode(s));
const base64ToUtf8 = (b: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, "")), (c) => c.charCodeAt(0)));

export async function testConnection(s: Settings): Promise<string> {
  const res = await check(await fetch(base(s), { headers: headers(s), cache: "no-store" }));
  const repo = await res.json();
  if (!repo.private) return `Connecté à ${repo.full_name} — ⚠️ ce dépôt est PUBLIC`;
  return `Connecté à ${repo.full_name} (privé)`;
}

/** Lecture brute (jusqu'à 100 Mo) — pour ledger.json et les justificatifs. null si absent. */
export async function getRaw(s: Settings, path: string): Promise<Response | null> {
  const res = await fetch(`${base(s)}/contents/${enc(path)}?ref=${encodeURIComponent(s.branch)}`, {
    headers: headers(s, "application/vnd.github.raw+json"),
    cache: "no-store",
  });
  if (res.status === 404) return null;
  return check(res);
}

export async function getJsonRaw<T>(s: Settings, path: string): Promise<T | null> {
  const res = await getRaw(s, path);
  return res ? ((await res.json()) as T) : null;
}

/** Lecture avec sha (fichiers < 1 Mo) — pour les écritures avec contrôle de concurrence. */
export async function getJsonWithSha<T>(s: Settings, path: string): Promise<{ data: T; sha: string } | null> {
  const res = await fetch(`${base(s)}/contents/${enc(path)}?ref=${encodeURIComponent(s.branch)}`, {
    headers: headers(s),
    cache: "no-store",
  });
  if (res.status === 404) return null;
  const json = await (await check(res)).json();
  return { data: JSON.parse(base64ToUtf8(json.content)) as T, sha: json.sha };
}

export async function putFile(
  s: Settings,
  path: string,
  contentBase64: string,
  message: string,
  sha?: string,
): Promise<void> {
  await check(
    await fetch(`${base(s)}/contents/${enc(path)}`, {
      method: "PUT",
      headers: { ...headers(s), "Content-Type": "application/json" },
      body: JSON.stringify({ message, content: contentBase64, branch: s.branch, sha }),
    }),
  );
}

export const putJson = (s: Settings, path: string, value: unknown, message: string, sha?: string) =>
  putFile(s, path, utf8ToBase64(JSON.stringify(value, null, 2) + "\n"), message, sha);

/** Lance immédiatement la passe d'analyse (workflow_dispatch). */
export async function dispatchWorkflow(s: Settings): Promise<void> {
  await check(
    await fetch(`${base(s)}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
      method: "POST",
      headers: { ...headers(s), "Content-Type": "application/json" },
      body: JSON.stringify({ ref: s.branch }),
    }),
  );
}

export interface RunInfo {
  status: string; // queued | in_progress | completed
  conclusion: string | null;
  created_at: string;
  html_url: string;
}

export async function latestRun(s: Settings): Promise<RunInfo | null> {
  const res = await fetch(`${base(s)}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=1`, {
    headers: headers(s),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.workflow_runs?.[0] ?? null;
}
