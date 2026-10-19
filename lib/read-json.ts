// Client-safe. A platform timeout or crash returns an HTML page instead of the API's JSON;
// turn that into a readable error instead of "Unexpected token '<'".
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`The server did not answer properly (HTTP ${res.status}). Please try again.`);
  }
}
