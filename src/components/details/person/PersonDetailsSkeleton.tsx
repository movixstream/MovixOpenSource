import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/utils';
import { DETAILS_GRID, DETAILS_PHONE_SCROLL } from '../layout';

/** Bloc gris aux dimensions données par ses classes. */
function Bone({ className, radius = '!rounded-lg' }: { className?: string; radius?: string }) {
  return (
    <span className={cn('block', className)}>
      <Skeleton height="100%" className={radius} />
    </span>
  );
}

/**
 * Squelette de la page d'une personne : mêmes boîtes que `DetailsHero`
 * (hauteurs, colonne du bas à gauche), la barre de sections, puis « À
 * propos » et « Connu pour ». Le haut reste noir : l'image n'est pas encore
 * connue, et un gris à sa place clignoterait à son arrivée.
 */
export function PersonDetailsSkeleton() {
  return (
    <div className="min-h-screen bg-black pb-24 text-white" aria-busy="true">
      <section className="relative md:flex md:min-h-[560px] md:items-end xl:min-h-[680px] min-[1440px]:min-h-[760px] 2xl:min-h-[820px] min-[1700px]:min-h-[900px]">
        <div className={cn(DETAILS_GRID, 'relative w-full md:pb-9 md:pt-[120px]')}>
          <div className="flex min-h-[520px] flex-col justify-end gap-3 pb-0.5 pt-20 md:min-h-0 md:max-w-[680px] md:gap-[18px] md:p-0 2xl:gap-[22px]">
            <Bone className="aspect-[4/5] w-[104px] md:w-[160px] 2xl:w-[184px]" radius="!rounded-2xl" />
            <div className="flex gap-1.5 md:gap-2">
              <Bone className="h-[26px] w-[74px] md:h-7 md:w-[84px]" radius="!rounded-full" />
              <Bone className="h-[26px] w-[56px] md:h-7 md:w-[64px]" radius="!rounded-full" />
            </div>
            <Bone className="h-[33px] w-[62%] max-w-[360px] md:h-[52px] 2xl:h-[66px]" />
            <Bone className="h-[18px] w-[78%] max-w-[420px] md:h-[22px]" radius="!rounded" />
            <div className="hidden space-y-2 md:block">
              <Bone className="h-[18px] w-[560px] max-w-full" radius="!rounded" />
              <Bone className="h-[18px] w-[520px] max-w-full" radius="!rounded" />
              <Bone className="h-[18px] w-[340px] max-w-full" radius="!rounded" />
            </div>
            <Bone className="hidden h-[54px] w-[260px] md:block" radius="!rounded-[14px]" />
          </div>
          <Bone className="mt-4 h-14 w-full md:hidden" radius="!rounded-[14px]" />
        </div>
      </section>

      <div className="h-[22px] md:h-0" />
      <div className="h-14 border-b border-white/[.12]">
        <div className={cn(DETAILS_GRID, 'flex h-full items-center gap-6')}>
          <Bone className="h-4 w-16" radius="!rounded" />
          <Bone className="h-4 w-20" radius="!rounded" />
          <Bone className="h-4 w-24" radius="!rounded" />
        </div>
      </div>

      <div className={DETAILS_GRID}>
        <div className="grid gap-9 pt-[22px] lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-[72px]">
          <div className="hidden space-y-3 md:block">
            <Bone className="mb-[22px] h-7 w-40" />
            {['w-full', 'w-[96%]', 'w-[92%]', 'w-full', 'w-[70%]'].map((width, index) => (
              <Bone key={index} className={cn('h-[18px]', width)} radius="!rounded" />
            ))}
          </div>
          <div className="border-t border-white/[.12]">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="flex justify-between gap-5 border-b border-white/[.12] py-3 md:py-[13px]">
                <Bone className="h-4 w-24" radius="!rounded" />
                <Bone className="h-4 w-32" radius="!rounded" />
              </div>
            ))}
          </div>
        </div>

        <div className="pt-[34px] md:pt-16 2xl:pt-20">
          <Bone className="mb-3.5 h-6 w-36 md:mb-[22px] md:h-7" />
          <div className={cn(DETAILS_PHONE_SCROLL, 'md:grid md:grid-cols-4 md:gap-x-4 xl:grid-cols-8')}>
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className={cn('w-[124px] flex-none md:w-auto', index >= 4 && 'hidden xl:block')}>
                <Bone className="aspect-[2/3] w-full" radius="!rounded-xl" />
                <Bone className="mt-2.5 h-4 w-[80%]" radius="!rounded" />
                <Bone className="mt-1.5 h-3.5 w-[60%]" radius="!rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default PersonDetailsSkeleton;
