/**
 * x402 pay-per-call integration for Sage SDK.
 *
 * Uses @x402/fetch to transparently handle HTTP 402 payment flows.
 * When an agent endpoint returns 402, the SDK automatically signs
 * a payment via the x402 facilitator and retries the request.
 */

import type { Account, LocalAccount } from 'viem';

export interface CallAgentOptions {
  /** Agent endpoint URL. If not provided, looked up from registry. */
  endpoint?: string;
  /** HTTP method (default: POST). */
  method?: string;
  /** Additional HTTP headers. */
  headers?: Record<string, string>;
  /** Request timeout in ms (default: 30000). */
  timeout?: number;
}

export interface CallAgentResult {
  /** HTTP status code of the final response. */
  status: number;
  /** Response body parsed as JSON. */
  data: unknown;
  /** Response headers. */
  headers: Record<string, string>;
}

export interface X402Client {
  /**
   * Call an agent endpoint with automatic x402 payment handling.
   * If the endpoint returns HTTP 402, the SDK signs a payment and retries.
   */
  callAgent(
    agentEndpoint: string,
    payload: unknown,
    options?: CallAgentOptions,
  ): Promise<CallAgentResult>;
}

/**
 * Create an x402 client for pay-per-call agent interactions.
 *
 * @param account - viem LocalAccount for signing payments.
 * @param chainNetwork - EIP-155 network identifier (e.g. "eip155:8453" for Base).
 */
export function createX402Client(
  account: Account,
  chainNetwork: string,
): X402Client {
  return {
    async callAgent(agentEndpoint, payload, options = {}) {
      // Dynamic import to keep x402 as optional at bundle level
      const { wrapFetchWithPaymentFromConfig } = await import('@x402/fetch');
      const { ExactEvmScheme } = await import('@x402/evm');

      const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
        schemes: [
          {
            network: chainNetwork as `${string}:${string}`,
            client: new ExactEvmScheme(account as LocalAccount),
          },
        ],
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        options.timeout ?? 30_000,
      );

      try {
        const response = await fetchWithPayment(agentEndpoint, {
          method: options.method ?? 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...options.headers,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        const data = await response.json();

        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });

        return {
          status: response.status,
          data,
          headers,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}
