import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StateChip } from "@/components/StateChip";
import { useAppState } from "@/hooks/useAppState";
import { onTranscription, startTestRecording, stopTestRecording } from "@/lib/tauri";

interface TestRecorderProps {
  onTranscript?: (text: string) => void;
  disabled?: boolean;
}

/** Scratch dictation test: start/stop buttons, live state chip, transcript. */
export function TestRecorder({ onTranscript, disabled }: TestRecorderProps) {
  const app = useAppState();
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  useEffect(
    () =>
      onTranscription((e) => {
        setTranscript(e.text);
        onTranscriptRef.current?.(e.text);
      }),
    [],
  );

  const recording = app.state === "recording";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {recording ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void stopTestRecording()}
          >
            <Square />
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => {
              setError(null);
              startTestRecording().catch((err) => setError(String(err)));
            }}
            disabled={disabled || app.state === "transcribing"}
          >
            <Mic />
            Start test
          </Button>
        )}
        <StateChip state={app} />
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Textarea
        aria-label="Transcript"
        placeholder="Your test transcription appears here…"
        rows={3}
        value={transcript}
        onChange={(e) => {
          setTranscript(e.target.value);
          onTranscriptRef.current?.(e.target.value);
        }}
      />
    </div>
  );
}
