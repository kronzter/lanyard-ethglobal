import { Center, EmptyState } from "@/ui";
import { routeCopy } from "@/ui/route-copy";
import { routeInfo } from "./routes";

/** A route that exists but whose screen is not built yet (P0.5-R1). */
export function Placeholder({ path }: { path: string }) {
  const r = routeInfo(path);
  return (
    <Center>
      <EmptyState
        icon={routeCopy(path).icon}
        tone="accent"
        title={r.title}
        body={`Coming soon for ${r.audience}.`}
      />
    </Center>
  );
}
