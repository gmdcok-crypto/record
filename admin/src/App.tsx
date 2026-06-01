import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  fetchJob,
  formatMs,
  htmlToSegments,
  resolveUrl,
  saveTranscript,
  segmentsToHtml,
  segmentsToPlainText,
  speakerLabel,
  type JobResponse,
  type Segment,
} from "./api";
import { findSegmentIndexAtPos, highlightActiveSegment } from "./editorUtils";

const DEFAULT_JOB_ID = "26fa09fd-798f-4a3c-b2a3-453c49003de5";

function getJobIdFromUrl(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("job_id") || DEFAULT_JOB_ID;
}

export default function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const editorWrapperRef = useRef<HTMLDivElement>(null);
  const segmentsRef = useRef<Segment[]>([]);
  const seekToRef = useRef<(ms: number | null | undefined, index?: number) => void>(() => {});
  const [jobIdInput, setJobIdInput] = useState(getJobIdFromUrl());
  const [job, setJob] = useState<JobResponse | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [currentMs, setCurrentMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const seekTo = useCallback((ms: number | null | undefined, index?: number) => {
    if (ms == null) return;
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = ms / 1000;
    void audio.play();
    if (index != null) setActiveIndex(index);
  }, []);

  seekToRef.current = seekTo;
  segmentsRef.current = segments;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "녹취 내용을 수정하세요. 클릭하면 해당 구간으로 이동합니다." }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none px-4 py-3",
      },
      handleClick(view, pos) {
        const index = findSegmentIndexAtPos(view.state.doc, pos);
        const seg = segmentsRef.current[index];
        if (seg?.start_ms != null) {
          seekToRef.current(seg.start_ms, index);
        }
        return false;
      },
    },
  });

  const loadJob = useCallback(async (jobId: string) => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const data = await fetchJob(jobId);
      const loadedSegments = data.transcript_json.segments || [];
      setJob(data);
      setSegments(loadedSegments);
      setActiveIndex(0);
      const html = loadedSegments.length
        ? segmentsToHtml(loadedSegments)
        : `<p>${data.transcript_json.text || ""}</p>`;
      editor?.commands.setContent(html);
      const url = new URL(window.location.href);
      url.searchParams.set("job_id", jobId);
      window.history.replaceState({}, "", url.toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
      setJob(null);
    } finally {
      setLoading(false);
    }
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const root = editorWrapperRef.current?.querySelector(".ProseMirror") as HTMLElement | null;
    highlightActiveSegment(root, activeIndex);
  }, [activeIndex, editor, segments, job]);

  useEffect(() => {
    if (!editor) return;
    void loadJob(getJobIdFromUrl());
  }, [editor]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !segments.length) return;

    const onTimeUpdate = () => {
      const ms = audio.currentTime * 1000;
      setCurrentMs(ms);
      const index = segments.findIndex(
        (seg) =>
          seg.start_ms != null &&
          seg.end_ms != null &&
          ms >= seg.start_ms &&
          ms <= seg.end_ms + 300,
      );
      if (index >= 0) setActiveIndex(index);
    };

    const onLoaded = () => setDurationMs(audio.duration * 1000);

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoaded);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoaded);
    };
  }, [segments, job]);

  const progress = durationMs > 0 ? (currentMs / durationMs) * 100 : 0;

  const markers = useMemo(
    () =>
      segments
        .filter((seg) => seg.start_ms != null && durationMs > 0)
        .map((seg, index) => ({
          index,
          left: ((seg.start_ms || 0) / durationMs) * 100,
        })),
    [segments, durationMs],
  );

  const onSave = async () => {
    if (!job || !editor) return;
    setSaving(true);
    setError("");
    try {
      const updatedSegments = htmlToSegments(editor.getHTML(), segments);
      const transcript_json = {
        ...job.transcript_json,
        segments: updatedSegments,
        text: segmentsToPlainText(updatedSegments),
      };
      await saveTranscript(job.job_id, transcript_json);
      setSegments(updatedSegments);
      setMessage("저장되었습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-blue-700">Bluecom AI · Admin Prototype</p>
            <h1 className="text-xl font-bold">녹취록 편집기</h1>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={jobIdInput}
              onChange={(e) => setJobIdInput(e.target.value)}
              className="w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="job_id"
            />
            <button
              type="button"
              onClick={() => loadJob(jobIdInput)}
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white"
            >
              불러오기
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!job || saving}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </header>

      {loading && (
        <p className="px-6 py-10 text-center text-slate-500">불러오는 중...</p>
      )}

      {!loading && error && (
        <p className="mx-6 mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {!loading && job && (
        <main className="mx-auto grid max-w-7xl gap-4 px-4 py-4 lg:grid-cols-[280px_1fr_240px]">
          <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">구간 목록</h2>
            <p className="mb-3 text-xs text-slate-500">클릭하면 해당 시점으로 이동합니다.</p>
            <div className="max-h-[70vh] space-y-2 overflow-y-auto">
              {segments.map((seg, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => seekTo(seg.start_ms, index)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                    activeIndex === index
                      ? "border-violet-400 bg-violet-50"
                      : "border-slate-200 hover:border-violet-200"
                  }`}
                >
                  <p className="font-semibold text-violet-700">{speakerLabel(seg.speaker)}</p>
                  <p className="text-xs text-slate-500">
                    {formatMs(seg.start_ms)} – {formatMs(seg.end_ms)}
                  </p>
                  <p className="mt-1 line-clamp-2 text-slate-700">{seg.text}</p>
                </button>
              ))}
            </div>
          </aside>

          <section className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between text-sm text-slate-600">
                <span>{job.transcript_json.filename || job.voice_key.split("/").pop()}</span>
                <span>
                  {formatMs(currentMs)} / {formatMs(durationMs)}
                </span>
              </div>

              <audio ref={audioRef} controls className="mb-3 w-full" src={resolveUrl(job.audio_url)} />

              <div className="relative mb-2 h-3 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="absolute h-full bg-blue-600 transition-all"
                  style={{ width: `${progress}%` }}
                />
                {markers.map((marker) => (
                  <button
                    key={marker.index}
                    type="button"
                    title={`구간 ${marker.index + 1}`}
                    onClick={() => seekTo(segments[marker.index]?.start_ms, marker.index)}
                    className="absolute top-0 h-full w-1 -translate-x-1/2 bg-violet-500/80"
                    style={{ left: `${marker.left}%` }}
                  />
                ))}
              </div>
              <p className="text-xs text-slate-500">보라색 마커 = 화자 구간 시작점</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-700">Tiptap 편집</h2>
                <p className="text-xs text-slate-500">텍스트 클릭 → 해당 구간으로 이동 · 화자 제목 + 본문 수정 가능</p>
              </div>
              <div ref={editorWrapperRef}>
                <EditorContent editor={editor} />
              </div>
            </div>
          </section>

          <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">작업 정보</h2>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-slate-500">작업 ID</dt>
                <dd className="break-all font-medium">{job.job_id}</dd>
              </div>
              <div>
                <dt className="text-slate-500">음성</dt>
                <dd className="break-all text-xs">{job.voice_key}</dd>
              </div>
              <div>
                <dt className="text-slate-500">녹취</dt>
                <dd className="break-all text-xs">{job.transcript_key}</dd>
              </div>
              <div>
                <dt className="text-slate-500">현재 구간</dt>
                <dd className="font-medium">
                  {segments[activeIndex]
                    ? `${speakerLabel(segments[activeIndex].speaker)} · ${formatMs(segments[activeIndex].start_ms)}`
                    : "-"}
                </dd>
              </div>
            </dl>

            {message && (
              <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{message}</p>
            )}
          </aside>
        </main>
      )}
    </div>
  );
}
