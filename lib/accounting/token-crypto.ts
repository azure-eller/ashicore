import "server-only";

import {
  decryptXeroToken,
  encryptXeroToken,
  getXeroTokenEncryptionKeyId,
  isEncryptedXeroToken,
} from "@/lib/xero/token-crypto";

export const decryptAccountingToken = decryptXeroToken;
export const encryptAccountingToken = encryptXeroToken;
export const getAccountingTokenEncryptionKeyId = getXeroTokenEncryptionKeyId;
export const isEncryptedAccountingToken = isEncryptedXeroToken;
