// Voice input (docs/17): press the microphone, speak, and the words land in the message box. Uses the browser's
// speech recognition (Chrome and Edge; audio is recognised by the browser's own service, nothing passes through
// Claudestra). Browsers without it simply do not show the button.
import { useCallback, useEffect, useRef, useState } from "react";
import { lang, t } from "./i18n.ts";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

const ctor = (): (new () => Recognition) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const speechLocale = () => (lang() === "az" ? "az-AZ" : "en-US");

// Joins dictated words onto what is already typed.
export const appendSpoken = (current: string, spoken: string) => {
  const add = spoken.trim();
  if (!add) return current;
  return current.trim() ? `${current.replace(/\s+$/, "")} ${add}` : add;
};

export function useDictation(onText: (finalText: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const cb = useRef(onText);
  cb.current = onText;
  const supported = typeof window !== "undefined" && ctor() !== null;

  const stop = useCallback(() => rec.current?.stop(), []);
  const start = useCallback(() => {
    const C = ctor();
    if (!C) return;
    setError(null);
    const r = new C();
    r.lang = speechLocale();
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) cb.current(res[0]!.transcript);
        else live += res[0]!.transcript;
      }
      setInterim(live);
    };
    r.onerror = (e) => {
      if (e.error !== "aborted" && e.error !== "no-speech") setError(e.error === "not-allowed" || e.error === "service-not-allowed" ? t("mic.denied") : t("mic.failed"));
    };
    r.onend = () => {
      setListening(false);
      setInterim("");
      rec.current = null;
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setError(t("mic.failed"));
    }
  }, []);

  useEffect(() => () => rec.current?.abort(), []);
  return { supported, listening, interim, error, start, stop, toggle: () => (listening ? stop() : start()) };
}

export function MicButton({ onText, disabled, className = "" }: { onText: (text: string) => void; disabled?: boolean; className?: string }) {
  const d = useDictation(onText);
  if (!d.supported) return null;
  return (
    <span className="mic-wrap">
      <button type="button" className={`mic-btn ${d.listening ? "on" : ""} ${className}`} onClick={d.toggle} disabled={disabled} aria-pressed={d.listening} aria-label={d.listening ? t("mic.stop") : t("mic.start")} title={d.listening ? t("mic.stop") : t("mic.start")}>
        {d.listening ? "■" : "🎤"}
      </button>
      {(d.listening || d.error) && (
        <span className={`mic-live small ${d.error ? "error" : ""}`} role="status">
          {d.error ?? (d.interim || t("mic.listening"))}
        </span>
      )}
    </span>
  );
}
