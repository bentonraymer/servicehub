import { ArrowLeft, ExternalLink, Play, Rocket, RotateCw, Square } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Modal, PageHeader, Segmented, ServiceIcon, Spinner, StatusPill, TypeChip } from "../../components/ui";
import { defaults, InputForm, type InputValues } from "../../components/Inputs";
import { api, type Service } from "../../lib/api";
import { useLoad } from "../../lib/hooks";
import { CodeTab } from "./service/CodeTab";
import { OverviewTab } from "./service/OverviewTab";
import { RunsTab } from "./service/RunsTab";
import { SettingsTab } from "./service/SettingsTab";
import { VersionsTab } from "./service/VersionsTab";

type Tab = "overview" | "code" | "settings" | "runs" | "versions";

export default function ServiceDetail() {
  const { slug = "", tab = "overview" } = useParams();
  const nav = useNavigate();
  const { data: s, error, reload } = useLoad(() => api.get<Service>(`/api/services/${slug}`), [slug], (e) => e.slug === slug || e.type === "layout");
  const [deploying, setDeploying] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [note, setNote] = useState("");
  const [runOpen, setRunOpen] = useState(false);
  const [runValues, setRunValues] = useState<InputValues>({});
  const [runErr, setRunErr] = useState("");

  if (error) {
    return (
      <div className="p-6">
        <div className="text-sm text-muted">{error}</div>
        <Link to="/admin/services" className="btn-outline mt-4">Back to services</Link>
      </div>
    );
  }
  if (!s) return <div className="grid h-40 place-items-center"><Spinner /></div>;

  const setTab = (t: Tab) => nav(`/admin/services/${slug}/${t}`, { replace: true });
  const live = ["running", "starting", "installing", "backoff"].includes(s.status.state);

  const act = async (a: "start" | "stop" | "restart") => {
    await api.post(`/api/services/${slug}/${a}`).catch((e) => alert(e.message));
    reload();
  };

  const startRun = async (inputs: InputValues) => {
    setRunErr("");
    try {
      await api.post(`/api/services/${slug}/run`, { inputs });
      setRunOpen(false);
      setTab("overview");
    } catch (e) {
      setRunErr((e as Error).message);
    }
  };

  const deploy = async () => {
    setDeploying(true);
    try {
      await api.post(`/api/services/${slug}/deploy`, { note });
      setDeployOpen(false);
      setNote("");
      reload();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDeploying(false);
    }
  };

  const tabs: { value: Tab; label: string }[] = [
    { value: "overview", label: "Overview" },
    { value: "code", label: "Code" },
    { value: "settings", label: "Settings" },
    ...(s.type === "script" ? [{ value: "runs" as Tab, label: "Runs" }] : []),
    { value: "versions", label: "Versions" },
  ];

  const deployHint =
    s.type === "worker" || s.type === "webapp"
      ? "Saves a version and restarts it with your changes."
      : "Saves a version you can roll back to. Changes are already live.";

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        leading={
          <>
            <Link to="/admin/services" className="btn-ghost p-1.5" title="All services"><ArrowLeft size={16} /></Link>
            <ServiceIcon name={s.name} icon={s.icon} className="size-9 text-lg" />
          </>
        }
        title={
          <span className="flex items-center gap-2">
            {s.name} <TypeChip type={s.type} /> <StatusPill type={s.type} status={s.status} />
          </span>
        }
        subtitle={
          <>
            <span className="font-mono">{s.slug}</span>
            {s.current_version > 0 && <> · version {s.current_version}</>}
            {s.description && <> · {s.description}</>}
          </>
        }
        actions={
          <>
            {(s.type === "static" || s.type === "webapp") && (
              <a className="btn-outline py-1.5" href={`/s/${s.slug}/`} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open</a>
            )}
            {s.type === "script" &&
              (s.status.state === "running" ? (
                <button className="btn-outline py-1.5" onClick={() => act("stop")}><Square size={14} /> Stop run</button>
              ) : (
                <button className="btn-outline py-1.5" disabled={!s.enabled} onClick={() => {
                  if (s.inputs.length) { setRunValues(defaults(s.inputs)); setRunOpen(true); } else startRun({});
                }}><Play size={14} /> Run now</button>
              ))}
            {(s.type === "worker" || s.type === "webapp") &&
              (live ? (
                <>
                  <button className="btn-outline py-1.5" onClick={() => act("restart")}><RotateCw size={14} /> Restart</button>
                  <button className="btn-ghost py-1.5" onClick={() => act("stop")}><Square size={14} /> Stop</button>
                </>
              ) : (
                <button className="btn-outline py-1.5" disabled={!s.enabled} onClick={() => act("start")}><Play size={14} /> Start</button>
              ))}
            <button
              className={s.status.dirty ? "btn-primary py-1.5" : "btn-outline py-1.5"}
              onClick={() => setDeployOpen(true)}
              title={s.status.dirty ? "You have changes that aren't in a version yet" : deployHint}
            >
              <Rocket size={14} /> Deploy{s.status.dirty && <span className="size-1.5 rounded-full bg-white" />}
            </button>
          </>
        }
      />
      <div className="border-b border-line px-6 py-2">
        <Segmented value={tab as Tab} onChange={setTab} options={tabs} />
      </div>
      <div className="min-h-0 flex-1">
        {tab === "overview" && <OverviewTab s={s} />}
        {tab === "code" && <CodeTab s={s} onDeploy={() => setDeployOpen(true)} />}
        {tab === "settings" && <SettingsTab s={s} onSaved={reload} />}
        {tab === "runs" && <RunsTab s={s} />}
        {tab === "versions" && <VersionsTab s={s} onRestored={reload} />}
      </div>

      {deployOpen && (
        <Modal
          title={`Deploy ${s.name}`}
          onClose={() => setDeployOpen(false)}
          footer={
            <>
              <button className="btn-ghost" onClick={() => setDeployOpen(false)}>Cancel</button>
              <button className="btn-primary" disabled={deploying} onClick={deploy}>
                {deploying ? "Deploying…" : s.type === "worker" || s.type === "webapp" ? "Deploy & restart" : "Save version"}
              </button>
            </>
          }
        >
          <div className="grid gap-3">
            <p className="text-sm text-muted">{deployHint}</p>
            <div>
              <label className="label">Note</label>
              <input autoFocus className="input" placeholder="What changed? (optional)" value={note} onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && deploy()} />
            </div>
          </div>
        </Modal>
      )}

      {runOpen && (
        <Modal
          title={`Run ${s.name}`}
          onClose={() => setRunOpen(false)}
          footer={
            <>
              {runErr && <span className="mr-auto text-sm text-down">{runErr}</span>}
              <button className="btn-ghost" onClick={() => setRunOpen(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => startRun(runValues)}><Play size={14} /> Run now</button>
            </>
          }
        >
          <InputForm specs={s.inputs} values={runValues} onChange={setRunValues} onSubmit={() => startRun(runValues)} />
        </Modal>
      )}
    </div>
  );
}
