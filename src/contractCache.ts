/**
 * Shared contract instance cache — avoids recreating getContract() on every call.
 * Uses setSender() to update sender on cached instances.
 */
import {
  JSONRpcProvider, getContract, OP_20_ABI, ABIDataTypes, BitcoinAbiTypes,
  type IOP20Contract, type BitcoinInterfaceAbi, type BaseContractProperties,
} from 'opnet';
import { Address } from '@btc-vision/transaction';
import { NETWORK, RPC_URL } from './config';

export { NETWORK, RPC_URL };

/** Generic OPNet contract with dynamic method dispatch */
export interface OPNetContract extends BaseContractProperties {
  [method: string]: ((...args: unknown[]) => Promise<unknown>) | undefined | unknown;
}

/** Singleton provider */
let _provider: JSONRpcProvider | null = null;
export function getProvider(): JSONRpcProvider {
  if (!_provider) _provider = new JSONRpcProvider({ url: RPC_URL, network: NETWORK });
  return _provider;
}

/** ABI for MintableToken publicMint method */
export const MINTABLE_ABI: BitcoinInterfaceAbi = [
  {
    name: 'publicMint',
    inputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }],
    outputs: [],
    type: BitcoinAbiTypes.Function,
  },
];

/** Contract instance cache keyed by address */
const contractCache = new Map<string, IOP20Contract>();

export function getCachedOP20(address: string, sender?: string): IOP20Contract {
  let contract = contractCache.get(address);
  if (!contract) {
    contract = getContract<IOP20Contract>(
      address, OP_20_ABI, getProvider(), NETWORK, sender ? Address.fromString(sender) : undefined,
    );
    contractCache.set(address, contract);
  } else if (sender) {
    (contract as unknown as OPNetContract).setSender?.(Address.fromString(sender));
  }
  return contract;
}

const mintableCache = new Map<string, OPNetContract>();

/** Generic contract cache for non-OP20 contracts (Market, CrossChain, etc.) */
const genericCache = new Map<string, OPNetContract>();

export function getCachedContract(address: string, abi: BitcoinInterfaceAbi, sender?: string): OPNetContract {
  const abiFingerprint = abi.map(e => e.name).join(',');
  const key = `${address}:${abiFingerprint}`;
  let contract = genericCache.get(key);
  if (!contract) {
    contract = getContract<OPNetContract>(address, abi, getProvider(), NETWORK, sender ? Address.fromString(sender) : undefined);
    genericCache.set(key, contract);
  } else if (sender) {
    contract.setSender?.(Address.fromString(sender));
  }
  return contract;
}

export function getCachedMintable(address: string, sender?: string): OPNetContract {
  let contract = mintableCache.get(address);
  if (!contract) {
    contract = getContract<OPNetContract>(
      address, MINTABLE_ABI, getProvider(), NETWORK, sender ? Address.fromString(sender) : undefined,
    );
    mintableCache.set(address, contract);
  } else if (sender) {
    contract.setSender?.(Address.fromString(sender));
  }
  return contract;
}
