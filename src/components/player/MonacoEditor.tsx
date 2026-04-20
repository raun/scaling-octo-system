"use client";

import { useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import Editor, { OnMount } from "@monaco-editor/react";
import type { editor as monacoEditor } from "monaco-editor";

const TYPING_SPEED_MS = 25; // milliseconds per character

export interface MonacoEditorHandle {
  applyEdits: (
    edits: {
      range: {
        startLine: number;
        startCol: number;
        endLine: number;
        endCol: number;
      };
      text: string;
    }[]
  ) => void;
  applyEditsAnimated: (
    edits: {
      range: {
        startLine: number;
        startCol: number;
        endLine: number;
        endCol: number;
      };
      text: string;
    }[],
    onComplete?: () => void
  ) => void;
  cancelAnimation: () => void;
  setContent: (content: string) => void;
  getContent: () => string;
  setReadOnly: (readOnly: boolean) => void;
}

interface MonacoEditorProps {
  language: string;
  readOnly?: boolean;
  onContentChange?: (content: string) => void;
  /** Fires only on real user keyboard input, never on programmatic edits */
  onUserType?: () => void;
}

export const MonacoEditorComponent = forwardRef<
  MonacoEditorHandle,
  MonacoEditorProps
>(function MonacoEditorComponent({ language, readOnly = true, onContentChange, onUserType }, ref) {
  const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
  const animationRef = useRef<number | null>(null);
  const onUserTypeRef = useRef(onUserType);
  onUserTypeRef.current = onUserType;

  const handleMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
    // Detect user keyboard input that would modify content
    editor.onKeyDown((e) => {
      // Ignore pure navigation/modifier keys
      const isModifier =
        e.keyCode === 0 || // Unknown
        e.keyCode === 4 || // Ctrl
        e.keyCode === 5 || // Shift
        e.keyCode === 6 || // Alt
        e.keyCode === 57; // Meta
      const isNavigation =
        (e.keyCode >= 12 && e.keyCode <= 18) || // arrows, home, end, pageup, pagedown
        e.keyCode === 2 || // Tab (debatable, but common in editors)
        e.keyCode === 9; // Escape

      // If it's a printable key or backspace/delete/enter, the user is editing
      if (!isModifier && !isNavigation && !e.ctrlKey && !e.metaKey) {
        onUserTypeRef.current?.();
      }
    });
  }, []);

  const cancelAnimation = useCallback(() => {
    if (animationRef.current !== null) {
      clearTimeout(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  useImperativeHandle(ref, () => ({
    applyEdits(edits) {
      const editor = editorRef.current;
      if (!editor) return;
      const model = editor.getModel();
      if (!model) return;

      const monacoEdits = edits.map((e) => ({
        range: {
          startLineNumber: e.range.startLine,
          startColumn: e.range.startCol,
          endLineNumber: e.range.endLine,
          endColumn: e.range.endCol,
        },
        text: e.text,
      }));

      model.pushEditOperations([], monacoEdits, () => null);
    },

    applyEditsAnimated(edits, onComplete) {
      const editor = editorRef.current;
      if (!editor) return;
      const model = editor.getModel();
      if (!model) return;

      // Cancel any in-progress animation
      cancelAnimation();

      // For each edit, first apply the deletion (replace range with empty),
      // then type the new text character by character
      const edit = edits[0]; // Handle one edit at a time
      if (!edit) {
        onComplete?.();
        return;
      }

      const { range, text } = edit;

      // Step 1: Delete the old content in the range (instant)
      const deleteRange = {
        startLineNumber: range.startLine,
        startColumn: range.startCol,
        endLineNumber: range.endLine,
        endColumn: range.endCol,
      };
      model.pushEditOperations(
        [],
        [{ range: deleteRange, text: "" }],
        () => null
      );

      // Step 2: Type new text character by character at the start position
      let charIndex = 0;

      const typeNextChar = () => {
        if (charIndex >= text.length) {
          animationRef.current = null;
          // If there are more edits, apply them
          if (edits.length > 1) {
            // Recalculate positions for remaining edits since the document changed
            // For simplicity, apply remaining edits instantly
            const remaining = edits.slice(1);
            const monacoEdits = remaining.map((e) => ({
              range: {
                startLineNumber: e.range.startLine,
                startColumn: e.range.startCol,
                endLineNumber: e.range.endLine,
                endColumn: e.range.endCol,
              },
              text: e.text,
            }));
            model.pushEditOperations([], monacoEdits, () => null);
          }
          onComplete?.();
          return;
        }

        const char = text[charIndex];
        charIndex++;

        // Find the current end of the already-typed text
        // We insert at the position after what we've typed so far
        const typedSoFar = text.substring(0, charIndex - 1);
        const typedLines = (
          model.getValueInRange({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: model.getLineCount(),
            endColumn:
              model.getLineMaxColumn(model.getLineCount()),
          })
        ); // full content — not used, just for reference

        // Calculate insertion position from the original start + typed chars
        const insertPos = getPositionAfterText(
          range.startLine,
          range.startCol,
          typedSoFar
        );

        model.pushEditOperations(
          [],
          [
            {
              range: {
                startLineNumber: insertPos.line,
                startColumn: insertPos.col,
                endLineNumber: insertPos.line,
                endColumn: insertPos.col,
              },
              text: char,
            },
          ],
          () => null
        );

        // Scroll to keep the cursor visible
        editor.revealPosition({
          lineNumber: insertPos.line,
          column: insertPos.col,
        });

        animationRef.current = window.setTimeout(
          typeNextChar,
          TYPING_SPEED_MS
        );
      };

      typeNextChar();
    },

    cancelAnimation,

    setContent(content: string) {
      const editor = editorRef.current;
      if (!editor) return;
      cancelAnimation();
      editor.setValue(content);
    },

    getContent() {
      const editor = editorRef.current;
      if (!editor) return "";
      return editor.getValue();
    },

    setReadOnly(value: boolean) {
      const editor = editorRef.current;
      if (!editor) return;
      editor.updateOptions({ readOnly: value });
    },
  }));

  return (
    <Editor
      height="100%"
      language={language}
      theme="vs-dark"
      onMount={handleMount}
      onChange={(value) => onContentChange?.(value ?? "")}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontSize: 16,
        lineHeight: 24,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        wordWrap: "on",
        padding: { top: 16 },
      }}
    />
  );
});

/**
 * Calculate the line/column position after inserting `text` starting at (startLine, startCol).
 */
function getPositionAfterText(
  startLine: number,
  startCol: number,
  text: string
): { line: number; col: number } {
  if (text.length === 0) return { line: startLine, col: startCol };

  const lines = text.split("\n");
  if (lines.length === 1) {
    return { line: startLine, col: startCol + lines[0].length };
  }

  return {
    line: startLine + lines.length - 1,
    col: lines[lines.length - 1].length + 1,
  };
}
