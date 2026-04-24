import { ImageResponse } from 'next/og';

export const dynamic = 'force-static';
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

/**
 * Favicon — solid purple rounded square, matches the `sage` wordmark logo.
 * Same colour as `--ck-accent-color` / purple-500 in tokens.css.
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#A78BFA',
          width: '100%',
          height: '100%',
          borderRadius: 8,
        }}
      />
    ),
    size,
  );
}
