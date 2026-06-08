import { useState, type FormEvent } from "react";
import { AuthShell } from "./AuthShell";
import {
  PhoneVerifyPreview,
  SignupActions,
  SignupError,
  SignupField,
  SignupHint,
  SignupRule,
  SignupSideButton,
  SignupSplit,
} from "./SignupFields";
import { checkTranscriberLoginId, signupTranscriber, type TranscriberAuthProfile } from "./api";

type TranscriberSignupProps = {
  onSuccess: (transcriber: TranscriberAuthProfile) => void;
  onLogin: () => void;
};

function normalizeLoginId(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, "").slice(0, 11);
}

export default function TranscriberSignup({ onSuccess, onLogin }: TranscriberSignupProps) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [residentId, setResidentId] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [loginIdHint, setLoginIdHint] = useState<{ text: string; tone: "ok" | "error" | "neutral" } | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [checkingLoginId, setCheckingLoginId] = useState(false);

  const verifyLoginId = async () => {
    const normalized = normalizeLoginId(loginId);
    setLoginId(normalized);
    if (normalized.length !== 8) {
      setLoginIdHint({ text: "로그인 ID는 영문·숫자 8자여야 합니다.", tone: "error" });
      return;
    }
    setCheckingLoginId(true);
    try {
      const available = await checkTranscriberLoginId(normalized);
      setLoginIdHint(
        available
          ? { text: "사용 가능한 로그인 ID입니다.", tone: "ok" }
          : { text: "이미 사용 중인 로그인 ID입니다.", tone: "error" },
      );
    } catch (err) {
      setLoginIdHint({
        text: err instanceof Error ? err.message : "로그인 ID 확인에 실패했습니다.",
        tone: "error",
      });
    } finally {
      setCheckingLoginId(false);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    const normalizedLoginId = normalizeLoginId(loginId);
    if (normalizedLoginId.length !== 8) {
      setError("로그인 ID는 영문·숫자 8자여야 합니다.");
      return;
    }
    if (password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (password !== passwordConfirm) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    if (!name.trim()) {
      setError("이름을 입력해 주세요.");
      return;
    }
    if (normalizePhone(phone).length < 10) {
      setError("휴대폰 번호를 올바르게 입력해 주세요.");
      return;
    }
    if (!residentId.trim()) {
      setError("주민등록번호를 입력해 주세요.");
      return;
    }
    if (!bankName.trim() || !accountNumber.trim()) {
      setError("은행명과 계좌번호를 입력해 주세요.");
      return;
    }

    setSubmitting(true);
    try {
      const available = await checkTranscriberLoginId(normalizedLoginId);
      if (!available) {
        setError("이미 사용 중인 로그인 ID입니다.");
        return;
      }
      const transcriber = await signupTranscriber({
        login_id: normalizedLoginId,
        password,
        name: name.trim(),
        phone: normalizePhone(phone),
        resident_id: residentId.trim(),
        bank_name: bankName.trim(),
        account_number: accountNumber.trim(),
      });
      onSuccess(transcriber);
    } catch (err) {
      setError(err instanceof Error ? err.message : "회원가입에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="회원가입" desc="통합증거센터 녹취사무소">
      <form className="grid gap-3" onSubmit={onSubmit}>
        <SignupField
          value={name}
          onChange={(event) => setName(event.target.value)}
          onClear={() => setName("")}
          placeholder="이름을 입력해 주세요."
          autoComplete="name"
          required
        />

        <SignupSplit>
          <SignupField
            value={loginId}
            onChange={(event) => {
              setLoginId(normalizeLoginId(event.target.value));
              setLoginIdHint(null);
            }}
            onClear={() => {
              setLoginId("");
              setLoginIdHint(null);
            }}
            placeholder="로그인 ID (영문·숫자 8자)"
            autoComplete="username"
            required
            maxLength={8}
          />
          <SignupSideButton disabled={checkingLoginId} onClick={() => void verifyLoginId()}>
            중복확인
          </SignupSideButton>
        </SignupSplit>
        {loginIdHint ? <SignupHint tone={loginIdHint.tone}>{loginIdHint.text}</SignupHint> : null}

        <SignupField
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="비밀번호"
          autoComplete="new-password"
          showPasswordToggle
          required
          minLength={8}
        />

        <SignupField
          value={passwordConfirm}
          onChange={(event) => setPasswordConfirm(event.target.value)}
          placeholder="비밀번호 확인"
          autoComplete="new-password"
          showPasswordToggle
          required
          minLength={8}
        />
        <SignupRule>✓ 8자 이상 입력해 주세요</SignupRule>

        <SignupField
          value={phone}
          onChange={(event) => setPhone(normalizePhone(event.target.value))}
          onClear={() => setPhone("")}
          type="tel"
          placeholder="휴대폰 ('-' 제외하고 입력)"
          autoComplete="tel"
          required
        />

        <SignupField
          value={residentId}
          onChange={(event) => setResidentId(event.target.value.replace(/[^\d-]/g, "").slice(0, 14))}
          onClear={() => setResidentId("")}
          placeholder="주민등록번호 (관리자 등록 정보와 동일)"
          required
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <SignupField
            value={bankName}
            onChange={(event) => setBankName(event.target.value)}
            onClear={() => setBankName("")}
            placeholder="은행명"
            required
          />
          <SignupField
            value={accountNumber}
            onChange={(event) => setAccountNumber(event.target.value.replace(/[^\d-]/g, ""))}
            onClear={() => setAccountNumber("")}
            placeholder="계좌번호"
            required
          />
        </div>

        <PhoneVerifyPreview />

        {error ? <SignupError>{error}</SignupError> : null}

        <SignupActions submitLabel="가입하기" submitting={submitting} onCancel={onLogin} />
      </form>

    </AuthShell>
  );
}
