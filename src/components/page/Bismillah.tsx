interface BismillahProps {
  text: string;
}

export default function Bismillah({ text }: BismillahProps) {
  return (
    <div
      className="w-full text-center font-arabic text-2xl text-slate-300 my-4 py-3 px-6 rounded-lg border border-slate-700 leading-loose"
      dir="rtl"
    >
      {text}
    </div>
  );
}
