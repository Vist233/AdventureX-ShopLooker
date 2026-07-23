#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
cd "$script_dir"

eval "$(pyenv init - zsh)"
pyenv shell Agent
python build_site.py

# The local proxy is occasionally unavailable; Cloudflare deployment should use
# the direct authenticated connection already configured for this workspace.
# `wrangler.toml` publishes the static artifact through a Worker and creates the
# custom-domain DNS record/certificate at Cloudflare's edge.
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
  wrangler deploy --config wrangler.toml
