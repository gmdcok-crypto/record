const API_URL = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";

export type PresignResponse = {
  job_id: string;
  object_key: string;
  upload_url: string;
  expires_in: number;
  bucket: string;
};

export type HealthResponse = {
  status: string;
  r2_configured: boolean;
  bucket: string;
};

export async function checkHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_URL}/health`);
  if (!res.ok) throw new Error("서버 연결 실패");
  return res.json();
}

export async function requestPresign(
  filename: string,
  contentType: string,
): Promise<PresignResponse> {
  const res = await fetch(`${API_URL}/api/upload/presign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, content_type: contentType }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "업로드 URL 발급 실패");
  }

  return res.json();
}

export async function uploadToR2(
  uploadUrl: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`R2 업로드 실패 (${xhr.status})`));
    };

    xhr.onerror = () => reject(new Error("네트워크 오류"));
    xhr.send(file);
  });
}

export function getApiUrl(): string {
  return API_URL || window.location.origin;
}
