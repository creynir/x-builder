export type CheckStatus = "pass" | "warn" | "fail";

export type VoiceCheck = {
  id: string;
  kind?: "quality";
  label: string;
  status: CheckStatus;
};
