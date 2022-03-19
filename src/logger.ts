import fetch from 'node-fetch';
import { NETWORK_INF0 } from './config'

export const log = async (message: string) => {
  await fetch(NETWORK_INF0.WEBHOOK_URL, {
    method: 'post',
    body: JSON.stringify({ content: message }),
    headers: { 'Content-Type': 'application/json' }
  });

}
