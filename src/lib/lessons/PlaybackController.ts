import { Lesson, LessonEvent, LessonSection, EditEvent } from "./types";
import { VirtualFileSystem } from "./VirtualFileSystem";

export type PlaybackState = "idle" | "playing" | "paused";

export interface PlaybackCallbacks {
  onEdit: (path: string, event: EditEvent) => void;
  onFileCreate: (path: string, content: string) => void;
  onTerminalInput: (command: string) => void;
  onTerminalOutput: (output: string) => void;
  onTerminalClear: () => void;
  onStateChange: (state: PlaybackState) => void;
  onSectionChange: (section: LessonSection) => void;
  onTimeUpdate: (time: number) => void;
  onActiveFileChange: (path: string) => void;
}

/**
 * Drives lesson playback by syncing a virtual clock with audio (if available)
 * or a requestAnimationFrame timer (fallback). Events are dispatched to
 * callbacks as the clock advances.
 */
export class PlaybackController {
  private lesson: Lesson;
  private vfs: VirtualFileSystem;
  private callbacks: PlaybackCallbacks;
  private cursor: number = 0;
  private allEvents: LessonEvent[] = [];
  private state: PlaybackState = "idle";
  private animFrameId: number | null = null;
  private currentSectionIndex: number = 0;

  // Audio per section
  private audio: HTMLAudioElement | null = null;
  private audioLoaded: boolean = false;

  // Timer-based clock (used always — audio syncs to this when available)
  private clockStartWall: number = 0; // performance.now() at play start
  private clockStartLesson: number = 0; // lesson time at play start
  private currentTime: number = 0;

  constructor(
    lesson: Lesson,
    vfs: VirtualFileSystem,
    callbacks: PlaybackCallbacks
  ) {
    this.lesson = lesson;
    this.vfs = vfs;
    this.callbacks = callbacks;

    this.allEvents = lesson.sections
      .flatMap((s) => s.events)
      .sort((a, b) => a.t - b.t);
  }

  getState(): PlaybackState {
    return this.state;
  }

  getCurrentTime(): number {
    return this.currentTime;
  }

  getDuration(): number {
    return this.lesson.totalDuration;
  }

  getCurrentSection(): LessonSection | undefined {
    return this.lesson.sections[this.currentSectionIndex];
  }

  play() {
    if (this.state === "playing") return;

    if (this.state === "idle") {
      this.currentSectionIndex = 0;
      this.cursor = 0;
      this.currentTime = 0;
      this.vfs.clear();
      this.callbacks.onTerminalClear();
      if (this.lesson.sections.length > 0) {
        this.callbacks.onSectionChange(this.lesson.sections[0]);
      }
    }

    this.clockStartWall = performance.now();
    this.clockStartLesson = this.currentTime;
    this.state = "playing";
    this.callbacks.onStateChange(this.state);
    this.tryPlayAudio();
    this.startTicking();
  }

  pause() {
    if (this.state !== "playing") return;
    // Update time one final time so the UI shows the exact pause point
    const elapsed = (performance.now() - this.clockStartWall) / 1000;
    this.currentTime = this.clockStartLesson + elapsed;
    this.callbacks.onTimeUpdate(this.currentTime);
    this.state = "paused";
    this.callbacks.onStateChange(this.state);
    this.audio?.pause();
    this.stopTicking();
  }

  resume() {
    if (this.state !== "paused") return;
    this.clockStartWall = performance.now();
    this.clockStartLesson = this.currentTime;
    this.state = "playing";
    this.callbacks.onStateChange(this.state);
    this.tryPlayAudio();
    this.startTicking();
  }

  togglePlayPause() {
    if (this.state === "playing") {
      this.pause();
    } else if (this.state === "paused") {
      this.resume();
    } else {
      this.play();
    }
  }

  seekToSection(sectionIndex: number) {
    if (sectionIndex < 0 || sectionIndex >= this.lesson.sections.length) return;
    const wasPlaying = this.state === "playing";

    this.stopTicking();
    this.audio?.pause();

    // Restore state from checkpoint
    this.vfs.clear();
    this.callbacks.onTerminalClear();

    if (sectionIndex > 0) {
      const prevCheckpoint = this.lesson.sections[sectionIndex - 1].checkpoint;
      this.vfs.restoreFromCheckpoint(prevCheckpoint.files);
      if (prevCheckpoint.terminalHistory) {
        this.callbacks.onTerminalOutput(prevCheckpoint.terminalHistory);
      }
      const files = Object.keys(prevCheckpoint.files);
      if (files.length > 0) {
        this.callbacks.onActiveFileChange(files[0]);
      }
    }

    const section = this.lesson.sections[sectionIndex];
    this.currentTime = section.startTime;
    this.cursor = this.allEvents.findIndex((e) => e.t >= section.startTime);
    if (this.cursor === -1) this.cursor = this.allEvents.length;

    this.currentSectionIndex = sectionIndex;
    this.callbacks.onSectionChange(section);
    this.callbacks.onTimeUpdate(this.currentTime);

    if (wasPlaying || this.state === "idle") {
      this.clockStartWall = performance.now();
      this.clockStartLesson = this.currentTime;
      this.state = "playing";
      this.callbacks.onStateChange(this.state);
      this.loadAndPlaySectionAudio(sectionIndex);
      this.startTicking();
    }
  }

  seekToTime(targetTime: number) {
    if (targetTime < 0) targetTime = 0;
    if (targetTime > this.lesson.totalDuration) targetTime = this.lesson.totalDuration;

    const wasPlaying = this.state === "playing";
    this.stopTicking();
    this.audio?.pause();

    // Find which section this time falls in
    let targetSectionIndex = 0;
    for (let i = 0; i < this.lesson.sections.length; i++) {
      if (targetTime >= this.lesson.sections[i].startTime) {
        targetSectionIndex = i;
      }
    }

    // Restore the checkpoint of the section BEFORE targetSectionIndex
    this.vfs.clear();
    this.callbacks.onTerminalClear();

    if (targetSectionIndex > 0) {
      const prevCheckpoint = this.lesson.sections[targetSectionIndex - 1].checkpoint;
      this.vfs.restoreFromCheckpoint(prevCheckpoint.files);
      if (prevCheckpoint.terminalHistory) {
        this.callbacks.onTerminalOutput(prevCheckpoint.terminalHistory);
      }
      const files = Object.keys(prevCheckpoint.files);
      if (files.length > 0) {
        this.callbacks.onActiveFileChange(files[0]);
      }
    }

    // Set cursor to the start of this section's events
    const sectionStartTime = this.lesson.sections[targetSectionIndex].startTime;
    this.cursor = this.allEvents.findIndex((e) => e.t >= sectionStartTime);
    if (this.cursor === -1) this.cursor = this.allEvents.length;

    // Instantly apply all events from section start up to targetTime
    while (
      this.cursor < this.allEvents.length &&
      this.allEvents[this.cursor].t <= targetTime
    ) {
      this.applyEvent(this.allEvents[this.cursor]);
      this.cursor++;
    }

    this.currentTime = targetTime;
    this.currentSectionIndex = targetSectionIndex;
    this.callbacks.onSectionChange(this.lesson.sections[targetSectionIndex]);
    this.callbacks.onTimeUpdate(this.currentTime);

    if (wasPlaying || this.state === "idle") {
      this.clockStartWall = performance.now();
      this.clockStartLesson = this.currentTime;
      this.state = "playing";
      this.callbacks.onStateChange(this.state);

      // Load audio for the current section and seek within it
      this.loadAndPlaySectionAudio(targetSectionIndex);
      const sectionOffset = targetTime - sectionStartTime;
      if (this.audio && sectionOffset > 0) {
        this.audio.currentTime = sectionOffset;
      }

      this.startTicking();
    }
  }

  destroy() {
    this.stopTicking();
    this.audio?.pause();
    this.audio = null;
  }

  // --- Audio ---

  private loadAndPlaySectionAudio(sectionIndex: number) {
    const lessonId = this.lesson.id;
    const src = `/lessons/${lessonId}/section-${sectionIndex + 1}.mp3`;

    if (this.audio) {
      this.audio.pause();
    }
    const audio = new Audio(src);
    this.audio = audio;
    this.audioLoaded = false;

    audio.addEventListener("canplaythrough", () => {
      this.audioLoaded = true;
      if (this.state === "playing") audio.play().catch(() => {});
    });
    audio.addEventListener("error", () => {
      // Audio not available — timer-only mode
      this.audioLoaded = false;
    });
    audio.addEventListener("ended", () => {
      this.onSectionAudioEnded();
    });
    audio.load();
  }

  private tryPlayAudio() {
    if (this.audioLoaded && this.audio) {
      this.audio.play().catch(() => {});
    } else {
      // First play or no audio yet — load for current section
      this.loadAndPlaySectionAudio(this.currentSectionIndex);
    }
  }

  private onSectionAudioEnded() {
    // Move to next section if not already there from the timer
    const nextIndex = this.currentSectionIndex + 1;
    if (
      nextIndex < this.lesson.sections.length &&
      this.currentTime < this.lesson.sections[nextIndex].startTime
    ) {
      // Jump time forward to the next section start
      this.currentTime = this.lesson.sections[nextIndex].startTime;
      this.flushEventsUpTo(this.currentTime);
    }
    if (nextIndex < this.lesson.sections.length) {
      this.currentSectionIndex = nextIndex;
      this.callbacks.onSectionChange(this.lesson.sections[nextIndex]);
      this.loadAndPlaySectionAudio(nextIndex);
      // Reset the clock to keep timer in sync
      this.clockStartWall = performance.now();
      this.clockStartLesson = this.currentTime;
    }
  }

  // --- Tick loop ---

  private startTicking() {
    const tick = () => {
      if (this.state !== "playing") return;
      this.processTick();
      this.animFrameId = requestAnimationFrame(tick);
    };
    this.animFrameId = requestAnimationFrame(tick);
  }

  private stopTicking() {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  private processTick() {
    const elapsed = (performance.now() - this.clockStartWall) / 1000;
    this.currentTime = this.clockStartLesson + elapsed;

    // Clamp to lesson duration
    if (this.currentTime >= this.lesson.totalDuration) {
      this.currentTime = this.lesson.totalDuration;
      this.flushEventsUpTo(this.currentTime);
      this.callbacks.onTimeUpdate(this.currentTime);
      this.state = "idle";
      this.callbacks.onStateChange(this.state);
      this.stopTicking();
      this.audio?.pause();
      return;
    }

    // Check if we've moved to a new section
    const currentSection = this.lesson.sections[this.currentSectionIndex];
    if (currentSection && this.currentTime >= currentSection.endTime) {
      const nextIndex = this.currentSectionIndex + 1;
      if (nextIndex < this.lesson.sections.length) {
        this.currentSectionIndex = nextIndex;
        this.callbacks.onSectionChange(this.lesson.sections[nextIndex]);
        // If audio hasn't already triggered the next section, load it
        if (
          !this.audio ||
          this.audio.ended ||
          this.audio.paused
        ) {
          this.loadAndPlaySectionAudio(nextIndex);
          this.clockStartWall = performance.now();
          this.clockStartLesson = this.currentTime;
        }
      }
    }

    this.callbacks.onTimeUpdate(this.currentTime);
    this.flushEventsUpTo(this.currentTime);
  }

  private flushEventsUpTo(time: number) {
    while (
      this.cursor < this.allEvents.length &&
      this.allEvents[this.cursor].t <= time
    ) {
      this.applyEvent(this.allEvents[this.cursor]);
      this.cursor++;
    }
  }

  private applyEvent(event: LessonEvent) {
    switch (event.type) {
      case "file_create":
        this.vfs.createFile(event.path, event.content);
        this.callbacks.onFileCreate(event.path, event.content);
        this.callbacks.onActiveFileChange(event.path);
        break;
      case "edit":
        this.callbacks.onEdit(event.path, event);
        this.callbacks.onActiveFileChange(event.path);
        break;
      case "terminal_input":
        this.callbacks.onTerminalInput(event.command);
        break;
      case "terminal_output":
        this.callbacks.onTerminalOutput(event.output);
        break;
    }
  }
}
