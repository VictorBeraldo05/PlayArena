export class ApiRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export async function apiRequestWithMeta<T>(path: string, token: string, init: RequestInit = {}): Promise<{ data: T; status: number }> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new ApiRequestError(body?.detail ?? 'Nao foi possivel concluir esta operacao.', response.status);
  }

  if (response.status === 204) {
    return { data: undefined as T, status: response.status };
  }

  return { data: await response.json() as T, status: response.status };
}

export async function apiRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  return (await apiRequestWithMeta<T>(path, token, init)).data;
}
