import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createExpenseCategory,
  createExpenseRecord,
  deleteExpenseCategory,
  deleteExpenseRecord,
  fetchExpensesOverview,
  updateExpenseCategory,
  updateExpenseRecord,
  type ExpenseCategory,
  type ExpenseRecord,
} from "./api";
import { todayKstDateKey } from "./formatKstDateTime";

function formatCurrency(value: number): string {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function SummaryChip({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "slate" | "cyan" | "amber";
}) {
  const toneClass =
    tone === "cyan"
      ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-100"
      : tone === "amber"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
        : "border-slate-700 bg-slate-950/70 text-slate-200";
  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

export default function ExpenseManagement() {
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [records, setRecords] = useState<ExpenseRecord[]>([]);
  const [dateFrom, setDateFrom] = useState(() => todayKstDateKey());
  const [dateTo, setDateTo] = useState(() => todayKstDateKey());

  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");

  const [formCategoryId, setFormCategoryId] = useState<number | "">("");
  const [formAmount, setFormAmount] = useState("");
  const [formDate, setFormDate] = useState(() => todayKstDateKey());
  const [formNote, setFormNote] = useState("");
  const [editingRecordId, setEditingRecordId] = useState<number | null>(null);
  const [editRecordCategoryId, setEditRecordCategoryId] = useState<number | "">("");
  const [editRecordAmount, setEditRecordAmount] = useState("");
  const [editRecordDate, setEditRecordDate] = useState("");
  const [editRecordNote, setEditRecordNote] = useState("");

  const activeCategories = useMemo(
    () => categories.filter((item) => item.is_active),
    [categories],
  );

  const periodTotal = useMemo(
    () => records.reduce((sum, item) => sum + item.amount, 0),
    [records],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchExpensesOverview({ dateFrom, dateTo });
      setCategories(data.categories);
      setRecords(data.records);
    } catch (err) {
      console.error(err);
      window.alert(err instanceof Error ? err.message : "지출 데이터를 불러올 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (formCategoryId !== "") return;
    const first = activeCategories[0];
    if (first) setFormCategoryId(first.id);
  }, [activeCategories, formCategoryId]);

  const handleAddCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) {
      window.alert("지출항목 이름을 입력해 주세요.");
      return;
    }
    try {
      await createExpenseCategory({ name });
      setNewCategoryName("");
      await loadData();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "지출항목 추가 실패");
    }
  };

  const handleSaveCategory = async (categoryId: number) => {
    const name = editingCategoryName.trim();
    if (!name) {
      window.alert("지출항목 이름을 입력해 주세요.");
      return;
    }
    try {
      await updateExpenseCategory(categoryId, { name });
      setEditingCategoryId(null);
      setEditingCategoryName("");
      await loadData();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "지출항목 수정 실패");
    }
  };

  const handleToggleCategory = async (category: ExpenseCategory) => {
    try {
      await updateExpenseCategory(category.id, { is_active: !category.is_active });
      await loadData();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "지출항목 상태 변경 실패");
    }
  };

  const handleDeleteCategory = async (category: ExpenseCategory) => {
    if (!window.confirm(`「${category.name}」 항목을 삭제하시겠습니까?`)) return;
    try {
      await deleteExpenseCategory(category.id);
      await loadData();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "지출항목 삭제 실패");
      await loadData();
    }
  };

  const handleSubmitRecord = async () => {
    if (formCategoryId === "") {
      window.alert("지출항목을 선택해 주세요.");
      return;
    }
    const amount = Number(formAmount.replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      window.alert("지출 금액을 입력해 주세요.");
      return;
    }
    try {
      await createExpenseRecord({
        category_id: formCategoryId,
        amount,
        expense_date: formDate,
        note: formNote.trim() || undefined,
      });
      setFormAmount("");
      setFormNote("");
      setFormDate(todayKstDateKey());
      await loadData();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "지출 입력 실패");
    }
  };

  const startEditRecord = (record: ExpenseRecord) => {
    setEditingRecordId(record.id);
    setEditRecordCategoryId(record.category_id);
    setEditRecordAmount(String(record.amount));
    setEditRecordDate(record.expense_date);
    setEditRecordNote(record.note);
  };

  const handleSaveRecord = async () => {
    if (editingRecordId === null || editRecordCategoryId === "") return;
    const amount = Number(editRecordAmount.replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      window.alert("지출 금액을 입력해 주세요.");
      return;
    }
    try {
      await updateExpenseRecord(editingRecordId, {
        category_id: editRecordCategoryId,
        amount,
        expense_date: editRecordDate,
        note: editRecordNote.trim(),
      });
      setEditingRecordId(null);
      await loadData();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "지출 수정 실패");
    }
  };

  const handleDeleteRecord = async (record: ExpenseRecord) => {
    if (record.source_type) {
      window.alert("자동 연동된 지출은 삭제할 수 없습니다.");
      return;
    }
    if (!window.confirm("이 지출 내역을 삭제하시겠습니까?")) return;
    try {
      await deleteExpenseRecord(record.id);
      await loadData();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "지출 삭제 실패");
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/92 p-4 shadow-[0_10px_30px_rgba(2,6,23,0.28)]">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-white">지출항목 관리</h3>
            <p className="mt-1 text-xs text-slate-400">기본 6개 항목 외에도 항목을 추가·수정할 수 있습니다.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={newCategoryName}
              onChange={(event) => setNewCategoryName(event.target.value)}
              placeholder="새 지출항목"
              className="rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200"
            />
            <button
              type="button"
              onClick={() => void handleAddCategory()}
              className="rounded-md border border-cyan-500/40 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/25"
            >
              항목 추가
            </button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/70">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                <th className="px-3 py-2">항목명</th>
                <th className="px-3 py-2">순서</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2">작업</th>
              </tr>
            </thead>
            <tbody>
              {categories.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                    {loading ? "불러오는 중..." : "등록된 지출항목이 없습니다."}
                  </td>
                </tr>
              ) : (
                categories.map((category) => (
                  <tr key={category.id} className="border-t border-slate-800 text-slate-300">
                    <td className="px-3 py-2">
                      {editingCategoryId === category.id ? (
                        <input
                          type="text"
                          value={editingCategoryName}
                          onChange={(event) => setEditingCategoryName(event.target.value)}
                          className="w-full rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1 text-sm text-white"
                        />
                      ) : (
                        <span className={category.is_active ? "text-white" : "text-slate-500 line-through"}>
                          {category.name}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">{category.sort_order}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-md px-2 py-1 text-[11px] font-semibold ${
                          category.is_active
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-slate-700/50 text-slate-400"
                        }`}
                      >
                        {category.is_active ? "사용" : "비활성"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        {editingCategoryId === category.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleSaveCategory(category.id)}
                              className="rounded-md border border-cyan-500/40 px-2 py-1 text-[11px] text-cyan-200"
                            >
                              저장
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingCategoryId(null);
                                setEditingCategoryName("");
                              }}
                              className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-400"
                            >
                              취소
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingCategoryId(category.id);
                                setEditingCategoryName(category.name);
                              }}
                              className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300"
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleToggleCategory(category)}
                              className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300"
                            >
                              {category.is_active ? "비활성" : "활성"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteCategory(category)}
                              className="rounded-md border border-rose-500/30 px-2 py-1 text-[11px] text-rose-300"
                            >
                              삭제
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/92 p-4 shadow-[0_10px_30px_rgba(2,6,23,0.28)]">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-base font-semibold text-white">지출 입력 · 목록</h3>
            <p className="mt-1 text-xs text-slate-400">기간별 지출 내역을 입력하고 조회합니다.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[11px] text-slate-400">
              <span>조회 시작</span>
              <input
                type="date"
                value={dateFrom}
                max={dateTo}
                onChange={(event) => {
                  const nextFrom = event.target.value;
                  setDateFrom(nextFrom);
                  if (nextFrom > dateTo) setDateTo(nextFrom);
                }}
                className="rounded-md border border-slate-700 bg-slate-950/70 px-2.5 py-1.5 text-[12px] text-slate-200"
              />
            </label>
            <span className="text-xs text-slate-500">~</span>
            <label className="flex items-center gap-2 text-[11px] text-slate-400">
              <span>조회 종료</span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom}
                onChange={(event) => {
                  const nextTo = event.target.value;
                  setDateTo(nextTo);
                  if (nextTo < dateFrom) setDateFrom(nextTo);
                }}
                className="rounded-md border border-slate-700 bg-slate-950/70 px-2.5 py-1.5 text-[12px] text-slate-200"
              />
            </label>
          </div>
        </div>

        <div className="mb-4 grid gap-2 md:grid-cols-2">
          <SummaryChip label="조회 건수" value={`${records.length}건`} />
          <SummaryChip label="기간 합계" value={formatCurrency(periodTotal)} tone="cyan" />
        </div>

        <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">새 지출 입력</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="block text-[11px] text-slate-400">
              지출항목
              <select
                value={formCategoryId}
                onChange={(event) => setFormCategoryId(Number(event.target.value))}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/70 px-2.5 py-2 text-sm text-slate-200"
              >
                {activeCategories.length === 0 ? (
                  <option value="">항목 없음</option>
                ) : (
                  activeCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="block text-[11px] text-slate-400">
              금액
              <input
                type="number"
                min={1}
                value={formAmount}
                onChange={(event) => setFormAmount(event.target.value)}
                placeholder="0"
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/70 px-2.5 py-2 text-sm text-slate-200"
              />
            </label>
            <label className="block text-[11px] text-slate-400">
              지출일
              <input
                type="date"
                value={formDate}
                onChange={(event) => setFormDate(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/70 px-2.5 py-2 text-sm text-slate-200"
              />
            </label>
            <label className="block text-[11px] text-slate-400 md:col-span-2 xl:col-span-1">
              메모
              <input
                type="text"
                value={formNote}
                onChange={(event) => setFormNote(event.target.value)}
                placeholder="선택 입력"
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/70 px-2.5 py-2 text-sm text-slate-200"
              />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => void handleSubmitRecord()}
                disabled={activeCategories.length === 0}
                className="w-full rounded-md border border-cyan-500/40 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                지출 등록
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/70">
          {records.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500">
              {loading ? "불러오는 중..." : "선택한 기간에 지출 내역이 없습니다."}
            </p>
          ) : (
            <table className="w-full min-w-[920px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  <th className="px-3 py-2">지출일</th>
                  <th className="px-3 py-2">항목</th>
                  <th className="px-3 py-2">금액</th>
                  <th className="px-3 py-2">메모</th>
                  <th className="px-3 py-2">구분</th>
                  <th className="px-3 py-2">작업</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id} className="border-t border-slate-800 text-slate-300">
                    <td className="px-3 py-2">
                      {editingRecordId === record.id ? (
                        <input
                          type="date"
                          value={editRecordDate}
                          onChange={(event) => setEditRecordDate(event.target.value)}
                          className="rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1 text-sm"
                        />
                      ) : (
                        record.expense_date
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editingRecordId === record.id ? (
                        <select
                          value={editRecordCategoryId}
                          onChange={(event) => setEditRecordCategoryId(Number(event.target.value))}
                          className="rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1 text-sm"
                        >
                          {activeCategories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        record.category_name
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editingRecordId === record.id ? (
                        <input
                          type="number"
                          min={1}
                          value={editRecordAmount}
                          onChange={(event) => setEditRecordAmount(event.target.value)}
                          className="w-28 rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1 text-sm"
                        />
                      ) : (
                        formatCurrency(record.amount)
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editingRecordId === record.id ? (
                        <input
                          type="text"
                          value={editRecordNote}
                          onChange={(event) => setEditRecordNote(event.target.value)}
                          className="w-full min-w-[120px] rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1 text-sm"
                        />
                      ) : (
                        record.note || "-"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {record.source_type ? (
                        <span className="inline-flex rounded-md bg-violet-500/15 px-2 py-1 text-[11px] font-semibold text-violet-300">
                          자동
                        </span>
                      ) : (
                        <span className="inline-flex rounded-md bg-slate-700/50 px-2 py-1 text-[11px] font-semibold text-slate-300">
                          수동
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {record.source_type ? (
                        <span className="text-[11px] text-slate-500">-</span>
                      ) : editingRecordId === record.id ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void handleSaveRecord()}
                            className="rounded-md border border-cyan-500/40 px-2 py-1 text-[11px] text-cyan-200"
                          >
                            저장
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingRecordId(null)}
                            className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-400"
                          >
                            취소
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => startEditRecord(record)}
                            className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300"
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteRecord(record)}
                            className="rounded-md border border-rose-500/30 px-2 py-1 text-[11px] text-rose-300"
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
