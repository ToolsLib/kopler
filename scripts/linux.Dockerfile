FROM rust:1.97.1-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential pkg-config libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
    librsvg2-dev libssl-dev libxdo-dev patchelf xvfb dbus-x11 xdotool openbox procps \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /work
COPY --from=node:24-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:24-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && apt-get update && apt-get install -y --no-install-recommends file libfuse2 x11-utils \
    && rm -rf /var/lib/apt/lists/*
