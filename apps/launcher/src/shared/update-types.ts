export type UpdatePhase =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "not-available"
  | "installing"
  | "error";

export type UpdateTrigger = "startup" | "scheduled" | "manual";

export type AppUpdateStatus = {
  currentVersion: string;
  phase: UpdatePhase;
  trigger?: UpdateTrigger;
  startup: boolean;
  version?: string;
  progress?: number;
  downloadSize?: number;
  differential?: boolean;
  releaseNotes?: string;
  checkedAt?: number;
  error?: {
    code:
      | "network"
      | "checksum"
      | "disk-space"
      | "locked"
      | "not-installed"
      | "unknown";
    message: string;
    retryable: boolean;
  };
};
