import type { RegistryRecord, TransitionEvent } from "./types";
export interface WorkspaceData {
  events: TransitionEvent[];
  records: RegistryRecord[];
  region: string;
  profile: { name: string; email: string };
  version: number;
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response
    .json()
    .catch(() => ({ error: "Backend unavailable. Start the API server." }));
  if (!response.ok)
    throw Object.assign(new Error(data.error || "Request failed"), {
      status: response.status,
    });
  return data;
}
