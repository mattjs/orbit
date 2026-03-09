const colors: Record<string, string> = {
  executing: "bg-green-500/20 text-green-400",
  thinking: "bg-blue-500/20 text-blue-400",
  waiting: "bg-yellow-500/20 text-yellow-400",
  idle: "bg-gray-500/20 text-gray-400",
};

export function StatusBadge({ status }: { status: string }) {
  const cls = colors[status] ?? colors.idle;
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}
