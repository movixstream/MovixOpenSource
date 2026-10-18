/**
 * Avatar Group — Animate UI (MIT + Commons Clause), https://animate-ui.com/docs/primitives/animate/avatar-group
 * Source : imskyleen/animate-ui, apps/www/registry/primitives/animate/avatar-group/index.tsx
 *
 * Adaptations Movix :
 * - import depuis `framer-motion` (le paquet `motion` n'est pas installé) ;
 * - l'infobulle maison d'Animate UI est remplacée par l'infobulle Radix
 *   déjà utilisée sur le site (`@/components/ui/tooltip`) ;
 * - `forwardRef`, car React 18 ne transmet pas `ref` comme une prop.
 */
import * as React from 'react';
import { motion, type HTMLMotionProps, type Transition } from 'framer-motion';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type TooltipPlacement = {
  side?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
  align?: 'start' | 'center' | 'end';
  alignOffset?: number;
};

// Chaque avatar porte sa propre infobulle (`AvatarGroupTooltip`) : la position
// choisie sur le groupe lui arrive par ce contexte.
const AvatarPlacementContext = React.createContext<TooltipPlacement>({});

type AvatarProps = Omit<HTMLMotionProps<'div'>, 'translate'> & {
  children: React.ReactNode;
  zIndex: number;
  translate?: string | number;
};

function AvatarContainer({ zIndex, translate, ...props }: AvatarProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.div
          data-slot="avatar-container"
          initial="initial"
          whileHover="hover"
          whileTap="hover"
          style={{ position: 'relative', zIndex }}
        >
          <motion.div
            variants={{
              initial: { y: 0 },
              hover: { y: translate },
            }}
            {...props}
          />
        </motion.div>
      </TooltipTrigger>
    </Tooltip>
  );
}

type AvatarGroupProps = Omit<React.ComponentProps<'div'>, 'translate' | 'ref'> & {
  children: React.ReactElement[];
  invertOverlap?: boolean;
  translate?: string | number;
  transition?: Transition;
  delayDuration?: number;
} & TooltipPlacement;

const AvatarGroup = React.forwardRef<HTMLDivElement, AvatarGroupProps>(function AvatarGroup(
  {
    children,
    transition = { type: 'spring', stiffness: 300, damping: 17 },
    invertOverlap = false,
    translate = '-30%',
    delayDuration = 0,
    side = 'top',
    sideOffset = 10,
    align = 'center',
    alignOffset = 0,
    style,
    ...props
  },
  ref,
) {
  const placement = React.useMemo(
    () => ({ side, sideOffset, align, alignOffset }),
    [side, sideOffset, align, alignOffset],
  );
  return (
    <TooltipProvider delayDuration={delayDuration}>
      <AvatarPlacementContext.Provider value={placement}>
        <div
          ref={ref}
          data-slot="avatar-group"
          style={{
            display: 'flex',
            alignItems: 'center',
            ...style,
          }}
          {...props}
        >
          {children?.map((child, index) => (
            <AvatarContainer
              key={child.key ?? index}
              zIndex={invertOverlap ? React.Children.count(children) - index : index}
              transition={transition}
              translate={translate}
            >
              {child}
            </AvatarContainer>
          ))}
        </div>
      </AvatarPlacementContext.Provider>
    </TooltipProvider>
  );
});

type AvatarGroupTooltipProps = React.ComponentPropsWithoutRef<typeof TooltipContent>;

function AvatarGroupTooltip(props: AvatarGroupTooltipProps) {
  const placement = React.useContext(AvatarPlacementContext);
  return <TooltipContent {...placement} {...props} />;
}

export { AvatarGroup, AvatarGroupTooltip, type AvatarGroupProps, type AvatarGroupTooltipProps };
