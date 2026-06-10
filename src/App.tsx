import {
  Dices,
  Download,
  ExternalLink,
  FileJson,
  Music,
  Play,
  RefreshCw,
  Volume2,
  VolumeX,
  Settings2,
  Shuffle,
  Swords,
  Trophy,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { NCS_TRACKS, NCS_USAGE_POLICY_URL } from "./audio/ncsCatalog";
import { createSoundEngine, type SoundEngine } from "./audio/sfx";
import { recordReel } from "./export/recordReel";
import { drawFightFrame } from "./render/drawFight";
import {
  MOVEMENT_DICE,
  ROBOT_CLASSES,
  WEAPONS,
  createDefaultFightConfig,
} from "./sim/catalog";
import { cloneFightConfig, simulateFight } from "./sim/engine";
import type { FightConfig, FightResult, RobotConfig } from "./sim/types";

type Tab = "setup" | "dice" | "export" | "history";

type HistoryItem = {
  id: string;
  seed: string;
  winner: string;
  duration: number;
  createdAt: string;
};

const HISTORY_KEY = "bot-fighter-history";

export default function App() {
  const [seed, setSeed] = useState("bot-fighter-001");
  const [robots, setRobots] = useState<RobotConfig[]>(() =>
    cloneFightConfig(createDefaultFightConfig()).robots
  );
  const [maxDuration, setMaxDuration] = useState(45);
  const [speed, setSpeed] = useState(1);
  const [activeTab, setActiveTab] = useState<Tab>("setup");
  const [isPlaying, setIsPlaying] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [exportStatus, setExportStatus] = useState("Ready");
  const [frameIndex, setFrameIndex] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>(() => readHistory());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const lastSoundTimeRef = useRef(-0.01);
  const soundEngineRef = useRef<SoundEngine | null>(null);

  const config = useMemo<FightConfig>(
    () => ({
      ...createDefaultFightConfig(seed),
      seed,
      maxDuration,
      robots,
    }),
    [maxDuration, robots, seed]
  );
  const result = useMemo(() => simulateFight(config), [config]);
  const frame = result.frames[Math.min(frameIndex, result.frames.length - 1)] ?? result.frames[0];
  const winner = result.config.robots.find((robot) => robot.id === result.winnerId);
  const recentEvents = result.events
    .filter((event) => event.type === "weapon" || event.type === "hit" || event.type === "winner")
    .slice(-7)
    .reverse();

  useEffect(() => {
    setFrameIndex(0);
    startedAtRef.current = null;
    lastSoundTimeRef.current = -0.01;
  }, [result]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !frame) {
      return;
    }

    drawFightFrame(context, frame, result);
  }, [frame, result]);

  useEffect(() => {
    if (!isPlaying) {
      startedAtRef.current = null;
      lastSoundTimeRef.current = -0.01;
      return;
    }

    let animationId = 0;

    const animate = (timestamp: number) => {
      if (startedAtRef.current === null) {
        startedAtRef.current = timestamp - frame.time * 1000 / speed;
      }

      const elapsed = ((timestamp - startedAtRef.current) / 1000) * speed;
      const nextIndex = result.frames.findIndex((candidate) => candidate.time >= elapsed);

      if (nextIndex === -1) {
        setFrameIndex(result.frames.length - 1);
        setIsPlaying(false);
        startedAtRef.current = null;
        return;
      }

      setFrameIndex(nextIndex);
      animationId = window.requestAnimationFrame(animate);
    };

    animationId = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(animationId);
  }, [frame.time, isPlaying, result.frames, speed]);

  useEffect(() => {
    if (!isPlaying || !soundEnabled || !soundEngineRef.current) {
      return;
    }

    for (const event of result.events) {
      if (
        "sound" in event &&
        event.time > lastSoundTimeRef.current &&
        event.time <= frame.time
      ) {
        soundEngineRef.current.play(event.sound);
      }
    }

    lastSoundTimeRef.current = frame.time;
  }, [frame.time, isPlaying, result.events, soundEnabled]);

  function updateRobot(robotId: string, updater: (robot: RobotConfig) => RobotConfig) {
    setRobots((current) => current.map((robot) => (robot.id === robotId ? updater(robot) : robot)));
  }

  function randomizeSeed() {
    setSeed(`fight-${Date.now().toString(36)}`);
    setIsPlaying(true);
  }

  function ensureSoundEngine() {
    if (!soundEngineRef.current) {
      soundEngineRef.current = createSoundEngine();
    }
    void soundEngineRef.current.context.resume();
  }

  function startPreview() {
    if (soundEnabled) {
      ensureSoundEngine();
    }
    setFrameIndex(0);
    lastSoundTimeRef.current = -0.01;
    startedAtRef.current = null;
    setIsPlaying(true);
  }

  function saveToHistory(resultToSave: FightResult) {
    const winnerName =
      resultToSave.config.robots.find((robot) => robot.id === resultToSave.winnerId)?.name ?? "Draw";
    const item: HistoryItem = {
      id: `${resultToSave.config.seed}-${Date.now()}`,
      seed: resultToSave.config.seed,
      winner: winnerName,
      duration: resultToSave.duration,
      createdAt: new Date().toISOString(),
    };
    const next = [item, ...history].slice(0, 12);
    setHistory(next);
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  }

  function downloadConfig() {
    saveToHistory(result);
    const blob = new Blob([JSON.stringify({ config, resultSummary: summarizeResult(result) }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${seed}-fight-config.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function exportReel() {
    const canvas = canvasRef.current;
    if (!canvas || isRecording) {
      return;
    }

    setIsRecording(true);
    setIsPlaying(false);
    setExportStatus("Recording");

    try {
      const recording = await recordReel(canvas, result, soundEnabled);
      saveToHistory(result);
      const url = URL.createObjectURL(recording.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${seed}-reel.${recording.extension}`;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportStatus(recording.extension.toUpperCase());
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : "Export failed");
    } finally {
      setIsRecording(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Simulation control room</p>
          <h1>Bot Fighter Lab</h1>
        </div>
        <div className="topbar__actions">
          <button className="icon-button" title="Random seed" onClick={randomizeSeed}>
            <Shuffle size={19} />
          </button>
          <button
            className="icon-button"
            title={soundEnabled ? "Mute sounds" : "Enable sounds"}
            onClick={() => {
              setSoundEnabled((current) => !current);
              if (!soundEnabled) {
                ensureSoundEngine();
              }
            }}
          >
            {soundEnabled ? <Volume2 size={19} /> : <VolumeX size={19} />}
          </button>
          <button
            className="primary-button"
            onClick={startPreview}
          >
            <Play size={18} />
            Preview
          </button>
          <button className="secondary-button" onClick={exportReel} disabled={isRecording}>
            <Download size={18} />
            {isRecording ? "Recording" : "Export"}
          </button>
        </div>
      </header>

      <section className="lab-grid">
        <aside className="control-rail" aria-label="Fight controls">
          <div className="tab-row" role="tablist" aria-label="Control views">
            <button
              className={activeTab === "setup" ? "tab-button is-active" : "tab-button"}
              onClick={() => setActiveTab("setup")}
            >
              <Settings2 size={17} />
              Setup
            </button>
            <button
              className={activeTab === "dice" ? "tab-button is-active" : "tab-button"}
              onClick={() => setActiveTab("dice")}
            >
              <Dices size={17} />
              Dice
            </button>
            <button
              className={activeTab === "export" ? "tab-button is-active" : "tab-button"}
              onClick={() => setActiveTab("export")}
            >
              <Download size={17} />
              Export
            </button>
            <button
              className={activeTab === "history" ? "tab-button is-active" : "tab-button"}
              onClick={() => setActiveTab("history")}
            >
              <Trophy size={17} />
              History
            </button>
          </div>

          {activeTab === "setup" && (
            <div className="panel-stack">
              <label className="field">
                <span>Seed</span>
                <div className="input-action">
                  <input value={seed} onChange={(event) => setSeed(event.target.value)} />
                  <button className="icon-button" title="Refresh seed" onClick={randomizeSeed}>
                    <RefreshCw size={17} />
                  </button>
                </div>
              </label>

              <div className="two-col">
                <label className="field">
                  <span>Duration</span>
                  <input
                    type="number"
                    min={10}
                    max={60}
                    value={maxDuration}
                    onChange={(event) => setMaxDuration(Number(event.target.value))}
                  />
                </label>
                <label className="field">
                  <span>Speed</span>
                  <input
                    type="range"
                    min={0.25}
                    max={3}
                    step={0.25}
                    value={speed}
                    onChange={(event) => setSpeed(Number(event.target.value))}
                  />
                </label>
              </div>

              {robots.map((robot) => (
                <section className="robot-editor" key={robot.id}>
                  <div className="robot-editor__header">
                    <span style={{ background: robot.palette.body }} />
                    <strong>{robot.name}</strong>
                  </div>
                  <label className="field">
                    <span>Name</span>
                    <input
                      value={robot.name}
                      onChange={(event) =>
                        updateRobot(robot.id, (current) => ({ ...current, name: event.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Class</span>
                    <select
                      value={robot.classId}
                      onChange={(event) =>
                        updateRobot(robot.id, (current) => ({ ...current, classId: event.target.value }))
                      }
                    >
                      {ROBOT_CLASSES.map((robotClass) => (
                        <option key={robotClass.id} value={robotClass.id}>
                          {robotClass.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </section>
              ))}
            </div>
          )}

          {activeTab === "dice" && (
            <div className="panel-stack">
              {robots.map((robot) => (
                <section className="robot-editor" key={robot.id}>
                  <div className="robot-editor__header">
                    <span style={{ background: robot.palette.body }} />
                    <strong>{robot.name}</strong>
                  </div>
                  <div className="check-grid">
                    {WEAPONS.map((weapon) => (
                      <label key={weapon.id} className="check-row">
                        <input
                          type="checkbox"
                          checked={robot.arsenal.includes(weapon.id)}
                          onChange={(event) =>
                            updateRobot(robot.id, (current) => {
                              const arsenal = event.target.checked
                                ? [...current.arsenal, weapon.id]
                                : current.arsenal.filter((id) => id !== weapon.id);
                              return { ...current, arsenal };
                            })
                          }
                        />
                        <span>{weapon.name}</span>
                      </label>
                    ))}
                  </div>
                  <div className="dice-list">
                    {robot.weaponDice.map((die) => (
                      <label className="dice-row" key={die.id}>
                        <span>{WEAPONS.find((weapon) => weapon.id === die.id)?.name}</span>
                        <input
                          type="number"
                          min={0}
                          max={50}
                          value={die.weight}
                          onChange={(event) =>
                            updateRobot(robot.id, (current) => ({
                              ...current,
                              weaponDice: current.weaponDice.map((currentDie) =>
                                currentDie.id === die.id
                                  ? { ...currentDie, weight: Number(event.target.value) }
                                  : currentDie
                              ),
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                </section>
              ))}

              <section className="robot-editor">
                <div className="robot-editor__header">
                  <Dices size={17} />
                  <strong>Movement die</strong>
                </div>
                <div className="movement-grid">
                  {MOVEMENT_DICE.map((die) => (
                    <span key={die.id}>{die.id}</span>
                  ))}
                </div>
              </section>
            </div>
          )}

          {activeTab === "export" && (
            <div className="panel-stack">
              <section className="metric-panel">
                <span>Preset</span>
                <strong>1080 x 1920 / 30 fps</strong>
              </section>
              <section className="metric-panel">
                <span>Winner</span>
                <strong>{winner?.name ?? "Draw"}</strong>
              </section>
              <section className="metric-panel">
                <span>Runtime</span>
                <strong>{result.duration.toFixed(1)}s</strong>
              </section>
              <button className="primary-button full-width" onClick={downloadConfig}>
                <FileJson size={18} />
                Export Fight Data
              </button>
              <button className="secondary-button full-width" onClick={exportReel} disabled={isRecording}>
                <Download size={18} />
                {isRecording ? "Recording Reel" : "Record Reel"}
              </button>
              <section className="metric-panel">
                <span>Status</span>
                <strong>{exportStatus}</strong>
              </section>
              <section className="soundtrack-panel">
                <div className="robot-editor__header">
                  <Music size={17} />
                  <strong>NCS credits</strong>
                </div>
                {NCS_TRACKS.map((track) => (
                  <div className="track-row" key={track.title}>
                    <div>
                      <strong>{track.title}</strong>
                      <span>{track.artists.join(", ")} · {track.genre}</span>
                    </div>
                    <button
                      className="icon-button"
                      title="Copy credit"
                      onClick={() => void navigator.clipboard.writeText(track.credit)}
                    >
                      <FileJson size={16} />
                    </button>
                  </div>
                ))}
                <a className="policy-link" href={NCS_USAGE_POLICY_URL} target="_blank" rel="noreferrer">
                  Usage policy
                  <ExternalLink size={15} />
                </a>
              </section>
            </div>
          )}

          {activeTab === "history" && (
            <div className="history-list">
              {history.length === 0 && <p className="muted">No exports yet.</p>}
              {history.map((item) => (
                <button
                  key={item.id}
                  className="history-item"
                  onClick={() => {
                    setSeed(item.seed);
                    setActiveTab("setup");
                  }}
                >
                  <span>{item.seed}</span>
                  <strong>{item.winner}</strong>
                  <small>{item.duration.toFixed(1)}s</small>
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="preview-zone" aria-label="Fight preview">
          <div className="stage-wrap">
            <canvas ref={canvasRef} width={900} height={1600} className="fight-canvas" />
          </div>
          <div className="match-strip">
            <div className="result-chip">
              <Swords size={18} />
              <strong>{robots.map((robot) => robot.name).join(" vs ")}</strong>
            </div>
            <div className="progress-track">
              <span style={{ width: `${(frame.time / result.duration) * 100}%` }} />
            </div>
          </div>
        </section>

        <aside className="telemetry" aria-label="Fight telemetry">
          <section className="score-band">
            <span>Winner</span>
            <strong>{winner?.name ?? "Draw"}</strong>
            <small>{result.events.find((event) => event.type === "winner")?.reason ?? "pending"}</small>
          </section>

          <section className="event-feed">
            <h2>Timeline</h2>
            {recentEvents.map((event, index) => (
              <div className="event-row" key={`${event.type}-${event.time}-${index}`}>
                <time>{event.time.toFixed(1)}s</time>
                <span>{formatEvent(event, config)}</span>
              </div>
            ))}
          </section>

          <section className="stat-grid">
            {robots.map((robot) => {
              const robotFrame = frame.robots.find((candidate) => candidate.id === robot.id);
              return (
                <div className="stat-box" key={robot.id}>
                  <span>{robot.name}</span>
                  <strong>{Math.round(robotFrame?.hp ?? 0)} HP</strong>
                  <small>{Math.round(result.damageByRobot[robot.id] ?? 0)} damage</small>
                </div>
              );
            })}
          </section>
        </aside>
      </section>
    </main>
  );
}

function readHistory(): HistoryItem[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryItem[]) : [];
  } catch {
    return [];
  }
}

function summarizeResult(result: FightResult) {
  return {
    seed: result.config.seed,
    winnerId: result.winnerId,
    duration: result.duration,
    damageByRobot: result.damageByRobot,
    events: result.events,
  };
}

function formatEvent(event: FightResult["events"][number], config: FightConfig): string {
  const robotName = (id?: string) => config.robots.find((robot) => robot.id === id)?.name ?? "Unknown";

  if (event.type === "weapon") {
    const weapon = WEAPONS.find((candidate) => candidate.id === event.weaponId);
    return `${robotName(event.robotId)} rolled ${weapon?.name ?? event.weaponId}`;
  }

  if (event.type === "hit") {
    return `${robotName(event.attackerId)} hit ${robotName(event.targetId)} for ${event.damage.toFixed(0)}`;
  }

  if (event.type === "winner") {
    return `${robotName(event.winnerId)} wins by ${event.reason}`;
  }

  return event.type;
}
