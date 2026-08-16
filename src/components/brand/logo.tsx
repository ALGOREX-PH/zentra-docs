import { cn } from '@/lib/cn';
import { ZentraMark, type ZentraTone } from './zentra-mark';

interface LogoProps {
  size?: number;
  tone?: ZentraTone;
  className?: string;
}

/** The horizontal lockup used in the nav and footer: mark + ZENTRA wordmark. */
export function Logo({ size = 26, tone = 'primary', className }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      {/* the wordmark beside it already carries the name, so the mark is decorative */}
      <ZentraMark size={size} tone={tone} />
      <span className="font-display text-[15px] font-bold tracking-[0.04em] text-fd-foreground">
        ZENTRA
      </span>
    </span>
  );
}
