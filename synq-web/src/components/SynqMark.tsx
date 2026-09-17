import React from 'react';

/**
 * The Synq mark: two nodes joined by an S-curve — a conversation and a
 * repository on one branch, and the S of the name.
 *
 * `glyph` inherits currentColor for inline use; `badge` sets it in an accent
 * tile so it reads as the product mark rather than as another toolbar icon.
 */
export default function SynqMark({
  className = 'w-5 h-5',
  variant = 'glyph',
}: {
  className?: string;
  variant?: 'glyph' | 'badge';
}) {
  const glyph = (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={variant === 'badge' ? 'w-[62%] h-[62%]' : className}>
      <path d="M6.5 17.5C6.5 11.5 17.5 12.5 17.5 6.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="6.5" cy="17.5" r="3" fill="currentColor" />
      <circle cx="17.5" cy="6.5" r="3" fill="currentColor" />
    </svg>
  );

  if (variant === 'glyph') return glyph;

  return (
    <span
      aria-hidden="true"
      className={`${className} inline-grid place-items-center rounded-[28%] bg-gradient-to-br from-accent-bright to-accent text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] shrink-0`}
    >
      {glyph}
    </span>
  );
}
