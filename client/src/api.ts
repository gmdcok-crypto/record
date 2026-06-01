const API_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";

export type TranscriptToken = {
  text: string;
  start_ms: number | null;
  end_ms: number | null;
  speaker: string | null;
};

export type TranscriptJson = {
  transcription_id: string;
  filename: string;
  text: string;
  tokens: TranscriptToken[];
};

export type UploadResponse = {
  job_id: string;
  object_key: string;
  bucket: string;
  status: string;
  transcript_text?: string | null;
  transcript_key?: string | null;
  transcript_json?: TranscriptJson | null;
  error?: string | null;
};

export type HealthResponse = {
  status: string;
  soniox_configured?: boolean;
  r2_configured: boolean;
  bucket: string;
};

function apiBase(): string {
  return API_URL || window.location.origin;
}

function parseErrorDetail(body: unknown): string {
  if (typeof body === "object" && body !== null && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map(String).join(", ");
  }
  return "업로드 실패";
}

export async function checkHealth(): Promise<HealthResponse> {
  const res = await fetch(`${apiBase()}/health`);
  if (!res.ok) throw new Error("서버 연결 실패");
  return res.json();
}

export async function uploadVoice(
  file: File,
  onProgress?: (percent: number) => void,
  onUploadComplete?: () => void,
): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiBase()}/api/upload/voice`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
        if (event.loaded >= event.total && onUploadComplete) {
          onUploadComplete();
        }
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText) as UploadResponse);
        return;
      }
      try {
        reject(new Error(parseErrorDetail(JSON.parse(xhr.responseText))));
      } catch {
        reject(new Error(`업로드 실패 (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error("서버 연결 오류"));
    xhr.send(form);
  });
}

export async function transcribeJob(jobId: string): Promise<UploadResponse> {
  const res = await fetch(`${apiBase()}/api/transcribe/job/${jobId}`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseErrorDetail(err));
  }
  const data = await res.json();
  return {
    job_id: data.job_id,
    object_key: data.voice_key,
    bucket: "",
    status: data.status,
    transcript_text: data.transcript_text,
    transcript_key: data.transcript_key,
    transcript_json: data.transcript_json,
  };
}

export function getApiUrl(): string {
  return apiBase();
}
