import type {
  BuyerConversationSummary,
  InstalledAppEntry,
  RouterPluginInfo,
  RuntimeProcessState,
  SystemProxyProfileSummary,
} from '../../types/bridge';
import { createCachedResource } from './cached-resource';

const POLL_MS = 3_000;

export const buyerConversationsResource = createCachedResource<BuyerConversationSummary[]>({
  pollMs: POLL_MS,
  async load() {
    const conversations = await window.antseedDesktop?.buyerConversationsList?.();
    if (conversations === null || conversations === undefined) throw new Error('Buyer unavailable');
    return conversations;
  },
});

export type SystemProxySnapshot = {
  profiles: SystemProxyProfileSummary[];
  state: RuntimeProcessState | null;
};

export const systemProxyResource = createCachedResource<SystemProxySnapshot>({
  pollMs: POLL_MS,
  async load() {
    const bridge = window.antseedDesktop;
    const [profiles, state] = await Promise.all([
      bridge?.systemProxyListProfiles?.() ?? Promise.resolve([]),
      bridge?.systemProxyGetState?.() ?? Promise.resolve(null),
    ]);
    return { profiles, state };
  },
});

/**
 * The real, live-advertised daily day-pass price, for the Auto-routing
 * Preferences toggle's disclosure
 * copy. `null` (not an error/throw) whenever no routing peer advertising one
 * has been discovered yet -- the toggle falls back to generic copy in that
 * case rather than showing a broken number.
 */
export type DayPassPriceOffer = { peerId?: string; flatUsdPrice?: number };

export const dayPassPriceResource = createCachedResource<DayPassPriceOffer | null>({
  pollMs: POLL_MS,
  async load() {
    const result = await window.antseedDesktop?.chatAiGetDayPassPrice?.();
    return result?.data ?? null;
  },
});

/**
 * Whether the connect daemon is currently capping some seller's day-pass
 * signing below what it's actually advertising (day-pass-signing.ts's
 * onPriceCappedChange, via buyer-proxy's own
 * `/_antseed/day-pass-price-increase`) -- polled so a UI can reopen the
 * router info dialog for re-confirmation on its own, instead of the buyer
 * only finding out once a routed request happens to fail. `null` (not an
 * error) whenever nothing is currently capped.
 */
export type DayPassPriceIncreaseNotice = { sellerPeerId: string; agreedUsd: number; discoveredUsd: number };

export const dayPassPriceIncreaseResource = createCachedResource<DayPassPriceIncreaseNotice | null>({
  pollMs: POLL_MS,
  async load() {
    const result = await window.antseedDesktop?.chatAiGetDayPassPriceIncrease?.();
    return result?.data ?? null;
  },
});

/**
 * Router-type plugins installed on disk (packages/node's AntseedRouterPlugin
 * metadata), for Preferences' "Select model router" dropdown -- driven by
 * whatever's actually installed rather than a hardcoded option list. Not
 * polled as aggressively as live runtime state since installed plugins
 * change only on an explicit install/reinstall.
 */
export const installedRouterPluginsResource = createCachedResource<RouterPluginInfo[]>({
  pollMs: 30_000,
  async load() {
    const result = await window.antseedDesktop?.pluginsListRouters?.();
    if (!result?.ok) throw new Error(result?.error ?? 'Could not list router plugins');
    return result.routers ?? [];
  },
});

export const installedAppsResource = createCachedResource<InstalledAppEntry[]>({
  async load() {
    const result = await window.antseedDesktop?.listInstalledApps?.();
    if (!result?.ok) throw new Error(result?.error ?? 'Could not list applications');
    return result.apps ?? [];
  },
});
