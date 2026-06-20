export type DiffOp = "equal" | "insert" | "delete";

export type DiffPart = {
  op: DiffOp;
  text: string;
};

const CHAR_DIFF_LIMIT = 1200;
const DIFF_CELL_LIMIT = 900_000;

export function diffText(before: string, after: string): DiffPart[] {
  if (before === after) {
    return before ? [{ op: "equal", text: before }] : [];
  }
  if (!before) {
    return after ? [{ op: "insert", text: after }] : [];
  }
  if (!after) {
    return [{ op: "delete", text: before }];
  }

  const useWords = before.length > CHAR_DIFF_LIMIT || after.length > CHAR_DIFF_LIMIT;
  const tokens = useWords
    ? diffTokens(tokenizeWords(before), tokenizeWords(after))
    : diffTokens(toChars(before), toChars(after));

  return mergeParts(tokens);
}

function toChars(value: string): string[] {
  return [...value];
}

function tokenizeWords(value: string): string[] {
  return value.match(/\S+|\s+/g) ?? [value];
}

function diffTokens(beforeTokens: string[], afterTokens: string[]): DiffPart[] {
  const n = beforeTokens.length;
  const m = afterTokens.length;

  if (n * m > DIFF_CELL_LIMIT) {
    return [
      { op: "delete", text: beforeTokens.join("") },
      { op: "insert", text: afterTokens.join("") },
    ];
  }

  const dp = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      if (beforeTokens[i - 1] === afterTokens[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const reversed: DiffPart[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && beforeTokens[i - 1] === afterTokens[j - 1]) {
      reversed.push({ op: "equal", text: beforeTokens[i - 1] });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      reversed.push({ op: "insert", text: afterTokens[j - 1] });
      j -= 1;
    } else {
      reversed.push({ op: "delete", text: beforeTokens[i - 1] });
      i -= 1;
    }
  }

  reversed.reverse();
  return mergeParts(reversed);
}

function mergeParts(parts: DiffPart[]): DiffPart[] {
  const merged: DiffPart[] = [];
  for (const part of parts) {
    if (!part.text) continue;
    const last = merged[merged.length - 1];
    if (last && last.op === part.op) {
      last.text += part.text;
    } else {
      merged.push({ ...part });
    }
  }
  return merged;
}

export function changeTypeLabel(type: string): string {
  switch (type) {
    case "segment_text":
      return "텍스트";
    case "segment_speaker":
      return "화자";
    case "speaker_label":
      return "화자 이름";
    case "segment_added":
      return "구간 추가";
    case "segment_removed":
      return "구간 삭제";
    case "segment_omitted":
      return "구간 생략";
    case "segment_restored":
      return "구간 복구";
    default:
      return "변경";
  }
}
