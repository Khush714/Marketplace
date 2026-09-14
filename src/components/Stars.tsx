export function Stars({
  rating,
  size = "sm",
}: {
  rating: number;
  size?: "sm" | "md";
}) {
  const rounded = Math.round(rating * 2) / 2;
  const cls = size === "md" ? "text-base" : "text-sm";
  return (
    <span className={`inline-flex items-center gap-0.5 ${cls} leading-none`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = i <= Math.floor(rounded);
        const half = !filled && i - 0.5 === rounded;
        return (
          <span key={i} className={filled || half ? "text-ember-400" : "text-white/15"}>
            {half ? "◐" : "★"}
          </span>
        );
      })}
    </span>
  );
}