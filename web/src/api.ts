import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      msg = body.error ?? body.message ?? msg;
    } catch {
      /* body was not JSON */
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

export async function getJSON<T>(path: string): Promise<T> {
  return handle<T>(await fetch(path, { headers: { accept: "application/json" } }));
}

export async function postJSON<T>(path: string, body: unknown): Promise<T> {
  return handle<T>(await fetch(path, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) }));
}

export interface ApiState<T> {
  data: T | null;
  error: ApiError | Error | null;
  loading: boolean;
  reload: () => void;
}

export function useApi<T>(path: string | null, pollMs = 0): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    const run = () => {
      setLoading(true);
      getJSON<T>(path)
        .then((d) => { if (alive) { setData(d); setError(null); } })
        .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e : new Error(String(e))); })
        .finally(() => { if (alive) setLoading(false); });
    };
    run();
    const id = pollMs > 0 ? window.setInterval(run, pollMs) : 0;
    return () => { alive = false; if (id) window.clearInterval(id); };
  }, [path, pollMs, nonce]);
  return { data, error, loading, reload };
}

export const isNotFound = (e: unknown): boolean => e instanceof ApiError && e.status === 404;
