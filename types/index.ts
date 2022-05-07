import { BigNumber } from 'ethers'
import { OrderSide } from 'ftx-api'

export interface NetRagePosition {
  availableMargin: BigNumber
  netTraderPosition: BigNumber
  accountMarketValue: BigNumber
}

export interface NetFtxPosition {
  netSide: OrderSide
  availableMargin: Number
  netTraderPosition: Number
  accountMarketValue: Number
}
