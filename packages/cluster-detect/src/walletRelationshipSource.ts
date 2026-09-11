import type { ClusterEdge } from "@whale-sniper/core";

/**
 * The wallet-relationship half of cluster detection: the two edge kinds that
 * cannot be derived from a trade stream at all, because they are facts about
 * *funding history and token deployment*, not about trading behaviour.
 *
 * Every method is SYNCHRONOUS on purpose. `ClusterDetector.detectForToken()`
 * runs at the signal engine's cluster-check stage, on a path that must not
 * block on network I/O, so an implementation backed by a remote source must
 * serve reads from cache and refresh in the background - see
 * `SolanaRpcWalletRelationshipSource`, which follows the same shape
 * `token-intel`'s `CompositeTokenMetadataProvider` established.
 */
export interface WalletRelationshipSource {
  /** True when `wallet` is the token's deployer or is funded by it. */
  isCreatorAssociated(tokenMint: string, wallet: string): boolean;

  /** `common-funder` edges (weight 0.9) between every pair of wallets that
   * share one original funding source. */
  commonFunderEdges(wallets: string[]): ClusterEdge[];

  /** `shared-creator` edges (weight 1.0) between every pair of wallets
   * associated with this token's deployer. */
  sharedCreatorEdges(tokenMint: string, wallets: string[]): ClusterEdge[];

  /**
   * Whether relationship data for this (token, wallet) pair has actually
   * been resolved yet, as opposed to being merely absent.
   *
   * This distinction exists because "unknown" and "clean" are the same thing
   * to the edge detectors (no data -> no edge -> a cluster is at worst
   * missed) but must NOT be the same thing to `WhaleDiscoveryEngine`:
   * auto-promoting a wallet onto the tradeable watchlist because "we found
   * no manipulation" when we simply had not looked yet is exactly the
   * wash-trade trap the flag exists to prevent. A false here means "defer,
   * re-check later", never "reject".
   */
  relationshipDataKnown(tokenMint: string, wallet: string): boolean;
}
