import { ZentraMark, type ZentraTone } from './zentra-mark';
import { cn } from '@/lib/cn';

interface LogoProps {
  size?: number;
  tone?: ZentraTone;
  showProtocolTag?: boolean;
  className?: string;
}

/** The horizontal lockup used in the nav and footer: mark + ZENTRA wordmark. */
export function Logo({
  size = 26,
  tone = 'primary',
  showProtocolTag = false,
  className,
}: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <ZentraMark size={size} tone={tone} title="Zentra Protocol" />
      <span className="font-display text-[15px] font-bold tracking-[0.04em] text-fd-foreground">
        ZENTRA
      </span>
      {showProtocolTag ? (
        <span className="font-mono text-[10px] tracking-[0.22em] text-cyan">
          // PROTOCOL
        </span>
      ) : null}
    </span>
  );
}
