/**
 * Single source of truth for rendering USDC base-unit amounts as
 * human-readable strings.
 *
 * Input is a decimal string of base units (6 decimals). The output is
 * always a string ending in " USDC". The formatter scales the
 * representation based on magnitude so a half-USDC plan and a "the LLM
 * hallucinated and emitted 5e23" plan both render legibly without 18
 * trailing zeros eating the layout:
 *
 *   |  Amount (USDC)        |  Output                |
 *   |-----------------------|------------------------|
 *   |  0.5                  |  0.500 USDC            |
 *   |  12.345               |  12.345 USDC           |
 *   |  1234.567             |  1,234.57 USDC         |
 *   |  1_500_000            |  1.50M USDC            |
 *   |  2_300_000_000        |  2.30B USDC            |
 *   |  4_700_000_000_000    |  4.70T USDC            |
 *   |  5e17                 |  500.00P USDC          |
 *
 * On parse failure (non-digit input, decimal point, scientific notation)
 * returns the raw string unchanged — the caller decides whether to flag
 * it.
 */

const TEN_POW_6 = 1_000_000n;

export function formatUsdc(baseUnits: string | bigint): string {
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
  const whole = absAmt / TEN_POW_6;
  const fracBase = absAmt % TEN_POW_6;
  const sign = negative ? '-' : '';

  // < 1 USDC: show 3 frac digits.
  // < 1_000 USDC: still 3 frac digits, readable.
  if (whole < 1_000n) {
    const fracStr = fracBase.toString().padStart(6, '0').slice(0, 3);
    return `${sign}${whole.toString()}.${fracStr} USDC`;
  }

  // < 1_000_000 USDC: comma-separated whole + 2 frac.
  if (whole < 1_000_000n) {
    const whole2 = numberWithCommas(whole);
    const fracStr = fracBase.toString().padStart(6, '0').slice(0, 2);
    return `${sign}${whole2}.${fracStr} USDC`;
  }

  // Larger: pick scale suffix and show with 2 significant frac digits.
  const tiers: Array<{ scale: bigint; suffix: string }> = [
    { scale: 1_000_000_000_000_000n, suffix: 'P' }, // peta-USDC (1e15)
    { scale: 1_000_000_000_000n, suffix: 'T' }, // tera-USDC (1e12)
    { scale: 1_000_000_000n, suffix: 'B' }, // giga-USDC (1e9)
    { scale: 1_000_000n, suffix: 'M' }, // mega-USDC (1e6)
  ];
  for (const { scale, suffix } of tiers) {
    if (whole >= scale) {
      // Compute (whole * 100) / scale, then split into integer + 2 frac.
      const scaled = (whole * 100n) / scale;
      const scaledWhole = scaled / 100n;
      const scaledFrac = scaled % 100n;
      return `${sign}${scaledWhole.toString()}.${scaledFrac.toString().padStart(2, '0')}${suffix} USDC`;
    }
  }

  // Should be unreachable — covers anything above 1M.
  const fracStr = fracBase.toString().padStart(6, '0').slice(0, 2);
  return `${sign}${numberWithCommas(whole)}.${fracStr} USDC`;
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
