// @x-builder/overlay - ExternalXSignalsSettingsSection
//
// Dense settings-panel surface for server-derived external X signal sources,
// evidence, and patterns. Pattern derivation stays in the engine; this component
// only renders the overview returned by getExternalXSignalsOverview.

import type {
  ExternalXSignalPattern,
  ExternalXSignalSource,
  GetExternalXSignalsOverviewResponse,
} from "@x-builder/shared";
import { useState, type CSSProperties, type ReactElement } from "react";

import { Alert } from "../ui/v2/alert";
import { Badge, type BadgeProps } from "../ui/v2/badge";
import { Button } from "../ui/v2/button";
import { EmptyState } from "../ui/v2/empty-state";
import { Input } from "../ui/v2/input";
import { KeyValueList, type KeyValueItem } from "../ui/v2/key-value-list";
import { Skeleton } from "../ui/v2/skeleton";

type Loadable<T> = T | "loading" | { error: unknown };

export type ExternalXSignalsActionState =
  | "idle"
  | { status: "adding"; screenName: string }
  | { status: "refreshing"; sourceId: string }
  | { status: "removing"; sourceId: string }
  | {
      status: "failed";
      operation: "add" | "refresh" | "remove";
      message: string;
      sourceId?: string;
    };

export interface ExternalXSignalsSettingsSectionProps {
  overview: Loadable<GetExternalXSignalsOverviewResponse>;
  actionState: ExternalXSignalsActionState;
  onAdd(screenName: string): Promise<void>;
  onRefreshSource(sourceId: string): Promise<void>;
  onRemoveSource(sourceId: string): Promise<void>;
  onRefreshOverview(): void;
}

const STACK_STYLE: CSSProperties = {
  display: "grid",
  gap: "var(--space-2)",
};

const FORM_STYLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: "var(--space-2)",
  alignItems: "center",
};

const ROW_STYLE: CSSProperties = {
  display: "grid",
  gap: "var(--space-2)",
  paddingBlock: "var(--space-2)",
  borderTop: "var(--border-width-thin) solid var(--xb-border-edge)",
};

const ROW_HEADER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-2)",
  flexWrap: "wrap",
};

const ACTIONS_STYLE: CSSProperties = {
  display: "flex",
  gap: "var(--space-2)",
  flexWrap: "wrap",
};

const MUTED_STYLE: CSSProperties = {
  margin: 0,
  font: "var(--type-body-small)",
  color: "var(--xb-text-muted)",
  overflowWrap: "anywhere",
};

const TEXT_STYLE: CSSProperties = {
  margin: 0,
  font: "var(--type-body-small)",
  color: "var(--xb-text)",
  overflowWrap: "anywhere",
};

const EVIDENCE_STYLE: CSSProperties = {
  display: "grid",
  gap: "var(--space-1)",
  minWidth: 0,
};

function isError<T>(value: Loadable<T>): value is { error: unknown } {
  return typeof value === "object" && value !== null && "error" in value;
}

function formatLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function sourceStatusVariant(status: ExternalXSignalSource["status"]): BadgeProps["variant"] {
  switch (status) {
    case "active":
      return "success";
    case "waiting_for_observation":
      return "warning";
    case "refresh_failed":
      return "danger";
    case "removed":
      return "warning";
  }
}

function patternVariant(pattern: ExternalXSignalPattern): BadgeProps["variant"] {
  return pattern.confidence >= 0.7 ? "success" : "info";
}

function totalsItems(overview: GetExternalXSignalsOverviewResponse): KeyValueItem[] {
  return [
    { key: "Sources", value: String(overview.totals.sources) },
    { key: "Active", value: String(overview.totals.activeSources) },
    { key: "Evidence", value: String(overview.totals.evidence) },
    { key: "Patterns", value: String(overview.totals.patterns) },
  ];
}

function actionFailure(
  actionState: ExternalXSignalsActionState,
  operation?: "add" | "refresh" | "remove",
  sourceId?: string,
): ReactElement | null {
  if (actionState === "idle" || actionState.status !== "failed") return null;
  if (operation !== undefined && actionState.operation !== operation) return null;
  if (sourceId !== undefined && actionState.sourceId !== sourceId) return null;

  return <Alert variant="warning">{actionState.message}</Alert>;
}

function AddSourceForm({
  actionState,
  onAdd,
}: {
  actionState: ExternalXSignalsActionState;
  onAdd(screenName: string): Promise<void>;
}): ReactElement {
  const [screenName, setScreenName] = useState("");
  const trimmed = screenName.trim();
  const normalizedScreenName = trimmed.replace(/^@+/, "").trim();
  const adding = actionState !== "idle" && actionState.status === "adding";

  const submit = (): void => {
    if (normalizedScreenName.length === 0 || adding) return;
    void onAdd(normalizedScreenName)
      .then(() => setScreenName(""))
      .catch(() => undefined);
  };

  return (
    <div style={STACK_STYLE} aria-live="polite">
      <div style={FORM_STYLE}>
        <Input
          value={screenName}
          onChange={setScreenName}
          aria-label="External X handle"
          disabled={adding}
        />
        <Button
          variant="secondary"
          size="sm"
          flat
          loading={adding}
          disabled={normalizedScreenName.length === 0 || adding}
          onClick={submit}
        >
          Add
        </Button>
      </div>
      {actionFailure(actionState, "add")}
    </div>
  );
}

function SourceRow({
  source,
  actionState,
  onRefreshSource,
  onRemoveSource,
}: {
  source: ExternalXSignalSource;
  actionState: ExternalXSignalsActionState;
  onRefreshSource(sourceId: string): Promise<void>;
  onRemoveSource(sourceId: string): Promise<void>;
}): ReactElement {
  const refreshing = actionState !== "idle" && actionState.status === "refreshing" && actionState.sourceId === source.id;
  const removing = actionState !== "idle" && actionState.status === "removing" && actionState.sourceId === source.id;
  const busy = refreshing || removing;

  return (
    <div data-external-x-source-row="" style={ROW_STYLE} aria-live="polite">
      <div style={ROW_HEADER_STYLE}>
        <div style={{ minWidth: 0 }}>
          <strong style={TEXT_STYLE}>@{source.screenName}</strong>
          {source.displayName ? <p style={MUTED_STYLE}>{source.displayName}</p> : null}
        </div>
        <Badge variant={sourceStatusVariant(source.status)}>{formatLabel(source.status)}</Badge>
      </div>
      <KeyValueList
        items={[
          { key: "Evidence", value: String(source.evidenceCount) },
          { key: "Patterns", value: String(source.patternCount) },
          { key: "Last observed", value: source.lastObservedAt ?? "Waiting" },
        ]}
      />
      <div style={ACTIONS_STYLE}>
        <Button
          variant="ghost"
          size="sm"
          flat
          loading={refreshing}
          disabled={busy}
          onClick={() => { void onRefreshSource(source.id); }}
        >
          Refresh
        </Button>
        <Button
          variant="danger"
          size="sm"
          flat
          loading={removing}
          disabled={busy}
          onClick={() => { void onRemoveSource(source.id); }}
        >
          Remove
        </Button>
      </div>
      {actionFailure(actionState, "refresh", source.id)}
      {actionFailure(actionState, "remove", source.id)}
    </div>
  );
}

function PatternRow({ pattern }: { pattern: ExternalXSignalPattern }): ReactElement {
  return (
    <div data-external-x-pattern-row="" style={ROW_STYLE}>
      <div style={ROW_HEADER_STYLE}>
        <strong style={TEXT_STYLE}>{pattern.label}</strong>
        <Badge variant={patternVariant(pattern)}>{formatLabel(pattern.patternType)}</Badge>
      </div>
      <p style={MUTED_STYLE}>{pattern.statement}</p>
      <KeyValueList
        items={[
          { key: "Sources", value: String(pattern.sourceIds.length) },
          { key: "Evidence", value: String(pattern.supportCount) },
          { key: "Confidence", value: `${Math.round(pattern.confidence * 100)}%` },
        ]}
      />
      {pattern.evidence.length > 0 ? (
        <div style={EVIDENCE_STYLE}>
          {pattern.evidence.slice(0, 3).map((item) => (
            <p key={item.evidenceId} style={MUTED_STYLE}>
              @{item.screenName}: {item.text}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ExternalXSignalsSettingsSection({
  overview,
  actionState,
  onAdd,
  onRefreshSource,
  onRemoveSource,
  onRefreshOverview,
}: ExternalXSignalsSettingsSectionProps): ReactElement {
  if (overview === "loading") {
    return (
      <div style={STACK_STYLE}>
        <Skeleton />
        <Button variant="ghost" size="sm" flat onClick={onRefreshOverview}>Refresh</Button>
      </div>
    );
  }

  if (isError(overview)) {
    return (
      <div style={STACK_STYLE}>
        <Alert variant="danger">Could not load external X signals.</Alert>
        <Button variant="secondary" size="sm" flat onClick={onRefreshOverview}>Refresh</Button>
      </div>
    );
  }

  return (
    <div style={STACK_STYLE}>
      <AddSourceForm actionState={actionState} onAdd={onAdd} />

      {overview.sources.length === 0 ? (
        <EmptyState
          title="No external sources"
          action={<Button variant="ghost" size="sm" flat onClick={onRefreshOverview}>Refresh</Button>}
        >
          Add an X handle to collect observed external evidence.
        </EmptyState>
      ) : (
        <>
          <div style={ROW_HEADER_STYLE}>
            <KeyValueList items={totalsItems(overview)} />
            <Button variant="ghost" size="sm" flat onClick={onRefreshOverview}>Refresh</Button>
          </div>

          <div style={STACK_STYLE}>
            <p style={MUTED_STYLE}>Sources</p>
            {overview.sources.map((source) => (
              <SourceRow
                key={source.id}
                source={source}
                actionState={actionState}
                onRefreshSource={onRefreshSource}
                onRemoveSource={onRemoveSource}
              />
            ))}
          </div>

          <div style={STACK_STYLE}>
            <p style={MUTED_STYLE}>Evidence-backed patterns</p>
            {overview.patterns.length > 0 ? (
              overview.patterns.map((pattern) => <PatternRow key={pattern.id} pattern={pattern} />)
            ) : (
              <p style={MUTED_STYLE}>No external patterns yet.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
