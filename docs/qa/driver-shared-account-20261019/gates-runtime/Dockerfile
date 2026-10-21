FROM docker:29.8.1-dind AS docker-engine
FROM node:22.23.2-bookworm
COPY --from=docker-engine /usr/local/bin/docker /usr/local/bin/dockerd /usr/local/bin/containerd /usr/local/bin/containerd-shim-runc-v2 /usr/local/bin/ctr /usr/local/bin/runc /usr/local/bin/docker-proxy /usr/local/bin/docker-init /usr/local/bin/
RUN apt-get update && apt-get install -y --no-install-recommends iptables procps postgresql-client python3 \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global npm@10.9.4 --ignore-scripts --no-audit --no-fund
ENTRYPOINT ["dockerd", "--host=unix:///var/run/docker.sock", "--storage-driver=vfs"]
