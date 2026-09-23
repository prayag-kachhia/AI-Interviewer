import type { z } from "zod";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

// Every API response is validated against its shared contract before the UI sees it.
export async function getJson<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed with ${res.status}`);
  return schema.parse(await res.json());
}
