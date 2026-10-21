/**
 * Minimal ABIs for the TRON MerchantPayIn contract + TRC-20 tokens.
 *
 * The contract ABI mirrors the EVM version — same function names, same
 * parameter order. Only the address format differs (TRON uses base58
 * T-prefixed addresses, hex-encoded as 0x41 + 20 bytes on the wire).
 */

export const MERCHANT_PAY_IN_ABI = [
  {
    inputs: [],
    name: 'payInNative',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'token', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    name: 'payInToken',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  // MerchantPayIn V3.2.3 (HP-16 / HP-25): the same pay-ins carrying the gateway's payment
  // reference. Selectors are keccak of the signature, so they are identical to the EVM build:
  // payInNativeWithReference(bytes32) = 0x817da306, payInTokenWithReference(address,uint256,bytes32) = 0xa7d020be.
  {
    inputs: [{ internalType: 'bytes32', name: 'paymentRef', type: 'bytes32' }],
    name: 'payInNativeWithReference',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'token', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
      { internalType: 'bytes32', name: 'paymentRef', type: 'bytes32' },
    ],
    name: 'payInTokenWithReference',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    anonymous: false,
    inputs: [{ indexed: true, internalType: 'bytes32', name: 'paymentRef', type: 'bytes32' }],
    name: 'PaymentReference',
    type: 'event',
  },
] as const;

export const TRC20_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'spender', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'owner', type: 'address' },
      { internalType: 'address', name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;
