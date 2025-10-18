interface StatusFooterProps {
  isLoading: boolean;
  isError: boolean;
  visibleCount: number;
  totalCount?: number;
  cacheSource?: string | null;
}

const StatusFooter = ({ isLoading, isError, visibleCount, totalCount, cacheSource }: StatusFooterProps) => (
  <footer className="mt-10 text-center text-xs text-terminal-white/60">
    {isLoading && <p>Scanning the dial…</p>}
    {isError && <p className="text-terminal-red">Failed to reach the station directory.</p>}
    {!isLoading && !isError && totalCount !== undefined && (
      <p>
        Showing {visibleCount} of {totalCount} stations · Cache source: {cacheSource ?? "unknown"}
      </p>
    )}
  </footer>
);

export default StatusFooter;
