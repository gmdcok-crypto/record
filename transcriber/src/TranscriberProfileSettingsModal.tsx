import { useEffect, useState, type FormEvent } from "react";
import type { TranscriberAuthProfile, TranscriberProfileUpdateInput } from "./api";

type Props = {
  open: boolean;
  profile: TranscriberAuthProfile | null;
  onClose: () => void;
  onSaved: (profile: TranscriberAuthProfile) => void;
  onSaveProfile: (input: TranscriberProfileUpdateInput) => Promise<TranscriberAuthProfile>;
  onUploadLicense: (file: File) => Promise<TranscriberAuthProfile>;
  loadLicensePreviewUrl: () => Promise<string | null>;
};

function fieldClassName() {
  return "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-violet-500";
}

function formatResidentId(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 13);
  if (digits.length <= 6) return digits;
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
}

export default function TranscriberProfileSettingsModal({
  open,
  profile,
  onClose,
  onSaved,
  onSaveProfile,
  onUploadLicense,
  loadLicensePreviewUrl,
}: Props) {
  const [phone, setPhone] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [residentId, setResidentId] = useState("");
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [licensePreviewUrl, setLicensePreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !profile) return;
    setPhone(profile.phone ?? "");
    setBankName(profile.bank_name ?? "");
    setAccountNumber(profile.account_number ?? "");
    setResidentId(formatResidentId(profile.resident_id ?? ""));
    setLicenseFile(null);
    setError("");
  }, [open, profile]);

  useEffect(() => {
    if (!open || !profile?.has_license) {
      setLicensePreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      return;
    }

    let cancelled = false;
    void loadLicensePreviewUrl().then((url) => {
      if (cancelled) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      setLicensePreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return url;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [open, profile?.has_license, profile?.license_filename, loadLicensePreviewUrl]);

  useEffect(() => {
    return () => {
      if (licensePreviewUrl) URL.revokeObjectURL(licensePreviewUrl);
    };
  }, [licensePreviewUrl]);

  if (!open || !profile) return null;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      let next = await onSaveProfile({
        phone: phone.trim(),
        bank_name: bankName.trim(),
        account_number: accountNumber.trim(),
        resident_id: residentId.trim(),
      });
      if (licenseFile) {
        next = await onUploadLicense(licenseFile);
      }
      onSaved(next);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const previewIsPdf = (profile.license_filename || licenseFile?.name || "").toLowerCase().endsWith(".pdf");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <h2 className="text-lg font-semibold text-white">개인정보 설정</h2>
        <p className="mt-1 text-sm text-slate-400">
          정산 및 본인 확인에 필요한 정보를 입력해 주세요. 로그인 ID·비밀번호는 가입 화면에서만 변경할 수 있습니다.
        </p>

        <form className="mt-5 space-y-4" onSubmit={(event) => void onSubmit(event)}>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">로그인 ID</span>
            <input type="text" value={profile.login_id} readOnly className={`${fieldClassName()} text-slate-400`} />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">이름</span>
            <input type="text" value={profile.name} readOnly className={`${fieldClassName()} text-slate-400`} />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">휴대폰 번호</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="01012345678"
              className={fieldClassName()}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">주민등록번호</span>
            <input
              type="text"
              inputMode="numeric"
              value={residentId}
              onChange={(e) => setResidentId(formatResidentId(e.target.value))}
              placeholder="000000-0000000"
              className={fieldClassName()}
              autoComplete="off"
              maxLength={14}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">은행명</span>
            <input
              type="text"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="예: 국민은행"
              className={fieldClassName()}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">통장번호</span>
            <input
              type="text"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder="계좌번호 입력"
              className={fieldClassName()}
            />
          </label>

          <div>
            <span className="mb-1 block text-xs font-medium text-slate-500">속기사 자격증</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => setLicenseFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-violet-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-violet-500"
            />
            <p className="mt-1 text-xs text-slate-500">jpg, png, webp, pdf · 최대 10MB</p>
            {licenseFile ? (
              <p className="mt-2 text-xs text-cyan-300">선택됨: {licenseFile.name}</p>
            ) : profile.license_filename ? (
              <p className="mt-2 text-xs text-slate-400">등록됨: {profile.license_filename}</p>
            ) : null}
            {licensePreviewUrl && !licenseFile && !previewIsPdf ? (
              <img src={licensePreviewUrl} alt="속기사 자격증" className="mt-3 max-h-48 rounded-lg border border-slate-700" />
            ) : null}
            {licensePreviewUrl && !licenseFile && previewIsPdf ? (
              <a
                href={licensePreviewUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex text-sm text-cyan-300 hover:text-cyan-200"
              >
                등록된 PDF 자격증 보기
              </a>
            ) : null}
          </div>

          {error ? <p className="text-sm text-rose-300">{error}</p> : null}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
