import { useEffect, useRef } from "react";
import { useTerminal } from "../../hooks/use-terminal";
import TerminalHeader from "./components/TerminalHeader";
import TerminalOutput from "./components/TerminalOutput";
import TerminalInput from "./components/TerminalInput";

const SecureTerminal = () => {
  const {
    input,
    setInput,
    history,
    displayCwd,
    loading,
    connectionError,
    isSubmitting,
    bannerLines,
    bannerColor,
    handleSubmit,
    handleKeyDown,
  } = useTerminal();

  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusInput = () => {
      inputRef.current?.focus();
    };
    focusInput();
    window.addEventListener("click", focusInput);
    return () => window.removeEventListener("click", focusInput);
  }, []);

  useEffect(() => {
    const node = terminalRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [history, loading, connectionError]);

  const isInputDisabled = loading || isSubmitting;
  return (
    <div
      role="region"
      aria-label="Sandbox terminal"
      className="w-full h-screen bg-black border-2 border-terminal-green font-mono shadow-[0_0_30px_rgba(0,255,0,0.25)] flex flex-col"
    >
      <TerminalHeader displayCwd={displayCwd} />

      <TerminalOutput
        history={history}
        ref={terminalRef}
        bannerLines={bannerLines}
        bannerColor={bannerColor}
      />

      <TerminalInput
        input={input}
        ref={inputRef}
        onSubmit={handleSubmit}
        displayCwd={displayCwd}
        onInputChange={setInput}
        onKeyDown={handleKeyDown}
        disabled={isInputDisabled}
      />
    </div>
  );
};

export default SecureTerminal;
