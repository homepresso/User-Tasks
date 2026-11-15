# UserTasks on-premises gateway (Linux container). Build from the repository root:
#   docker build -f packages/gateway/Dockerfile -t usertasks-gateway .
# Run (configuration read-only, key + registration in a volume):
#   docker run -d --name usertasks-gateway --restart unless-stopped --stop-timeout 90 \
#     -v usertasks-gateway:/var/lib/usertasks-gateway \
#     -v $PWD/gateway.json:/etc/usertasks-gateway/gateway.json:ro \
#     -e UTGW_REGISTRATION_TOKEN=utgwr_… usertasks-gateway register-and-run
FROM node:20-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/gateway/package.json packages/gateway/
RUN npm ci --workspace @user-tasks/gateway --include-workspace-root=false --ignore-scripts
COPY lib/gateway/protocol.ts lib/gateway/
COPY lib/integrations/windows-auth lib/integrations/windows-auth/
COPY packages/gateway packages/gateway/
RUN cd packages/gateway && npx tsup

FROM node:20-alpine
ENV NODE_ENV=production UTGW_STATE_DIR=/var/lib/usertasks-gateway UTGW_CONFIG=/etc/usertasks-gateway/gateway.json
RUN mkdir -p /var/lib/usertasks-gateway /etc/usertasks-gateway && chown node:node /var/lib/usertasks-gateway
COPY --from=build /src/packages/gateway/dist/usertasks-gateway.mjs /opt/usertasks-gateway/usertasks-gateway.mjs
USER node
VOLUME ["/var/lib/usertasks-gateway"]
HEALTHCHECK --interval=30s --timeout=5s CMD node /opt/usertasks-gateway/usertasks-gateway.mjs status >/dev/null || exit 1
ENTRYPOINT ["node", "/opt/usertasks-gateway/usertasks-gateway.mjs"]
CMD ["run"]
