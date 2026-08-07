// Next.js shows this immediately on navigation while the dashboard layout's
// async work (auth + profile + shop lookup) and any server-rendered page's
// data fetch are still in flight, instead of leaving the browser sitting on
// the old screen with no feedback. Applies to every /dashboard/* route.
export default function DashboardLoading() {
  return (
    <div className="min-h-screen">
      <div className="border-b border-chalk/10">
        <div className="max-w-4xl mx-auto px-5 py-4 flex items-center justify-between gap-3">
          <div className="h-6 w-32 rounded bg-board3 animate-pulse" />
          <div className="h-6 w-20 rounded-full bg-board3 animate-pulse" />
        </div>
        <div className="max-w-4xl mx-auto px-5 flex gap-2 pb-3">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="h-7 w-20 rounded-full bg-board3 animate-pulse" />
          ))}
        </div>
      </div>
      <div className="max-w-4xl mx-auto px-5 py-6 space-y-3">
        <div className="h-24 rounded-2xl bg-board2 border border-chalk/10 animate-pulse" />
        <div className="h-24 rounded-2xl bg-board2 border border-chalk/10 animate-pulse" />
        <div className="h-24 rounded-2xl bg-board2 border border-chalk/10 animate-pulse" />
      </div>
    </div>
  );
}
