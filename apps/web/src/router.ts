import { useEffect, useState } from "react";

// Hash routing (#/agents?x=1) so the server needs no rewrites and links work as OBS browser sources.
export type Route = { page: string; params: URLSearchParams };

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [page = "", query = ""] = raw.split("?");
  return { page: page || "runs", params: new URLSearchParams(query) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function go(page: string, params?: Record<string, string>) {
  const q = params ? `?${new URLSearchParams(params).toString()}` : "";
  window.location.hash = `#/${page}${q}`;
}
