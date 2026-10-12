"use client";

import { useActionState, type ReactNode } from "react";
import { showToast } from "./toast";

// A form that calls a server action and shows its answer in place: the error that stopped it, or a
// short success note. While saving, the button is disabled so it cannot be pressed twice.

type State = { ok: boolean; message: string } | null;

export function ActionForm({ action, submit, children, className, style, danger, confirm }: {
  action: (prev: State, form: FormData) => Promise<State>;
  submit: string;
  children?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  danger?: boolean;
  confirm?: string;
}) {
  // Success also shows in the corner, raised as soon as the server answers: the form itself may
  // disappear in the same update (e.g. a router moves to another list once it has a SIM).
  const [state, formAction, pending] = useActionState(async (prev: State, form: FormData) => {
    const result = await action(prev, form);
    if (result?.ok) showToast(result.message);
    return result;
  }, null);
  return (
    <form action={formAction} className={className} style={style}
          onSubmit={confirm ? (e) => { if (!window.confirm(confirm)) e.preventDefault(); } : undefined}>
      {children}
      <button type="submit" className={danger ? "btn sm dg" : "btn p"} disabled={pending}>
        {pending ? "Saving…" : submit}
      </button>
      {state && (
        <div role={state.ok ? "status" : "alert"} className={state.ok ? "alert ok" : "alert err"} style={{ flexBasis: "100%" }}>
          {state.message}
        </div>
      )}
    </form>
  );
}
