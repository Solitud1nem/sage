/**
 * Pluggable task handler — THIS is the file you replace with your agent's
 * real logic. The runtime (`index.ts`) handles registration, task discovery,
 * acceptance, and on-chain completion; all you implement is: given the task
 * instruction (and any material), produce a result string.
 *
 * `spec`     — the instruction (what to do).
 * `material` — the content to apply it to (the original payload for a root
 *              sub-task, or an upstream step's output for a dependent one),
 *              per ADR-0018. `null` when the task carried no separate material.
 *
 * The example below calls OpenAI gpt-4o-mini when `OPENAI_API_KEY` is set, and
 * otherwise returns a trivial deterministic echo so the template runs with zero
 * external dependencies. Swap it for whatever your agent actually does.
 */

export interface Job {
  readonly spec: string;
  readonly material: string | null;
}

export async function execute(job: Job): Promise<string> {
  const apiKey = process.env['OPENAI_API_KEY'];
  const input = job.material ?? job.spec;

  if (!apiKey) {
    // Zero-config fallback. Replace with real logic.
    return `[foreign-agent] handled instruction: ${job.spec}\n\n--- input (first 500 chars) ---\n${input.slice(0, 500)}`;
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are a task executor. Apply the INSTRUCTION to the MATERIAL and return ONLY the deliverable — no preamble, no commentary.',
        },
        { role: 'user', content: `INSTRUCTION:\n${job.spec}\n\nMATERIAL:\n${input}` },
      ],
      max_tokens: 600,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 160)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? 'Result unavailable';
}
