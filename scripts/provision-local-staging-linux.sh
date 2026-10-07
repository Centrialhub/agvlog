#!/usr/bin/env bash
# Reviewed for a NEW, dedicated Ubuntu 24.04 amd64 WSL 2 distribution.
# Installs tools only. Does not copy application files or start Supabase/containers.
set -Eeuo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
export DEBIAN_FRONTEND=noninteractive
umask 022

die() { printf '%s\n' "$*" >&2; exit 1; }
[[ $# == 0 ]] || die 'This provisioner accepts no arguments.'
[[ $EUID == 0 ]] || die 'Run as root inside the dedicated Ubuntu distribution.'
[[ $(uname -s) == Linux ]] || die 'Linux is required.'
grep -qi microsoft /proc/sys/kernel/osrelease || die 'This provisioner is scoped to WSL 2.'
# shellcheck source=/dev/null
source /etc/os-release
[[ ${ID:-} == ubuntu && ${VERSION_ID:-} == 24.04 && ${VERSION_CODENAME:-} == noble ]] || die 'Ubuntu 24.04 noble is required.'
[[ $(dpkg --print-architecture) == amd64 ]] || die 'Only the reviewed amd64 packages are supported.'
[[ $(cat /proc/1/comm) == systemd ]] || die 'Enable systemd in this WSL distribution and restart it before provisioning.'

runtime=/opt/agvlog-staging-runtime
repo_source=/etc/apt/sources.list.d/docker.sources
key_path=/etc/apt/keyrings/docker.asc
node_sha=d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307
npm_sha=4bfba8a0c823024d1926ec9d97a37a00eb60fd2adf44b3d34a686fc32e8f51e4
key_sha=1500c1f56fa9e26b9b8f42452a553675796ade0807cdce11975eb98170b3a570
packages=(docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin)
versions=('5:29.8.1-1~ubuntu.24.04~noble' '5:29.8.1-1~ubuntu.24.04~noble' '2.3.6-1~ubuntu.24.04~noble' '0.37.1-1~ubuntu.24.04~noble' '5.5.1-1~ubuntu.24.04~noble')

for path in /opt /etc/apt /etc/apt/sources.list.d /etc/apt/keyrings "$runtime" "$repo_source" "$key_path" /home/agvqa /home/agvqa/agvlog-main; do
  [[ ! -L $path ]] || die "Refusing symbolic link: $path"
done
for path in /etc/docker/daemon.json /etc/systemd/system/docker.service /etc/systemd/system/docker.socket /etc/systemd/system/docker.service.d /etc/systemd/system/docker.socket.d; do
  [[ ! -e $path && ! -L $path ]] || die "Existing Docker configuration needs manual review: $path"
done
if [[ -f /etc/default/docker ]] && grep -Eq '^[[:space:]]*[^#[:space:]]' /etc/default/docker; then
  die 'Existing /etc/default/docker settings need manual review.'
fi
for package in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker podman containerd runc; do
  status=$(dpkg-query -W -f='${db:Status-Status}' "$package" 2>/dev/null || true)
  [[ $status != installed ]] || die "Conflicting runtime package present; nothing will be removed: $package"
done
for index in "${!packages[@]}"; do
  installed=$(dpkg-query -W -f='${db:Status-Status} ${Version}' "${packages[$index]}" 2>/dev/null || true)
  [[ $installed != installed\ * || $installed == "installed ${versions[$index]}" ]] || die "Existing package version differs: ${packages[$index]}"
done
for executable in docker dockerd containerd node npm npx; do
  found=$(command -v "$executable" || true)
  if [[ -n $found ]]; then
    case "$executable" in
      docker|dockerd|containerd)
        dpkg-query -S "$found" >/dev/null 2>&1 || die "Unmanaged runtime binary needs manual review: $found"
        ;;
      *) die "Existing Node/npm runtime needs manual review: $found" ;;
    esac
  fi
done
if id agvqa >/dev/null 2>&1; then
  [[ $(getent passwd agvqa | cut -d: -f6) == /home/agvqa ]] || die 'Existing agvqa account has an unexpected home.'
  [[ $(id -u agvqa) -ge 1000 && $(id -u agvqa) -ne 65534 ]] || die 'Existing agvqa account is not a normal user.'
else
  [[ ! -e /home/agvqa ]] || die 'The agvqa home already exists without its user.'
fi

scratch=$(mktemp -d /var/tmp/agvlog-runtime.XXXXXXXX)
cleanup() {
  case "$scratch" in /var/tmp/agvlog-runtime.*) [[ -d $scratch && ! -L $scratch ]] && rm -rf -- "$scratch" ;; esac
}
trap cleanup EXIT
cat > "$scratch/docker.sources" <<'EOF'
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
EOF
cat > "$scratch/runtime-manifest.txt" <<EOF
scope=agvlog-local-staging-tools-only
node=22.23.2
node_archive_sha256=$node_sha
npm=10.9.4
npm_archive_sha256=$npm_sha
docker_ce=${versions[0]}
docker_cli=${versions[1]}
containerd=${versions[2]}
buildx=${versions[3]}
compose=${versions[4]}
docker_apt_key_sha256=$key_sha
EOF
if [[ -e $repo_source ]]; then
  cmp -s "$scratch/docker.sources" "$repo_source" || die 'Existing Docker apt source differs; refusing overwrite.'
fi
while IFS= read -r source_file; do
  [[ $source_file == "$repo_source" ]] || die "Another Docker apt source needs manual review: $source_file"
done < <(grep -rl 'download\.docker\.com' /etc/apt/sources.list /etc/apt/sources.list.d 2>/dev/null || true)
if [[ -e $key_path ]]; then
  printf '%s  %s\n' "$key_sha" "$key_path" | sha256sum -c - >/dev/null || die 'Existing Docker signing key differs.'
fi
if [[ -e $runtime ]]; then
  [[ -d $runtime && ! -L $runtime/manifest.txt ]] || die 'Existing runtime directory needs review.'
  cmp -s "$scratch/runtime-manifest.txt" "$runtime/manifest.txt" || die 'Existing runtime manifest differs; refusing overwrite.'
  [[ $("$runtime/bin/node" --version) == v22.23.2 ]] || die 'Existing portable Node version differs.'
  [[ $("$runtime/bin/npm" --version) == 10.9.4 ]] || die 'Existing portable npm version differs.'
fi

# All conflict checks above happen before package or system changes.
apt-get update
apt-get install --yes --no-remove --no-install-recommends ca-certificates curl xz-utils git
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 https://download.docker.com/linux/ubuntu/gpg -o "$scratch/docker.asc"
printf '%s  %s\n' "$key_sha" "$scratch/docker.asc" | sha256sum -c -
install -d -m 0755 /etc/apt/keyrings
[[ -e $key_path ]] || install -m 0644 "$scratch/docker.asc" "$key_path"
[[ -e $repo_source ]] || install -m 0644 "$scratch/docker.sources" "$repo_source"
apt-get update
install_packages=()
for index in "${!packages[@]}"; do
  package=${packages[$index]}
  version=${versions[$index]}
  apt-cache madison "$package" | awk -F '|' '{gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2}' | grep -Fx "$version" >/dev/null || die "Pinned package unavailable: $package=$version"
  install_packages+=("$package=$version")
done
# Ubuntu may start its standard Unix-socket Docker service during installation.
# No remote daemon endpoint, published port, network or application container is created here.
apt-get install --yes --no-remove --no-install-recommends "${install_packages[@]}"
for index in "${!packages[@]}"; do
  [[ $(dpkg-query -W -f='${Version}' "${packages[$index]}") == "${versions[$index]}" ]] || die 'Installed Docker package version differs.'
done

if [[ ! -e $runtime ]]; then
  node_archive=node-v22.23.2-linux-x64.tar.xz
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/v22.23.2/$node_archive" -o "$scratch/$node_archive"
  printf '%s  %s\n' "$node_sha" "$scratch/$node_archive" | sha256sum -c -
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 https://registry.npmjs.org/npm/-/npm-10.9.4.tgz -o "$scratch/npm-10.9.4.tgz"
  printf '%s  %s\n' "$npm_sha" "$scratch/npm-10.9.4.tgz" | sha256sum -c -
  mkdir "$scratch/runtime"
  tar -xJf "$scratch/$node_archive" -C "$scratch/runtime" --no-same-owner
  mkdir "$scratch/runtime/npm-10.9.4" "$scratch/runtime/bin"
  tar -xzf "$scratch/npm-10.9.4.tgz" -C "$scratch/runtime/npm-10.9.4" --strip-components=1 --no-same-owner
  ln -s ../node-v22.23.2-linux-x64/bin/node "$scratch/runtime/bin/node"
  for command in npm npx; do
    printf '#!/bin/sh\nexec "%s/bin/node" "%s/npm-10.9.4/bin/%s-cli.js" "$@"\n' "$runtime" "$runtime" "$command" > "$scratch/runtime/bin/$command"
    chmod 0755 "$scratch/runtime/bin/$command"
  done
  install -m 0644 "$scratch/runtime-manifest.txt" "$scratch/runtime/manifest.txt"
  # Fixed, new destination. No system node/npm executable or profile is changed.
  [[ ! -e $runtime && ! -L $runtime ]] || die 'Portable runtime destination appeared during provisioning.'
  mv -T -- "$scratch/runtime" "$runtime"
fi
[[ $("$runtime/bin/node" --version) == v22.23.2 ]] || die 'Portable Node verification failed.'
[[ $("$runtime/bin/npm" --version) == 10.9.4 ]] || die 'Portable npm verification failed.'
if ! id agvqa >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash agvqa
fi
[[ -d /home/agvqa && ! -L /home/agvqa ]] || die 'Expected a regular agvqa home directory.'
if [[ ! -e /home/agvqa/agvlog-main ]]; then
  install -d -m 0755 -o agvqa -g "$(id -gn agvqa)" /home/agvqa/agvlog-main
fi
[[ -d /home/agvqa/agvlog-main && $(stat -c %u /home/agvqa/agvlog-main) == "$(id -u agvqa)" ]] || die 'Project directory ownership needs review.'

printf '\nInstalled tool versions (application not started):\n'
dpkg-query -W -f='${Package} ${Version}\n' "${packages[@]}"
"$runtime/bin/node" --version
"$runtime/bin/npm" --version
/usr/bin/docker compose version
printf '\nUse this PATH explicitly in the dedicated Linux checkout:\nexport PATH=%s/bin:$PATH\n' "$runtime"
printf 'User agvqa has no password or Docker-group grant created by this script.\n'
printf 'Next: review/start the Unix-socket daemon, transfer the exact Git candidate, install dependencies, then verify the isolated staging workdir.\n'
