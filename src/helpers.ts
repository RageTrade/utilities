import Ftx from './ftx'
import RageTrade from './rage-trade'

export const isMovementWithinSpread = (pFtx: number, pRage: number, pFinal: number): boolean => {
  if ((pFtx > pRage && pFinal < pRage) || (pFtx < pRage && pFinal > pRage)) {
    return true
  }

  return false
}

export const calculateFinalPrice = async (pFtx: number, pRage: number, ftxFee: number, rageFee: number) => {
  let sign
  pRage - pFtx > 0 ? sign = 1 : sign = (-1)

  return pFtx * (1 + ftxFee * sign) / (1 - rageFee * sign)
}
