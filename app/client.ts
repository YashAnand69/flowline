export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch('/api/' + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    credentials: 'same-origin',
  });
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new Error('The server is unavailable. Please try again in a moment.');
  }
  if (!response.ok)
    throw new ApiError(
      data.error || 'The request could not be completed.',
      response.status,
    );
  return data;
}
export const post = (body: unknown) => ({
  method: 'POST',
  body: JSON.stringify(body),
});
export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export const relative = (date: string) => {
  const secs = Math.max(0, (Date.now() - Date.parse(date)) / 1000);
  return secs < 60
    ? 'Just now'
    : secs < 3600
      ? `${Math.floor(secs / 60)}m ago`
      : secs < 86400
        ? `${Math.floor(secs / 3600)}h ago`
        : new Date(date).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          });
};
