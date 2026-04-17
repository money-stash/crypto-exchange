function isValidBitcoinAddress(address) {
  if (!address || typeof address !== 'string') return false;

  const p2pkh = /^[1][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
  const p2sh = /^[3][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
  const bech32 = /^(bc1)[a-z0-9]{39,59}$/;

  return p2pkh.test(address) || p2sh.test(address) || bech32.test(address);
}

function isValidLitecoinAddress(address) {
  if (!address || typeof address !== 'string') return false;

  const p2pkh = /^[L][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
  const p2sh = /^[M][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
  const bech32 = /^(ltc1)[a-z0-9]{39,59}$/;

  return p2pkh.test(address) || p2sh.test(address) || bech32.test(address);
}

function isValidMoneroAddress(address) {
  if (!address || typeof address !== 'string') return false;

  const standard = /^[4][0-9AB][1-9A-HJ-NP-Za-km-z]{93}$/;
  const integrated = /^[4][0-9AB][1-9A-HJ-NP-Za-km-z]{105}$/;
  const subaddress = /^[8][0-9AB][1-9A-HJ-NP-Za-km-z]{93}$/;

  return standard.test(address) || integrated.test(address) || subaddress.test(address);
}

function isValidUsdtTrc20Address(address) {
  if (!address || typeof address !== 'string') return false;

  // TRON (TRC20) base58: starts with T and has 34 chars.
  const trc20 = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
  return trc20.test(address);
}

function validateWalletAddress(address, coin) {
  if (!address || !coin) return false;

  switch (coin.toUpperCase()) {
    case 'BTC':
      return isValidBitcoinAddress(address);
    case 'LTC':
      return isValidLitecoinAddress(address);
    case 'XMR':
      return isValidMoneroAddress(address);
    case 'USDT':
      return isValidUsdtTrc20Address(address);
    default:
      return false;
  }
}

function getValidationErrorMessage(coin) {
  switch (coin.toUpperCase()) {
    case 'BTC':
      return '❌ Неверный адрес Bitcoin. Адрес должен начинаться с 1, 3 или bc1';
    case 'LTC':
      return '❌ Неверный адрес Litecoin. Адрес должен начинаться с L, M или ltc1';
    case 'XMR':
      return '❌ Неверный адрес Monero. Адрес должен начинаться с 4 или 8';
    case 'USDT':
      return '❌ Неверный адрес USDT (TRC20). Адрес должен начинаться с T';
    default:
      return '❌ Неверный адрес кошелька';
  }
}

module.exports = {
  validateWalletAddress,
  getValidationErrorMessage,
  isValidBitcoinAddress,
  isValidLitecoinAddress,
  isValidMoneroAddress,
  isValidUsdtTrc20Address
};
