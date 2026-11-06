export type LeaveReason = "cancel" | "escape" | "backdrop" | "navigation" | "signout";
export type LeaveDecision = "keep" | "discard";
export type LeaveOutcome = "proceeded" | "kept" | "busy" | "stale";

export interface DraftOwner<T> {
  id: object;
  parent?: object;
  current(): T;
  snapshot(value: T): T;
  equal(a: T, b: T): boolean;
  restore(snapshot: T): void;
}

export interface DraftScope<T> {
  readonly id: object;
  changed(): void;
  isDirty(): boolean;
  commit(submitted: T): void;
  dispose(): void;
}

export interface LeaveRequest {
  scopes: readonly object[] | "all";
  reason: LeaveReason;
  except?: readonly object[];
  signal?: AbortSignal;
  proceed(): void | Promise<void>;
}

export type ConfirmLeave = (
  question: { reason: LeaveReason; dirtyScopes: readonly object[] },
  signal: AbortSignal,
) => Promise<LeaveDecision>;

export interface LeaveCoordinator {
  register<T>(owner: DraftOwner<T>): DraftScope<T>;
  request(request: LeaveRequest): Promise<LeaveOutcome>;
  isDirty(scopes?: readonly object[], except?: readonly object[]): boolean;
  forceReset(): void;
  dispose(): void;
}

interface RegisteredDraft {
  id: object;
  parent: object | undefined;
  dirty(): boolean;
  restore(): void;
  release(): void;
}

interface Baseline<T> {
  readonly live: boolean;
  dirty(): boolean;
  restore(): void;
  commit(submitted: T, beforeSwap?: () => void): void;
  release(): void;
}

function baselineFor<T>(source: DraftOwner<T>): Baseline<T> {
  let owner: DraftOwner<T> | undefined = source;
  let baseline: T | undefined = owner.snapshot(owner.current());
  return {
    get live() {
      return owner !== undefined;
    },
    dirty: () => !!owner && !owner.equal(baseline as T, owner.current()),
    restore: () => {
      if (owner) owner.restore(owner.snapshot(baseline as T));
    },
    commit(submitted, beforeSwap) {
      if (!owner) return;
      const snapshot = owner.snapshot(submitted);
      beforeSwap?.();
      baseline = snapshot;
    },
    release: () => {
      owner = undefined;
      baseline = undefined;
    },
  };
}

/** A draft followed for its changed state alone: it asks no leave question and guards no unload. */
export function trackDraft<T>(owner: DraftOwner<T>): DraftScope<T> {
  const draft = baselineFor(owner);
  return {
    id: owner.id,
    changed() {},
    isDirty: draft.dirty,
    commit(submitted) {
      draft.commit(submitted);
    },
    dispose: draft.release,
  };
}

interface PendingLeave {
  roots: readonly object[] | undefined;
  except: readonly object[];
  controller: AbortController;
  deciding: boolean;
}

export function createLeaveCoordinator(confirm: ConfirmLeave, target: Window): LeaveCoordinator {
  const owners = new Map<object, RegisteredDraft>();
  let pending: PendingLeave | undefined;
  let disposed = false;
  let listening = false;

  function within(id: object, roots: readonly object[]): boolean {
    const visited = new Set<object>();
    let current: object | undefined = id;
    while (current && !visited.has(current)) {
      if (roots.includes(current)) return true;
      visited.add(current);
      current = owners.get(current)?.parent;
    }
    return false;
  }

  function selected(roots?: readonly object[], except: readonly object[] = []): RegisteredDraft[] {
    return [...owners.values()].filter(
      (owner) => (!roots || within(owner.id, roots)) && !within(owner.id, except),
    );
  }

  function beforeUnload(event: Event): void {
    event.preventDefault();
    (event as BeforeUnloadEvent).returnValue = "unsaved";
  }

  function refreshUnload(): void {
    const dirty = [...owners.values()].some((owner) => owner.dirty());
    if (dirty === listening) return;
    listening = dirty;
    if (listening) target.addEventListener("beforeunload", beforeUnload);
    else target.removeEventListener("beforeunload", beforeUnload);
  }

  function invalidate(id?: object): void {
    if (
      pending?.deciding &&
      (!id || ((!pending.roots || within(id, pending.roots)) && !within(id, pending.except)))
    ) {
      pending.controller.abort();
    }
  }

  function clear(): void {
    invalidate();
    for (const owner of owners.values()) owner.release();
    owners.clear();
    refreshUnload();
  }

  return {
    register<T>(source: DraftOwner<T>): DraftScope<T> {
      if (disposed) throw new Error("Cannot register a draft on a disposed leave coordinator");
      const draft = baselineFor(source);
      const id = source.id;
      const record: RegisteredDraft = {
        id,
        parent: source.parent,
        dirty: draft.dirty,
        restore: draft.restore,
        release: draft.release,
      };
      if (owners.has(id)) invalidate(id);
      owners.get(id)?.release();
      owners.set(id, record);
      invalidate(id);
      refreshUnload();
      return {
        id,
        changed() {
          if (!draft.live) return;
          invalidate(id);
          refreshUnload();
        },
        isDirty: record.dirty,
        commit(submitted) {
          draft.commit(submitted, () => invalidate(id));
          refreshUnload();
        },
        dispose() {
          if (!draft.live) return;
          invalidate(id);
          record.release();
          owners.delete(id);
          refreshUnload();
        },
      };
    },
    async request(request) {
      if (disposed || request.signal?.aborted) return "stale";
      if (pending) return "busy";
      const attempt: PendingLeave = {
        roots: request.scopes === "all" ? undefined : [...request.scopes],
        except: [...(request.except ?? [])],
        controller: new AbortController(),
        deciding: true,
      };
      pending = attempt;
      const cancel = () => {
        if (attempt.deciding) attempt.controller.abort();
      };
      request.signal?.addEventListener("abort", cancel, { once: true });
      let onAbort: (() => void) | undefined;
      try {
        const affected = selected(attempt.roots, attempt.except);
        const dirty = affected.filter((owner) => owner.dirty());
        if (dirty.length) {
          const aborted = new Promise<"stale">((resolve) => {
            onAbort = () => resolve("stale");
            attempt.controller.signal.addEventListener("abort", onAbort, { once: true });
          });
          const answer = await Promise.race([
            aborted,
            confirm(
              { reason: request.reason, dirtyScopes: dirty.map((owner) => owner.id) },
              attempt.controller.signal,
            ),
          ]);
          if (attempt.controller.signal.aborted) return "stale";
          if (answer === "keep") return "kept";
          attempt.deciding = false;
          for (const owner of dirty) owner.restore();
          refreshUnload();
        }
        attempt.deciding = false;
        await request.proceed();
        return "proceeded";
      } finally {
        request.signal?.removeEventListener("abort", cancel);
        if (onAbort) attempt.controller.signal.removeEventListener("abort", onAbort);
        if (pending === attempt) pending = undefined;
      }
    },
    isDirty(scopes, except) {
      return selected(scopes, except).some((owner) => owner.dirty());
    },
    forceReset: clear,
    dispose() {
      disposed = true;
      clear();
    },
  };
}
