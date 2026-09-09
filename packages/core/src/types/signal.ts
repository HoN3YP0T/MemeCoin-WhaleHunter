export interface SignalComponents {
  whaleQuality: number;
  tokenQuality: number;
  liquidity: number;
  buyingMomentum: number;
  independentBuyers: number;
  earlyEntryQuality: number;
  manipulationPenalty: number;
}

export interface Signal {
  signalId: string;
  tokenMint: string;
  triggeringWallet: string;
  triggeringTxSignature: string;
  components: SignalComponents;
  score: number; // 0-100 composite
  generatedAt: number;
}

export interface EntryGateResult {
  passed: boolean;
  reasons: string[]; // populated when passed = false, one per failed condition
}
