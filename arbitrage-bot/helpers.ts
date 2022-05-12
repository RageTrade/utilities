/** checks whether price difference is within spread */
export const isMovementWithinSpread = (
  pFtx: number,
  pRage: number,
  pFinal: number
): boolean => {
  if ((pFtx > pRage && pFinal < pRage) || (pFtx < pRage && pFinal > pRage)) {
    return true
  }

  return false
}

/** calculates the final price on Rage after all the arbitrage has been taken up */
export const calculateFinalPrice = (
  pFtx: number,
  pRage: number,
  ftxFee: number,
  rageFee: number
) => {
  let sign
  pRage - pFtx > 0 ? (sign = 1) : (sign = -1)

  return (pFtx * (1 + ftxFee * sign)) / (1 - rageFee * sign)
}

/** calculates amount of tokens arb will make before gas cost */
export const calculateArbRevenue = (
    pFtx: number,
    potentialArbSize: number,
    ethPriceReceived: number,
    ftxFee: number
) => {
  return - potentialArbSize * (ethPriceReceived - pFtx * (1 - ftxFee * Math.sign(potentialArbSize)))
}