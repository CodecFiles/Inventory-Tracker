"use client";

import { startTransition, useActionState, useRef, type ReactNode } from "react";
import { showToast } from "./toast";

// A form that calls a server action and shows its answer in place: the error that stopped it, or a
// short success note. While saving, the button is disabled so it cannot be pressed twice.
//
// The form is cleared only when the save worked. (React clears a form after any action that
// returns — including a refusal — which silently put fields back to their defaults, e.g. a stage
// choice, before the person tried again. So this form submits itself and resets only on success.)

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
  const formRef = useRef<HTMLFormElement>(null);
  // Success also shows in the corner, raised as soon as the server answers: the form itself may
  // disappear in the same update (e.g. a router moves to another list once it has a SIM).
  const [state, formAction, pending] = useActionState(async (prev: State, form: FormData) => {
    const result = await action(prev, form);
    if (result?.ok) {
      showToast(result.message);
      formRef.current?.reset();
    }
    return result;
  }, null);

  return (
    <form ref={formRef} className={className} style={style}
          onSubmit={(e) => {
            e.preventDefault();
            if (confirm && !window.confirm(confirm)) return;
            const data = new FormData(e.currentTarget);
            startTransition(() => formAction(data));
          }}>
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
