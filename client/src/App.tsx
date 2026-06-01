import { useEffect, useRef, useState } from "react";
import {
  checkHealth,
  getApiUrl,
  transcribeJob,
  uploadVoice,
  type UploadResponse,
} from "./api";

type Step = "idle" | "uploading" | "transcribing" | "done" | "error";

const ACCEPT = "audio/*,video/mp4,video/webm,.wav,.mp3,.m4a,.flac,.ogg";
const EXISTING_JOB_ID = "26fa09fd-798f-4a3c-b2a3-453c49003de5";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function speakerLabel(speaker: string): string {
  return /^\d+$/.test(speaker) ? `화자 ${speaker}` : speaker;
}

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [error, setError] = useState("");
  const [r2Ready, setR2Ready] = useState<boolean | null>(null);
  const [sonioxReady, setSonioxReady] = useState<boolean | null>(null);

  useEffect(() => {
    checkHealth()
      .then((h) => {
        setR2Ready(h.r2_configured);
        setSonioxReady(Boolean(h.soniox_configured));
      })
      .catch(() => {
        setR2Ready(false);
        setSonioxReady(false);
      });
  }, []);

  const onSelect = (selected: File | null) => {
    setFile(selected);
    setStep("idle");
    setProgress(0);
    setResult(null);
    setError("");
  };

  const onUpload = async () => {
    if (!file) return;

    setStep("uploading");
    setProgress(0);
    setError("");

    try {
      const uploaded = await uploadVoice(
        file,
        setProgress,
        () => setStep("transcribing"),
      );
      setResult(uploaded);
      if (uploaded.status === "AI_FAILED") {
        setError(uploaded.error || "녹취 변환 실패");
        setStep("error");
        return;
      }
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "업로드 실패");
      setStep("error");
    }
  };

  const onTranscribeExisting = async () => {
    setStep("transcribing");
    setProgress(0);
    setError("");
    setResult(null);

    try {
      const transcribed = await transcribeJob(EXISTING_JOB_ID);
      setResult(transcribed);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "녹취 변환 실패");
      setStep("error");
    }
  };

  const busy = step === "uploading" || step === "transcribing";

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 py-8">
      <header className="mb-8">
        <p className="text-sm font-medium text-blue-700">Bluecom AI</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">음성 업로드 · 녹취 테스트</h1>
        <p className="mt-2 text-sm text-slate-600">
          업로드 → Soniox AI 변환(화자분리) → R2 <code className="rounded bg-slate-200 px-1">text/</code> 저장
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          <span className="text-slate-500">API: {getApiUrl()}</span>
          {r2Ready && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">R2</span>
          )}
          {sonioxReady && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">Soniox</span>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => onSelect(e.target.files?.[0] ?? null)}
        />

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-10 transition hover:border-blue-400 hover:bg-blue-50 disabled:opacity-60"
        >
          <span className="text-4xl">🎙️</span>
          <span className="mt-3 font-medium text-slate-800">
            {file ? file.name : "음성/영상 파일 선택"}
          </span>
          <span className="mt-1 text-sm text-slate-500">
            {file ? formatSize(file.size) : "wav, mp3, m4a, mp4 등"}
          </span>
        </button>

        {busy && (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-sm text-slate-600">
              <span>
                {step === "uploading" ? "업로드 중..." : "Soniox 녹취 변환 중..."}
              </span>
              {step === "uploading" && <span>{progress}%</span>}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className={`h-full rounded-full transition-all ${
                  step === "transcribing" ? "w-full animate-pulse bg-violet-600" : "bg-blue-600"
                }`}
                style={step === "uploading" ? { width: `${progress}%` } : undefined}
              />
            </div>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        {result && step === "done" && (
          <div className="mt-4 space-y-3">
            <div className="space-y-2 rounded-lg bg-green-50 px-3 py-3 text-sm text-green-900">
              <p className="font-semibold">
                {result.status === "AI_DONE" ? "업로드 · 녹취 완료" : "업로드 완료"}
              </p>
              <p>
                <span className="text-green-700">작업 ID:</span> {result.job_id}
              </p>
              <p className="break-all">
                <span className="text-green-700">음성:</span> {result.object_key}
              </p>
              {result.transcript_key && (
                <p className="break-all">
                  <span className="text-green-700">녹취:</span> {result.transcript_key}
                </p>
              )}
            </div>

            {(result.transcript_json?.segments?.length
              ? result.transcript_json.segments
              : null) && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                <p className="mb-2 font-semibold text-slate-700">화자별 녹취</p>
                <div className="space-y-3">
                  {result.transcript_json!.segments!.map((segment, index) => (
                    <div key={index} className="rounded-lg bg-white px-3 py-2 shadow-sm">
                      <p className="mb-1 text-xs font-semibold text-violet-700">
                        {speakerLabel(segment.speaker)}
                      </p>
                      <p className="whitespace-pre-wrap leading-relaxed text-slate-800">
                        {segment.text}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.transcript_text && !result.transcript_json?.segments?.length && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                <p className="mb-2 font-semibold text-slate-700">녹취 내용</p>
                <p className="whitespace-pre-wrap leading-relaxed text-slate-800">
                  {result.transcript_text}
                </p>
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={onUpload}
          disabled={!file || busy || r2Ready === false}
          className="mt-5 w-full rounded-xl bg-blue-700 py-3 font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {step === "uploading"
            ? "업로드 중..."
            : step === "transcribing"
              ? "녹취 변환 중..."
              : "업로드 + 녹취 변환"}
        </button>

        <button
          type="button"
          onClick={onTranscribeExisting}
          disabled={busy || sonioxReady === false || r2Ready === false}
          className="mt-3 w-full rounded-xl border border-violet-300 bg-violet-50 py-3 font-semibold text-violet-800 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          기존 파일 녹취 테스트 (26fa09fd...)
        </button>
      </section>

      <p className="mt-6 text-center text-xs text-slate-400">
        voice/ 업로드 → Soniox 변환 → text/ 저장
        <br />
        <a href="/admin/" className="text-blue-600 underline">
          관리자 편집 화면 (/admin/)
        </a>
      </p>
    </div>
  );
}
