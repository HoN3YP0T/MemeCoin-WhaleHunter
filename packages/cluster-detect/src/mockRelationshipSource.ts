import type { ClusterEdge } from "@whale-sniper/core";

/**
 * Stands in for real on-chain funding-graph and token-creator lookups
 * (common-funder, shared-creator relationships aren't derivable from a
 * trade stream alone). A real implementation would walk SOL transfer
 * history and token metadata; here relationships are explicitly registered
 * by scenario setup / wiring code.
 */
export class MockWalletRelationshipSource {
  private funders = new Map<string, string>(); // wallet -> funder wallet
  private creators = new Map<string, string>(); // tokenMint -> creator wallet
  private creatorLinked = new Map<string, Set<string>>(); // tokenMint -> wallets associated with the creator

  setFunder(wallet: string, funder: string): void {
    this.funders.set(wallet, funder);
  }

  setCreator(tokenMint: string, creator: string, associatedWallets: string[] = []): void {
    this.creators.set(tokenMint, creator);
    this.creatorLinked.set(tokenMint, new Set([creator, ...associatedWallets]));
  }

  isCreatorAssociated(tokenMint: string, wallet: string): boolean {
    return this.creatorLinked.get(tokenMint)?.has(wallet) ?? false;
  }

  commonFunderEdges(wallets: string[]): ClusterEdge[] {
    const edges: ClusterEdge[] = [];
    for (let i = 0; i < wallets.length; i++) {
      for (let j = i + 1; j < wallets.length; j++) {
        const fa = this.funders.get(wallets[i]);
        const fb = this.funders.get(wallets[j]);
        if (fa && fb && fa === fb) {
          edges.push({ a: wallets[i], b: wallets[j], reason: "common-funder", weight: 0.9 });
        }
      }
    }
    return edges;
  }

  sharedCreatorEdges(tokenMint: string, wallets: string[]): ClusterEdge[] {
    const linked = wallets.filter((w) => this.isCreatorAssociated(tokenMint, w));
    const edges: ClusterEdge[] = [];
    for (let i = 0; i < linked.length; i++) {
      for (let j = i + 1; j < linked.length; j++) {
        edges.push({ a: linked[i], b: linked[j], reason: "shared-creator", weight: 1 });
      }
    }
    return edges;
  }
}
