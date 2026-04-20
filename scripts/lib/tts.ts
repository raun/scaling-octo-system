import type { AudioClip, ScriptedSection } from "./types";

const TTS_URL = "https://api.openai.com/v1/audio/speech";
const TTS_MODEL = "tts-1";
const TTS_VOICE = "alloy";
const BITRATE_BPS = 64_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5_000;

export class TTSService {
  private apiKey: string;

  constructor() {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not set");
    this.apiKey = key;
  }

  async generateClip(
    sectionId: string,
    narration: string
  ): Promise<AudioClip> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(TTS_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: TTS_MODEL,
            voice: TTS_VOICE,
            input: narration,
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`OpenAI TTS failed (${response.status}): ${body}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const durationSeconds = estimateMp3Duration(buffer);

        return { sectionId, buffer, durationSeconds };
      } catch (e: unknown) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < MAX_RETRIES) {
          console.warn(
            `[TTS] Attempt ${attempt}/${MAX_RETRIES} failed for "${sectionId}": ${lastError.message}. Retrying in ${RETRY_DELAY_MS / 1000}s...`
          );
          await sleep(RETRY_DELAY_MS);
        }
      }
    }

    throw lastError ?? new Error(`TTS failed for "${sectionId}" after ${MAX_RETRIES} attempts`);
  }

  async generateAll(sections: ScriptedSection[]): Promise<AudioClip[]> {
    const clips: AudioClip[] = [];

    for (const section of sections) {
      console.log(`[TTS] Generating audio for section "${section.id}"...`);
      const clip = await this.generateClip(section.id, section.narration);
      console.log(
        `[TTS] Section "${section.id}": ${clip.durationSeconds.toFixed(1)}s`
      );
      clips.push(clip);
    }

    return clips;
  }
}

function estimateMp3Duration(buffer: Buffer): number {
  return (buffer.length * 8) / BITRATE_BPS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
