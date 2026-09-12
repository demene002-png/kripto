export interface CoinData {
  symbol: string;
  pair?: string;
  name: string;
  price: number;
  change24h: number;
  volume: string;
  quoteVolume?: number;
  bidPrice?: number;
  askPrice?: number;
  spreadPercent?: number;
}

export interface PortfolioItem {
  symbol: string;
  amount: number;
  averageBuyPrice: number;
  type?: 'LONG';
  margin?: number;
  leverage?: number;
  stopLoss?: number;
  takeProfit1?: number;
  takeProfit2?: number;
  trailingActivation?: number;
  trailingDistancePct?: number;
  highestPrice?: number;
  riskAmount?: number;
  tp1Hit?: number;
  tp2Hit?: number;
}

export interface TradeSignal {
  id: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  price: number;
  aiScore: number;
  analysis: string;
  timestamp: number;
  status: 'PENDING' | 'EXECUTED' | 'REJECTED';
  source?: string;
  targetPrice?: number;
  projectedProfit?: number;
  investmentAmount?: number;
  opportunity?: number;
  risk?: number;
  confidence?: number;
}

export interface AppState {
  balance: number;
  portfolio: PortfolioItem[];
  favorites: string[];
  autoPilot: boolean;
  autoPilotAmount: number;
  autoPilotBudget: number;
  dailyTargetPercent: number;
  positionSizePercent: number;
  riskProfile: 'CONSERVATIVE'|'BALANCED'|'AGGRESSIVE'|'CUSTOM';
  riskPerTradePercent: number;
  maxDailyLossPercent: number;
  maxOpenRiskPercent: number;
  maxPositions: number;
  executionMode: 'PAPER';
  automationMode: 'MANUAL'|'SEMI_AUTO'|'FULL_AUTO';
  safeMode: boolean;
  liveCapitalCapUsd: number;
  liveApiPermissionAttested: boolean;
  emergencyDrillAttested: boolean;
  testnetReviewAttested: boolean;
  newsRetestAttested: boolean;
}

export interface MarketRegime { label:string; risk:number; breadth:number; avgChange24h:number; trendScore:number; volatility:number; }

export interface NewsIntelligence { symbol:string; level:'NORMAL'|'INFO'|'CAUTION'|'HIGH_RISK'|'VETO'; reason:string; veto:{active:boolean;reason:string}; score:{sentiment:number;opportunityAdjustment:number;riskAdjustment:number;confidenceAdjustment:number;socialAnomaly:number}; news:Array<{id:string;title:string;source:string;domain:string;publishedAt:number;reliability:number;sentiment:number;impact:number;category:string;confirmations:number;stale:boolean}>; upcomingEvents:Array<{id:string;title:string;date:number;displayedDate:string;impact:number;category:string;provider:string;estimated?:boolean}>; providers:{cryptopanic:boolean;coinmarketcal:boolean;genericNews:boolean;macroConfig:boolean;errors:string[]}; generatedAt:number; }
