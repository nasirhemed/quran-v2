interface HighlightedAyahProps {
  text: string;
  /** 1-indexed [from, to] word ranges to emphasize. */
  ranges?: [number, number][];
  className?: string;
}

/**
 * Renders an ayah with the given word ranges highlighted. Word positions in
 * the phrase/similarity data are 1-indexed against the same segmentation the
 * page data uses, so a plain space split lines up.
 */
export default function HighlightedAyah({ text, ranges, className }: HighlightedAyahProps) {
  const cls = className ?? "font-arabic text-xl leading-loose text-ink";
  if (!ranges || ranges.length === 0) {
    return (
      <p dir="rtl" lang="ar" className={cls}>
        {text}
      </p>
    );
  }

  const marked = new Set<number>();
  for (const [from, to] of ranges) {
    for (let i = from; i <= to; i++) marked.add(i);
  }

  const words = text.split(" ");
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
