import { History } from "lucide-react";
import { useState } from "react";
import { Empty, PageHeader, Segmented } from "../../components/ui";
import { api, type Run } from "../../lib/api";
import { useLoad } from "../../lib/hooks";
import { RunTable } from "./service/RunsTab";

type F = "all" | "failed" | "success" | "running";

export default function Runs() {
  const [f, setF] = useState<F>("all");
  const { data } = useLoad(() => api.get<Run[]>(`/api/runs?limit=300${f !== "all" ? `&status=${f}` : ""}`), [f], (e) => e.type === "run");
  return (
    <>
      <PageHeader title="Run history" subtitle="Every script run across ServiceHub, newest first. Click a run to see its output." />
      <div className="grid gap-4 p-6">
        <Segmented<F> value={f} onChange={setF} options={[
          { value: "all", label: "All" }, { value: "failed", label: "Failed" }, { value: "success", label: "Succeeded" }, { value: "running", label: "Running" },
        ]} />
        {data && data.length === 0 && f === "all" ? (
          <Empty icon={History}>No runs yet. Scripts show up here after they run on a schedule or when you press Run.</Empty>
        ) : (
          data && <RunTable runs={data} showService />
        )}
      </div>
    </>
  );
}
