import { forwardRef } from "react";

interface TerminalInputProps {
  promptLabel: string;
  input: string;
  onInputChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  disabled: boolean;
}

const TerminalInput = forwardRef<HTMLInputElement, TerminalInputProps>(
  ({ promptLabel, input, onInputChange, onKeyDown, onSubmit, disabled }, ref) => {
    return (
      <form
        onSubmit={onSubmit}
        className="flex items-center gap-2 border-t-2 border-terminal-green px-3 py-2 text-terminal-white"
      >
        <label htmlFor="secure-terminal-input" className="sr-only">
          Terminal input
        </label>
        <div className="flex items-center gap-1 text-xs sm:text-sm">
          <span className="text-terminal-cyan">{promptLabel}</span>
          <span className="text-terminal-white">$</span>
        </div>
        <input
          ref={ref}
          id="secure-terminal-input"
          className="flex-1 bg-transparent text-terminal-yellow focus:outline-none caret-terminal-green"
          autoComplete="off"
          spellCheck={false}
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Sandbox terminal input"
          disabled={disabled}
        />
      </form>
    );
  }
);

TerminalInput.displayName = "TerminalInput";

export default TerminalInput;
