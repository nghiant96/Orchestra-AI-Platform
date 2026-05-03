const DASHBOARD_SERVER_TOKEN =
  String(import.meta.env.VITE_AI_SYSTEM_SERVER_TOKEN || import.meta.env.VITE_SERVER_TOKEN || "").trim();

export function apiHeaders(headers?: HeadersInit): Headers {
  const next = new Headers(headers);
  if (DASHBOARD_SERVER_TOKEN) {
    next.set("Authorization", `Bearer ${DASHBOARD_SERVER_TOKEN}`);
  }
  return next;
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, {
    ...init,
    headers: apiHeaders(init?.headers)
  });
}

export async function apiJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await apiFetch(input, init);
  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(String((payload as { error?: string } | null)?.error || `HTTP ${response.status}`));
  }
  return payload as T;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
