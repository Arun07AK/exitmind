import { useState } from "react";
import type { ScenarioChatReply, ScenarioTurn } from "../../../../src/server/contract.ts";
import { postJSON } from "../../api.ts";
import { Button, cx } from "../../components/ui.tsx";
import { useScenario } from "../../sim/scenario.ts";

export const SATURNALIA_DEMO = "Simulate an evacuation during a Saturnalia concert at Thapar, with students aged 18–21 and the real venue mapped using Google Maps or OpenStreetMap.";

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function ScenarioGenerator({ onStarted }: { onStarted?: () => void }) {
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<ScenarioTurn[]>([]);
  const [reply, setReply] = useState<ScenarioChatReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useScenario((s) => s.run);

  const send = async () => {
    if (!text.trim() || busy) return;
    const next: ScenarioTurn[] = [...turns, { role: "user", text: text.trim() }];
    setBusy(true); setError(null);
    try {
      const r = await postJSON<ScenarioChatReply>("/api/scenario/chat", { messages: next });
      const withAgent: ScenarioTurn[] = r.status === "needs_info" ? [...next, { role: "assistant", text: r.questions.join(" ") }] : next;
      setTurns(withAgent); setReply(r); setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };
  const reset = () => { setTurns([]); setReply(null); setText(""); setError(null); };
  const start = async () => {
    if (!reply?.scenario) return;
    await run(reply.scenario, reply.summary ? reply.summary.split(".")[0]! : "Custom scenario", "crowd", reply.venue);
    onStarted?.();
  };

  return (
    <section className="flex flex-col gap-2.5 rounded-lg border border-line bg-white p-3" data-testid="scenario-generator" aria-label="Custom emergency scenario generator">
      <div>
        <h3 className="text-[14px] font-semibold">Custom emergency scenario</h3>
        <p className="text-[12px] text-ink-3">Describe it in one box. Needed: crowd size, age groups and event type. Optional: venue, emergency, mobility needs, blocked exits, anything else to test. Claude Opus 5.5 sets it up; Claude Haiku drives how the crowd reacts.</p>
      </div>
      {turns.length ? (
        <ol className="flex max-h-48 flex-col gap-1.5 overflow-auto text-[13px]" data-testid="scenario-transcript">
          {turns.map((t, i) => (
            <li key={i} className={cx("rounded-md px-2.5 py-1.5", t.role === "user" ? "self-end bg-slate-100" : "self-start bg-sky-50 text-sky-900")}>
              <span className="mr-1 text-[11px] font-medium text-ink-3">{t.role === "user" ? "You" : "Opus"}</span>{t.text}
            </li>
          ))}
        </ol>
      ) : null}
      <textarea
        value={text} onChange={(e) => setText(e.target.value)} rows={4} data-testid="scenario-input"
        placeholder={reply?.status === "needs_info" ? "Answer the question above…" : "e.g. Fire during an evening concert, 3,000 students aged 18–21, main gate blocked"}
        className="w-full resize-y rounded-md border border-line p-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-sky-300"
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(); }}
      />
      <div className="flex items-center gap-2">
        <Button tone="primary" onClick={() => void send()} disabled={busy || !text.trim()} data-testid="scenario-send">{busy ? "Opus is setting it up…" : turns.length ? "Send" : "Set up scenario"}</Button>
        {turns.length ? <Button onClick={reset} data-testid="scenario-reset">Start over</Button> : null}
      </div>
      {!turns.length ? (
        <div className="rounded-md border border-dashed border-sky-300 bg-sky-50/60 p-2.5" data-testid="saturnalia-suggestion">
          <div className="text-[13px] font-medium">Try the Saturnalia demo</div>
          <p className="text-[12px] text-ink-2">{SATURNALIA_DEMO}</p>
          <Button className="mt-1.5 h-7 px-2.5 text-[12px]" onClick={() => setText(SATURNALIA_DEMO)} data-testid="try-saturnalia">Try this scenario</Button>
        </div>
      ) : null}
      {error ? <p className="text-[12px] text-red-700" role="alert">{error}</p> : null}
      {reply ? (
        <div className="flex flex-col gap-1.5 text-[13px]" data-testid="scenario-reply" data-status={reply.status} data-source={reply.source}>
          {reply.note ? <p className="text-[12px] text-amber-800">{reply.note}</p> : null}
          {reply.status === "needs_info" ? <p className="text-[12px] text-ink-3">Opus needs: {reply.missing.map((m) => m.replace("_", " ")).join(", ")}.</p> : null}
          {reply.status === "ready" && reply.crowd ? (
            <>
              <p data-testid="scenario-summary">{reply.summary || `${reply.crowd.size} people at ${reply.venueLabel}.`}</p>
              <p className="text-[12px] text-ink-2">
                <span className="num">{reply.crowd.size.toLocaleString()}</span> people · {reply.venueLabel} · ages {Object.entries(reply.crowd.ages).filter(([, v]) => v > 0).map(([k, v]) => `${k.replace("_", " ")} ${pct(v)}`).join(", ")} · {Object.entries(reply.crowd.roles).filter(([, v]) => v > 0).map(([k, v]) => `${k === "visitor" ? "first-time visitors" : k} ${pct(v)}`).join(", ")}
              </p>
              <details open className="rounded-md bg-amber-50 p-2" data-testid="scenario-assumptions">
                <summary className="cursor-pointer text-[12px] font-medium text-amber-900">Assumptions ({reply.assumptions.length}) — check these before running</summary>
                <ul className="mt-1 list-disc pl-4 text-[12px] text-amber-900">{reply.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
              </details>
              {reply.attribution ? <p className="text-[11px] text-ink-3">{reply.attribution}</p> : null}
              <p className="text-[11px] text-ink-3">Crowd behaviour is modelled behaviour, not validated against real evacuations.</p>
              <Button tone="primary" onClick={() => void start()} data-testid="scenario-run">Run simulation</Button>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
