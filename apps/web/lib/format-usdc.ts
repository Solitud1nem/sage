/**
 * Single source of truth for rendering settlement-token base-unit amounts
 * as human-readable strings.
 *
 * Input is a decimal string of base units. Default posture is USDC
 * (6 decimals, " USDC" suffix); chains whose settlement token differs pass
 * a `settlement` override — Monad settles in WMON at 18 decimals
 * (ADR-0026, `settlementOf(chainId)` in chains/base.ts). The formatter
 * scales the representation based on magnitude so a half-token plan and a
 * "the LLM hallucinated and emitted 5e23" plan both render legibly:
 *
 *   |  Amount (tokens)      |  Output (USDC default) |
 *   |-----------------------|------------------------|
 *   |  0.5                  |  0.500 USDC            |
 *   |  12.345               |  12.345 USDC           |
 *   |  1234.567             |  1,234.57 USDC         |
 *   |  1_500_000            |  1.50M USDC            |
 *   |  2_300_000_000        |  2.30B USDC            |
 *
 * On parse failure (non-digit input, decimal point, scientific notation)
 * returns the raw string unchanged — the caller decides whether to flag
 * it.
 */

export interface Settlement {
  symbol: string;
  decimals: number;
}

const USDC_DEFAULT: Settlement = { symbol: 'USDC', decimals: 6 };

export function formatUsdc(baseUnits: string | bigint, settlement: Settlement = USDC_DEFAULT): string {
  const { symbol, decimals } = settlement;
  const tenPow = 10n ** BigInt(decimals);

  let amt: bigint;
  if (typeof baseUnits === 'bigint') {
    amt = baseUnits;
  } else {
    if (!/^-?\d+$/.test(baseUnits)) return baseUnits;
    try {
      amt = BigInt(baseUnits);
    } catch {
      return baseUnits;
    }
  }

  const negative = amt < 0n;
  const absAmt = negative ? -amt : amt;
  const whole = absAmt / tenPow;
  const fracBase = absAmt % tenPow;
  const sign = negative ? '-' : '';

  // < 1 token: show 3 frac digits.
  // < 1_000 tokens: still 3 frac digits, readable.
  if (whole < 1_000n) {
    const fracStr = fracBase.toString().padStart(decimals, '0').slice(0, 3);
    return `${sign}${whole.toString()}.${fracStr} ${symbol}`;
  }

  // < 1_000_000 tokens: comma-separated whole + 2 frac.
  if (whole < 1_000_000n) {
    const whole2 = numberWithCommas(whole);
    const fracStr = fracBase.toString().padStart(decimals, '0').slice(0, 2);
    return `${sign}${whole2}.${fracStr} ${symbol}`;
  }

  // Larger: pick scale suffix and show with 2 significant frac digits.
  const tiers: Array<{ scale: bigint; suffix: string }> = [
    { scale: 1_000_000_000_000_000n, suffix: 'P' },
    { scale: 1_000_000_000_000n, suffix: 'T' },
    { scale: 1_000_000_000n, suffix: 'B' },
    { scale: 1_000_000n, suffix: 'M' },
  ];
  for (const { scale, suffix } of tiers) {
    if (whole >= scale) {
      const scaled = (whole * 100n) / scale;
      const scaledWhole = scaled / 100n;
      const scaledFrac = scaled % 100n;
      return `${sign}${scaledWhole.toString()}.${scaledFrac.toString().padStart(2, '0')}${suffix} ${symbol}`;
    }
  }

  // Should be unreachable — covers anything above 1M.
  const fracStr = fracBase.toString().padStart(decimals, '0').slice(0, 2);
  return `${sign}${numberWithCommas(whole)}.${fracStr} ${symbol}`;
}

function numberWithCommas(n: bigint): string {
  const s = n.toString();
  // BigInt — insert commas every 3 digits from the right.
  const parts: string[] = [];
  let i = s.length;
  while (i > 3) {
    parts.unshift(s.slice(i - 3, i));
    i -= 3;
  }
  parts.unshift(s.slice(0, i));
  return parts.join(',');
}
