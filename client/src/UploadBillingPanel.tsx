import { useEffect, useMemo, useRef, useState } from "react";
import * as PortOne from "@portone/browser-sdk/v2";

import TimeHmsSelect from "./TimeHmsSelect";
import { completePortOnePayment, fetchPortOnePublicConfig, preparePortOnePayment } from "./api";
import { isKakaoInAppBrowser } from "./inAppBrowser";
import {
  buildPaymentRedirectUrl,
  shouldForceMobilePaymentRedirect,
} from "./uploadEnvironment";
import {
  ZERO_HMS,
  calculateQuote,
  clampHms,
  formatDurationHuman,
  formatKrw,
  formatSegmentClock,
  hmsToMs,
  msToHms,
  readMediaDuration,
  type QuoteSegment,
} from "./quotePricing";
import { playSegmentAudio } from "./segmentAudio";
import {
  createUploadSegment,
  fileBillableDurationMs,
  isUploadBillingReady,
  totalBillableDurationMs,
  type UploadBillingFile,
  type UploadBillingMode,
} from "./uploadBilling";

export type BillingRestoreHint = {
  mode: UploadBillingMode;
  segments: QuoteSegment[];
  durationMs?: number | null;
};

type UploadBillingPanelProps = {
  files: File[];
  fileIdentity: (file: File) => string;
  formatSize: (bytes: number) => string;
  paid: boolean;
  uploading?: boolean;
  holdPaidState?: boolean;
  billingRestoreByKey?: Record<string, BillingRestoreHint>;
  onPaidChange: (paid: boolean) => void;
  onPaymentConfirmed?: () => void;
  onRemoveFile: (file: File) => void;
  onEntriesChange?: (entries: UploadBillingFile[]) => void;
  onPaymentPending?: (payload: { paymentId: string; amount: number; orderName: string } | null) => void | Promise<void>;
};

function formatSegmentRange(startMs: number, endMs: number): string {
  return `${formatSegmentClock(startMs)} ~ ${formatSegmentClock(endMs)}`;
}

function revokeUrls(entries: UploadBillingFile[]) {
  for (const entry of entries) {
    URL.revokeObjectURL(entry.url);
  }
}

export default function UploadBillingPanel({
  files,
  fileIdentity,
  formatSize,
  paid,
  uploading = false,
  holdPaidState = false,
  billingRestoreByKey,
  onPaidChange,
  onPaymentConfirmed,
  onRemoveFile,
  onEntriesChange,
  onPaymentPending,
}: UploadBillingPanelProps) {
  const entriesRef = useRef<UploadBillingFile[]>([]);
  const paidBillableRef = useRef<number | null>(null);
  const [entries, setEntries] = useState<UploadBillingFile[]>([]);
  const [segmentForms, setSegmentForms] = useState<Record<string, { start: typeof ZERO_HMS; end: typeof ZERO_HMS }>>({});
  const [segmentFormErrors, setSegmentFormErrors] = useState<Record<string, string>>({});
  const [paymentError, setPaymentError] = useState("");
  const [purchaseAgreementChecked, setPurchaseAgreementChecked] = useState(false);

  const billableDurationMs = useMemo(() => totalBillableDurationMs(entries), [entries]);
  const quote = useMemo(() => calculateQuote(billableDurationMs), [billableDurationMs]);
  const billingReady = useMemo(
    () => isUploadBillingReady(entries) && (quote.tier != null || (quote.totalWithVat ?? 0) > 0),
    [entries, quote],
  );

  entriesRef.current = entries;

  useEffect(() => {
    return () => {
      revokeUrls(entriesRef.current);
    };
  }, []);

  useEffect(() => {
    const incomingKeys = new Set(files.map(fileIdentity));

    setEntries((prev) => {
      const kept = prev.filter((entry) => incomingKeys.has(entry.key));
      const keptKeys = new Set(kept.map((entry) => entry.key));
      const added = files
        .filter((file) => !keptKeys.has(fileIdentity(file)))
        .map((file) => {
          const key = fileIdentity(file);
          const restored = billingRestoreByKey?.[key];
          const durationMs = restored?.durationMs ?? null;
          return {
            key,
            file,
            url: URL.createObjectURL(file),
            durationMs,
            loading: durationMs == null,
            error: "",
            mode: restored?.mode ?? ("full" as UploadBillingMode),
            segments: restored?.segments ?? ([] as QuoteSegment[]),
          };
        });

      const removed = prev.filter((entry) => !incomingKeys.has(entry.key));
      for (const entry of removed) {
        URL.revokeObjectURL(entry.url);
      }

      return [...kept, ...added];
    });
  }, [billingRestoreByKey, files, fileIdentity]);

  const loadingKeysRef = useRef(new Set<string>());

  useEffect(() => {
    const pending = entries.filter((entry) => entry.loading && !loadingKeysRef.current.has(entry.key));
    if (!pending.length) return;

    for (const entry of pending) {
      loadingKeysRef.current.add(entry.key);
      void readMediaDuration(entry.file)
        .then((durationMs) => {
          setEntries((prev) =>
            prev.map((item) =>
              item.key === entry.key ? { ...item, durationMs, loading: false, error: "" } : item,
            ),
          );
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : "재생 시간을 확인할 수 없습니다.";
          setEntries((prev) =>
            prev.map((item) =>
              item.key === entry.key ? { ...item, durationMs: null, loading: false, error: message } : item,
            ),
          );
        });
    }
  }, [entries]);

  useEffect(() => {
    if (!paid) {
      paidBillableRef.current = null;
      return;
    }
    if (!billingReady) {
      if (!holdPaidState) onPaidChange(false);
      return;
    }
    if (paidBillableRef.current === null) {
      paidBillableRef.current = billableDurationMs;
      return;
    }
    if (billableDurationMs !== paidBillableRef.current) {
      if (!holdPaidState) onPaidChange(false);
    }
  }, [billingReady, billableDurationMs, holdPaidState, paid, onPaidChange]);

  useEffect(() => {
    onEntriesChange?.(entries);
  }, [entries, onEntriesChange]);

  useEffect(() => {
    setPaymentError("");
  }, [billableDurationMs, quote.totalWithVat]);

  useEffect(() => {
    setPurchaseAgreementChecked(false);
  }, [billableDurationMs, entries.length]);

  const updateEntry = (key: string, patch: Partial<UploadBillingFile>) => {
    setEntries((prev) => prev.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)));
  };

  const getSegmentForm = (key: string) => segmentForms[key] ?? { start: ZERO_HMS, end: ZERO_HMS };

  const setSegmentForm = (key: string, patch: Partial<{ start: typeof ZERO_HMS; end: typeof ZERO_HMS }>) => {
    setSegmentForms((prev) => ({
      ...prev,
      [key]: { ...getSegmentForm(key), ...patch },
    }));
  };

  const addSegment = (entry: UploadBillingFile) => {
    if (!entry.durationMs) return;

    const form = getSegmentForm(entry.key);
    const start_ms = hmsToMs(form.start);
    const end_ms = hmsToMs(form.end);

    if (end_ms <= start_ms) {
      setSegmentFormErrors((prev) => ({ ...prev, [entry.key]: "종료 시간은 시작 시간보다 늦어야 합니다." }));
      return;
    }
    if (end_ms > entry.durationMs) {
      setSegmentFormErrors((prev) => ({ ...prev, [entry.key]: "종료 시간이 파일 길이를 넘을 수 없습니다." }));
      return;
    }

    const segment = createUploadSegment(entry.key, start_ms, end_ms);
    updateEntry(entry.key, {
      segments: [...entry.segments, segment].sort((left, right) => left.start_ms - right.start_ms || left.end_ms - right.end_ms),
    });
    setSegmentForm(entry.key, { start: ZERO_HMS, end: ZERO_HMS });
    setSegmentFormErrors((prev) => ({ ...prev, [entry.key]: "" }));
  };

  const handlePay = async () => {
    if (!billingReady || !quote.tier) return;
    setPaymentError("");
    try {
      if (isKakaoInAppBrowser()) {
        throw new Error("카카오톡 브라우저에서는 결제 후 업로드가 실패할 수 있습니다. 상단 '크롬에서 열기' 또는 'Safari에서 열기' 후 다시 시도해 주세요.");
      }

      const config = await fetchPortOnePublicConfig();
      if (!config.portonePaymentEnabled || !config.portoneStoreId || !config.portonePaymentChannelKey) {
        throw new Error("포트원 결제 설정이 아직 완료되지 않았습니다.");
      }

      const totalAmount = quote.totalWithVat ?? 0;
      const paymentId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? `payment-${crypto.randomUUID()}`
          : `payment-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const orderName =
        entries.length > 1
          ? `녹취록 업로드 ${entries.length}건`
          : `${entries[0]?.file.name ?? "녹취록 업로드"} 결제`;
      await Promise.resolve(onPaymentPending?.({ paymentId, amount: totalAmount, orderName }));

      const useServerRedirect = shouldForceMobilePaymentRedirect();
      let redirectUrl = buildPaymentRedirectUrl();
      if (useServerRedirect) {
        try {
          const prepared = await preparePortOnePayment({
            paymentId,
            amount: totalAmount,
            orderName,
            returnTo: buildPaymentRedirectUrl(),
          });
          redirectUrl = prepared.redirectUrl;
        } catch (err) {
          const message = err instanceof Error ? err.message : "결제 준비 실패";
          throw err instanceof Error ? err : new Error(message);
        }
      }

      const response = await PortOne.requestPayment({
        storeId: config.portoneStoreId,
        channelKey: config.portonePaymentChannelKey,
        paymentId,
        orderName,
        totalAmount,
        currency: "CURRENCY_KRW",
        payMethod: "CARD",
        redirectUrl,
        forceRedirect: useServerRedirect,
      });

      if (useServerRedirect) {
        return;
      }

      if (!response) {
        throw new Error("결제 결과를 확인하지 못했습니다.");
      }
      if (response.code !== undefined) {
        throw new Error(response.message || "결제가 취소되었습니다.");
      }

      try {
        await completePortOnePayment({ paymentId, amount: totalAmount, orderName });
      } catch {
        // PortOne checkout succeeded; continue upload even if server confirmation fails.
      }
      onPaymentPending?.(null);
      paidBillableRef.current = billableDurationMs;
      onPaidChange(true);
      onPaymentConfirmed?.();
    } catch (error) {
      onPaymentPending?.(null);
      setPaymentError(error instanceof Error ? error.message : "결제에 실패했습니다.");
    }
  };

  if (!entries.length) return null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-soft p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-brown/80">파일별 업로드 범위</p>
        <div className="space-y-3">
          {entries.map((entry) => (
            <UploadFileBillingCard
              key={entry.key}
              entry={entry}
              formatSize={formatSize}
              segmentForm={getSegmentForm(entry.key)}
              segmentFormError={segmentFormErrors[entry.key] ?? ""}
              billableDurationMs={fileBillableDurationMs(entry)}
              onModeChange={(mode) => updateEntry(entry.key, { mode })}
              onRemove={() => onRemoveFile(entry.file)}
              onSegmentFormChange={(patch) => setSegmentForm(entry.key, patch)}
              onAddSegment={() => addSegment(entry)}
              onSegmentsChange={(segments) => updateEntry(entry.key, { segments })}
            />
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-brand-orange/30 bg-gradient-to-br from-brand-orange/10 to-soft px-4 py-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-orange">결제 견적</p>

        {entries.some((entry) => entry.loading) ? (
          <p className="mt-2 text-sm text-brand-brown">파일 재생 시간을 확인하는 중입니다…</p>
        ) : !billingReady ? (
          <p className="mt-2 text-sm text-amber-700">
            구간 선택 파일은 구간을 추가해야 견적이 완료됩니다.
          </p>
        ) : quote.tier || (quote.totalWithVat ?? 0) > 0 ? (
          <>
            <p className="mt-2 text-sm text-brand-navy">
              계산 기준 시간: <span className="font-semibold text-brand-navy">{formatDurationHuman(quote.durationMs)}</span>
            </p>
            <p className="mt-1 text-sm text-brand-navy">
              적용 구간: <span className="font-semibold text-brand-navy">{quote.label || quote.tier?.label || "-"}</span>
            </p>
            {quote.overLimit && (quote.extraMinutes ?? 0) > 0 ? (
              <p className="mt-1 text-sm text-amber-700">
                60분 요금에 초과 {quote.extraMinutes}분 x 분당 3,000원이 추가됩니다.
              </p>
            ) : null}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-soft px-3 py-3">
                <p className="text-xs text-brand-brown/80">PDF 기본요금</p>
                <p className="mt-1 text-lg font-bold text-brand-navy">{formatKrw(quote.totalBaseFee ?? quote.tier?.baseFee ?? 0)}</p>
              </div>
              <div className="rounded-xl border border-brand-orange/30 bg-brand-orange/10 px-3 py-3">
                <p className="text-xs text-brand-orange/80">부가세 포함 결제금액</p>
                <p className="mt-1 text-2xl font-bold text-brand-navy">{formatKrw(quote.totalWithVat ?? quote.tier?.totalWithVat ?? 0)}</p>
              </div>
            </div>
          </>
        ) : null}

        <label
          className={`mt-4 flex gap-3 rounded-xl border border-line/80 bg-soft px-3 py-3 ${
            purchaseAgreementChecked ? "items-center" : "items-start"
          }`}
        >
          <input
            type="checkbox"
            checked={purchaseAgreementChecked}
            onChange={(event) => setPurchaseAgreementChecked(event.target.checked)}
            className={`h-4 w-4 shrink-0 rounded border-line-strong bg-white text-brand-orange focus:ring-brand-orange/40 ${
              purchaseAgreementChecked ? "" : "mt-0.5"
            }`}
          />
          <span className="text-sm leading-6 text-brand-navy">
            <span className="block font-semibold text-brand-navy">구매조건 및 결제진행 동의</span>
            {!purchaseAgreementChecked ? (
              <span className="mt-1 block text-brand-brown">
                결제 후 녹취록 작성 작업이 즉시 진행되며, 작업이 시작된 이후에는 단순 취소 및 환불이 어렵습니다. 음질,
                잡음, 대화자 수, 화자 구분 난이도 등에 따라 추가 요금 또는 일정 변경이나 취소 환불이 발생할 수 있음을
                확인하고 동의합니다.
              </span>
            ) : null}
          </span>
        </label>

        <div className="mt-4 flex flex-wrap gap-2">
          {uploading ? (
            <span className="inline-flex items-center rounded-xl border border-brand-orange/30 bg-brand-orange/10 px-4 py-2.5 text-sm font-semibold text-brand-navy">
              업로드 진행 중...
            </span>
          ) : paid && billingReady ? (
            <span className="inline-flex items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-700">
              결제 완료
            </span>
          ) : paid && !billingReady && holdPaidState ? (
            <span className="inline-flex items-center rounded-xl border border-brand-orange/30 bg-brand-orange/10 px-4 py-2.5 text-sm font-semibold text-brand-navy">
              결제 완료 · 업로드 준비 중…
            </span>
          ) : paid && !billingReady ? (
            <span className="inline-flex items-center rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-700">
              견적이 변경되어 결제를 다시 진행해 주세요.
            </span>
          ) : (
            <button
              type="button"
              onClick={handlePay}
              disabled={!billingReady || (quote.totalWithVat ?? 0) <= 0 || !purchaseAgreementChecked}
              className="rounded-xl bg-brand-orange px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-orange-dark disabled:cursor-not-allowed disabled:bg-muted disabled:text-brand-brown"
            >
              {(quote.totalWithVat ?? 0) > 0 ? `${formatKrw(quote.totalWithVat ?? 0)} 결제하기` : "결제하기"}
            </button>
          )}
        </div>

        {paymentError ? (
          <p className="mt-3 text-xs text-red-700">{paymentError}</p>
        ) : null}
      </div>
    </div>
  );
}

function UploadFileBillingCard({
  entry,
  formatSize,
  segmentForm,
  segmentFormError,
  billableDurationMs,
  onModeChange,
  onRemove,
  onSegmentFormChange,
  onAddSegment,
  onSegmentsChange,
}: {
  entry: UploadBillingFile;
  formatSize: (bytes: number) => string;
  segmentForm: { start: typeof ZERO_HMS; end: typeof ZERO_HMS };
  segmentFormError: string;
  billableDurationMs: number;
  onModeChange: (mode: UploadBillingMode) => void;
  onRemove: () => void;
  onSegmentFormChange: (patch: Partial<{ start: typeof ZERO_HMS; end: typeof ZERO_HMS }>) => void;
  onAddSegment: () => void;
  onSegmentsChange: (segments: QuoteSegment[]) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const segmentEndRef = useRef<number | null>(null);

  const setCurrentTimeToForm = (field: "start" | "end") => {
    const audio = audioRef.current;
    if (!audio || !entry.durationMs) return;
    const next = clampHms(msToHms(Math.floor(audio.currentTime * 1000)), entry.durationMs);
    onSegmentFormChange({ [field]: next });
  };

  const playSegment = (startMs: number, endMs: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    void playSegmentAudio(audio, segmentEndRef, startMs, endMs);
  };

  return (
    <div className="rounded-xl border border-line bg-white/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-brand-navy">{entry.file.name}</p>
          <p className="mt-1 text-xs text-brand-brown/80">
            {formatSize(entry.file.size)}
            {entry.loading
              ? " · 재생 시간 확인 중…"
              : entry.error
                ? ` · ${entry.error}`
                : entry.durationMs != null
                  ? ` · ${formatDurationHuman(entry.durationMs)}`
                  : ""}
            {billableDurationMs > 0 ? ` · 견적 ${formatDurationHuman(billableDurationMs)}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-lg border border-rose-500/30 px-2.5 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-rose-500/10"
        >
          제거
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-line bg-soft p-1">
        <button
          type="button"
          onClick={() => onModeChange("full")}
          className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
            entry.mode === "full" ? "bg-brand-orange text-white" : "text-brand-brown hover:text-brand-navy"
          }`}
        >
          파일 전체
        </button>
        <button
          type="button"
          onClick={() => onModeChange("segments")}
          className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
            entry.mode === "segments" ? "bg-brand-orange text-white" : "text-brand-brown hover:text-brand-navy"
          }`}
        >
          구간 선택
        </button>
      </div>

      {entry.mode === "segments" && entry.durationMs != null && !entry.error ? (
        <div className="mt-3 space-y-3 rounded-xl border border-line bg-soft p-3">
          <audio ref={audioRef} controls preload="metadata" src={entry.url} className="w-full rounded-xl" />
          <TimeHmsSelect
            label="시작"
            value={segmentForm.start}
            maxMs={entry.durationMs}
            onChange={(start) => onSegmentFormChange({ start })}
          />
          <TimeHmsSelect
            label="종료"
            value={segmentForm.end}
            maxMs={entry.durationMs}
            onChange={(end) => onSegmentFormChange({ end })}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCurrentTimeToForm("start")}
              className="rounded-lg border border-line px-2.5 py-2 text-xs font-semibold text-brand-navy transition hover:bg-muted"
            >
              현재→시작
            </button>
            <button
              type="button"
              onClick={() => setCurrentTimeToForm("end")}
              className="rounded-lg border border-line px-2.5 py-2 text-xs font-semibold text-brand-navy transition hover:bg-muted"
            >
              현재→종료
            </button>
            <button
              type="button"
              onClick={onAddSegment}
              className="rounded-lg bg-brand-orange px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-orange-dark"
            >
              구간 추가
            </button>
          </div>
          {segmentFormError ? <p className="text-sm text-red-700">{segmentFormError}</p> : null}

          <div className="space-y-2">
            {entry.segments.length ? (
              entry.segments.map((segment) => {
                const segmentDuration = Math.max(0, segment.end_ms - segment.start_ms);
                return (
                  <div
                    key={segment.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-white px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      checked={segment.selected}
                      onChange={(event) =>
                        onSegmentsChange(
                          entry.segments.map((item) =>
                            item.id === segment.id ? { ...item, selected: event.target.checked } : item,
                          ),
                        )
                      }
                      className="h-4 w-4 rounded border-line-strong bg-page text-brand-orange"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-brand-navy">{formatSegmentRange(segment.start_ms, segment.end_ms)}</p>
                      <p className="text-xs text-brand-brown/80">{formatDurationHuman(segmentDuration)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => playSegment(segment.start_ms, segment.end_ms)}
                      className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-brand-navy transition hover:bg-muted"
                    >
                      재생
                    </button>
                    <button
                      type="button"
                      onClick={() => onSegmentsChange(entry.segments.filter((item) => item.id !== segment.id))}
                      className="rounded-lg border border-rose-500/30 px-2.5 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-rose-500/10"
                    >
                      삭제
                    </button>
                  </div>
                );
              })
            ) : (
              <p className="text-center text-xs text-brand-brown/80">추가할 구간을 선택해 주세요.</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
