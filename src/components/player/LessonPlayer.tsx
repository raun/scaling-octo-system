"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Lesson, LessonSection, EditEvent } from "@/lib/lessons/types";
import { VirtualFileSystem } from "@/lib/lessons/VirtualFileSystem";
import {
  PlaybackController,
  PlaybackState,
} from "@/lib/lessons/PlaybackController";
import { LessonRuntime } from "@/lib/runtime/interface";
import {
  MonacoEditorComponent,
  MonacoEditorHandle,
} from "./MonacoEditor";
import { XTerminal, XTerminalHandle } from "./XTerminal";
import { FileExplorer } from "./FileExplorer";
import { PlaybackControls } from "./PlaybackControls";

interface LessonPlayerProps {
  lesson: Lesson;
}

export function LessonPlayer({ lesson }: LessonPlayerProps) {
  const editorRef = useRef<MonacoEditorHandle>(null);
  const terminalRef = useRef<XTerminalHandle>(null);
  const controllerRef = useRef<PlaybackController | null>(null);
  const vfsRef = useRef(new VirtualFileSystem());

  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const [currentTime, setCurrentTime] = useState(0);
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);

  // Runtime state
  const runtimeRef = useRef<LessonRuntime | null>(null);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [isInteractive, setIsInteractive] = useState(false);

  const activeFileRef = useRef<string | null>(null);
  // Throttle time updates to avoid excessive re-renders
  const lastTimeUpdateRef = useRef(0);

  // Pre-load the runtime on mount
  useEffect(() => {
    let cancelled = false;
    async function initRuntime() {
      try {
        const { createRuntime } = await import("@/lib/runtime/interface");
        const runtime = createRuntime(
          lesson.language as "python" | "javascript"
        );
        await runtime.initialize();
        if (!cancelled) {
          runtimeRef.current = runtime;
          setRuntimeReady(true);
        }
      } catch (e) {
        console.warn("Runtime initialization failed:", e);
      }
    }
    initRuntime();
    return () => {
      cancelled = true;
    };
  }, [lesson.language]);

  const syncVfsFromEditor = useCallback(() => {
    if (activeFileRef.current && editorRef.current) {
      vfsRef.current.writeFile(
        activeFileRef.current,
        editorRef.current.getContent()
      );
    }
  }, []);

  const switchToFile = useCallback(
    (path: string) => {
      syncVfsFromEditor();
      const content = vfsRef.current.readFile(path);
      if (content !== undefined && editorRef.current) {
        editorRef.current.setContent(content);
      }
      activeFileRef.current = path;
      setActiveFile(path);
    },
    [syncVfsFromEditor]
  );

  // Initialize the playback controller
  useEffect(() => {
    const vfs = vfsRef.current;

    const controller = new PlaybackController(lesson, vfs, {
      onEdit: (path: string, event: EditEvent) => {
        if (path === activeFileRef.current && editorRef.current) {
          editorRef.current.applyEditsAnimated(event.edits, () => {
            vfs.writeFile(path, editorRef.current!.getContent());
          });
        } else {
          const currentContent = vfs.readFile(path) ?? "";
          const newContent = applyEditsToString(currentContent, event.edits);
          vfs.writeFile(path, newContent);
        }
      },
      onFileCreate: (_path: string) => {
        setFiles(vfs.listFiles());
        if (!activeFileRef.current) {
          switchToFile(_path);
        }
      },
      onTerminalInput: (command: string) => {
        terminalRef.current?.writeln(`$ ${command}`);
      },
      onTerminalOutput: (output: string) => {
        terminalRef.current?.write(output);
      },
      onTerminalClear: () => {
        terminalRef.current?.clear();
      },
      onStateChange: (state: PlaybackState) => {
        setPlaybackState(state);
        if (state === "idle") {
          setCurrentTime(0);
          setCurrentSectionIndex(0);
        }
      },
      onSectionChange: (section: LessonSection) => {
        const idx = lesson.sections.findIndex((s) => s.id === section.id);
        if (idx !== -1) setCurrentSectionIndex(idx);
      },
      onTimeUpdate: (time: number) => {
        // Update React state at most every 100ms to avoid excessive re-renders
        const now = performance.now();
        if (now - lastTimeUpdateRef.current >= 100) {
          lastTimeUpdateRef.current = now;
          setCurrentTime(time);
        }
      },
      onActiveFileChange: (path: string) => {
        if (path !== activeFileRef.current) {
          switchToFile(path);
        }
      },
    });

    controllerRef.current = controller;

    const unsubscribe = vfs.onChange(() => {
      setFiles(vfs.listFiles());
    });

    return () => {
      controller.destroy();
      unsubscribe();
    };
  }, [lesson, switchToFile]);

  // Enter interactive mode
  const enterInteractiveMode = useCallback(async () => {
    const runtime = runtimeRef.current;
    const terminal = terminalRef.current;
    if (!runtime || !terminal) return;

    // Sync VFS to runtime
    syncVfsFromEditor();
    await runtime.syncFromVFS(vfsRef.current);

    // Enable terminal input
    terminal.setInteractive(true);

    setIsInteractive(true);
  }, [syncVfsFromEditor]);

  // Exit interactive mode
  const exitInteractiveMode = useCallback(() => {
    // Disable terminal input
    terminalRef.current?.setInteractive(false);

    setIsInteractive(false);
  }, []);

  const handlePlayPause = useCallback(() => {
    if (isInteractive) {
      // Resume from interactive mode — continue from where we paused
      exitInteractiveMode();
      controllerRef.current?.resume();
      return;
    }

    const controller = controllerRef.current;
    if (!controller) return;

    if (playbackState === "playing") {
      editorRef.current?.cancelAnimation();
      controller.pause();
      // Enter interactive mode if runtime is ready
      if (runtimeReady) {
        enterInteractiveMode();
      }
    } else {
      controller.togglePlayPause();
    }
  }, [
    playbackState,
    isInteractive,
    runtimeReady,
    enterInteractiveMode,
    exitInteractiveMode,
  ]);

  const handleSeekToSection = useCallback(
    (index: number) => {
      // Cancel any typing animation before seeking
      editorRef.current?.cancelAnimation();
      if (isInteractive) {
        exitInteractiveMode();
      }
      controllerRef.current?.seekToSection(index);
    },
    [isInteractive, exitInteractiveMode]
  );

  const handleSeekToTime = useCallback(
    (time: number) => {
      editorRef.current?.cancelAnimation();
      if (isInteractive) {
        exitInteractiveMode();
      }
      controllerRef.current?.seekToTime(time);
    },
    [isInteractive, exitInteractiveMode]
  );

  const handleFileSelect = useCallback(
    (path: string) => {
      switchToFile(path);
    },
    [switchToFile]
  );

  // Run button handler for interactive mode
  const handleRun = useCallback(async () => {
    const runtime = runtimeRef.current;
    const editor = editorRef.current;
    if (!runtime || !editor || !activeFileRef.current) return;

    // Read the CURRENT editor content directly (not from VFS cache)
    const currentContent = editor.getContent();
    const filePath = activeFileRef.current;

    // Write latest content to both VFS and runtime
    vfsRef.current.writeFile(filePath, currentContent);
    await runtime.writeFile(filePath, currentContent);

    // Run the file
    const lang = lesson.language;
    let command = "";
    if (lang === "python") {
      command = `python ${filePath}`;
    } else if (lang === "javascript") {
      command = `node ${filePath}`;
    }

    if (command) {
      terminalRef.current?.writeln(`$ ${command}`);
      const result = await runtime.run(command);
      if (result.stdout) {
        terminalRef.current?.write(result.stdout);
      }
      if (result.stderr) {
        terminalRef.current?.write(result.stderr);
      }
    }
  }, [lesson.language]);

  // Fires only when the user physically types — auto-pause and enter interactive mode
  const handleUserType = useCallback(() => {
    if (playbackState !== "playing") return;

    editorRef.current?.cancelAnimation();
    controllerRef.current?.pause();
    if (runtimeReady) {
      enterInteractiveMode();
    }
  }, [playbackState, runtimeReady, enterInteractiveMode]);

  const getButtonLabel = () => {
    if (isInteractive) return "Resume";
    if (playbackState === "playing") return "Pause";
    if (playbackState === "paused") return "Paused";
    return "Play";
  };

  return (
    <div className="flex h-screen flex-col bg-[#1e1e1e]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#333] bg-[#252526] px-5 py-3">
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="flex items-center justify-center rounded-md p-1.5 text-[#888] hover:text-white hover:bg-[#333] transition-colors"
            title="Back to lessons"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </a>
          <h1 className="text-base font-semibold text-[#e0e0e0]">
            {lesson.title}
          </h1>
          {playbackState === "playing" && (
            <span className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
          )}
          {isInteractive && (
            <span className="rounded-full bg-yellow-600 px-3 py-1 text-sm font-medium text-white">
              Interactive Mode
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              runtimeReady ? "bg-green-500" : "bg-yellow-500 animate-pulse"
            }`}
            title={runtimeReady ? "Runtime ready" : "Loading runtime..."}
          />
          <span className="text-sm text-[#888]">
            {runtimeReady ? "Runtime ready" : "Loading runtime..."}
          </span>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* File explorer */}
        <div className="w-48 flex-shrink-0 border-r border-[#333]">
          <FileExplorer
            files={files}
            activeFile={activeFile}
            onFileSelect={handleFileSelect}
          />
        </div>

        {/* Editor + Terminal */}
        <div className="flex flex-1 flex-col">
          {/* Terminal (top) */}
          <div className="h-56 flex-shrink-0 flex flex-col">
            <div className="flex items-center justify-between bg-[#0d1117] border-b border-[#21262d] px-4 py-1.5">
              <span className="text-sm font-semibold text-[#8b949e] uppercase tracking-wide">
                Terminal
              </span>
            </div>
            <div className="flex-1 min-h-0">
              <XTerminal ref={terminalRef} />
            </div>
          </div>

          {/* Editor (bottom) with optional run button */}
          <div className="flex-1 min-h-0 relative border-t border-[#333]">
            <MonacoEditorComponent
              ref={editorRef}
              language={lesson.language}
              readOnly={false}
              onUserType={handleUserType}
            />
            {(isInteractive || playbackState === "paused") && (
              <button
                onClick={handleRun}
                className="absolute top-4 right-4 z-10 flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 transition-colors shadow-lg"
              >
                <RunIcon />
                Run
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Playback controls */}
      {/* Subtitles */}
      {playbackState !== "idle" && (
        <div className="bg-[#181818] border-t border-[#333] px-6 py-3">
          <p className="text-base text-[#d4d4d4] leading-relaxed text-center max-w-3xl mx-auto">
            {lesson.sections[currentSectionIndex]?.narration || ""}
          </p>
        </div>
      )}

      {/* Playback controls */}
      <PlaybackControls
        state={playbackState}
        currentTime={currentTime}
        duration={lesson.totalDuration}
        sections={lesson.sections}
        currentSectionIndex={currentSectionIndex}
        onPlayPause={handlePlayPause}
        onSeekToSection={handleSeekToSection}
        onSeekToTime={handleSeekToTime}
        isInteractive={isInteractive}
        buttonLabel={getButtonLabel()}
      />
    </div>
  );
}

function RunIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
      <path d="M2 1v10l9-5L2 1z" />
    </svg>
  );
}

/**
 * Apply Monaco-style edits to a plain string.
 */
function applyEditsToString(
  content: string,
  edits: EditEvent["edits"]
): string {
  const lines = content.split("\n");

  const sortedEdits = [...edits].sort((a, b) => {
    if (a.range.startLine !== b.range.startLine)
      return b.range.startLine - a.range.startLine;
    return b.range.startCol - a.range.startCol;
  });

  for (const edit of sortedEdits) {
    const { startLine, startCol, endLine, endCol } = edit.range;
    const startIdx = startLine - 1;
    const endIdx = endLine - 1;

    while (lines.length < endLine) {
      lines.push("");
    }

    const startLineContent = lines[startIdx] ?? "";
    const endLineContent = lines[endIdx] ?? "";

    const before = startLineContent.substring(0, startCol - 1);
    const after = endLineContent.substring(endCol - 1);

    const newText = before + edit.text + after;
    const newLines = newText.split("\n");

    lines.splice(startIdx, endIdx - startIdx + 1, ...newLines);
  }

  return lines.join("\n");
}
