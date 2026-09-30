#!/usr/bin/env node
// Re-derives every KNOWN_PERMIT_TOKENS entry from the chain (docs/PERMIT_ALLOWLIST.md).
// For each token: read name() / version() / DOMAIN_SEPARATOR() / PERMIT_TYPEHASH(), check the
// DOMAIN_SEPARATOR against the EIP-712 domain built from (name, version, chainId, address), and
// print the permitDomainKey digest. Read-only public RPC calls; no keys.
//
//   node scripts/verify-permit-domains.mjs
//   ETH_RPC_URL=… BASE_RPC_URL=… node scripts/verify-permit-domains.mjs
import { createPublicClient, encodeAbiParameters, http, keccak256, parseAbi, stringToBytes } from 'viem';
import { sha256 } from '@noble/hashes/sha256';

const ETH = process.env.ETH_RPC_URL ?? 'https://ethereum-rpc.publicnode.com';
const BASE = process.env.BASE_RPC_URL ?? 'https://base-rpc.publicnode.com';
const TOKENS = [
  { label: 'USDC Ethereum', chainId: 1, rpc: ETH, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  { label: 'DAI Ethereum', chainId: 1, rpc: ETH, address: '0x6B175474E89094C44Da98b954EedeAC495271d0F' },
  { label: 'USDC Base', chainId: 8453, rpc: BASE, address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
];

const abi = parseAbi([
  'function name() view returns (string)',
  'function version() view returns (string)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
  'function PERMIT_TYPEHASH() view returns (bytes32)',
]);
const EIP712_DOMAIN = keccak256(stringToBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'));
const EIP2612 = keccak256(stringToBytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)'));

// Same algorithm as src/evm/permit.ts permitDomainKey.
function permitDomainKey(name, version, chainId, verifyingContract) {
  const bytes = sha256(new TextEncoder().encode(`${name}|${version}|${chainId}|${verifyingContract.toLowerCase()}`));
  return Buffer.from(bytes).toString('hex');
}

let failed = false;
for (const t of TOKENS) {
  const client = createPublicClient({ transport: http(t.rpc) });
  const chainId = await client.getChainId();
  const read = (functionName) => client.readContract({ address: t.address, abi, functionName });
  const [name, version, separator] = await Promise.all([read('name'), read('version'), read('DOMAIN_SEPARATOR')]);
  const typehash = await read('PERMIT_TYPEHASH').catch(() => null);
  const expected = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
      [EIP712_DOMAIN, keccak256(stringToBytes(name)), keccak256(stringToBytes(version)), BigInt(t.chainId), t.address],
    ),
  );
  const ok = chainId === t.chainId && separator === expected;
  failed ||= !ok;
  console.log(
    JSON.stringify({
      token: t.label,
      rpcChainId: chainId,
      name,
      version,
      domainSeparatorMatches: separator === expected,
      permit: typehash === null ? 'no PERMIT_TYPEHASH view' : typehash === EIP2612 ? 'EIP-2612' : `non-EIP-2612 (${typehash})`,
      digest: permitDomainKey(name, version, t.chainId, t.address),
    }),
  );
}
process.exit(failed ? 1 : 0);
