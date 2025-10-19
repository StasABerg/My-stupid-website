interface StatusFooterProps {
  isLoading: boolean;
  isError: boolean;
  visibleCount: number;
  totalCount?: number;
  cacheSource?: string | null;
  updatedAt?: string;
  origin?: string | null;
}

const StatusFooter = ({
  isLoading,
  isError,
  visibleCount,
  totalCount,
  cacheSource,
  updatedAt,
  origin,
}: StatusFooterProps) => (
  <footer className="mt-6 border-t border-terminal-green/30 pt-3 text-[0.65rem] text-terminal-white/70">
    {isLoading && <p>Scanning the dial…</p>}
    {isError && <p className="text-terminal-red">Failed to reach the station directory.</p>}
    {!isLoading && !isError && totalCount !== undefined && (
      <div className="space-y-1">
        <p>
          Displaying {visibleCount} of {totalCount} stations · Cache: {cacheSource ?? "unknown"}
        </p>
        {updatedAt && <p>Last refresh: {updatedAt}</p>}
        {origin && <p>Radio Browser source: {origin}</p>}
      </div>
    )}
  </footer>
);

export default StatusFooter;
