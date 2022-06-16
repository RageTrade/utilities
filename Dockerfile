# keeper-liquidation
FROM node:17.9.0-alpine3.15 as keeper-liquidation

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
WORKDIR /home/node/app

COPY package.json ./
COPY yarn.lock ./

USER node

ENV PATH="/home/node/.yarn/bin:${PATH}"

RUN yarn global add pm2
RUN yarn install --frozen-lockfile

COPY dist ./dist
COPY config.ts ./config.ts

CMD [ "pm2-runtime", "ecosystem.config.js", "--only", "keeper-liquidation" ]

# vault-rebalance
FROM node:17.9.0-alpine3.15 as vault-rebalance

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
WORKDIR /home/node/app

COPY package.json ./
COPY yarn.lock ./

USER node

ENV PATH="/home/node/.yarn/bin:${PATH}"

RUN yarn global add pm2
RUN yarn install --frozen-lockfile

COPY dist ./dist
COPY config.ts ./config.ts

CMD [ "pm2-runtime", "ecosystem.config.js", "--only", "vault-rebalance" ]

# arb-bot
FROM node:17.9.0-alpine3.15 as arb-bot

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
WORKDIR /home/node/app

COPY package.json ./
COPY yarn.lock ./

USER node

ENV PATH="/home/node/.yarn/bin:${PATH}"

RUN yarn global add pm2
RUN yarn install --frozen-lockfile

COPY dist ./dist
COPY config.ts ./config.ts

CMD [ "pm2-runtime", "ecosystem.config.js", "--only", "arb-bot" ]
