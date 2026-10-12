"use client";

import { useEffect, useState } from "react";

// A short confirmation in the corner. Forms announce success with showToast(); the message stays
// visible even when the form itself disappears (e.g. a router moves to another list once it has a SIM).

const EVENT = "mrd:toast";

export function showToast(message: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: message }));
}

export function Toaster() {
  const [message, setMessage] = useState("");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onToast = (e: Event) => {
      setMessage((e as CustomEvent<string>).detail);
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(""), 4000);
    };
    window.addEventListener(EVENT, onToast);
    return () => { window.removeEventListener(EVENT, onToast); clearTimeout(timer); };
  }, []);
  if (!message) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      <span>✓ {message}</span>
      <button className="btn sm" onClick={() => setMessage("")} style={{ background: "#1C2A42", borderColor: "#1C2A42", color: "#fff" }}>Dismiss</button>
    </div>
  );
}
