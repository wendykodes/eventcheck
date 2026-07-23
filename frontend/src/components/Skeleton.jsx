export function SkeletonCard({ lines = 2 }) {
  return (
    <div className="card-flat p-5 space-y-3">
      <div className="skeleton h-5 w-3/4" />
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton h-3.5" style={{ width: `${85 - i * 15}%` }} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5 }) {
  return (
    <div className="space-y-1">
      <div className="flex gap-4 px-4 py-3">
        {[35, 22, 10, 14, 8, 8, 8].map((w, i) => (
          <div key={i} className="skeleton h-3" style={{ width: `${w}%` }} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 px-4 py-3.5">
          {[35, 22, 10, 14, 8, 8, 8].map((w, i) => (
            <div key={i} className="skeleton h-3.5" style={{ width: `${w}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonStat({ count = 4 }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card-flat p-4 space-y-2">
          <div className="skeleton h-7 w-14" />
          <div className="skeleton h-3 w-20" />
          <div className="skeleton h-2.5 w-16" />
        </div>
      ))}
    </div>
  );
}
