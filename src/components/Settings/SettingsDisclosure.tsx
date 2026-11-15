import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { useLightMode } from '@/context/LightModeContext';

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

interface SettingsDisclosureProps {
  title: string;
  children: ReactNode;
  className?: string;
  triggerClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClosed?: () => void;
}

function DisclosureContent({ id, duration, children }: { id: string; duration: number; children: ReactNode }) {
  const present = useIsPresent();
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    // Keep the exit visible without leaving its inputs reachable by Tab.
    if (ref.current) ref.current.inert = !present;
  }, [present]);

  return (
    <motion.div
      ref={ref}
      id={`${id}-content`}
      role="region"
      aria-labelledby={`${id}-trigger`}
      aria-hidden={!present || undefined}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit="collapsed"
      variants={{
        collapsed: (exitDuration: number) => ({
          height: 0, opacity: 0, transition: { duration: exitDuration, ease: EASE_OUT },
        }),
      }}
      transition={{ duration, ease: EASE_OUT }}
      className="min-w-0 overflow-hidden"
    >
      {children}
    </motion.div>
  );
}

export function SettingsDisclosure({
  title, children, className, triggerClassName = '', open, onOpenChange, onClosed,
}: SettingsDisclosureProps) {
  const id = useId();
  const { effectivePrefs } = useLightMode();
  const [localOpen, setLocalOpen] = useState(false);
  const [pointerToggle, setPointerToggle] = useState(true);
  const expanded = open ?? localOpen;
  const duration = effectivePrefs.transitions && pointerToggle ? 0.2 : 0;

  return (
    <div className={className}>
      <button
        id={`${id}-trigger`}
        type="button"
        aria-expanded={expanded}
        aria-controls={`${id}-content`}
        onClick={(event) => {
          setPointerToggle(event.detail !== 0);
          setLocalOpen(!expanded);
          onOpenChange?.(!expanded);
        }}
        className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg text-left text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${triggerClassName}`}
      >
        <span>{title}</span>
        <ChevronDown
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-gray-400"
          style={{
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: `transform ${duration}s cubic-bezier(${EASE_OUT.join(',')})`,
          }}
        />
      </button>
      <AnimatePresence initial={false} custom={duration} onExitComplete={() => { if (!expanded) onClosed?.(); }}>
        {expanded && <DisclosureContent key="content" id={id} duration={duration}>{children}</DisclosureContent>}
      </AnimatePresence>
    </div>
  );
}
