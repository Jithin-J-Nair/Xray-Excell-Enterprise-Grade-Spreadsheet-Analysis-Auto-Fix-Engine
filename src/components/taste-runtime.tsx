"use client";

import { useEffect } from "react";

const KIT_MODULES = [
  "/assets/motion/motion.js",
  "/assets/layout/layout.js",
  "/assets/system.js",
  "/assets/effects/fx.js",
  "/assets/moments/moments.js",
] as const;

/** Marks enter/moments classes; loads kit modules after React has hydrated. */
export function TasteRuntime() {
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add("m-enter", "mo-js");
    const enterDone = window.setTimeout(() => html.classList.add("m-enter-done"), 700);
    const moSafe = window.setTimeout(() => html.classList.add("mo-safe"), 2500);

    const loaded = new Set<string>();
    for (const src of KIT_MODULES) {
      if (document.querySelector(`script[data-xray-kit="${src}"]`)) continue;
      const el = document.createElement("script");
      el.type = "module";
      el.src = src;
      el.async = true;
      el.dataset.xrayKit = src;
      if (src.includes("/fx.js")) el.dataset.fxAuto = "";
      document.body.appendChild(el);
      loaded.add(src);
    }

    return () => {
      window.clearTimeout(enterDone);
      window.clearTimeout(moSafe);
    };
  }, []);

  return null;
}
