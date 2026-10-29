import type { ScorePair } from "./score-input";

export type ScoreSaveJob = { status: "saving" | "error"; scores: ScorePair; error?: string };
export function createScoreSaveQueue() {
  type Job = { state: ScoreSaveJob; commit: (scores: ScorePair) => Promise<void> };
  const jobs = new Map<string, Job>(), listeners = new Set<() => void>();
  const writeStates = new Map<string, { saving: Set<string>; newIds: Map<string, string>; resultIds: Map<string, string>; error: string }>();
  const revisions = new Map<string, number>();
  let snapshot: Readonly<Record<string, ScoreSaveJob>> = {}, revision = 0;
  const invalidateReads = (scope: string) => { revision++; revisions.set(scope, (revisions.get(scope) ?? 0) + 1); };
  const publish = (key: string) => {
    snapshot = Object.fromEntries([...jobs].map(([key, job]) => [key, job.state]));
    invalidateReads(`${key.split("#")[0]}#`);
    listeners.forEach(listener => listener());
  };
  const submit = (key: string, scores: ScorePair, commit: Job["commit"]) => {
    if (jobs.get(key)?.state.status === "saving") return false;
    const job: Job = { state: { status: "saving", scores: { ...scores } }, commit };
    jobs.set(key, job); publish(key);
    // 通信の寿命を入力ポップアップや履歴モーダルから切り離す。
    void Promise.resolve().then(() => commit({ ...job.state.scores })).then(() => {
      jobs.delete(key); publish(key);
    }).catch(cause => {
      job.state = { ...job.state, status: "error", error: cause instanceof Error ? cause.message : "保存に失敗しました。再試行してください" };
      publish(key);
    });
    return true;
  };
  return {
    // 画面を移動して戻った場合も、PR #163の再試行用ID・送信ロックを再利用する。
    writeState: (scope: string) => {
      if (!writeStates.has(scope)) writeStates.set(scope, { saving: new Set(), newIds: new Map(), resultIds: new Map(), error: "" });
      return writeStates.get(scope)!;
    },
    submit,
    retry: (key: string) => { const job = jobs.get(key); return job ? submit(key, job.state.scores, job.commit) : false; },
    getSnapshot: () => snapshot,
    getRevision: (scope?: string) => scope ? revisions.get(scope) ?? 0 : revision,
    invalidateReads,
    has: (key: string) => jobs.has(key),
    hasUnsaved: (prefix = "") => [...jobs.keys()].some(key => key.startsWith(prefix)),
    hasSaving: (prefix = "") => [...jobs].some(([key, job]) => key.startsWith(prefix) && job.state.status === "saving"),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }
  };
}
