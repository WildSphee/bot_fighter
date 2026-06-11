import {
  Crosshair,
  Dices,
  Download,
  ExternalLink,
  FileJson,
  Music,
  Plus,
  Play,
  RefreshCw,
  Trash2,
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
import { drawFightFrame, drawIntroCard } from "./render/drawFight";
import {
  MOVEMENTS,
  MOVEMENT_PROFILES,
  ROBOT_CLASSES,
  WEAPONS,
  cloneMovementProfiles,
  cloneWeapons,
  createRobotFromClass,
  createDefaultFightConfig,
  normalizeMovementProfile,
  syncRobotWithClass,
  withClassDefaults,
} from "./sim/catalog";
import { cloneFightConfig, simulateFight } from "./sim/engine";
import type {
  FightConfig,
  FightResult,
  MovementId,
  MovementProfileId,
  MovementProfileMap,
  RobotClass,
  RobotConfig,
  WeaponDefinition,
} from "./sim/types";

type Tab = "setup" | "dice" | "weapons" | "movement" | "export" | "history";

type HistoryItem = {
  id: string;
  seed: string;
  winner: string;
  duration: number;
  createdAt: string;
};

const HISTORY_KEY = "bot-fighter-history";
const CLASS_PROFILE_KEY = "bot-fighter-class-profiles";
const MOVEMENT_PROFILE_KEY = "bot-fighter-movement-profiles";
const WEAPON_PROFILE_KEY = "bot-fighter-weapon-profiles";
const SETTINGS_KEY = "bot-fighter-settings";

type GameSettings = {
  moveInterval: number;
  weaponInterval: number;
  centerGravity: number;
};

type HealthChartPoint = {
  time: number;
  hpPercent: number;
};

type HealthChartSeries = {
  robotId: string;
  name: string;
  color: string;
  points: HealthChartPoint[];
};

type UnderdogScore = {
  value: number;
  firstArea: number;
  secondArea: number;
};

const DEFAULT_SETTINGS: GameSettings = {
  moveInterval: 1,
  weaponInterval: 2,
  centerGravity: 0.35,
};

const MOVEMENT_PROFILE_LABELS: Record<MovementProfileId, string> = {
  balanced: "Balanced",
  aggressive: "Aggressive",
  evasive: "Evasive",
  stationary: "Stationary",
  flanker: "Flanker",
  charger: "Charger",
};

const MOVEMENT_PROFILE_COLORS: Record<MovementProfileId, string> = {
  balanced: "#8b5cf6",
  aggressive: "#ef4f64",
  evasive: "#2d9cdb",
  stationary: "#5f6b76",
  flanker: "#187b70",
  charger: "#ff8f4f",
};

const WEAPON_COLORS: Record<string, string> = {
  ray: "#a9fffd",
  missile: "#ff8f4f",
  boomerang: "#d7f8ff",
  blade: "#ff0055",
  "blast-rifle": "#2bbcff",
  shotgun: "#ffd166",
  mine: "#f6c85f",
  shield: "#7ef7c7",
  emp: "#a9fffd",
  railgun: "#36e0ff",
  rocket: "#ff6a3d",
};

const MOVEMENT_LABELS: Record<MovementId, string> = {
  orbit: "Orbit",
  boost: "Forward Boost",
  backstep: "Backstep",
  "strafe-left": "Strafe Left",
  "strafe-right": "Strafe Right",
  hold: "Hold",
  evade: "Evade",
};

export default function App() {
  const [seed, setSeed] = useState("bot-fighter-001");
  const [classes, setClasses] = useState<RobotClass[]>(() => readClassProfiles());
  const [movementProfiles, setMovementProfiles] = useState<MovementProfileMap>(() =>
    readMovementProfiles()
  );
  const [robots, setRobots] = useState<RobotConfig[]>(() =>
    cloneFightConfig(createDefaultFightConfig()).robots
  );
  const [maxDuration, setMaxDuration] = useState(80);
  const [speed, setSpeed] = useState(1);
  const [settings, setSettings] = useState<GameSettings>(() => readSettings());
  const [activeTab, setActiveTab] = useState<Tab>("setup");
  const [isPlaying, setIsPlaying] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [exportStatus, setExportStatus] = useState("Ready");
  const [frameIndex, setFrameIndex] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>(() => readHistory());
  const [weapons, setWeapons] = useState<WeaponDefinition[]>(() => readWeaponProfiles());
  const [intro, setIntro] = useState<string[] | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const lastSoundTimeRef = useRef(-0.01);
  const soundEngineRef = useRef<SoundEngine | null>(null);
  const introTimeoutRef = useRef<number | null>(null);

  const syncedRobots = useMemo(
    () => robots.map((robot, index) => syncRobotWithClass(robot, classes, index, movementProfiles)),
    [classes, movementProfiles, robots]
  );

  const config = useMemo<FightConfig>(
    () => ({
      ...createDefaultFightConfig(seed),
      seed,
      maxDuration,
      moveInterval: settings.moveInterval,
      weaponInterval: settings.weaponInterval,
      centerGravity: settings.centerGravity,
      classes,
      movementProfiles,
      weapons,
      robots: syncedRobots,
    }),
    [classes, maxDuration, movementProfiles, seed, settings, syncedRobots, weapons]
  );
  const result = useMemo(() => simulateFight(config), [config]);
  const frame = result.frames[Math.min(frameIndex, result.frames.length - 1)] ?? result.frames[0];
  const finalFrame = result.frames[result.frames.length - 1] ?? result.frames[0];
  const winner = result.config.robots.find((robot) => robot.id === result.winnerId);
  const matchDuration = getMatchDuration(result);
  const healthChartSeries = useMemo(() => buildHealthChartSeries(result, matchDuration), [matchDuration, result]);
  const underdogScore = useMemo(() => calculateUnderdogScore(result, matchDuration), [matchDuration, result]);
  const recentEvents = result.events
    .filter((event) => event.type === "hit")
    .slice(-8)
    .reverse();

  useEffect(() => {
    setFrameIndex(0);
    startedAtRef.current = null;
    lastSoundTimeRef.current = -0.01;
  }, [result]);

  useEffect(
    () => () => {
      if (introTimeoutRef.current !== null) {
        window.clearTimeout(introTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !frame) {
      return;
    }

    drawFightFrame(context, frame, result);
    if (intro) {
      drawIntroCard(context, intro);
    }
  }, [frame, result, intro]);

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

  useEffect(() => {
    window.localStorage.setItem(CLASS_PROFILE_KEY, JSON.stringify(classes));
    window.localStorage.setItem(MOVEMENT_PROFILE_KEY, JSON.stringify(movementProfiles));
    window.localStorage.setItem(WEAPON_PROFILE_KEY, JSON.stringify(weapons));
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    void fetch("http://localhost:8787/api/class-profiles", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classes, movementProfiles, weapons, settings }),
    }).catch(() => undefined);
  }, [classes, movementProfiles, settings, weapons]);

  useEffect(() => {
    void fetch("http://localhost:8787/api/class-profiles")
      .then((response) => (response.ok ? response.json() : undefined))
      .then(
        (
          payload:
            | {
                classes?: RobotClass[];
                movementProfiles?: MovementProfileMap;
                weapons?: WeaponDefinition[];
                settings?: Partial<GameSettings>;
              }
            | undefined
        ) => {
        if (payload?.classes?.length) {
          setClasses(withClassDefaults(payload.classes));
        }
        if (payload?.movementProfiles) {
          setMovementProfiles(cloneMovementProfiles(payload.movementProfiles));
        }
        if (payload?.weapons?.length) {
          setWeapons(payload.weapons);
        }
        if (payload?.settings) {
          setSettings((current) => ({ ...current, ...payload.settings }));
        }
      })
      .catch(() => undefined);
  }, []);

  function updateRobot(robotId: string, updater: (robot: RobotConfig) => RobotConfig) {
    setRobots((current) => current.map((robot) => (robot.id === robotId ? updater(robot) : robot)));
  }

  function updateSetting<K extends keyof GameSettings>(key: K, value: GameSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function updateClass(classId: string, updater: (robotClass: RobotClass) => RobotClass) {
    setClasses((current) =>
      current.map((robotClass) => {
        if (robotClass.id !== classId) {
          return robotClass;
        }

        const next = updater(robotClass);
        return {
          ...next,
          arsenal: next.arsenal.length > 0 ? next.arsenal : [WEAPONS[0].id],
        };
      })
    );
  }

  function updateMovementWeight(
    profileId: MovementProfileId,
    movementId: MovementId,
    weight: number
  ) {
    setMovementProfiles((current) => ({
      ...current,
      [profileId]: normalizeMovementProfile(current[profileId]).map((die) =>
        die.id === movementId
          ? { ...die, weight: Math.max(0, Math.min(10, Math.round(weight))) }
          : die
      ),
    }));
  }

  function updateWeaponDamage(weaponId: WeaponDefinition["id"], damage: number) {
    setWeapons((current) =>
      current.map((weapon) =>
        weapon.id === weaponId ? { ...weapon, damage: Math.max(0, Math.round(damage)) } : weapon
      )
    );
  }

  function addBot() {
    setRobots((current) => {
      const next = createRobotFromClass(
        classes[0]?.id ?? ROBOT_CLASSES[0].id,
        current.length,
        classes,
        movementProfiles
      );
      return [
        ...current,
        {
          ...next,
          id: `${next.classId}-${Date.now().toString(36)}`,
        },
      ];
    });
  }

  function removeBot(robotId: string) {
    setRobots((current) => (current.length > 2 ? current.filter((robot) => robot.id !== robotId) : current));
  }

  function randomizeSeed() {
    setSeed(`fight-${Date.now().toString(36)}`);
    setFrameIndex(0);
    startPreview();
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
    setIsPlaying(false);

    const names = syncedRobots.map((robot) => getClassName(robot.classId, classes));
    setIntro(names);

    if (introTimeoutRef.current !== null) {
      window.clearTimeout(introTimeoutRef.current);
    }
    introTimeoutRef.current = window.setTimeout(() => {
      setIntro(null);
      startedAtRef.current = null;
      setIsPlaying(true);
    }, 2000);
  }

  function saveToHistory(resultToSave: FightResult) {
    const winnerRobot = resultToSave.config.robots.find((robot) => robot.id === resultToSave.winnerId);
    const winnerName = winnerRobot ? getClassName(winnerRobot.classId, resultToSave.config.classes) : "Draw";
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
              className={activeTab === "weapons" ? "tab-button is-active" : "tab-button"}
              onClick={() => setActiveTab("weapons")}
            >
              <Crosshair size={17} />
              Weapons
            </button>
            <button
              className={activeTab === "movement" ? "tab-button is-active" : "tab-button"}
              onClick={() => setActiveTab("movement")}
            >
              <Swords size={17} />
              Move
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
                    max={180}
                    value={maxDuration}
                    onChange={(event) => setMaxDuration(Number(event.target.value))}
                  />
                </label>
                <label className="field">
                  <span>Speed · {speed.toFixed(2)}x</span>
                  <input
                    type="range"
                    min={0.5}
                    max={3}
                    step={0.25}
                    value={speed}
                    onChange={(event) => setSpeed(Number(event.target.value))}
                  />
                </label>
              </div>

              <section className="robot-editor">
                <div className="robot-editor__header">
                  <span style={{ background: "#2fffc8" }} />
                  <strong>Match Tuning</strong>
                </div>
                <label className="field">
                  <span>Movement delay · {settings.moveInterval.toFixed(2)}s</span>
                  <input
                    type="range"
                    min={0.25}
                    max={3}
                    step={0.25}
                    value={settings.moveInterval}
                    onChange={(event) => updateSetting("moveInterval", Number(event.target.value))}
                  />
                </label>
                <label className="field">
                  <span>Firing delay · {settings.weaponInterval.toFixed(2)}s</span>
                  <input
                    type="range"
                    min={0.5}
                    max={5}
                    step={0.25}
                    value={settings.weaponInterval}
                    onChange={(event) => updateSetting("weaponInterval", Number(event.target.value))}
                  />
                </label>
                <label className="field">
                  <span>Center gravity · {Math.round(settings.centerGravity * 100)}%</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={settings.centerGravity}
                    onChange={(event) => updateSetting("centerGravity", Number(event.target.value))}
                  />
                </label>
                <p className="muted">Tuning autosaves to the backend on every change.</p>
              </section>

              {robots.map((robot, index) => (
                <section className="robot-editor" key={robot.id}>
                  <div className="robot-editor__header">
                    <span style={{ background: classes.find((robotClass) => robotClass.id === robot.classId)?.palette.body }} />
                    <strong>Bot {index + 1}</strong>
                    <button
                      className="icon-button"
                      title="Remove bot"
                      onClick={() => removeBot(robot.id)}
                      disabled={robots.length <= 2}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <label className="field">
                    <span>Class</span>
                    <select
                      value={robot.classId}
                      onChange={(event) =>
                        updateRobot(robot.id, (current) => ({ ...current, classId: event.target.value }))
                      }
                    >
                      {classes.map((robotClass) => (
                        <option key={robotClass.id} value={robotClass.id}>
                          {robotClass.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </section>
              ))}
              <button className="primary-button full-width" onClick={addBot}>
                <Plus size={18} />
                Add Bot
              </button>
            </div>
          )}

          {activeTab === "dice" && (
            <div className="panel-stack">
              {classes.map((robotClass) => (
                <section className="robot-editor" key={robotClass.id}>
                  <div className="robot-editor__header">
                    <span style={{ background: robotClass.palette.body }} />
                    <strong>{robotClass.name}</strong>
                  </div>
                  <div className="two-col">
                    <label className="field">
                      <span>Starting Health</span>
                      <input
                        type="number"
                        min={1}
                        max={400}
                        value={robotClass.hp}
                        onChange={(event) =>
                          updateClass(robotClass.id, (current) => ({
                            ...current,
                            hp: Number(event.target.value),
                          }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Impact Damage Dealt</span>
                      <input
                        type="number"
                        min={0}
                        max={80}
                        value={robotClass.impactDamage}
                        onChange={(event) =>
                          updateClass(robotClass.id, (current) => ({
                            ...current,
                            impactDamage: Number(event.target.value),
                          }))
                        }
                      />
                    </label>
                  </div>
                  <div className="two-col">
                    <label className="field">
                      <span>Starting Shield</span>
                      <input
                        type="number"
                        min={0}
                        max={80}
                        value={robotClass.shield}
                        onChange={(event) =>
                          updateClass(robotClass.id, (current) => ({
                            ...current,
                            shield: Number(event.target.value),
                          }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Rotation Speed · {robotClass.rotationSpeed.toFixed(2)}x</span>
                      <div className="input-action">
                        <input
                          type="range"
                          min={0}
                          max={3}
                          step={0.05}
                          value={robotClass.rotationSpeed}
                          onChange={(event) =>
                            updateClass(robotClass.id, (current) => ({
                              ...current,
                              rotationSpeed: Number(event.target.value),
                            }))
                          }
                        />
                        <input
                          type="number"
                          min={0}
                          max={3}
                          step={0.01}
                          value={robotClass.rotationSpeed}
                          onChange={(event) =>
                            updateClass(robotClass.id, (current) => ({
                              ...current,
                              rotationSpeed: Number(event.target.value),
                            }))
                          }
                        />
                      </div>
                    </label>
                  </div>
                  <div className="two-col">
                    <label className="field">
                      <span>Movement Profile</span>
                      <select
                        value={robotClass.movementProfile}
                        onChange={(event) =>
                          updateClass(robotClass.id, (current) => ({
                            ...current,
                            movementProfile: event.target.value as MovementProfileId,
                          }))
                        }
                      >
                        {Object.entries(MOVEMENT_PROFILE_LABELS).map(([profileId, label]) => (
                          <option key={profileId} value={profileId}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="check-grid">
                    {WEAPONS.map((weapon) => (
                      <label key={weapon.id} className="check-row">
                        <input
                          type="checkbox"
                          checked={robotClass.arsenal.includes(weapon.id)}
                          onChange={(event) =>
                            updateClass(robotClass.id, (current) => {
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
                  <p className="muted">Weapon odds are automatic: {Math.round(100 / Math.max(1, robotClass.arsenal.length))}% each.</p>
                </section>
              ))}
            </div>
          )}

          {activeTab === "weapons" && (
            <div className="panel-stack">
              {weapons.map((weapon) => (
                <section className="robot-editor" key={weapon.id}>
                  <div className="robot-editor__header">
                    <span style={{ background: WEAPON_COLORS[weapon.id] ?? "#9feee2" }} />
                    <strong>{weapon.name}</strong>
                    <em className="weapon-rarity">{weapon.rarity}</em>
                  </div>
                  <label className="field">
                    <span>Damage</span>
                    <div className="input-action">
                      <input
                        type="range"
                        min={0}
                        max={120}
                        step={1}
                        value={weapon.damage}
                        onChange={(event) => updateWeaponDamage(weapon.id, Number(event.target.value))}
                      />
                      <input
                        type="number"
                        min={0}
                        max={200}
                        value={weapon.damage}
                        onChange={(event) => updateWeaponDamage(weapon.id, Number(event.target.value))}
                      />
                    </div>
                  </label>
                  <dl className="weapon-stats">
                    <div><dt>Type</dt><dd>{weapon.kind}</dd></div>
                    <div><dt>Range</dt><dd>{weapon.range}</dd></div>
                    <div><dt>Cooldown</dt><dd>{weapon.cooldown}s</dd></div>
                    <div><dt>Speed</dt><dd>{weapon.projectileSpeed || "—"}</dd></div>
                    <div><dt>Radius</dt><dd>{weapon.radius}</dd></div>
                    <div><dt>Knockback</dt><dd>{weapon.knockback}</dd></div>
                  </dl>
                </section>
              ))}
            </div>
          )}

          {activeTab === "movement" && (
            <div className="panel-stack">
              {Object.entries(movementProfiles).map(([profileId, dice]) => {
                const normalizedDice = normalizeMovementProfile(dice);
                const totalWeight = normalizedDice.reduce((sum, die) => sum + die.weight, 0);

                return (
                <section className="robot-editor" key={profileId}>
                  <div className="robot-editor__header">
                    <span style={{ background: MOVEMENT_PROFILE_COLORS[profileId as MovementProfileId] }} />
                    <strong>{MOVEMENT_PROFILE_LABELS[profileId as MovementProfileId]}</strong>
                  </div>
                  <div className="movement-weight-list">
                    {MOVEMENTS.map((movementId) => {
                      const die = normalizedDice.find((candidate) => candidate.id === movementId) ?? {
                        id: movementId,
                        weight: 0,
                      };
                      const percentage = totalWeight > 0 ? Math.round((die.weight / totalWeight) * 100) : 0;

                      return (
                        <label className="movement-weight-row" key={movementId}>
                          <span>{MOVEMENT_LABELS[movementId]}</span>
                          <input
                            type="range"
                            min={0}
                            max={10}
                            step={1}
                            value={die.weight}
                            onChange={(event) =>
                              updateMovementWeight(
                                profileId as MovementProfileId,
                                movementId,
                                Number(event.target.value)
                              )
                            }
                          />
                          <input
                            type="number"
                            min={0}
                            max={10}
                            value={die.weight}
                            onChange={(event) =>
                              updateMovementWeight(
                                profileId as MovementProfileId,
                                movementId,
                                Number(event.target.value)
                              )
                            }
                          />
                          <strong>{percentage}%</strong>
                        </label>
                      );
                    })}
                  </div>
                  <p className="muted">Total weight: {totalWeight || 0}</p>
                </section>
                );
              })}
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
                <strong>{winner ? getClassName(winner.classId, classes) : "Draw"}</strong>
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
              <strong>{syncedRobots.map((robot) => getClassName(robot.classId, classes)).join(" vs ")}</strong>
            </div>
            <div className="progress-track">
              <span style={{ width: `${(frame.time / result.duration) * 100}%` }} />
            </div>
          </div>
        </section>

        <aside className="telemetry" aria-label="Fight telemetry">
          <section className="score-band">
            <span>Winner</span>
            <div className="score-band__headline">
              <strong>{winner ? getClassName(winner.classId, classes) : "Draw"}</strong>
              <em title={`HP-area score: ${underdogScore.secondArea.toFixed(0)} vs ${underdogScore.firstArea.toFixed(0)}`}>
                {formatScore(underdogScore.value)}
              </em>
              <time>{matchDuration.toFixed(1)}s</time>
            </div>
            <small>{result.events.find((event) => event.type === "winner")?.reason ?? "pending"}</small>
          </section>

          <section className="event-feed">
            <h2>Timeline</h2>
            {recentEvents.length === 0 && <p className="muted">No hits yet.</p>}
            {recentEvents.map((event, index) => (
              <div className="event-row" key={`${event.type}-${event.time}-${index}`}>
                <time>{event.time.toFixed(1)}s</time>
                <span>{formatEvent(event, config)}</span>
              </div>
            ))}
          </section>

          <HealthTimelineChart
            currentTime={Math.min(frame.time, matchDuration)}
            duration={matchDuration}
            frame={frame}
            series={healthChartSeries}
          />

          <section className="stat-grid">
            {syncedRobots.map((robot) => {
              const robotFrame = frame.robots.find((candidate) => candidate.id === robot.id);
              const finalRobotFrame = finalFrame.robots.find((candidate) => candidate.id === robot.id);
              const damageDealt = result.damageByRobot[robot.id] ?? 0;
              return (
                <div className="stat-box" key={robot.id}>
                  <span>{getClassName(robot.classId, classes)}</span>
                  <strong>{Math.round(robotFrame?.hp ?? 0)} HP</strong>
                  <small>
                    {Math.round(finalRobotFrame?.hp ?? 0)} remain <br></br> {Math.round(damageDealt)} dealt
                  </small>
                </div>
              );
            })}
          </section>
        </aside>
      </section>
    </main>
  );
}

function HealthTimelineChart({
  currentTime,
  duration,
  frame,
  series,
}: {
  currentTime: number;
  duration: number;
  frame: FightResult["frames"][number];
  series: HealthChartSeries[];
}) {
  const chartWidth = 320;
  const chartHeight = 128;
  const plotLeft = 34;
  const plotRight = 12;
  const plotTop = 12;
  const plotBottom = 24;
  const plotWidth = chartWidth - plotLeft - plotRight;
  const plotHeight = chartHeight - plotTop - plotBottom;
  const safeDuration = Math.max(0.001, duration);
  const currentX = plotLeft + (Math.min(currentTime, safeDuration) / safeDuration) * plotWidth;

  return (
    <section className="health-chart">
      <div className="health-chart__header">
        <h2>HP Remaining</h2>
        <span>{duration.toFixed(1)}s</span>
      </div>
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="HP remaining over time">
        {[0, 50, 100].map((mark) => {
          const y = plotTop + ((100 - mark) / 100) * plotHeight;
          return (
            <g key={mark}>
              <line className="health-chart__grid" x1={plotLeft} x2={chartWidth - plotRight} y1={y} y2={y} />
              <text className="health-chart__tick" x={4} y={y + 4}>
                {mark}%
              </text>
            </g>
          );
        })}
        <line
          className="health-chart__cursor"
          x1={currentX}
          x2={currentX}
          y1={plotTop}
          y2={plotTop + plotHeight}
        />
        {series.map((robotSeries) => (
          <polyline
            className="health-chart__line"
            key={robotSeries.robotId}
            points={robotSeries.points
              .map((point) => {
                const x = plotLeft + (point.time / safeDuration) * plotWidth;
                const y = plotTop + ((100 - point.hpPercent) / 100) * plotHeight;
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              })
              .join(" ")}
            stroke={robotSeries.color}
          />
        ))}
        <line
          className="health-chart__axis"
          x1={plotLeft}
          x2={chartWidth - plotRight}
          y1={plotTop + plotHeight}
          y2={plotTop + plotHeight}
        />
      </svg>
      <div className="health-chart__legend">
        {series.map((robotSeries) => {
          const robotFrame = frame.robots.find((robot) => robot.id === robotSeries.robotId);
          const hpPercent = robotFrame ? hpPercentFor(robotFrame.hp, robotFrame.maxHp) : 0;
          return (
            <span key={robotSeries.robotId}>
              <i style={{ background: robotSeries.color }} />
              {robotSeries.name} {Math.round(hpPercent)}%
            </span>
          );
        })}
      </div>
    </section>
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

function readClassProfiles(): RobotClass[] {
  try {
    const raw = window.localStorage.getItem(CLASS_PROFILE_KEY);
    return raw
      ? withClassDefaults(JSON.parse(raw) as RobotClass[])
      : withClassDefaults(ROBOT_CLASSES);
  } catch {
    return withClassDefaults(ROBOT_CLASSES);
  }
}

function readMovementProfiles(): MovementProfileMap {
  try {
    const raw = window.localStorage.getItem(MOVEMENT_PROFILE_KEY);
    if (!raw) {
      return cloneMovementProfiles(MOVEMENT_PROFILES);
    }

    return cloneMovementProfiles({
      ...MOVEMENT_PROFILES,
      ...(JSON.parse(raw) as Partial<MovementProfileMap>),
    });
  } catch {
    return cloneMovementProfiles(MOVEMENT_PROFILES);
  }
}

function readWeaponProfiles(): WeaponDefinition[] {
  const base = cloneWeapons();
  try {
    const raw = window.localStorage.getItem(WEAPON_PROFILE_KEY);
    if (!raw) {
      return base;
    }

    const stored = JSON.parse(raw) as WeaponDefinition[];
    // Merge persisted overrides onto the current catalog so newly added
    // weapons still show up and only edited fields (damage) carry over.
    return base.map((weapon) => {
      const override = stored.find((candidate) => candidate.id === weapon.id);
      return override ? { ...weapon, damage: override.damage } : weapon;
    });
  } catch {
    return base;
  }
}

function readSettings(): GameSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<GameSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
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

function getMatchDuration(result: FightResult): number {
  return result.events.find((event) => event.type === "winner")?.time ?? result.duration;
}

function buildHealthChartSeries(result: FightResult, duration: number): HealthChartSeries[] {
  const sampledFrames = sampleFrames(result.frames.filter((frame) => frame.time <= duration + 0.0001));
  return result.config.robots.map((robot) => ({
    robotId: robot.id,
    name: getClassName(robot.classId, result.config.classes),
    color: robot.palette.glow || robot.palette.body,
    points: sampledFrames.map((frame) => {
      const robotFrame = frame.robots.find((candidate) => candidate.id === robot.id);
      return {
        time: Math.min(frame.time, duration),
        hpPercent: robotFrame ? hpPercentFor(robotFrame.hp, robotFrame.maxHp) : 0,
      };
    }),
  }));
}

function sampleFrames(frames: FightResult["frames"]): FightResult["frames"] {
  const maxPoints = 140;
  if (frames.length <= maxPoints) {
    return frames;
  }

  const sampled: FightResult["frames"] = [];
  const step = (frames.length - 1) / (maxPoints - 1);
  for (let index = 0; index < maxPoints; index += 1) {
    const frame = frames[Math.round(index * step)];
    if (frame && sampled[sampled.length - 1]?.time !== frame.time) {
      sampled.push(frame);
    }
  }
  return sampled;
}

function calculateUnderdogScore(result: FightResult, duration: number): UnderdogScore {
  const areas = calculateHealthAreas(result, duration);
  const finalFrame =
    [...result.frames].reverse().find((frame) => frame.time <= duration + 0.0001) ??
    result.frames[result.frames.length - 1];
  const rankedRobots = [...result.config.robots].sort((left, right) => {
    if (left.id === result.winnerId) {
      return -1;
    }
    if (right.id === result.winnerId) {
      return 1;
    }

    const leftFrame = finalFrame?.robots.find((robot) => robot.id === left.id);
    const rightFrame = finalFrame?.robots.find((robot) => robot.id === right.id);
    const hpDelta = (rightFrame?.hp ?? 0) - (leftFrame?.hp ?? 0);
    if (hpDelta !== 0) {
      return hpDelta;
    }
    return (result.damageByRobot[right.id] ?? 0) - (result.damageByRobot[left.id] ?? 0);
  });

  const firstArea = areas[rankedRobots[0]?.id ?? ""] ?? 0;
  const secondArea = areas[rankedRobots[1]?.id ?? ""] ?? 0;
  const rawScore = firstArea > 0 ? ((secondArea - firstArea) / firstArea) * 100 : 0;
  return {
    value: Math.max(-100, Math.min(100, rawScore)),
    firstArea,
    secondArea,
  };
}

function calculateHealthAreas(result: FightResult, duration: number): Record<string, number> {
  const areas = Object.fromEntries(result.config.robots.map((robot) => [robot.id, 0]));
  const safeDuration = Math.max(0, duration);

  for (let index = 1; index < result.frames.length; index += 1) {
    const previousFrame = result.frames[index - 1];
    const currentFrame = result.frames[index];
    const startTime = Math.min(previousFrame.time, safeDuration);
    const endTime = Math.min(currentFrame.time, safeDuration);
    const deltaTime = endTime - startTime;

    if (deltaTime <= 0) {
      continue;
    }

    for (const robot of result.config.robots) {
      const previousRobot = previousFrame.robots.find((candidate) => candidate.id === robot.id);
      const currentRobot = currentFrame.robots.find((candidate) => candidate.id === robot.id);
      const previousHp = previousRobot ? hpPercentFor(previousRobot.hp, previousRobot.maxHp) : 0;
      const currentHp = currentRobot ? hpPercentFor(currentRobot.hp, currentRobot.maxHp) : 0;
      areas[robot.id] += ((previousHp + currentHp) / 2) * deltaTime;
    }
  }

  return areas;
}

function hpPercentFor(hp: number, maxHp: number): number {
  return Math.max(0, Math.min(100, (hp / Math.max(1, maxHp)) * 100));
}

function formatScore(score: number): string {
  const rounded = Math.round(score);
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

function formatEvent(event: FightResult["events"][number], config: FightConfig): string {
  const robotName = (id?: string) => {
    const robot = config.robots.find((candidate) => candidate.id === id);
    return robot ? getClassName(robot.classId, config.classes) : "Unknown";
  };

  if (event.type === "weapon") {
    const weapon = WEAPONS.find((candidate) => candidate.id === event.weaponId);
    return `${robotName(event.robotId)} rolled ${weapon?.name ?? event.weaponId}`;
  }

  if (event.type === "hit") {
    const weapon = config.weapons.find((candidate) => candidate.id === event.weaponId);
    return `${robotName(event.attackerId)} > ${robotName(event.targetId)} - ${weapon?.name ?? event.weaponId} - ${event.damage.toFixed(0)}`;
  }

  if (event.type === "winner") {
    return `${robotName(event.winnerId)} wins by ${event.reason}`;
  }

  return event.type;
}

function getClassName(classId: string, classes: RobotClass[]): string {
  return classes.find((robotClass) => robotClass.id === classId)?.name ?? classId;
}
