interface TerminalBannerLineProps {
  line: string;
  color: string;
}

function TerminalBannerLine({ line, color }: TerminalBannerLineProps) {
  return (
    <p className={color}>
      {line}
    </p>
  );
}

export default TerminalBannerLine;
