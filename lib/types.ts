export type Project = {
  name: string;
  symbol: string;
  status: "Bonding" | "Graduated";
  token: `0x${string}`;
  curve: `0x${string}`;
  bondedPct: number;
  estMcapMon: number;
  raisedMon?: number;
  price?: number;
  priceWeiPerToken?: bigint | number;
  uniqueBuyers: number;
  pfpUrl?: string;
  bannerUrl?: string;
  desc?: string;
  createdAt?: number;
  priceHistory?: number[]; // sparkline prices
};