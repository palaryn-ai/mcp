FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies (installs gateway from GitHub, postinstall builds it)
RUN npm install

# Copy policy packs and bin shim
COPY policy-packs/ ./policy-packs/
COPY bin/ ./bin/

ENV NODE_ENV=production
ENV POLICY_PACK_PATH=./policy-packs/default.yaml

ENTRYPOINT ["node", "node_modules/palaryn/dist/src/mcp/server.js"]
