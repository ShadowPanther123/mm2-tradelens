import type { ItemRarity } from "@/types";
import { capitalise } from "@/utils/format";
import { cn } from "@/utils/cn";

const RARITY_STYLES: Record<ItemRarity, string> = {
  common: "bg-slate-500/20 text-slate-300",
  uncommon: "bg-emerald-500/20 text-emerald-300",
  rare: "bg-sky-500/20 text-sky-300",
  legendary: "bg-amber-500/20 text-amber-300",
  godly: "bg-orange-500/20 text-orange-300",
  ancient: "bg-fuchsia-500/20 text-fuchsia-300",
  unique: "bg-rose-500/20 text-rose-300",
  vintage: "bg-teal-500/20 text-teal-300",
  chroma:
    "bg-gradient-to-r from-rose-400/30 via-emerald-400/30 to-sky-400/30 text-white",
  pet: "bg-lime-500/20 text-lime-300",
  misc: "bg-zinc-500/20 text-zinc-300",
};

export function RarityBadge({ rarity }: { rarity: ItemRarity }) {
  return (
    <span className={cn("chip", RARITY_STYLES[rarity])}>{capitalise(rarity)}</span>
  );
}
