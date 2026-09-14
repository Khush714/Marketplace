import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { StarIcon } from "./icons";

type Variant = "primary" | "secondary" | "ghost" | "outline";

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-ember-500 text-ink-950 hover:bg-ember-400 shadow-[0_8px_30px_rgba(255,122,26,0.3)]",
  secondary: "bg-white/10 text-white hover:bg-white/15 border border-white/10",
  ghost: "text-white/70 hover:text-white hover:bg-white/5",
  outline: "border border-white/15 text-white hover:bg-white/5",
};

type ButtonProps = {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  className?: string;
  children: ReactNode;
} & (
  | ({ href: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">)
  | ({ href?: undefined } & ButtonHTMLAttributes<HTMLButtonElement>)
);

export function Button(props: ButtonProps) {
  const {
    variant = "primary",
    size = "md",
    className = "",
    children,
    ...rest
  } = props;

  const sizeClasses = {
    sm: "h-9 px-4 text-sm",
    md: "h-11 px-6 text-sm",
    lg: "h-13 px-8 text-base",
  }[size];

  const base = `inline-flex items-center justify-center gap-2 rounded-2xl font-semibold tracking-tight transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none ${variantClasses[variant]} ${sizeClasses} ${className}`;

  if ("href" in props && props.href !== undefined) {
    return (
      <Link href={props.href} className={base} {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {children}
      </Link>
    );
  }

  return (
    <button className={base} {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}>
      {children}
    </button>
  );
}

export function Badge({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/80 ${className}`}
    >
      {children}
    </span>
  );
}

export function RatingStars({
  rating,
  size = 16,
}: {
  rating: number;
  size?: number;
}) {
  return (
    <span className="inline-flex items-center gap-0.5 text-ember-400">
      <StarIcon style={{ width: size, height: size, fill: "currentColor" }} />
      <span className="ml-1 text-sm font-semibold text-white">
        {rating.toFixed(1)}
      </span>
    </span>
  );
}

export function PriceLevelDots({ level }: { level: number }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${level} out of 3 price`}>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${
            i <= level ? "bg-ember-400" : "bg-white/20"
          }`}
        />
      ))}
    </span>
  );
}