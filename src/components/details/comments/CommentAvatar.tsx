import { cn } from '@/lib/utils';

export interface CommentAvatarProps {
  /** Nom du profil : sa première lettre sert d'image par défaut. */
  name: string;
  /** Image du profil, si elle existe. */
  src?: string | null;
  /** `md` : commentaire et champ de saisie. `sm` : réponse. */
  size?: 'md' | 'sm';
  className?: string;
}

const SIZES = {
  md: 'size-9 rounded-[11px] text-sm md:size-10 md:rounded-xl md:text-[15px]',
  sm: 'size-8 rounded-[10px] text-[13px]',
} as const;

/** Vignette d'un auteur : carré aux coins arrondis, image ou initiale. */
export function CommentAvatar({ name, src, size = 'md', className }: CommentAvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex flex-none select-none items-center justify-center overflow-hidden bg-white/[.12] font-bold text-white',
        SIZES[size],
        className,
      )}
    >
      {src
        ? <img src={src} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
        : (name.trim().charAt(0).toUpperCase() || '?')}
    </span>
  );
}

export default CommentAvatar;
