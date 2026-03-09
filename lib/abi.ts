export const FACTORY_ABI = [
  {
    type: "function",
    name: "createLaunch",
    stateMutability: "payable",
    inputs: [
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "maxSupply", type: "uint256" },
    ],
    outputs: [
      { name: "token", type: "address" },
      { name: "curve", type: "address" },
      { name: "graduator", type: "address" },
    ],
  },
  {
    type: "function",
    name: "creationFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "capMon",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "event",
    name: "Launched",
    inputs: [
      { indexed: true, name: "token", type: "address" },
      { indexed: true, name: "curve", type: "address" },
      { indexed: true, name: "graduator", type: "address" },
      { indexed: false, name: "creator", type: "address" },
    ],
  },
] as const;

export const CURVE_ABI = [
  {
    type: "function",
    name: "buy",
    stateMutability: "payable",
    inputs: [{ name: "minTokensOut", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "sell",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenAmount", type: "uint256" },
      { name: "minMonOut", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "priceWeiPerToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "bondedBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "capMon",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "monRaisedNet",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "graduated",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "token",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "creator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "event",
    name: "Buy",
    inputs: [
      { indexed: true, name: "buyer", type: "address" },
      { indexed: false, name: "monIn", type: "uint256" },
      { indexed: false, name: "tokensOut", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "Sell",
    inputs: [
      { indexed: true, name: "seller", type: "address" },
      { indexed: false, name: "tokensIn", type: "uint256" },
      { indexed: false, name: "monOut", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "Graduated",
    inputs: [
      { indexed: false, name: "pool", type: "address" },
      { indexed: false, name: "tokenId", type: "uint256" },
    ],
  },
] as const;

export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "o", type: "address" },
      { name: "s", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;
