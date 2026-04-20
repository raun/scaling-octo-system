"use client";

import {
  useRef,
  useState,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from "react";

export interface XTerminalHandle {
  write: (data: string) => void;
  writeln: (data: string) => void;
  clear: () => void;
  getTerminal: () => null;
  setInteractive: (interactive: boolean) => void;
}

interface TerminalLine {
  id: number;
  text: string;
  isCommand: boolean;
  isError: boolean;
}

/**
 * Simple DOM-based terminal that renders output as styled divs.
 * More reliable than xterm.js canvas rendering in flex layouts.
 */
export const XTerminal = forwardRef<XTerminalHandle>(
  function XTerminal(_props, ref) {
    const [lines, setLines] = useState<TerminalLine[]>([]);
    const [interactive, setInteractive] = useState(false);
    const [inputValue, setInputValue] = useState("");
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const lineIdRef = useRef(0);
    const onDataCallback = useRef<((data: string) => void) | null>(null);

    // Auto-scroll to bottom when new lines appear
    useEffect(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, [lines]);

    const addLine = useCallback(
      (text: string, isCommand = false, isError = false) => {
        const id = ++lineIdRef.current;
        setLines((prev) => [...prev, { id, text, isCommand, isError }]);
      },
      []
    );

    const handleInputSubmit = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && inputValue.trim()) {
          const cmd = inputValue;
          setInputValue("");
          addLine(`$ ${cmd}`, true);
          onDataCallback.current?.("\r");
        }
      },
      [inputValue, addLine]
    );

    useImperativeHandle(ref, () => ({
      write(data: string) {
        // Strip ANSI escape codes for display
        const clean = data.replace(/\x1b\[[0-9;]*m/g, "");
        // Check if this contains error markers
        const isError = data.includes("\x1b[31m") || data.includes("Error") || data.includes("Traceback");

        // Split by newlines and add each line
        const parts = clean.split(/\r?\n/);
        for (const part of parts) {
          if (part.length > 0) {
            addLine(part, false, isError);
          }
        }
      },
      writeln(data: string) {
        const clean = data.replace(/\x1b\[[0-9;]*m/g, "");
        const isCommand = clean.startsWith("$");
        addLine(clean, isCommand);
      },
      clear() {
        setLines([]);
        lineIdRef.current = 0;
      },
      getTerminal() {
        return null;
      },
      setInteractive(value: boolean) {
        setInteractive(value);
        if (value) {
          setTimeout(() => inputRef.current?.focus(), 50);
        }
      },
    }));

    return (
      <div
        className="h-full flex flex-col"
        style={{ backgroundColor: "#0d1117" }}
      >
        {/* Scrollable output area */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-3 font-mono text-base leading-relaxed"
        >
          {lines.length === 0 && (
            <div className="text-[#484f58]">
              Terminal output will appear here...
            </div>
          )}
          {lines.map((line) => (
            <div
              key={line.id}
              className={
                line.isCommand
                  ? "text-[#58a6ff]"
                  : line.isError
                    ? "text-[#ff7b72]"
                    : "text-[#c9d1d9]"
              }
              style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}
            >
              {line.text}
            </div>
          ))}
        </div>

        {/* Interactive input (only shown in interactive mode) */}
        {interactive && (
          <div className="flex items-center gap-2 border-t border-[#21262d] px-4 py-2">
            <span className="text-[#3fb950] font-mono text-base">$</span>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleInputSubmit}
              className="flex-1 bg-transparent font-mono text-base text-[#c9d1d9] outline-none placeholder-[#484f58]"
              placeholder="Type a command..."
              autoFocus
            />
          </div>
        )}
      </div>
    );
  }
);
