export type ApiResponse<T> =
  | { success: true; data: T; meta?: Record<string, unknown> }
  | { success: false; error: string; details?: unknown }

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  })
  const payload = (await response.json()) as ApiResponse<T>
  if (!payload.success) {
    throw new Error(payload.error)
  }
  return payload.data
}
