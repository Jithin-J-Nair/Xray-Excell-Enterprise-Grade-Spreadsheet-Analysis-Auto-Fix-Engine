"use client";

import { useEffect } from "react";

/** Marks enter/moments classes; kit scripts in layout mount motion, moments, and effects. */
export function TasteRuntime() {
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add("m-enter", "mo-js");
    const enterDone = window.setTimeout(() => html.classList.add("m-enter-done"), 700);
    const moSafe = window.setTimeout(() => html.classList.add("mo-safe"), 2500);
    return () => {
      window.clearTimeout(enterDone);
      window.clearTimeout(moSafe);
    };
  }, []);

  return null;
}
