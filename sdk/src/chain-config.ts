/**
 * Optional compile-time defaults for chain infra (PoolManager, StateView).
 * Override at runtime via createMonpad({ addresses }) or env / spec fetch.
 * Monpad launcher/hook/router stay empty until deployed.
 */
export type InfraAddresses = {
  poolManager?: string;
  stateView?: string;
};

export const DEFAULT_INFRA: InfraAddresses = {
  poolManager: '',
  stateView: '',
};
