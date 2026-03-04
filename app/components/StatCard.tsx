interface StatCardProps {
  title: string;
  value: string;
  sub?: string;
  positive?: boolean;
}

export default function StatCard({ title, value, sub, positive }: StatCardProps) {
  return (
    <div className="bg-slate-50 rounded-xl px-4 py-2 border border-slate-100">
      <p className="text-xs font-medium text-slate-400 uppercase tracking-wide leading-tight">{title}</p>
      <p className="text-base font-bold text-slate-900 leading-tight">{value}</p>
      {sub && (
        <p className={`text-xs font-semibold ${positive ? "text-emerald-500" : "text-red-500"}`}>
          {sub}
        </p>
      )}
    </div>
  );
}
