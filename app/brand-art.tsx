type BrandTone = "on-light" | "on-dark";

function classes(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function BrandMark({
  className,
  tone = "on-light",
}: {
  className?: string;
  tone?: BrandTone;
}) {
  return (
    <span className={classes("brand-art", "brand-art-mark", `is-${tone}`, className)} aria-hidden="true">
      <img src="/brand/mark.svg" alt="" draggable={false} />
    </span>
  );
}

export function BrandLockup({
  className,
  tone = "on-light",
}: {
  className?: string;
  tone?: BrandTone;
}) {
  return (
    <span className={classes("brand-art", "brand-art-lockup", `is-${tone}`, className)} aria-hidden="true">
      <img src="/brand/lockup.svg" alt="" draggable={false} />
    </span>
  );
}
