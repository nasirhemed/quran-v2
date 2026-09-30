interface HighlightedAyahProps {
  /** The verse's words as the page data segments them (a word can hold a space before its waqf mark). */
  words: string[];
  /** 1-indexed [from, to] word ranges to emphasize. */
  ranges?: [number, number][];
  className?: string;
}

/**
 * Renders an ayah with the given 1-indexed word ranges highlighted.
 */
export default function HighlightedAyah({ words, ranges, className }: HighlightedAyahProps) {
  const cls = className ?? "font-arabic text-xl leading-loose text-ink";
  if (!ranges || ranges.length === 0) {
    return (
      <p dir="rtl" lang="ar" className={cls}>
        {words.join(" ")}
      </p>
    );
  }

  const marked = new Set<number>();
  for (const [from, to] of ranges) {
    for (let i = from; i <= to; i++) marked.add(i);
  }

  return (
    <p dir="rtl" lang="ar" className={cls}>
      {words.map((word, i) => (
        <span key={i}>
          <span
            className={
              marked.has(i + 1)
                ? "bg-primary-soft text-primary rounded px-0.5"
                : undefined
            }
          >
            {word}
          </span>
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </p>
  );
}
