/**
 * Persists two pieces of buyer-local day-pass state, per seller peer id,
 * read and written directly against the raw config file rather than
 * through `loadConfig`/`saveConfig`:
 *  - which day-pass price this buyer has actually agreed to --
 *    `VprRoutingPreferences.agreedDayPassPricesUsdc` (packages/node's
 *    ModelRoutingPreferences), a user-facing preference under
 *    `buyer.routingPreferences`.
 *  - when this buyer last signed a flat-fee cumulative for that seller --
 *    `buyer.dayPassSigningState.lastSignedAtMsBySeller`, pure internal
 *    bookkeeping (never shown in any UI, never sent to the seller) that
 *    restores `BuyerPaymentManager`'s in-process elapsed-day clock across
 *    restarts. Kept in its own key rather than `routingPreferences` since
 *    it isn't a preference at all.
 * Both bypass `loadConfig`/`saveConfig` for the same reason: a full
 * load-then-save round trip touches and rewrites the whole config object,
 * widening the window for the concurrent-write race described below.
 * Reading and writing only the one key this module owns, preserving
 * everything else in the file byte-for-byte, keeps that race narrowed to
 * this module's own read-modify-write -- the same reasoning
 * `apps/desktop/src/main/runtime/process-manager.ts`'s own raw
 * `readFileSync`/`JSON.parse` of this same file already applies to
 * `selectedRouterPackage`.
 *
 * This file's own state can be written concurrently by a completely
 * separate OS process (the desktop app's main process, via its own
 * `updateDashboardConfig` IPC handler, while a connect-mode buyer daemon is
 * already running). Reading fresh immediately before writing narrows that
 * race to the single read-modify-write below rather than eliminating it --
 * proportionate for a value that changes at most a few times ever, matching
 * every other piece of config handling in this codebase, none of which
 * takes a file lock either.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Mirrors config/loader.ts's own private resolveConfigPath (~ expansion, default path) -- not exported from there, so duplicated here rather than reworking that module's exports for one caller. */
function resolveConfigPath(configPath: string | undefined): string {
  if (!configPath || configPath.trim().length === 0) {
    return join(homedir(), '.antseed', 'config.json')
  }
  if (configPath.startsWith('~')) {
    return resolve(homedir(), configPath.slice(2))
  }
  return resolve(configPath)
}

async function readRawConfig(resolvedPath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(resolvedPath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
}

function readAgreedPricesMap(config: Record<string, unknown>): Record<string, number> {
  const buyer = config['buyer']
  if (!buyer || typeof buyer !== 'object') return {}
  const routingPreferences = (buyer as Record<string, unknown>)['routingPreferences']
  if (!routingPreferences || typeof routingPreferences !== 'object') return {}
  const prices = (routingPreferences as Record<string, unknown>)['agreedDayPassPricesUsdc']
  if (!prices || typeof prices !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [peerId, price] of Object.entries(prices as Record<string, unknown>)) {
    if (typeof price === 'number' && Number.isFinite(price) && price >= 0) out[peerId] = price
  }
  return out
}

function readLastSignedAtMap(config: Record<string, unknown>): Record<string, number> {
  const buyer = config['buyer']
  if (!buyer || typeof buyer !== 'object') return {}
  const signingState = (buyer as Record<string, unknown>)['dayPassSigningState']
  if (!signingState || typeof signingState !== 'object') return {}
  const bySeller = (signingState as Record<string, unknown>)['lastSignedAtMsBySeller']
  if (!bySeller || typeof bySeller !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [peerId, atMs] of Object.entries(bySeller as Record<string, unknown>)) {
    if (typeof atMs === 'number' && Number.isFinite(atMs) && atMs >= 0) out[peerId] = atMs
  }
  return out
}

/**
 * Epoch-ms timestamp of the last flat-fee (day-pass) cumulative signature
 * this buyer sent this seller, or `null` if none is on file. Buyer-local
 * bookkeeping only -- never sent to the seller, unrelated to
 * `agreedDayPassPricesUsdc` above -- stored under its own
 * `buyer.dayPassSigningState` key rather than `routingPreferences` since
 * it's not a user-facing preference, just this process's memory of when it
 * last paid, restored across restarts so a fresh process doesn't forget and
 * grant an unwarranted extra day's charge (see
 * `BuyerPaymentManager.seedFlatFeeSignedAt`'s own doc comment).
 */
export async function readLastFlatFeeSignedAtMs(
  configPath: string | undefined,
  sellerPeerId: string,
): Promise<number | null> {
  const resolvedPath = resolveConfigPath(configPath)
  const config = await readRawConfig(resolvedPath)
  const bySeller = readLastSignedAtMap(config)
  return bySeller[sellerPeerId.toLowerCase()] ?? null
}

/**
 * Records the last flat-fee signing time for one seller, preserving every
 * other key in the config file untouched (including any other seller's own
 * timestamp already in this same map).
 */
export async function writeLastFlatFeeSignedAtMs(
  configPath: string | undefined,
  sellerPeerId: string,
  atMs: number,
): Promise<void> {
  const resolvedPath = resolveConfigPath(configPath)
  const config = await readRawConfig(resolvedPath)
  const buyer = (config['buyer'] && typeof config['buyer'] === 'object' ? config['buyer'] : {}) as Record<string, unknown>
  const signingState = (buyer['dayPassSigningState'] && typeof buyer['dayPassSigningState'] === 'object'
    ? buyer['dayPassSigningState']
    : {}) as Record<string, unknown>
  const bySeller = readLastSignedAtMap(config)
  bySeller[sellerPeerId.toLowerCase()] = atMs

  const merged = {
    ...config,
    buyer: {
      ...buyer,
      dayPassSigningState: {
        ...signingState,
        lastSignedAtMsBySeller: bySeller,
      },
    },
  }
  await mkdir(dirname(resolvedPath), { recursive: true })
  await writeFile(resolvedPath, JSON.stringify(merged, null, 2), 'utf-8')
}

/** Whole-USD agreed price for a seller peer id, or `null` if none has ever been recorded. */
export async function readAgreedDayPassPriceUsd(
  configPath: string | undefined,
  sellerPeerId: string,
): Promise<number | null> {
  const resolvedPath = resolveConfigPath(configPath)
  const config = await readRawConfig(resolvedPath)
  const prices = readAgreedPricesMap(config)
  return prices[sellerPeerId.toLowerCase()] ?? null
}

/**
 * Records the agreed price for one seller, preserving every other key in
 * the config file untouched (including any other seller's own agreed
 * price already in this same map).
 */
export async function writeAgreedDayPassPriceUsd(
  configPath: string | undefined,
  sellerPeerId: string,
  priceUsd: number,
): Promise<void> {
  const resolvedPath = resolveConfigPath(configPath)
  const config = await readRawConfig(resolvedPath)
  const buyer = (config['buyer'] && typeof config['buyer'] === 'object' ? config['buyer'] : {}) as Record<string, unknown>
  const routingPreferences = (buyer['routingPreferences'] && typeof buyer['routingPreferences'] === 'object'
    ? buyer['routingPreferences']
    : {}) as Record<string, unknown>
  const prices = readAgreedPricesMap(config)
  prices[sellerPeerId.toLowerCase()] = priceUsd

  const merged = {
    ...config,
    buyer: {
      ...buyer,
      routingPreferences: {
        ...routingPreferences,
        agreedDayPassPricesUsdc: prices,
      },
    },
  }
  await mkdir(dirname(resolvedPath), { recursive: true })
  await writeFile(resolvedPath, JSON.stringify(merged, null, 2), 'utf-8')
}

/** 6-decimal USDC base units -> whole USD, for comparing against/storing alongside the UI's own price display convention. */
export function usdcToUsd(baseUnits: bigint): number {
  return Number(baseUnits) / 1_000_000
}

/** Whole USD -> 6-decimal USDC base units, rounding to the nearest base unit. */
export function usdToUsdc(usd: number): bigint {
  return BigInt(Math.round(usd * 1_000_000))
}
