import { type FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import logo from "../../assets/logo.png";
import {
  type LauncherApi,
  MINECRAFT,
  NEOFORGE,
  type Progress,
  type Settings,
  type Status,
} from "../main/contract.js";
import "./launcher.css";

declare global {
  interface Window {
    launcher: LauncherApi;
  }
}

const initialSettings: Settings = {
  nickname: "",
  host: "",
  updatePort: 3000,
  gamePort: 25565,
  memoryGb: 4,
};

function errorText(error: unknown) {
  return error instanceof Error
    ? error.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        "",
      )
    : "Не удалось выполнить операцию.";
}

function ServerStatus({
  label,
  online,
  checking,
}: {
  label: string;
  online?: boolean;
  checking: boolean;
}) {
  const state =
    online === undefined ? "unknown" : online ? "online" : "offline";
  return (
    <div className="server-status">
      <span className={`status-dot ${state}`} aria-hidden="true" />
      <div>
        <div className="status-title">{label}</div>
        <div className="status-description">
          {online === undefined
            ? checking
              ? "Проверяем…"
              : "Адрес не задан"
            : online
              ? "Доступен"
              : "Недоступен"}
        </div>
      </div>
    </div>
  );
}

function SettingsForm({
  current,
  onCancel,
  onSave,
}: {
  current: Settings;
  onCancel: () => void;
  onSave: (settings: Settings) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      const saved = await window.launcher.saveSettings({
        nickname: String(form.get("nickname")),
        host: String(form.get("host")),
        updatePort: Number(form.get("updatePort")),
        gamePort: Number(form.get("gamePort")),
        memoryGb: Number(form.get("memoryGb")),
      });
      onSave(saved);
    } catch (failure) {
      setError(errorText(failure));
      setSaving(false);
    }
  }

  return (
    <section className="settings" aria-labelledby="settings-title">
      <div className="settings-heading">
        <h1 id="settings-title">Настройки</h1>
        <button
          className="secondary"
          type="button"
          onClick={onCancel}
          disabled={saving}
        >
          Назад
        </button>
      </div>
      <form onSubmit={submit} noValidate>
        <fieldset disabled={saving}>
          <div className="fields">
            <label>
              Игровой никнейм
              <input
                name="nickname"
                defaultValue={current.nickname}
                placeholder="Player"
                pattern="[A-Za-z0-9_]{3,16}"
                required
              />
            </label>
            <label>
              IP-адрес сервера
              <input
                name="host"
                defaultValue={current.host}
                placeholder="127.0.0.1"
                required
              />
            </label>
            <label>
              Порт обновлений
              <input
                name="updatePort"
                type="number"
                defaultValue={current.updatePort}
                min="1"
                max="65535"
                required
              />
            </label>
            <label>
              Порт Minecraft
              <input
                name="gamePort"
                type="number"
                defaultValue={current.gamePort}
                min="1"
                max="65535"
                required
              />
            </label>
            <label>
              Память для игры, ГБ
              <input
                name="memoryGb"
                type="number"
                defaultValue={current.memoryGb}
                min="2"
                max="64"
                required
              />
            </label>
          </div>
        </fieldset>
        <div className="form-footer">
          <span role="alert">{error}</span>
          <button className="primary" disabled={saving} type="submit">
            Сохранить
          </button>
        </div>
      </form>
    </section>
  );
}

function App() {
  const [settings, setSettings] = useState(initialSettings);
  const [status, setStatus] = useState<Status | null>(null);
  const [screen, setScreen] = useState<"home" | "settings">("home");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<Progress>({
    phase: "idle",
    message: "",
  });
  const busy = pending || !["idle", "error"].includes(progress.phase);

  useEffect(() => {
    const unsubscribe = window.launcher.onProgress(setProgress);
    void window.launcher.getProgress().then(setProgress);
    void window.launcher
      .getSettings()
      .then(setSettings)
      .catch((error) =>
        setProgress({ phase: "error", message: errorText(error) }),
      )
      .finally(() => setLoading(false));
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!settings.host) return;
    let ignore = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const current = await window.launcher
        .getStatus()
        .catch(() => ({ updates: false, minecraft: false }));
      if (!ignore) {
        setStatus(current);
        timer = setTimeout(poll, 8000);
      }
    }
    void poll();
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [settings]);

  async function play() {
    if (!settings.host) {
      setScreen("settings");
      return;
    }
    setPending(true);
    try {
      await window.launcher.play();
    } catch (error) {
      setProgress({ phase: "error", message: errorText(error) });
    } finally {
      setPending(false);
    }
  }

  const showBar = busy && progress.phase !== "running";
  const message =
    progress.phase === "error"
      ? progress.message
      : !settings.host
        ? "Для первого запуска заполните настройки."
        : (progress.message ?? "Готов к запуску");

  return (
    <main className="shell">
      <header className="topbar">
        <img className="mark" src={logo} alt="" width="46" height="46" />
        {screen === "home" && (
          <button
            className="secondary"
            type="button"
            onClick={() => setScreen("settings")}
            disabled={busy || loading}
          >
            Настройки
          </button>
        )}
      </header>
      {screen === "settings" ? (
        <SettingsForm
          current={settings}
          onCancel={() => setScreen("home")}
          onSave={(saved) => {
            setStatus(null);
            setSettings(saved);
            setScreen("home");
          }}
        />
      ) : (
        <>
          <section className="hero" aria-labelledby="hero-title">
            <div className="hero-content">
              <h1 id="hero-title">GLauncher</h1>
              <p>
                Minecraft {MINECRAFT} <span aria-hidden="true">·</span> NeoForge{" "}
                {NEOFORGE}
              </p>
            </div>
          </section>
          <section className="servers" aria-label="Состояние серверов">
            <ServerStatus
              label="Сервер Minecraft"
              online={status?.minecraft}
              checking={Boolean(settings.host)}
            />
            <ServerStatus
              label="Сервер обновлений"
              online={status?.updates}
              checking={Boolean(settings.host)}
            />
          </section>
          <footer className="launchbar">
            <div className="launch-status">
              <span
                className={progress.phase === "error" ? "error" : ""}
                role="status"
              >
                {message}
              </span>
              {showBar && (
                <progress
                  aria-label="Ход операции"
                  max={1}
                  value={progress.fraction}
                />
              )}
            </div>
            <button
              className="primary play"
              type="button"
              disabled={busy || loading}
              onClick={() => void play()}
            >
              <span aria-hidden="true" className="play-icon" />
              Играть
            </button>
          </footer>
        </>
      )}
    </main>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("Missing renderer root element");
createRoot(container).render(<App />);
