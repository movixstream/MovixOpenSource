import { Skeleton } from '@/components/ui/Skeleton';

/** Géométrie commune à SearchGridCard et aux affiches d'EmblaCarousel. */
const MediaCardSkeleton = () => (
  <div className="relative rounded-xl overflow-hidden bg-white/5 border border-white/10" aria-hidden="true">
    <Skeleton variant="poster" className="!rounded-none" />
    <div className="absolute top-2 left-2">
      <div className="h-[23px] w-12 rounded-lg bg-[#2a2a2a]" />
    </div>
    <div className="absolute top-2 right-2 md:hidden">
      <div className="h-8 w-8 rounded-full bg-[#2a2a2a]" />
    </div>
    <div className="absolute bottom-0 inset-x-0 p-3 md:hidden bg-gradient-to-t from-black via-black/60 to-transparent">
      <div className="mb-1 h-5 w-3/4 rounded bg-[#1a1a1a]" />
      <div className="flex gap-2 mb-1">
        <span className="h-4 w-9 rounded bg-[#1a1a1a]" />
        <span className="h-4 w-8 rounded bg-[#1a1a1a]" />
      </div>
      <div className="space-y-1 py-0.5">
        <div className="h-3 w-full rounded bg-[#1a1a1a]" />
        <div className="h-3 w-full rounded bg-[#1a1a1a]" />
        <div className="h-3 w-[70%] rounded bg-[#1a1a1a]" />
      </div>
    </div>
  </div>
);

export default MediaCardSkeleton;
