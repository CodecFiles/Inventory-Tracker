"use client";

import type { ReactNode, SelectHTMLAttributes } from "react";

// A filter dropdown that applies itself as soon as a choice is made (the form's other fields go along).
export function AutoSubmitSelect({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
      {children}
    </select>
  );
}
