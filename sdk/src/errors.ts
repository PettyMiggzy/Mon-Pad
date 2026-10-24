export class MonpadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MonpadError';
  }
}

export class SlippageExceeded extends MonpadError {
  constructor(message = 'Slippage exceeded') {
    super(message);
    this.name = 'SlippageExceeded';
  }
}

export class DeadlineExpired extends MonpadError {
  constructor(message = 'Deadline expired') {
    super(message);
    this.name = 'DeadlineExpired';
  }
}

export class PoolNotFound extends MonpadError {
  constructor(token: string) {
    super(`Pool not found for token ${token}`);
    this.name = 'PoolNotFound';
  }
}

export class Paused extends MonpadError {
  constructor(message = 'Launches paused') {
    super(message);
    this.name = 'Paused';
  }
}

export class ContractsNotDeployed extends MonpadError {
  constructor(message = 'contracts not deployed yet') {
    super(message);
    this.name = 'ContractsNotDeployed';
  }
}

export class WalletRequired extends MonpadError {
  constructor() {
    super('walletClient required for this operation');
    this.name = 'WalletRequired';
  }
}

export class MaxMonExceeded extends MonpadError {
  constructor(message: string) {
    super(message);
    this.name = 'MaxMonExceeded';
  }
}

export class MaxUsdcExceeded extends MonpadError {
  constructor(message: string) {
    super(message);
    this.name = 'MaxUsdcExceeded';
  }
}

/** The quote asset (USDC) refused a transfer: paused, or an address on its blacklist. */
export class QuoteAssetBlocked extends MonpadError {
  constructor(message = 'USDC transfer blocked (token paused or an address is blacklisted)') {
    super(message);
    this.name = 'QuoteAssetBlocked';
  }
}

export class InsufficientQuoteBalance extends MonpadError {
  constructor(need: string, have: string) {
    super(`Insufficient USDC: need ${need}, have ${have}`);
    this.name = 'InsufficientQuoteBalance';
  }
}
