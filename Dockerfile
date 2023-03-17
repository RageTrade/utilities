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
COPY config-env.ts ./config-env.ts
COPY ecosystem.config.js ./ecosystem.config.js

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
COPY config-env.ts ./config-env.ts
COPY ecosystem.config.js ./ecosystem.config.js

CMD [ "pm2-runtime", "ecosystem.config.js", "--only", "vault-rebalance" ]

# usdc batching manager
FROM node:17.9.0-alpine3.15 as usdc-batching-manager

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
WORKDIR /home/node/app

COPY package.json ./
COPY yarn.lock ./

USER node

ENV PATH="/home/node/.yarn/bin:${PATH}"

RUN yarn global add pm2
RUN yarn install --frozen-lockfile

COPY dist ./dist
COPY config-env.ts ./config-env.ts
COPY ecosystem.config.js ./ecosystem.config.js

CMD [ "pm2-runtime", "ecosystem.config.js", "--only", "usdc-batching-manager" ]

# glp batching manager
FROM node:17.9.0-alpine3.15 as glp-batching-manager

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
WORKDIR /home/node/app

COPY package.json ./
COPY yarn.lock ./

USER node

ENV PATH="/home/node/.yarn/bin:${PATH}"

RUN yarn global add pm2
RUN yarn install --frozen-lockfile

COPY dist ./dist
COPY config-env.ts ./config-env.ts
COPY ecosystem.config.js ./ecosystem.config.js

CMD [ "pm2-runtime", "ecosystem.config.js", "--only", "glp-batching-manager" ]

# dn rebalance
FROM node:17.9.0-alpine3.15 as dn-rebalance

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
WORKDIR /home/node/app

COPY package.json ./
COPY yarn.lock ./

USER node

ENV PATH="/home/node/.yarn/bin:${PATH}"

RUN yarn global add pm2
RUN yarn install --frozen-lockfile

COPY dist ./dist
COPY config-env.ts ./config-env.ts
COPY ecosystem.config.js ./ecosystem.config.js

CMD [ "pm2-runtime", "ecosystem.config.js", "--only", "dn-rebalance" ]

# hedge strategy
FROM node:17.9.0-alpine3.15 as hedge-strategy

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
WORKDIR /home/node/app

COPY package.json ./
COPY yarn.lock ./

USER node

ENV PATH="/home/node/.yarn/bin:${PATH}"

RUN yarn global add pm2
RUN yarn install --frozen-lockfile

COPY dist ./dist
COPY config-env.ts ./config-env.ts
COPY ecosystem.config.js ./ecosystem.config.js

CMD [ "pm2-runtime", "ecosystem.config.js", "--only", "hedge-strategy" ]
