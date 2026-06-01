import { useEffect, useRef, useState } from "react";
import {
  checkHealth,
  getApiUrl,
  uploadVoice,
  type UploadResponse,
} from "./api";

type Step = "idle" | "uploading" | "done" | "error";

const ACCEPT = "audio/*,video/mp4,video/webm,.wav,.mp3,.m4a,.flac,.ogg";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [error, setError] = useState("");
  const [r2Ready, setR2Ready] = useState<boolean | null>(null);

  useEffect(() => {
    checkHealth()
      .then((h) => setR2Ready(h.r2_configured))
      .catch(() => setR2Ready(false));
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
      const uploaded = await uploadVoice(file, setProgress);
      setResult(uploaded);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "업로드 실패");
      setStep("error");
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 py-8">
      <header className="mb-8">
        <p className="text-sm font-medium text-blue-700">Bluecom AI</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">음성 업로드 테스트</h1>
        <p className="mt-2 text-sm text-slate-600">
          선택한 파일은 Cloudflare R2 <code className="rounded bg-slate-200 px-1">voice/</code> 폴더에
          저장됩니다.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between text-xs text-slate-500">
          <span>API: {getApiUrl()}</span>
          {r2Ready === true && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">R2 연결됨</span>
          )}
          {r2Ready === false && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">R2 미설정</span>
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
          disabled={step === "uploading"}
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

        {step === "uploading" && (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-sm text-slate-600">
              <span>업로드 중...</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-blue-600 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        {result && step === "done" && (
          <div className="mt-4 space-y-2 rounded-lg bg-green-50 px-3 py-3 text-sm text-green-900">
            <p className="font-semibold">업로드 완료</p>
            <p>
              <span className="text-green-700">작업 ID:</span> {result.job_id}
            </p>
            <p className="break-all">
              <span className="text-green-700">경로:</span> {result.object_key}
            </p>
            <p>
              <span className="text-green-700">버킷:</span> {result.bucket}
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={onUpload}
          disabled={!file || step === "uploading" || r2Ready === false}
          className="mt-5 w-full rounded-xl bg-blue-700 py-3 font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {step === "uploading" ? "업로드 중..." : "R2에 업로드"}
        </button>
      </section>

      <p className="mt-6 text-center text-xs text-slate-400">
        테스트용 PWA · 서버 경유 R2 업로드
      </p>
    </div>
  );
}
