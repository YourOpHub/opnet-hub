/**
 * Shared contract instance cache — avoids recreating getContract() on every call.
 * Uses setSender() to update sender on cached instances.
 */
import { networks } from '@btc-vision/bitcoin';
import {
  JSONRpcProvider, getContract, OP_20_ABI, ABIDataTypes, BitcoinAbiTypes,
  type IOP20Contract, type BitcoinInterfaceAbi,
} from 'opnet';

export const NETWORK = networks.testnet;
export const RPC_URL = 'https://testnet.opnet.org/api/v1/json-rpc';

/** Singleton provider */
let _provider: JSONRpcProvider | null = null;
export function getProvider(): JSONRpcProvider {
  if (!_provider) _provider = new JSONRpcProvider(RPC_URL, NETWORK);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCachedOP20(address: string, sender?: any): IOP20Contract {
  let contract = contractCache.get(address);
  if (!contract) {
    contract = getContract<IOP20Contract>(
      address, OP_20_ABI, getProvider(), NETWORK, sender,
    );
    contractCache.set(address, contract);
  } else if (sender) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (contract as any).setSender?.(sender);
  }
  return contract;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mintableCache = new Map<string, any>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCachedMintable(address: string, sender?: any): any {
  let contract = mintableCache.get(address);
  if (!contract) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contract = getContract<any>(
      address, MINTABLE_ABI, getProvider(), NETWORK, sender,
    );
    mintableCache.set(address, contract);
  } else if (sender) {
    contract.setSender?.(sender);
  }
  return contract;
}
