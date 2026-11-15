import React from 'react';
import { motion } from 'framer-motion';
import { Star } from 'lucide-react';
import { cn } from '../lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

interface FavoriteStarButtonProps {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
  onToggle: (event: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  iconClassName?: string;
}

interface FavoriteStarPillButtonProps extends FavoriteStarButtonProps {
  activeText: string;
  inactiveText: string;
}

export const FavoriteStarIconButton: React.FC<FavoriteStarButtonProps> = ({
  active,
  activeLabel,
  inactiveLabel,
  onToggle,
  className,
  iconClassName,
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <motion.button
        type="button"
        onClick={onToggle}
        whileTap={{ scale: 0.7 }}
        className={cn(
          'flex items-center justify-center rounded-full transition-all duration-200',
          active
            ? 'bg-yellow-500/20 border border-yellow-400/30 text-yellow-400'
            : 'bg-black/40 border border-white/10 text-white hover:bg-black/60',
          className
        )}
      >
        <motion.div
          key={active ? 'on' : 'off'}
          initial={{ scale: 0.3, rotate: -45 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 15 }}
        >
          <Star
            className={cn('w-4 h-4 transition-colors duration-150', iconClassName)}
            fill={active ? 'currentColor' : 'none'}
          />
        </motion.div>
      </motion.button>
    </TooltipTrigger>
    <TooltipContent>{active ? activeLabel : inactiveLabel}</TooltipContent>
  </Tooltip>
);

export const FavoriteStarPillButton: React.FC<FavoriteStarPillButtonProps> = ({
  active,
  activeLabel,
  inactiveLabel,
  activeText,
  inactiveText,
  onToggle,
  className,
  iconClassName,
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <motion.button
        type="button"
        onClick={onToggle}
        whileTap={{ scale: 0.96 }}
        className={cn(
          'group/icon inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-all duration-200',
          active
            ? 'border-yellow-400/30 bg-yellow-500/12 text-yellow-300'
            : 'border-white/10 bg-white/5 text-white/70 hover:border-purple-500/35 hover:bg-purple-500/10 hover:text-white',
          className
        )}
      >
        <motion.div
          key={active ? 'on' : 'off'}
          initial={{ scale: 0.3, rotate: -45 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 15 }}
        >
          <Star
            className={cn(
              'w-4 h-4 transition-[color,opacity] duration-150',
              active ? 'text-yellow-300' : 'text-white opacity-70 group-hover/icon:opacity-100',
              iconClassName,
            )}
            fill={active ? 'currentColor' : 'none'}
          />
        </motion.div>
        <span>{active ? activeText : inactiveText}</span>
      </motion.button>
    </TooltipTrigger>
    <TooltipContent>{active ? activeLabel : inactiveLabel}</TooltipContent>
  </Tooltip>
);
