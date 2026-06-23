// @x-builder/overlay — overlay React tree root (XOB-019)
//
// Mounts the transport seam and the anchor layer. `OverlayTransportProvider`
// wraps the tree and (with no explicit prop) resolves the page-bound
// `window.__xbTransport`, falling back to a warned no-op when absent.
// `AnchorLayer` runs its MutationObserver reconcile loop and owns the (empty)
// anchor registry. Renders no visible output at this ticket — the affordance
// pins that hang off the registry arrive in XOB-025+.

import type { ReactNode } from "react";

import { AnchorLayer } from "./anchor-layer";
import { ComposeCockpit } from "./compose/compose-cockpit";
import { overlayExplainerCopy } from "./explainer/copy";
import { SettingsAffordance } from "./settings/settings-affordance";
import { SuggestController } from "./suggest/suggest-controller";
import { OverlayTransportProvider } from "./transport/provider";

export interface OverlayRuntimeProps {}

/**
 * The overlay's React root: transport provider over the anchor layer and the
 * page-persistent settings affordance. The affordance is a sibling of
 * `AnchorLayer` (not inside the node-anchored pin tree) so it stays mounted in
 * the top-left of the shadow layer regardless of which X nodes are present.
 *
 * `ComposeCockpit` and `SuggestController` both mount INSIDE `AnchorLayer` (they
 * consume the `ComposeContext` the layer publishes) and self-guard on it:
 * `ComposeCockpit` renders nothing until the layer detects X's compose modal,
 * while `SuggestController` is the inverse — the page-persistent suggest-post
 * surface that renders only while the compose modal is NOT active. So the runtime
 * stays inert on non-compose routes except for the suggest launcher.
 */
export function OverlayRuntime(_props: OverlayRuntimeProps): ReactNode {
  return (
    <OverlayTransportProvider>
      <AnchorLayer>
        <ComposeCockpit explainer={overlayExplainerCopy} />
        <SuggestController />
      </AnchorLayer>
      <SettingsAffordance />
    </OverlayTransportProvider>
  );
}
