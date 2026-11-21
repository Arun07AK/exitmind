import { useEffect, useState } from "react";

export type Route = "simulate" | "optimise" | "live" | "report" | "plans";

function current(): string {
  return location.hash.startsWith("#/") ? location.hash.slice(1) : location.pathname;
}

export function routeOf(path: string): Route {
  if (path.startsWith("/live")) return "live";
  if (path.startsWith("/report")) return "report";
  if (path.startsWith("/optimise")) return "optimise";
  if (path.startsWith("/plans")) return "plans";
  return "simulate";
}

export function navigate(path: string): void {
  if (location.hash.startsWith("#/")) location.hash = path;
  else history.pushState(null, "", path);
  window.dispatchEvent(new Event("exitmind:navigate"));
}

export function usePath(): string {
  const [path, setPath] = useState(current);
  useEffect(() => {
    const on = () => setPath(current());
    window.addEventListener("popstate", on);
    window.addEventListener("hashchange", on);
    window.addEventListener("exitmind:navigate", on);
    return () => {
      window.removeEventListener("popstate", on);
      window.removeEventListener("hashchange", on);
      window.removeEventListener("exitmind:navigate", on);
    };
  }, []);
  return path;
}
