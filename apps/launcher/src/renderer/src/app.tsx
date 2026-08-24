import { FormEvent, useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, CSSProperties, JSX } from "react";
import type {
  AdminClientMod,
  AdminServer,
  AdminServerCreateInput,
  AdminServerUpdateInput,
  CurrentUser,
  ServerCatalogItem,
} from "@lapis/contracts";
import type { AppUpdateStatus } from "../../shared/update-types";
import { IdleAnimation, SkinViewer } from "skinview3d";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faDownload,
  faCircleInfo,
  faEllipsisVertical,
  faGear,
  faKey,
  faPlay,
  faPlus,
  faPuzzlePiece,
  faRotateRight,
  faShieldHalved,
  faSpinner,
  faStop,
  faTrash,
  faUpload,
} from "@fortawesome/free-solid-svg-icons";

type Mode = "login" | "register";
type Session = CurrentUser;
type AppPage = "servers" | "admin";
type RunningGame = { pid: number; serverId: string; nickname: string } | null;
type Notice = { id: number; message: string } | null;
type AuthField = "nickname" | "password" | "confirmation";
type AuthFieldErrors = Partial<Record<AuthField, string>>;
type BuildStatus = "missing" | "update" | "ready";
type PlayerSkin = { textureUrl: string; model: "default" | "slim" };
type ServerMod = { fileName: string; required: boolean };
type ServerPlayer = { nickname: string; skin: PlayerSkin };
type InstallProgress = {
  serverId: string;
  progress: number;
  phase:
    | "preparing"
    | "java"
    | "minecraft"
    | "libraries"
    | "assets"
    | "fabric"
    | "mods"
    | "complete";
  completed?: number;
  total?: number;
  fileName?: string;
};
type LaunchSettings = {
  memoryMb: number;
  recommendedMemoryMb: number;
  maxMemoryMb: number;
  fullscreen: boolean;
};
const DEFAULT_PLAYER_SKIN: PlayerSkin = {
  textureUrl:
    "https://textures.minecraft.net/texture/6d3b06c38504ffc0229b9492147c69fcf59fd2ed7885f78502152f77b4d50de1",
  model: "default",
};
type ConfirmAction =
  | { kind: "delete"; server: ServerCatalogItem }
  | { kind: "stop" }
  | { kind: "logout" };
type ServerListState = {
  kind: "mods" | "players";
  server: ServerCatalogItem;
  loading: boolean;
  error: string;
  mods: ServerMod[];
  players: ServerPlayer[];
};

function rendererAssetUrl(path: string): string {
  return new URL(path, document.baseURI).toString();
}

function VideoBackdrop(): JSX.Element {
  return (
    <div className="video-backdrop" aria-hidden="true">
      <video
        autoPlay
        muted
        loop
        playsInline
        poster={rendererAssetUrl("./video/LapisIcon.jpg")}
      >
        <source
          src={rendererAssetUrl("./video/LapisVideo.mp4")}
          type="video/mp4"
        />
      </video>
      <div className="video-shade" />
    </div>
  );
}
function UserIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.42 0-8 2.01-8 4.5V20h16v-1.5c0-2.49-3.58-4.5-8-4.5Z" />
    </svg>
  );
}
function LockIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2Zm-7-2a2 2 0 1 1 4 0v2h-4V7Zm3 9.73V19h-2v-2.27A2 2 0 1 1 13 16.73Z" />
    </svg>
  );
}
function PasswordIcon(): JSX.Element {
  return <FontAwesomeIcon icon={faKey} aria-hidden="true" />;
}
function EyeIcon({ visible }: { visible: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={
          visible
            ? "M12 5c-5.5 0-9.5 5.2-9.5 7s4 7 9.5 7 9.5-5.2 9.5-7-4-7-9.5-7Zm0 11.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Z"
            : "m3 4 17 17-1.4 1.4-2.5-2.5c-1.25.54-2.64.85-4.1.85-5.5 0-9.5-5.2-9.5-7 0-.98 1.18-2.63 3.08-4.02L1.6 5.4 3 4Zm6.1 6.1A4.5 4.5 0 0 0 13.9 14.9L9.1 10.1ZM12 5c5.5 0 9.5 5.2 9.5 7 0 .82-.83 2.12-2.24 3.31l-2.12-2.12A4.5 4.5 0 0 0 10.8 6.86L9.23 5.29C10.1 5.1 11.03 5 12 5Z"
        }
      />
    </svg>
  );
}
function Spinner(): JSX.Element {
  return <span className="spinner" aria-label="Загрузка" />;
}
function IconButton({
  icon,
  tooltip,
  size = 38,
  color,
  className = "",
  style,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "color"> & {
  icon: JSX.Element;
  tooltip: string;
  size?: number;
  color?: string;
}): JSX.Element {
  const buttonStyle = {
    ...style,
    "--icon-button-size": `${size}px`,
    ...(color ? { "--icon-button-color": color } : {}),
  } as CSSProperties;
  return (
    <button
      {...props}
      className={`tooltip-icon-button ${className}`.trim()}
      data-tooltip={tooltip}
      style={buttonStyle}
    >
      {icon}
    </button>
  );
}
function ServerActionIcon({
  action,
}: {
  action: "download" | "update" | "play" | "stop" | "loading";
}): JSX.Element {
  const icon =
    action === "download"
      ? faDownload
      : action === "update"
        ? faRotateRight
        : action === "play"
          ? faPlay
          : action === "stop"
            ? faStop
            : faSpinner;
  return (
    <FontAwesomeIcon
      icon={icon}
      aria-hidden="true"
      spin={action === "loading"}
    />
  );
}
function BrandLockup({ className = "" }: { className?: string }): JSX.Element {
  return (
    <div className={`brand-lockup ${className}`.trim()}>
      <img src={rendererAssetUrl("./logo.png")} alt="" />
      <div className="brand-title">
        <h1 className="lapis-wordmark">LAPIS</h1>
        <span>LAUNCHER</span>
      </div>
    </div>
  );
}
function PlayerSkinModel({
  skin,
  loading,
  onUpload,
}: {
  skin: PlayerSkin | null;
  loading: boolean;
  onUpload: () => void;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const visibleSkin = skin ?? DEFAULT_PLAYER_SKIN;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    let active = true;
    setReady(false);

    const viewer = new SkinViewer({
      canvas,
      width: Math.max(1, Math.round(container.clientWidth)),
      height: Math.max(1, Math.round(container.clientHeight)),
      model: visibleSkin.model,
      animation: new IdleAnimation(),
      enableControls: true,
      renderPaused: true,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
      zoom: 0.88,
    });
    viewer.background = null;
    viewer.renderer.setClearColor(0x000000, 0);
    viewer.autoRotate = true;
    viewer.autoRotateSpeed = 0.55;
    void viewer
      .loadSkin(visibleSkin.textureUrl, { model: visibleSkin.model })
      .then(() => {
        if (!active) return;

        // skinview3d uses a post-processing pass.  Its first canvas frame can
        // still be an uninitialised opaque buffer, so let two real animation
        // frames complete before exposing the canvas.
        viewer.renderPaused = false;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (active) setReady(true);
          });
        });
      })
      .catch(() => {
        // Keep the canvas hidden on a failed external texture request instead
        // of exposing the WebGL fallback buffer as a white rectangle.
        if (active) console.warn("Не удалось отобразить скин игрока.");
      });
    const resize = (): void => {
      viewer.setSize(
        Math.max(1, Math.round(container.clientWidth)),
        Math.max(1, Math.round(container.clientHeight)),
      );
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => {
      active = false;
      observer.disconnect();
      viewer.dispose();
    };
  }, [visibleSkin.model, visibleSkin.textureUrl]);

  return (
    <div
      className={`player-skin ${loading ? "is-loading" : ""} ${ready ? "is-ready" : ""}`}
      ref={containerRef}
      aria-label="Модель скина игрока"
    >
      <canvas
        ref={canvasRef}
        // Inline styles take effect before the renderer stylesheet is parsed.
        // This prevents a native WebGL canvas from flashing during navigation.
        style={{
          opacity: ready ? 1 : 0,
          visibility: ready ? "visible" : "hidden",
        }}
      />
      {loading && (
        <span className="player-skin-loader">
          <Spinner />
        </span>
      )}
      {!loading && (
        <IconButton
          className="skin-upload"
          type="button"
          onClick={onUpload}
          aria-label="Загрузить скин"
          tooltip="Загрузить скин"
          icon={<FontAwesomeIcon icon={faUpload} aria-hidden="true" />}
        />
      )}
    </div>
  );
}
function Modal({
  title,
  children,
  footer,
  onClose,
  className = "",
}: {
  title: string;
  children: JSX.Element;
  footer?: (close: (afterClose?: () => void) => void) => JSX.Element;
  onClose: () => void;
  className?: string;
}): JSX.Element {
  const [closing, setClosing] = useState(false);
  const close = (afterClose: () => void = onClose): void => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(afterClose, 180);
  };
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  });
  return (
    <div
      className={`modal-layer ${closing ? "is-closing" : ""}`}
      role="presentation"
      onMouseDown={() => close()}
    >
      <section
        className={`modal-card ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          <button type="button" onClick={() => close()} aria-label="Закрыть">
            ×
          </button>
        </header>
        <div className="modal-content">{children}</div>
        {footer && <footer>{footer(close)}</footer>}
      </section>
    </div>
  );
}
function ConfirmDialog({
  action,
  onConfirm,
  onClose,
}: {
  action: ConfirmAction;
  onConfirm: () => void;
  onClose: () => void;
}): JSX.Element {
  const copy =
    action.kind === "delete"
      ? {
          title: "Удалить сборку?",
          message: `Сборка «${action.server.name}» будет удалена с этого компьютера.`,
          confirm: "Удалить",
          danger: true,
        }
      : action.kind === "stop"
        ? {
            title: "Остановить Minecraft?",
            message:
              "Игра будет принудительно закрыта. Несохранённый прогресс может быть потерян.",
            confirm: "Остановить",
            danger: true,
          }
        : {
            title: "Выйти из аккаунта?",
            message: "Сохранённая сессия на этом устройстве будет завершена.",
            confirm: "Выйти",
            danger: false,
          };
  return (
    <ConfirmationDialog {...copy} onConfirm={onConfirm} onClose={onClose} />
  );
}

function ConfirmationDialog({
  title,
  message,
  confirm,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirm: string;
  danger: boolean;
  onConfirm: () => void | boolean | Promise<void | boolean>;
  onClose: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={(close) => (
        <>
          <button
            className="modal-secondary"
            type="button"
            disabled={busy}
            onClick={() => close()}
          >
            Нет
          </button>
          <button
            className={danger ? "modal-confirm danger" : "modal-confirm"}
            type="button"
            disabled={busy}
            onClick={() => {
              if (busy) return;
              setBusy(true);
              void Promise.resolve(onConfirm()).then((result) => {
                if (result === false) setBusy(false);
                else close();
              });
            }}
          >
            {busy ? <Spinner /> : `Да, ${confirm.toLowerCase()}`}
          </button>
        </>
      )}
    >
      <p>{message}</p>
    </Modal>
  );
}

function SkinHead({ skin }: { skin: PlayerSkin }): JSX.Element {
  const backgroundImage = `url("${skin.textureUrl.replace(/["\\]/g, "")}")`;
  return (
    <span className="skin-head" aria-hidden="true">
      <i className="skin-head-face" style={{ backgroundImage }} />
      <i className="skin-head-overlay" style={{ backgroundImage }} />
    </span>
  );
}

function ServerListDialog({
  kind,
  server,
  loading,
  error,
  mods,
  players,
  expectedPlayers,
  onClose,
}: {
  kind: "mods" | "players";
  server: ServerCatalogItem;
  loading: boolean;
  error: string;
  mods: ServerMod[];
  players: ServerPlayer[];
  expectedPlayers: number;
  onClose: () => void;
}): JSX.Element {
  const title =
    kind === "mods" ? `Моды — ${server.name}` : `Игроки — ${server.name}`;
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={(close) => (
        <button
          className="modal-secondary"
          type="button"
          onClick={() => close()}
        >
          Закрыть
        </button>
      )}
    >
      <div className="server-detail-dialog" aria-live="polite">
        {loading ? (
          <div className="server-detail-loading">
            <Spinner />
          </div>
        ) : error ? (
          <p className="server-detail-error">{error}</p>
        ) : kind === "mods" && mods.length ? (
          <ul className="mod-list">
            {mods.map((mod) => (
              <li key={mod.fileName}>
                <span>{mod.fileName.replace(/\.jar$/i, "")}</span>
                {mod.required && <small>обязательный</small>}
              </li>
            ))}
          </ul>
        ) : kind === "mods" ? (
          <p>В этой сборке нет модов.</p>
        ) : players.length ? (
          <ul className="player-list">
            {players.map((player) => (
              <li key={player.nickname}>
                <SkinHead skin={player.skin} />
                <span>{player.nickname}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>
            {expectedPlayers > 0
              ? "Сервер пока не передал имена игроков."
              : "Сейчас на сервере никого нет."}
          </p>
        )}
      </div>
    </Modal>
  );
}

function installProgressLabel(progress: InstallProgress): string {
  const count =
    progress.total !== undefined && progress.completed !== undefined
      ? `${progress.completed}/${progress.total}`
      : null;
  switch (progress.phase) {
    case "preparing":
      return "Подготовка сборки";
    case "java":
      return "Подготовка Java";
    case "minecraft":
      return "Файлы Minecraft";
    case "libraries":
      return `Библиотеки Minecraft${count ? ` · ${count}` : ""}`;
    case "assets":
      return `Ресурсы Minecraft${count ? ` · ${count}` : ""}`;
    case "fabric":
      return `Fabric${count ? ` · ${count}` : ""}`;
    case "mods":
      return `Моды${count ? ` · ${count}` : ""}${progress.fileName ? ` · ${progress.fileName}` : ""}`;
    case "complete":
      return "Сборка готова";
  }
}

function formatDownloadSize(bytes: number | undefined): string | null {
  if (!bytes || bytes < 1) return null;
  const megabytes = bytes / (1024 * 1024);
  return megabytes >= 100
    ? `${Math.round(megabytes)} МБ`
    : `${megabytes.toFixed(1)} МБ`;
}

function UpdateProgress({ progress }: { progress: number }): JSX.Element {
  const normalized = Math.max(0, Math.min(100, progress));
  return (
    <div
      className="launcher-update-progress"
      role="progressbar"
      aria-label="Загрузка обновления"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={normalized}
    >
      <span style={{ width: `${normalized}%` }} />
    </div>
  );
}

function UpdateDialog({
  status,
  onDownload,
  onInstall,
  onRetry,
  onClose,
}: {
  status: AppUpdateStatus;
  onDownload: () => void;
  onInstall: () => void;
  onRetry: () => void;
  onClose: () => void;
}): JSX.Element {
  const downloading = status.phase === "downloading";
  const downloaded = status.phase === "downloaded";
  const failed = status.phase === "error";
  const size = formatDownloadSize(status.downloadSize);
  return (
    <Modal
      title={downloaded ? "Обновление готово" : "Обновление Lapis Launcher"}
      onClose={onClose}
      footer={(close) => (
        <>
          <button
            className="modal-secondary"
            type="button"
            onClick={() => close()}
          >
            Позже
          </button>
          {status.phase === "available" && (
            <button
              className="modal-confirm"
              type="button"
              onClick={onDownload}
            >
              Обновить
            </button>
          )}
          {downloaded && (
            <button className="modal-confirm" type="button" onClick={onInstall}>
              Перезапустить
            </button>
          )}
          {failed && (
            <button className="modal-confirm" type="button" onClick={onRetry}>
              Повторить
            </button>
          )}
        </>
      )}
    >
      <div className="launcher-update-dialog" aria-live="polite">
        {status.version && (
          <div className="launcher-update-version">
            <span>{status.currentVersion}</span>
            <b>→</b>
            <strong>{status.version}</strong>
          </div>
        )}
        {status.phase === "available" && (
          <p>
            {status.differential
              ? "Будут загружены только изменения"
              : "Будет загружена новая версия"}
            {size ? ` · ${size}` : ""}.
          </p>
        )}
        {downloading && (
          <>
            <p>Загрузка продолжится, даже если закрыть это окно.</p>
            <UpdateProgress progress={status.progress ?? 0} />
          </>
        )}
        {downloaded && (
          <p>
            {status.error?.message ??
              "Лаунчер закроется, установит обновление и запустится снова."}
          </p>
        )}
        {failed && (
          <p>{status.error?.message ?? "Не удалось подготовить обновление."}</p>
        )}
        {status.releaseNotes && status.phase === "available" && (
          <div className="launcher-update-notes">{status.releaseNotes}</div>
        )}
      </div>
    </Modal>
  );
}

function StartupUpdateGate({
  status,
}: {
  status: AppUpdateStatus;
}): JSX.Element | null {
  const visible =
    status.startup &&
    (status.phase === "checking" ||
      status.phase === "available" ||
      status.phase === "downloading" ||
      status.phase === "downloaded" ||
      status.phase === "installing");
  if (!visible) return null;
  const title =
    status.phase === "checking"
      ? "Проверка обновлений"
      : status.phase === "installing" || status.phase === "downloaded"
        ? "Установка обновления"
        : "Обновление лаунчера";
  return (
    <div className="startup-update-gate" role="status" aria-live="polite">
      <div className="startup-update-card">
        <BrandLockup />
        <Spinner />
        <p>{title}</p>
        {(status.phase === "downloading" || status.phase === "available") && (
          <UpdateProgress progress={status.progress ?? 0} />
        )}
      </div>
    </div>
  );
}

function LaunchSettingsDialog({
  server,
  settings,
  loading,
  saving,
  onSave,
  onClose,
}: {
  server: ServerCatalogItem;
  settings: LaunchSettings | null;
  loading: boolean;
  saving: boolean;
  onSave: (settings: Pick<LaunchSettings, "memoryMb" | "fullscreen">) => void;
  onClose: () => void;
}): JSX.Element {
  const [memoryMb, setMemoryMb] = useState(settings?.memoryMb ?? 1024);
  const [fullscreen, setFullscreen] = useState(settings?.fullscreen ?? false);

  useEffect(() => {
    if (settings) {
      setMemoryMb(settings.memoryMb);
      setFullscreen(settings.fullscreen);
    }
  }, [settings]);

  const formatMemory = (value: number): string => `${value / 1024} ГБ`;
  const memoryProgress = settings
    ? ((memoryMb - 1024) / Math.max(settings.maxMemoryMb - 1024, 1)) * 100
    : 0;
  return (
    <Modal
      title={`Настройки — ${server.name}`}
      onClose={onClose}
      footer={(close) =>
        loading || !settings ? (
          <button
            className="modal-secondary"
            type="button"
            onClick={() => close()}
          >
            Закрыть
          </button>
        ) : (
          <>
            <button
              className="modal-secondary"
              type="button"
              disabled={saving}
              onClick={() => close()}
            >
              Отмена
            </button>
            <button
              className="modal-confirm"
              type="button"
              disabled={saving}
              onClick={() => close(() => onSave({ memoryMb, fullscreen }))}
            >
              {saving ? <Spinner /> : "Сохранить"}
            </button>
          </>
        )
      }
    >
      {loading || !settings ? (
        <div className="launch-settings-loading" aria-label="Загрузка настроек">
          <Spinner />
        </div>
      ) : (
        <div className="launch-settings-form">
          <label htmlFor="memory-limit">ОЗУ для Minecraft</label>
          <div className="memory-value">{formatMemory(memoryMb)}</div>
          <input
            id="memory-limit"
            type="range"
            min="1024"
            max={settings.maxMemoryMb}
            step="512"
            value={memoryMb}
            style={
              { "--memory-progress": `${memoryProgress}%` } as CSSProperties
            }
            onChange={(event) => setMemoryMb(Number(event.target.value))}
          />
          <label className="fullscreen-setting">
            <input
              type="checkbox"
              checked={fullscreen}
              onChange={(event) => setFullscreen(event.target.checked)}
            />
            <span>Полноэкранный режим</span>
          </label>
        </div>
      )}
    </Modal>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  visible,
  onToggle,
  error,
  required = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  visible: boolean;
  onToggle: () => void;
  error?: string;
  required?: boolean;
}): JSX.Element {
  const inputId =
    autoComplete === "current-password"
      ? "password"
      : autoComplete === "new-password" && label === "Пароль"
        ? "new-password"
        : "password-confirmation";
  return (
    <div className="auth-field">
      <label htmlFor={inputId}>{label}</label>
      <span className={`input-wrap password-input ${error ? "has-error" : ""}`}>
        <button
          className="password-toggle"
          type="button"
          tabIndex={-1}
          onClick={onToggle}
          aria-label={visible ? "Скрыть пароль" : "Показать пароль"}
        >
          {visible ? <EyeIcon visible /> : <PasswordIcon />}
        </button>
        <input
          id={inputId}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          required={required}
          aria-invalid={Boolean(error)}
        />
      </span>
    </div>
  );
}
function PasswordStrength({ password }: { password: string }): JSX.Element {
  const score =
    password.length < 6
      ? 0
      : Math.min(
          3,
          1 +
            Number(/[a-zA-Zа-яА-Я]/.test(password)) +
            Number(/[0-9]/.test(password)) +
            Number(/[^\w]/.test(password)),
        );
  const label =
    score === 0
      ? "Минимум 6 символов"
      : score === 1
        ? "Базовый пароль"
        : score === 2
          ? "Хороший пароль"
          : "Надёжный пароль";
  return (
    <div className={`password-strength strength-${score}`}>
      <div className="strength-bars" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <span>{label}</span>
    </div>
  );
}
function AuthScreen({
  mode,
  nickname,
  password,
  confirmation,
  busy,
  fieldErrors,
  onModeChange,
  onNicknameChange,
  onPasswordChange,
  onConfirmationChange,
  onSubmit,
}: {
  mode: Mode;
  nickname: string;
  password: string;
  confirmation: string;
  busy: boolean;
  fieldErrors: AuthFieldErrors;
  onModeChange: () => void;
  onNicknameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onConfirmationChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}): JSX.Element {
  const [passwordVisible, setPasswordVisible] = useState(false);
  const registering = mode === "register";
  return (
    <main className="shell auth-shell">
      <section
        className={`auth-card card ${registering ? "registering" : "logging-in"}`}
      >
        <header className="auth-header">
          <BrandLockup />
        </header>
        <form onSubmit={onSubmit} noValidate>
          <label className="auth-field">
            <span>Ник</span>
            <span
              className={`input-wrap ${fieldErrors.nickname ? "has-error" : ""}`}
            >
              <i>
                <UserIcon />
              </i>
              <input
                type="text"
                value={nickname}
                onChange={(event) => onNicknameChange(event.target.value)}
                autoComplete="username"
                maxLength={16}
                required
                aria-invalid={Boolean(fieldErrors.nickname)}
              />
            </span>
          </label>
          <PasswordField
            label="Пароль"
            value={password}
            onChange={onPasswordChange}
            autoComplete={registering ? "new-password" : "current-password"}
            visible={passwordVisible}
            onToggle={() => setPasswordVisible((visible) => !visible)}
            error={fieldErrors.password}
          />
          {registering && (
            <>
              <PasswordField
                label="Повторите пароль"
                value={confirmation}
                onChange={onConfirmationChange}
                autoComplete="new-password"
                visible={passwordVisible}
                onToggle={() => setPasswordVisible((visible) => !visible)}
                error={fieldErrors.confirmation}
              />
              <PasswordStrength password={password} />
            </>
          )}
          <button
            className="primary-action"
            disabled={busy}
            aria-label={busy ? "Выполняется запрос" : undefined}
          >
            {busy ? <Spinner /> : registering ? "Зарегистрироваться" : "Войти"}
          </button>
        </form>
        <div className="auth-mode-switch">
          <span>{registering ? "Уже есть аккаунт?" : "Впервые в Lapis?"}</span>
          <button
            className="switch-mode"
            type="button"
            disabled={busy}
            onClick={onModeChange}
          >
            {registering ? "Войти" : "Создать аккаунт"}
          </button>
        </div>
      </section>
    </main>
  );
}

function Dashboard({
  session,
  servers,
  catalogError,
  buildStatuses,
  installProgress,
  launching,
  runningGame,
  loggingOut,
  playerSkin,
  skinUploading,
  onLogout,
  onUploadSkin,
  onPrepare,
  onLaunch,
  onStop,
  onDelete,
  onSettings,
  onMods,
  onPlayers,
  updateStatus,
  onOpenUpdate,
  canAdmin,
  adminLoading,
  onAdmin,
}: {
  session: Session;
  servers: ServerCatalogItem[];
  catalogError: string;
  buildStatuses: Record<string, BuildStatus>;
  installProgress: InstallProgress | null;
  launching: boolean;
  runningGame: RunningGame;
  loggingOut: boolean;
  playerSkin: PlayerSkin | null;
  skinUploading: boolean;
  onLogout: () => void;
  onUploadSkin: () => void;
  onPrepare: (server: ServerCatalogItem) => void;
  onLaunch: (server: ServerCatalogItem) => void;
  onStop: () => void;
  onDelete: (server: ServerCatalogItem) => void;
  onSettings: (server: ServerCatalogItem) => void;
  onMods: (server: ServerCatalogItem) => void;
  onPlayers: (server: ServerCatalogItem) => void;
  updateStatus: AppUpdateStatus;
  onOpenUpdate: () => void;
  canAdmin: boolean;
  adminLoading: boolean;
  onAdmin: () => void;
}): JSX.Element {
  const [menuServerId, setMenuServerId] = useState<string | null>(null);
  const menuAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuServerId) return;
    const closeRadius = 48;
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (!menuAreaRef.current?.contains(event.target as Node))
        setMenuServerId(null);
    };
    const closeWhenCursorIsFar = (event: PointerEvent): void => {
      const area = menuAreaRef.current;
      if (!area) return;
      const triggerRect = area.getBoundingClientRect();
      const menuRect = area
        .querySelector<HTMLElement>(".server-menu")
        ?.getBoundingClientRect();
      const left =
        Math.min(triggerRect.left, menuRect?.left ?? triggerRect.left) -
        closeRadius;
      const right =
        Math.max(triggerRect.right, menuRect?.right ?? triggerRect.right) +
        closeRadius;
      const top =
        Math.min(triggerRect.top, menuRect?.top ?? triggerRect.top) -
        closeRadius;
      const bottom =
        Math.max(triggerRect.bottom, menuRect?.bottom ?? triggerRect.bottom) +
        closeRadius;
      if (
        event.clientX < left ||
        event.clientX > right ||
        event.clientY < top ||
        event.clientY > bottom
      )
        setMenuServerId(null);
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("pointermove", closeWhenCursorIsFar);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("pointermove", closeWhenCursorIsFar);
    };
  }, [menuServerId]);
  const runMenuAction = (
    action: (server: ServerCatalogItem) => void,
    server: ServerCatalogItem,
  ): void => {
    setMenuServerId(null);
    action(server);
  };
  const updateLabel =
    updateStatus.phase === "available"
      ? "Доступно обновление"
      : updateStatus.phase === "downloading"
        ? `Скачивание ${updateStatus.progress ?? 0}%`
        : updateStatus.phase === "error"
          ? "Повторить обновление"
          : "Обновление готово";
  const updateActionVisible =
    updateStatus.phase === "available" ||
    updateStatus.phase === "downloading" ||
    updateStatus.phase === "downloaded" ||
    (updateStatus.phase === "error" && Boolean(updateStatus.version));
  return (
    <main className={`shell dashboard ${loggingOut ? "is-leaving" : ""}`}>
      <aside className="profile">
        <BrandLockup className="dashboard-brand" />
        <p className="profile-name">{session.user.nickname}</p>
        <PlayerSkinModel
          skin={playerSkin}
          loading={skinUploading}
          onUpload={onUploadSkin}
        />
        {canAdmin && (
          <button
            className="admin-entry"
            type="button"
            disabled={adminLoading}
            aria-busy={adminLoading}
            onClick={onAdmin}
          >
            {adminLoading ? (
              <Spinner />
            ) : (
              <FontAwesomeIcon icon={faShieldHalved} />
            )}
            Управление
          </button>
        )}
        <button className="link logout" onClick={onLogout}>
          Выйти
        </button>
      </aside>
      <section className="servers">
        <header>
          <h2>Серверы</h2>
          {updateActionVisible && (
            <button
              className={`update-action ${updateStatus.phase}`}
              type="button"
              onClick={onOpenUpdate}
            >
              {updateLabel}
            </button>
          )}
        </header>
        {catalogError && <p className="error">{catalogError}</p>}
        <div className="server-list">
          {servers.map((server) => {
            const activeProgress =
              installProgress?.serverId === server.id
                ? installProgress.progress
                : null;
            const running = runningGame?.serverId === server.id;
            const status = buildStatuses[server.id] ?? "missing";
            const action = running
              ? "stop"
              : activeProgress !== null
                ? "loading"
                : status === "ready"
                  ? "play"
                  : status === "update"
                    ? "update"
                    : "download";
            const label =
              action === "stop"
                ? "Остановить Minecraft"
                : action === "play"
                  ? "Играть"
                  : action === "update"
                    ? "Обновить сборку"
                    : action === "download"
                      ? "Скачать сборку"
                      : "Подготовка сборки";
            const disabled = server.maintenance || (launching && !running);
            const onClick =
              action === "stop"
                ? onStop
                : action === "play"
                  ? () => onLaunch(server)
                  : () => onPrepare(server);
            const menuOpen = menuServerId === server.id;
            return (
              <article
                className={`server-card ${activeProgress !== null ? "installing" : ""}`}
                key={server.id}
              >
                <div
                  className="server-menu-area"
                  ref={menuOpen ? menuAreaRef : undefined}
                >
                  <button
                    className="server-menu-trigger"
                    type="button"
                    aria-label="Меню сборки"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuServerId(menuOpen ? null : server.id)}
                  >
                    <FontAwesomeIcon
                      icon={faEllipsisVertical}
                      aria-hidden="true"
                    />
                  </button>
                  {menuOpen && (
                    <div className="server-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => runMenuAction(onSettings, server)}
                      >
                        <FontAwesomeIcon icon={faGear} aria-hidden="true" />
                        Настройки
                      </button>
                      {status !== "missing" && (
                        <button
                          className="danger"
                          type="button"
                          role="menuitem"
                          disabled={disabled || running}
                          onClick={() => runMenuAction(onDelete, server)}
                        >
                          <FontAwesomeIcon icon={faTrash} aria-hidden="true" />
                          Удалить
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="server-mark">
                  <img src={server.iconUrl} alt="" />
                </div>
                <div className="server-info">
                  <h3>{server.name}</h3>
                  <p>
                    Версия: Fabric {server.build.minecraftVersion} ·{" "}
                    <button
                      className="server-inline-action"
                      type="button"
                      onClick={() => onMods(server)}
                    >
                      моды {server.build.modCount}
                    </button>
                  </p>
                  {activeProgress !== null && installProgress && (
                    <span className="install-progress-label" role="status">
                      {installProgressLabel(installProgress)}
                    </span>
                  )}
                </div>
                {server.status === "online" && !server.maintenance ? (
                  <button
                    className="server-status online interactive"
                    type="button"
                    onClick={() => onPlayers(server)}
                  >
                    {server.onlinePlayers ?? 0}/{server.maxPlayers ?? "?"}{" "}
                    онлайн
                  </button>
                ) : (
                  <div
                    className={
                      server.maintenance
                        ? "server-status maintenance"
                        : `server-status ${server.status}`
                    }
                  >
                    {server.maintenance
                      ? "Техработы"
                      : server.status === "offline"
                        ? "Офлайн"
                        : "Статус уточняется"}
                  </div>
                )}
                <IconButton
                  className="server-action"
                  type="button"
                  disabled={disabled || action === "loading"}
                  onClick={onClick}
                  aria-label={label}
                  tooltip={action === "play" ? "Запуск" : label}
                  size={64}
                  color="#9ed0ff"
                  icon={<ServerActionIcon action={action} />}
                />
                {activeProgress !== null && (
                  <span className="install-progress" aria-hidden="true">
                    <span style={{ width: `${activeProgress}%` }} />
                  </span>
                )}
              </article>
            );
          })}
        </div>
      </section>
      {loggingOut && (
        <div className="screen-loader" aria-label="Выход из аккаунта">
          <Spinner />
        </div>
      )}
    </main>
  );
}

function formatAdminModSize(bytes: number): string {
  if (bytes <= 0) return "Файл недоступен";
  const mib = bytes / (1024 * 1024);
  return mib >= 1 ? `${mib.toFixed(1)} МБ` : `${Math.ceil(bytes / 1024)} КБ`;
}

function AdminServerInfoDialog({
  server,
  onClose,
  onSaved,
}: {
  server: AdminServer | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}): JSX.Element {
  const creating = server === null;
  const [id, setId] = useState(server?.id ?? "");
  const [name, setName] = useState(server?.name ?? "");
  const [host, setHost] = useState(server?.host ?? "");
  const [port, setPort] = useState(String(server?.port ?? 25565));
  const [visible, setVisible] = useState(server?.visible ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(close: (afterClose?: () => void) => void): Promise<void> {
    if (saving) return;
    setSaving(true);
    setError("");
    const portNumber = Number(port);
    const result = creating
      ? await window.lapis.admin.createServer({
          id: id.trim(),
          name: name.trim(),
          host: host.trim(),
          port: portNumber,
          visible,
        } satisfies AdminServerCreateInput)
      : await window.lapis.admin.updateServer(server.id, {
          name: name.trim(),
          host: host.trim(),
          port: portNumber,
          visible,
        } satisfies AdminServerUpdateInput);
    if (!result.ok) {
      setError(result.error.message);
      setSaving(false);
      return;
    }
    await onSaved();
    setSaving(false);
    close();
  }

  return (
    <Modal
      title={creating ? "Добавить сервер" : server.name}
      className="admin-server-dialog"
      onClose={onClose}
      footer={(close) => (
        <>
          <button
            className="modal-secondary"
            type="button"
            onClick={() => close()}
          >
            Отмена
          </button>
          <button
            className="modal-confirm"
            type="button"
            disabled={saving}
            onClick={() => void save(close)}
          >
            {saving ? <Spinner /> : creating ? "Добавить" : "Сохранить"}
          </button>
        </>
      )}
    >
      <div className="admin-server-form">
        {error && (
          <p className="admin-form-error" role="alert">
            {error}
          </p>
        )}
        <div className="admin-server-fields">
          {creating && (
            <label>
              <span>ID сервера</span>
              <input
                value={id}
                maxLength={32}
                placeholder="example"
                onChange={(event) => setId(event.target.value)}
              />
            </label>
          )}
          <label>
            <span>Название</span>
            <input
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="admin-server-endpoint">
            <label>
              <span>Адрес</span>
              <input
                value={host}
                maxLength={255}
                onChange={(event) => setHost(event.target.value)}
              />
            </label>
            <label>
              <span>Порт</span>
              <input
                value={port}
                inputMode="numeric"
                onChange={(event) =>
                  setPort(event.target.value.replace(/\D/g, ""))
                }
              />
            </label>
          </div>
          <label className="admin-visible-setting">
            <input
              type="checkbox"
              checked={visible}
              onChange={(event) => setVisible(event.target.checked)}
            />
            <span>Показывать сервер в лаунчере</span>
          </label>
        </div>
      </div>
    </Modal>
  );
}

function compatibilityLabel(mod: AdminClientMod): string {
  return mod.compatibility.status === "compatible"
    ? "Совместим"
    : mod.compatibility.status === "incompatible"
      ? "Не совместим"
      : "Не определено";
}

function AdminModsDialog({
  server,
  onClose,
  onSaved,
}: {
  server: AdminServer;
  onClose: () => void;
  onSaved: () => Promise<void>;
}): JSX.Element {
  const [mods, setMods] = useState<AdminClientMod[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void window.lapis.admin.clientMods(server.id).then((result) => {
      if (!active) return;
      if (result.ok) setMods(result.data);
      else setError(result.error.message);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [server.id]);

  function toggleSelected(modId: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(modId)) next.delete(modId);
      else next.add(modId);
      return next;
    });
  }

  async function uploadClientMod(): Promise<void> {
    if (uploading) return;
    setUploading(true);
    setError("");
    const result = await window.lapis.admin.uploadClientMod(server.id);
    if (!result.ok) setError(result.error.message);
    else if (result.data) {
      setMods((current) => {
        const existing = current.some((mod) => mod.id === result.data!.id);
        return existing
          ? current.map((mod) =>
              mod.id === result.data!.id ? result.data! : mod,
            )
          : [result.data!, ...current];
      });
      await onSaved();
    }
    setUploading(false);
  }

  async function toggleClientMod(mod: AdminClientMod): Promise<void> {
    if (togglingId) return;
    setTogglingId(mod.id);
    setError("");
    const result = await window.lapis.admin.toggleClientMod(
      server.id,
      mod.id,
      !mod.enabled,
    );
    if (!result.ok) setError(result.error.message);
    else {
      setMods((current) =>
        current.map((item) =>
          item.id === result.data.id ? result.data : item,
        ),
      );
      await onSaved();
    }
    setTogglingId(null);
  }

  async function deleteSelected(): Promise<boolean> {
    const ids = [...selected];
    const result = await window.lapis.admin.deleteClientMods(server.id, {
      ids,
    });
    if (!result.ok) {
      setError(result.error.message);
      return false;
    }
    const removed = new Set(result.data.deletedIds);
    setMods((current) => current.filter((mod) => !removed.has(mod.id)));
    setSelected(new Set());
    setConfirmingDelete(false);
    await onSaved();
    return true;
  }

  const allSelected = mods.length > 0 && selected.size === mods.length;
  return (
    <>
      <Modal
        title={`Моды — ${server.name}`}
        className="admin-server-dialog admin-mods-dialog"
        onClose={onClose}
      >
        <section className="admin-client-mods">
          <div className="admin-mods-toolbar">
            <label className="admin-mods-select-all">
              <input
                type="checkbox"
                checked={allSelected}
                disabled={mods.length === 0}
                onChange={() =>
                  setSelected(
                    allSelected
                      ? new Set()
                      : new Set(mods.map((mod) => mod.id)),
                  )
                }
              />
              <span>
                {selected.size > 0
                  ? `Выбрано: ${selected.size}`
                  : "Выбрать все"}
              </span>
            </label>
            <div className="admin-mods-commands">
              <button
                className="admin-mod-command danger"
                type="button"
                disabled={selected.size === 0}
                onClick={() => setConfirmingDelete(true)}
              >
                <FontAwesomeIcon icon={faTrash} aria-hidden="true" />
                Удалить
              </button>
              <button
                className="admin-mod-command"
                type="button"
                disabled={uploading}
                onClick={() => void uploadClientMod()}
              >
                {uploading ? (
                  <Spinner />
                ) : (
                  <FontAwesomeIcon icon={faUpload} aria-hidden="true" />
                )}
                Добавить мод
              </button>
            </div>
          </div>
          {error && (
            <p className="admin-form-error" role="alert">
              {error}
            </p>
          )}
          <div className="admin-mods-summary">
            {mods.filter((mod) => mod.enabled).length} включено · {mods.length}{" "}
            всего
          </div>
          {loading ? (
            <div className="admin-mods-loading">
              <Spinner />
            </div>
          ) : mods.length === 0 ? (
            <p className="admin-mods-empty">
              Клиентские моды ещё не добавлены.
            </p>
          ) : (
            <ul>
              {mods.map((mod) => (
                <li
                  key={mod.id}
                  className={`${mod.enabled ? "enabled" : "disabled"} ${selected.has(mod.id) ? "selected" : ""}`}
                >
                  <input
                    className="admin-mod-select"
                    type="checkbox"
                    checked={selected.has(mod.id)}
                    aria-label={`Выбрать ${mod.fileName}`}
                    onChange={() => toggleSelected(mod.id)}
                  />
                  <div className="admin-mod-details">
                    <strong title={mod.fileName}>{mod.fileName}</strong>
                    <span>
                      {formatAdminModSize(mod.size)}
                      {mod.compatibility.modVersion
                        ? ` · версия ${mod.compatibility.modVersion}`
                        : ""}
                    </span>
                    <small>{mod.compatibility.reason}</small>
                  </div>
                  <span
                    className={`admin-mod-compatibility ${mod.compatibility.status}`}
                    title={`${mod.compatibility.reason}${
                      mod.compatibility.minecraftRequirement
                        ? ` Minecraft: ${mod.compatibility.minecraftRequirement}.`
                        : ""
                    }${
                      mod.compatibility.loaderRequirement
                        ? ` Fabric Loader: ${mod.compatibility.loaderRequirement}.`
                        : ""
                    }`}
                  >
                    {compatibilityLabel(mod)}
                  </span>
                  <button
                    className={`admin-mod-toggle ${mod.enabled ? "is-on" : ""}`}
                    type="button"
                    role="switch"
                    aria-checked={mod.enabled}
                    aria-label={`${mod.enabled ? "Выключить" : "Включить"} ${mod.fileName}`}
                    disabled={togglingId !== null}
                    onClick={() => void toggleClientMod(mod)}
                  >
                    {togglingId === mod.id ? <Spinner /> : <span />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Modal>
      {confirmingDelete && (
        <ConfirmationDialog
          title="Удалить выбранные моды?"
          message={`${selected.size} ${selected.size === 1 ? "мод будет удалён" : "модов будут удалены"} из клиентской сборки «${server.name}». У пользователей они исчезнут при следующей синхронизации.`}
          confirm="Удалить"
          danger
          onClose={() => setConfirmingDelete(false)}
          onConfirm={deleteSelected}
        />
      )}
    </>
  );
}

function AdminScreen({
  servers,
  onBack,
  onReload,
}: {
  servers: AdminServer[];
  onBack: () => void;
  onReload: () => Promise<void>;
}): JSX.Element {
  const [editingServer, setEditingServer] = useState<
    AdminServer | null | undefined
  >(undefined);
  const [modsServer, setModsServer] = useState<AdminServer | null>(null);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (editingServer === undefined && modsServer === null) onBack();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingServer, modsServer, onBack]);

  return (
    <main className="shell dashboard admin-dashboard">
      <section className="servers admin-panel">
        <header>
          <IconButton
            className="admin-back"
            type="button"
            onClick={onBack}
            aria-label="Назад к серверам"
            tooltip="Назад"
            icon={<FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />}
            size={40}
          />
          <h2>Управление серверами</h2>
          <button
            className="admin-add-server"
            type="button"
            onClick={() => setEditingServer(null)}
          >
            <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
            Добавить сервер
          </button>
        </header>
        <div className="server-list admin-server-list">
          {servers.map((server) => (
            <article className="admin-server-card" key={server.id}>
              <button
                className="admin-server-overview"
                type="button"
                onClick={() => setEditingServer(server)}
                aria-label={`Информация о сервере ${server.name}`}
              >
                <span className="server-mark">
                  <img src={server.iconUrl} alt="" />
                </span>
                <span className="server-info">
                  <span className="admin-server-title-row">
                    <strong>{server.name}</strong>
                    <span
                      className={`admin-visibility ${server.visible ? "visible" : "hidden"}`}
                    >
                      {server.visible ? "Показывается" : "Скрыт"}
                    </span>
                  </span>
                  <span>
                    Fabric {server.activeBuild.minecraftVersion} · {server.host}
                    :{server.port}
                  </span>
                </span>
                <span className="admin-server-info-hint">
                  <FontAwesomeIcon icon={faCircleInfo} aria-hidden="true" />
                  Информация
                </span>
              </button>
              <button
                className="admin-server-mods-button"
                type="button"
                onClick={() => setModsServer(server)}
                aria-label={`Управление модами сервера ${server.name}`}
              >
                <FontAwesomeIcon icon={faPuzzlePiece} aria-hidden="true" />
                <span>
                  <strong>Моды</strong>
                  <small>{server.activeBuild.modCount} включено</small>
                </span>
              </button>
              <span
                className={`server-status admin-server-runtime ${server.maintenance ? "maintenance" : server.status}`}
              >
                {server.maintenance
                  ? "Техработы"
                  : server.status === "online"
                    ? `${server.onlinePlayers ?? 0}/${server.maxPlayers ?? "?"} онлайн`
                    : server.status === "offline"
                      ? "Офлайн"
                      : "Статус уточняется"}
              </span>
            </article>
          ))}
        </div>
      </section>
      {editingServer !== undefined && (
        <AdminServerInfoDialog
          key={editingServer?.id ?? "new"}
          server={editingServer}
          onClose={() => setEditingServer(undefined)}
          onSaved={onReload}
        />
      )}
      {modsServer && (
        <AdminModsDialog
          key={modsServer.id}
          server={modsServer}
          onClose={() => setModsServer(null)}
          onSaved={onReload}
        />
      )}
    </main>
  );
}

export function App(): JSX.Element {
  const [mode, setMode] = useState<Mode>("login");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [page, setPage] = useState<AppPage>("servers");
  const [restoring, setRestoring] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [servers, setServers] = useState<ServerCatalogItem[]>([]);
  const [buildStatuses, setBuildStatuses] = useState<
    Record<string, BuildStatus>
  >({});
  const [installProgress, setInstallProgress] =
    useState<InstallProgress | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [launching, setLaunching] = useState(false);
  const [runningGame, setRunningGame] = useState<RunningGame>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [playerSkin, setPlayerSkin] = useState<PlayerSkin | null>(null);
  const [skinUploading, setSkinUploading] = useState(false);
  const [confirmationRequest, setConfirmationRequest] =
    useState<ConfirmAction | null>(null);
  const [settingsServer, setSettingsServer] =
    useState<ServerCatalogItem | null>(null);
  const [launchSettings, setLaunchSettings] = useState<LaunchSettings | null>(
    null,
  );
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [serverListDialog, setServerListDialog] =
    useState<ServerListState | null>(null);
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus>({
    currentVersion: "",
    phase: "checking",
    startup: true,
  });
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [adminServers, setAdminServers] = useState<AdminServer[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const showNotice = (message: string): void =>
    setNotice({ id: Date.now(), message });
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const unsubscribe = window.lapis.updates.onStatus(setUpdateStatus);
    void window.lapis.updates.status().then((result) => {
      if (result.ok) setUpdateStatus(result.data);
    });
    return unsubscribe;
  }, []);
  useEffect(() => {
    void window.lapis.auth
      .restore()
      .then((result) => {
        if (result.ok) setSession(result.data);
        else showNotice(result.error.message);
      })
      .finally(() => setRestoring(false));
  }, []);
  useEffect(() => {
    if (!session) return;
    void window.lapis.catalog.list().then(async (result) => {
      if (!result.ok) {
        setCatalogError(result.error.message);
        return;
      }
      setServers(result.data);
      const statuses = await Promise.all(
        result.data.map(async (server) => ({
          id: server.id,
          result: await window.lapis.runtime.buildStatus(server.id),
        })),
      );
      setBuildStatuses(
        Object.fromEntries(
          statuses.map(({ id, result }) => [
            id,
            result.ok ? result.data : "missing",
          ]),
        ),
      );
    });
  }, [session?.user.id]);
  useEffect(() => {
    if (!session) {
      setPlayerSkin(null);
      return;
    }
    let active = true;
    void window.lapis.profile.skin().then((result) => {
      if (active && result.ok) setPlayerSkin(result.data);
    });
    return () => {
      active = false;
    };
  }, [session?.user.id]);
  useEffect(() => {
    if (!session) return;
    let disposed = false;
    void window.lapis.runtime.gameStatus().then((result) => {
      if (!disposed && result.ok) setRunningGame(result.data);
    });
    const unsubscribe = window.lapis.runtime.onGameExit(() =>
      setRunningGame(null),
    );
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [session]);
  useEffect(
    () =>
      window.lapis.runtime.onInstallProgress((progress) =>
        setInstallProgress(progress),
      ),
    [],
  );
  const clearFieldError = (field: AuthField): void =>
    setFieldErrors((current) => {
      const { [field]: _removed, ...rest } = current;
      return rest;
    });
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmedNickname = nickname.trim();
    const validationErrors: AuthFieldErrors = {};
    if (!trimmedNickname) validationErrors.nickname = "Введите ник.";
    else if (!/^[A-Za-z0-9_]{3,16}$/.test(trimmedNickname))
      validationErrors.nickname = "Ник: 3–16 символов (латиница, цифры, _).";
    if (!password) validationErrors.password = "Введите пароль.";
    else if (mode === "register" && password.length < 6)
      validationErrors.password = "Пароль должен содержать минимум 6 символов.";
    if (mode === "register" && password && confirmation !== password)
      validationErrors.confirmation = "Пароли не совпадают.";
    if (Object.keys(validationErrors).length) {
      setFieldErrors(validationErrors);
      showNotice(Object.values(validationErrors)[0] ?? "Проверьте данные.");
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      const result =
        mode === "login"
          ? await window.lapis.auth.login({
              nickname: trimmedNickname,
              password,
            })
          : await window.lapis.auth.register({
              nickname: trimmedNickname,
              password,
            });
      if (!result.ok) {
        const failedFields: AuthFieldErrors = {};
        if (result.error.fields?.nickname)
          failedFields.nickname = "Ник: 3–16 символов (латиница, цифры, _).";
        if (result.error.fields?.password)
          failedFields.password =
            mode === "register"
              ? "Пароль должен содержать минимум 6 символов."
              : "Введите пароль.";
        if (Object.keys(failedFields).length) {
          setFieldErrors(failedFields);
          showNotice(Object.values(failedFields)[0] ?? "Проверьте данные.");
        } else showNotice(result.error.message);
        return;
      }
      setSession(result.data);
      setPassword("");
      setConfirmation("");
    } catch {
      showNotice("Не удалось выполнить запрос. Повторите попытку.");
    } finally {
      setBusy(false);
    }
  }
  async function prepareBuild(server: ServerCatalogItem): Promise<void> {
    setLaunching(true);
    setInstallProgress({
      serverId: server.id,
      progress: 0,
      phase: "preparing",
    });
    try {
      const result = await window.lapis.runtime.ensureGame(server.id);
      if (!result.ok) showNotice(result.error.message);
      const status = await window.lapis.runtime.buildStatus(server.id);
      setBuildStatuses((current) => ({
        ...current,
        [server.id]: status.ok ? status.data : result.ok ? "ready" : "update",
      }));
    } finally {
      setInstallProgress(null);
      setLaunching(false);
    }
  }
  async function launchGame(server: ServerCatalogItem): Promise<void> {
    if (!session) return;
    setLaunching(true);
    setInstallProgress({
      serverId: server.id,
      progress: 0,
      phase: "preparing",
    });
    const result = await window.lapis.runtime.launchGame(server.id);
    if (result.ok) {
      setRunningGame(result.data);
      setBuildStatuses((current) => ({ ...current, [server.id]: "ready" }));
    } else showNotice(result.error.message);
    setInstallProgress(null);
    setLaunching(false);
  }

  async function openServerList(
    kind: "mods" | "players",
    server: ServerCatalogItem,
  ): Promise<void> {
    if (!session) return;
    setServerListDialog({
      kind,
      server,
      loading: true,
      error: "",
      mods: [],
      players: [],
    });
    const result =
      kind === "mods"
        ? await window.lapis.catalog.mods(server.id)
        : await window.lapis.catalog.players(server.id);
    setServerListDialog((current) => {
      if (!current || current.kind !== kind || current.server.id !== server.id)
        return current;
      if (!result.ok)
        return { ...current, loading: false, error: result.error.message };
      return {
        ...current,
        loading: false,
        mods: kind === "mods" ? (result.data as ServerMod[]) : [],
        players: kind === "players" ? (result.data as ServerPlayer[]) : [],
      };
    });
  }
  async function stopGame(): Promise<void> {
    const result = await window.lapis.runtime.stopGame();
    if (result.ok) setRunningGame(null);
    else showNotice(result.error.message);
  }
  async function deleteBuild(server: ServerCatalogItem): Promise<void> {
    setLaunching(true);
    const result = await window.lapis.runtime.removeGame(server.id);
    if (result.ok)
      setBuildStatuses((current) => ({ ...current, [server.id]: "missing" }));
    else showNotice(result.error.message);
    setLaunching(false);
  }
  async function openBuildSettings(server: ServerCatalogItem): Promise<void> {
    setSettingsServer(server);
    setLaunchSettings(null);
    setSettingsLoading(true);
    const result = await window.lapis.runtime.launchSettings(server.id);
    if (result.ok) setLaunchSettings(result.data);
    else {
      setSettingsServer(null);
      showNotice(result.error.message);
    }
    setSettingsLoading(false);
  }
  async function saveBuildSettings(
    settings: Pick<LaunchSettings, "memoryMb" | "fullscreen">,
  ): Promise<void> {
    if (!settingsServer) return;
    setSettingsSaving(true);
    const result = await window.lapis.runtime.saveLaunchSettings(
      settingsServer.id,
      settings,
    );
    if (!result.ok) showNotice(result.error.message);
    else setLaunchSettings(result.data);
    setSettingsSaving(false);
    setSettingsServer(null);
  }
  async function downloadLauncherUpdate(): Promise<void> {
    const result = await window.lapis.updates.download();
    if (result.ok) setUpdateStatus(result.data);
    else showNotice(result.error.message);
  }
  async function installLauncherUpdate(): Promise<void> {
    const result = await window.lapis.updates.install();
    if (!result.ok) showNotice(result.error.message);
  }
  async function retryLauncherUpdate(): Promise<void> {
    const result = updateStatus.version
      ? await window.lapis.updates.download()
      : await window.lapis.updates.check();
    if (result.ok) setUpdateStatus(result.data);
    else showNotice(result.error.message);
  }
  async function uploadSkin(): Promise<void> {
    if (!session || skinUploading) return;
    setSkinUploading(true);
    try {
      const result = await window.lapis.profile.uploadSkin();
      if (result.ok && result.data) {
        setPlayerSkin(result.data);
      } else if (!result.ok) showNotice(result.error.message);
    } finally {
      setSkinUploading(false);
    }
  }
  async function confirmAction(): Promise<void> {
    const request = confirmationRequest;
    setConfirmationRequest(null);
    if (!request) return;
    if (request.kind === "delete") await deleteBuild(request.server);
    else if (request.kind === "stop") await stopGame();
    else await logout();
  }
  async function logout(): Promise<void> {
    setLoggingOut(true);
    try {
      await window.lapis.auth.logout();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 220));
      setSession(null);
      setPage("servers");
    } finally {
      setLoggingOut(false);
    }
  }
  async function reloadAdminServers(): Promise<void> {
    const [adminResult, catalogResult] = await Promise.all([
      window.lapis.admin.servers(),
      window.lapis.catalog.list(),
    ]);
    if (!adminResult.ok) {
      showNotice(adminResult.error.message);
      return;
    }
    setAdminServers(adminResult.data);
    if (!catalogResult.ok) return;
    setServers(catalogResult.data);
    const statuses = await Promise.all(
      catalogResult.data.map(async (server) => ({
        id: server.id,
        result: await window.lapis.runtime.buildStatus(server.id),
      })),
    );
    setBuildStatuses(
      Object.fromEntries(
        statuses.map(({ id, result }) => [
          id,
          result.ok ? result.data : "missing",
        ]),
      ),
    );
  }
  async function openAdmin(): Promise<void> {
    if (!session || adminLoading) return;
    setAdminLoading(true);
    try {
      const current = await window.lapis.auth.me();
      if (!current.ok) {
        showNotice(current.error.message);
        return;
      }
      setSession(current.data);
      const authorized =
        current.data.authorization.isSuperAdmin ||
        (current.data.authorization.globalPermissions.includes(
          "admin.access",
        ) &&
          current.data.authorization.globalPermissions.includes(
            "servers.read",
          ));
      if (!authorized) {
        showNotice("Недостаточно прав для административного раздела.");
        return;
      }
      const result = await window.lapis.admin.servers();
      if (!result.ok) {
        showNotice(result.error.message);
        return;
      }
      setAdminServers(result.data);
      setPage("admin");
    } finally {
      setAdminLoading(false);
    }
  }
  const changeMode = (): void => {
    setMode((current) => (current === "login" ? "register" : "login"));
    setPassword("");
    setConfirmation("");
    setFieldErrors({});
    setNotice(null);
  };
  const screen =
    restoring && !session ? (
      <main className="shell auth-shell">
        <section className="auth-card card">
          <BrandLockup />
        </section>
      </main>
    ) : session && page === "admin" ? (
      <AdminScreen
        servers={adminServers}
        onBack={() => setPage("servers")}
        onReload={reloadAdminServers}
      />
    ) : session ? (
      <Dashboard
        session={session}
        servers={servers}
        catalogError={catalogError}
        buildStatuses={buildStatuses}
        installProgress={installProgress}
        launching={launching}
        runningGame={runningGame}
        loggingOut={loggingOut}
        playerSkin={playerSkin}
        skinUploading={skinUploading}
        onLogout={() => setConfirmationRequest({ kind: "logout" })}
        onUploadSkin={() => void uploadSkin()}
        onPrepare={(server) => void prepareBuild(server)}
        onLaunch={(server) => void launchGame(server)}
        onStop={() => setConfirmationRequest({ kind: "stop" })}
        onDelete={(server) =>
          setConfirmationRequest({ kind: "delete", server })
        }
        onSettings={(server) => void openBuildSettings(server)}
        onMods={(server) => void openServerList("mods", server)}
        onPlayers={(server) => void openServerList("players", server)}
        updateStatus={updateStatus}
        onOpenUpdate={() => setUpdateDialogOpen(true)}
        canAdmin={
          session.authorization.isSuperAdmin ||
          (session.authorization.globalPermissions.includes("admin.access") &&
            session.authorization.globalPermissions.includes("servers.read"))
        }
        adminLoading={adminLoading}
        onAdmin={() => void openAdmin()}
      />
    ) : (
      <AuthScreen
        mode={mode}
        nickname={nickname}
        password={password}
        confirmation={confirmation}
        busy={busy}
        fieldErrors={fieldErrors}
        onModeChange={changeMode}
        onNicknameChange={(value) => {
          setNickname(value);
          clearFieldError("nickname");
        }}
        onPasswordChange={(value) => {
          setPassword(value);
          clearFieldError("password");
        }}
        onConfirmationChange={(value) => {
          setConfirmation(value);
          clearFieldError("confirmation");
        }}
        onSubmit={(event) => void submit(event)}
      />
    );
  return (
    <div className="app-root">
      <VideoBackdrop />
      {screen}
      {settingsServer && (
        <LaunchSettingsDialog
          key={settingsServer.id}
          server={settingsServer}
          settings={launchSettings}
          loading={settingsLoading}
          saving={settingsSaving}
          onSave={(settings) => void saveBuildSettings(settings)}
          onClose={() => setSettingsServer(null)}
        />
      )}
      {serverListDialog && (
        <ServerListDialog
          kind={serverListDialog.kind}
          server={serverListDialog.server}
          loading={serverListDialog.loading}
          error={serverListDialog.error}
          mods={serverListDialog.mods}
          players={serverListDialog.players}
          expectedPlayers={serverListDialog.server.onlinePlayers ?? 0}
          onClose={() => setServerListDialog(null)}
        />
      )}
      {notice && (
        <div className="auth-toast" role="alert">
          <span>{notice.message}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Закрыть уведомление"
          >
            ×
          </button>
        </div>
      )}
      {confirmationRequest && (
        <ConfirmDialog
          action={confirmationRequest}
          onClose={() => setConfirmationRequest(null)}
          onConfirm={() => void confirmAction()}
        />
      )}
      {updateDialogOpen && !updateStatus.startup && (
        <UpdateDialog
          status={updateStatus}
          onClose={() => setUpdateDialogOpen(false)}
          onDownload={() => void downloadLauncherUpdate()}
          onInstall={() => void installLauncherUpdate()}
          onRetry={() => void retryLauncherUpdate()}
        />
      )}
      <StartupUpdateGate status={updateStatus} />
    </div>
  );
}
