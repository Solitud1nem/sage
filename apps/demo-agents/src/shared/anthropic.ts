/**
 * Minimal Anthropic Messages API client (M12.1.6, raw fetch — same style and
 * throw-semantics as `worker/llm.ts`: any API/HTTP/shape failure THROWS and
 * the caller's retry machinery deals with it).
 *
 * Lives in `src/shared/` because both bundles need it: the generic worker
 * (builder / copywriter / qa-judge handlers) and the orchestrator (council).
 *
 * Scope is deliberately small: single user turn (+optional PNG), optional
 * structured output via `output_config.format` json_schema — which
 * guarantees schema-valid JSON instead of parse-and-hope. Opus 4.8 / Sonnet
 * 4.6 surface: no temperature/top_p (removed), no prefill, thinking omitted
 * (off by default on 4.8; keeps latency predictable for non-streaming calls).
 */

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export const ANTHROPIC_MODELS = {
  /** Frontier executor — the builder's design+code pass (M12.1.6). */
  opus: 'claude-opus-4-8',
  /** Copywriter / QA judge / council (judge-class rule: ≤1 class below executor). */
  sonnet: 'claude-sonnet-4-6',
} as const;

export interface AnthropicChatOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number;
  /**
   * JSON Schema for structured output (`output_config.format`). The response
   * text is guaranteed schema-valid JSON. Objects must carry
   * `additionalProperties: false` per API requirements.
   */
  readonly jsonSchema?: Record<string, unknown>;
  /** Optional PNG attached to the user turn (base64, no data: prefix). */
  readonly imagePngB64?: string;
  /** Test seam. */
  readonly fetchImpl?: typeof fetch;
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string;
  error?: { message?: string };
}

export async function anthropicChat(opts: AnthropicChatOptions): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch;

  const userContent = opts.imagePngB64
    ? [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: opts.imagePngB64 },
        },
        { type: 'text', text: opts.user },
      ]
    : opts.user;

  const res = await fetchImpl(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: [{ role: 'user', content: userContent }],
      ...(opts.jsonSchema
        ? { output_config: { format: { type: 'json_schema', schema: opts.jsonSchema } } }
        : {}),
    }),
  });

  // Same CR.2 discipline as the OpenAI client: the API returns `{error}`
  // without `content` on 4xx/5xx — never cast blindly.
  const data = (await res.json().catch(() => null)) as AnthropicResponse | null;
  if (!res.ok || data?.error) {
    throw new Error(`Anthropic error: ${data?.error?.message ?? `HTTP ${res.status}`}`);
  }
  if (data?.stop_reason === 'refusal') {
    throw new Error('Anthropic error: request refused by safety classifiers');
  }
  if (data?.stop_reason === 'max_tokens') {
    throw new Error('Anthropic error: output truncated at max_tokens');
  }
  const text = (data?.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
  if (!text) {
    throw new Error('Anthropic returned no text content');
  }
  return text;
}
