"use client";

import { useRef, useCallback } from "react";
import { PlaybackState } from "@/lib/lessons/PlaybackController";
import { LessonSection } from "@/lib/lessons/types";

interface PlaybackControlsProps {
  state: PlaybackState;
  currentTime: number;
  duration: number;
  sections: LessonSection[];
  currentSectionIndex: number;
  onPlayPause: () => void;
  onSeekToSection: (index: number) => void;
  onSeekToTime: (time: number) => void;
  isInteractive?: boolean;
  buttonLabel?: string;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function PlaybackControls({
  state,
  currentTime,
  duration,
  sections,
  currentSectionIndex,
  onPlayPause,
  onSeekToSection,
  onSeekToTime,
  isInteractive = false,
  buttonLabel,
}: PlaybackControlsProps) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const trackRef = useRef<HTMLDivElement>(null);

  const handleTrackClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const track = trackRef.current;
      if (!track || duration <= 0) return;

      const rect = track.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const fraction = Math.max(0, Math.min(1, x / rect.width));
      const targetTime = fraction * duration;
      onSeekToTime(targetTime);
    },
    [duration, onSeekToTime]
  );

  return (
    <div className="flex flex-col gap-3 bg-[#1e1e1e] border-t border-[#333] px-5 py-4">
      {/* Progress bar */}
      <div className="flex items-center gap-4">
        <button
          onClick={onPlayPause}
          className={`flex items-center justify-center gap-2 rounded-full px-5 py-2 text-base font-semibold text-white transition-colors ${
            isInteractive
              ? "bg-yellow-600 hover:bg-yellow-500"
              : "bg-[#0078d4] hover:bg-[#1a8ad4]"
          }`}
        >
          {isInteractive ? (
            <PlayIcon />
          ) : state === "playing" ? (
            <PauseIcon />
          ) : (
            <PlayIcon />
          )}
          {buttonLabel && <span>{buttonLabel}</span>}
        </button>

        {/* Clickable track */}
        <div
          ref={trackRef}
          className="flex-1 relative cursor-pointer group py-2"
          onClick={handleTrackClick}
        >
          <div className="h-2 rounded-full bg-[#333] relative group-hover:h-3 transition-all">
            {/* Progress fill */}
            <div
              className="absolute top-0 left-0 h-full rounded-full bg-[#0078d4]"
              style={{ width: `${progress}%` }}
            />
            {/* Playhead */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ left: `${progress}%`, marginLeft: "-8px" }}
            />
            {/* Section markers */}
            {sections.map((section, i) => {
              const markerPos = (section.startTime / duration) * 100;
              if (i === 0) return null;
              return (
                <div
                  key={section.id}
                  className="absolute top-1/2 -translate-y-1/2 w-1 h-4 rounded-full bg-[#555]"
                  style={{ left: `${markerPos}%`, marginLeft: "-2px" }}
                  title={section.label}
                />
              );
            })}
          </div>
        </div>

        <span className="text-sm text-[#aaa] font-mono min-w-[100px] text-right">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>

      {/* Section chips */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {sections.map((section, i) => (
          <button
            key={section.id}
            onClick={() => onSeekToSection(i)}
            className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              i === currentSectionIndex
                ? "bg-[#0078d4] text-white"
                : "bg-[#2d2d2d] text-[#999] hover:bg-[#3d3d3d] hover:text-[#ccc]"
            }`}
          >
            {section.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <path d="M3 1.5v11l9-5.5L3 1.5z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <rect x="2" y="1" width="3.5" height="12" rx="0.5" />
      <rect x="8.5" y="1" width="3.5" height="12" rx="0.5" />
    </svg>
  );
}
