// Main SecureTerminal component
export { default as SecureTerminal } from "./SecureTerminal";

// Subcomponents
export { default as TerminalWindow } from "./components/TerminalWindow";
export { default as TerminalHeader } from "./components/TerminalHeader";
export { default as TerminalOutput } from "./components/TerminalOutput";
export { default as TerminalInput } from "./components/TerminalInput";
export { default as TerminalPrompt } from "./components/TerminalPrompt";
export { default as TerminalCursor } from "./components/TerminalCursor";
export { default as TerminalBannerLine } from "./components/TerminalBannerLine";
export { default as TerminalOutputLine } from "./components/TerminalOutputLine";
export { default as TerminalHistoryEntry } from "./components/TerminalHistoryEntry";

// Custom hook
export { useTerminal } from "../../hooks/use-terminal";