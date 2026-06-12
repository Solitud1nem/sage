/**
 * Minimal OpenAI chat helper for generic-worker handlers (M12.1.1).
 *
 * Error semantics differ from the legacy workers ON PURPOSE: the legacy
 * agents return error TEXT so their completeTask still settles (CR.2). In
 * the generic worker that settle-with-honest-failure step lives in
 * `executor.ts` (retry → `Task failed: …`), so this helper THROWS on any
 * API/HTTP/shape failure and lets the executor's retry machinery do its job.
 */

export interface ChatOptions {
  readonly apiKey: string;
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number;
  readonly model?: string;
  readonly temperature?: number;
  /** Ask the API for a JSON object response (builder's manifest). */
  readonly json?: boolean;
  /**
   * Optional PNG attached to the user message (base64, no data: prefix) —
   * the QA judge inspects the rendered screenshot (M12.1.5).
   */
  readonly imagePngB64?: string;
  /** Test seam. */
  readonly fetchImpl?: typeof fetch;
}

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';

export async function chat(opts: ChatOptions): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_MODEL,
      messages: [
        { role: 'system', content: opts.system },
        {
          role: 'user',
          content: opts.imagePngB64
            ? [
                { type: 'text', text: opts.user },
                {
                  type: 'image_url',
                  // detail high: 'low' downscales to 512px — the QA judge
                  // called a properly styled page "unstyled, system fonts"
                  // (false-fail on run 4973fc63, M12.1.5 control).
                  image_url: { url: `data:image/png;base64,${opts.imagePngB64}`, detail: 'high' },
                },
              ]
            : opts.user,
        },
      ],
      max_tokens: opts.maxTokens,
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });

  // OpenAI returns `{error}` without `choices` on 429/5xx — never cast blindly
  // (CR.2 lesson).
  const data = (await res.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  } | null;
  if (!res.ok || data?.error) {
    throw new Error(`OpenAI error: ${data?.error?.message ?? `HTTP ${res.status}`}`);
  }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI returned no content');
  }
  return content;
}
