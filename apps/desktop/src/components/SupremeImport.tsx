/**
 * SupremeValues source status. Its current terms prohibit copying value-list
 * data into applications, including by manual entry, so TradeLens only enables
 * this source through an explicitly authorised partner/API feed.
 */
export function SupremeSourceStatus() {
  return (
    <section className="card flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Supreme Values source</h2>
        <span className="chip border border-amber-400/30 bg-amber-400/10 text-amber-200">
          Permission required
        </span>
      </div>
      <p className="text-xs text-slate-500">
        The integration is ready for a feed that SupremeValues has explicitly authorised
        TradeLens to use. No SupremeValues data is bundled, scraped, pasted, or imported
        until that permission and feed are provided.
      </p>
      <a
        className="w-fit text-xs text-accent hover:underline"
        href="https://supremevalues.com/tos"
        target="_blank"
        rel="noreferrer"
      >
        Review SupremeValues terms
      </a>
    </section>
  );
}
