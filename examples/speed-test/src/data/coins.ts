export const TICKERS = [
  // L1 — Layer 1 blockchains (20)
  'BTC','ETH','SOL','AVAX','ADA','DOT','ATOM','NEAR','ALGO','FTM',
  'HBAR','XLM','XRP','LTC','ICP','APT','SUI','TON','TRX','EOS',
  // DeFi — Decentralized Finance (20)
  'UNI','AAVE','MKR','CRV','SNX','COMP','YFI','BAL','SUSHI','GMX',
  'DYDX','CVX','LDO','RPL','CAKE','SPELL','FXS','KNC','ZRX','ALPHA',
  // L2 — Layer 2 & Scaling (20)
  'MATIC','OP','ARB','IMX','METIS','BOBA','CELR','CELO','SKL','MOVR',
  'GLMR','KAVA','EVMOS','ROSE','CRO','RON','AURORA','MANTA','ZK','STRK',
  // Meme — Meme coins (20)
  'DOGE','SHIB','PEPE','FLOKI','BONK','WIF','BOME','MEME','TURBO','NEIRO',
  'POPCAT','MEW','COQ','MYRO','WOJAK','LADYS','BENJI','APU','DEGEN','GIGA',
  // AI & Infrastructure (20)
  'LINK','GRT','RNDR','FET','OCEAN','AGIX','TAO','AKT','LPT','BAND',
  'API3','TRB','NMR','VET','THETA','AR','STORJ','BLZ','HOT','INJ',
];

export const SECTORS = ['L1', 'DeFi', 'L2', 'Meme', 'AI'];
export const SECTOR_SIZE = 20;
export const COIN_COUNT = TICKERS.length; // 100

export function getInitialPrices(): number[] {
  return TICKERS.map(() => +(80 + Math.random() * 920).toFixed(2));
}
