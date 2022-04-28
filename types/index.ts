import { BigNumber, BigNumberish } from 'ethers'

export enum Side {
  BUY,
  SELL,
}

export interface Position {
  tickUpper: number
  tickLower: number
  vTokenAmount: BigNumber
}

export interface NetRagePosition {
  netSide: Side
  netTokenPosition: Position
  availableMargin: BigNumberish
  accountMarketValue: BigNumberish
  lastUpdated: Date | BigNumberish
  lastTradedFundingRate: BigNumberish
}

export interface NetFtxPosition {
  netSide: Side
  availableMargin: BigNumberish
  netTokenPosition: BigNumberish
  accountMarketValue: BigNumberish
  lastUpdated: Date | BigNumberish
  lastTradedFundingRate: BigNumberish
}
