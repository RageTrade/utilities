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
COPY config-env.ts ./config-env.ts
COPY ecosystem.config.js ./ecosystem.config.js

CMD [ "pm2-runtime", "ecosystem.config.js", "--only", "arb-bot" ]
