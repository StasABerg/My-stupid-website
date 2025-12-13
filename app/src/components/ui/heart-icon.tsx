interface HeartIconProps {
  filled?: boolean;
  className?: string;
  onClick?: () => void;
  'aria-label'?: string;
}

export const HeartIcon = ({
  filled = false,
  className = '',
  onClick,
  'aria-label': ariaLabel
}: HeartIconProps) => {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      aria-label={ariaLabel}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
};
