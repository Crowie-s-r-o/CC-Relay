#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
release_tag="${1:?Usage: ./build-and-push.sh unique-release-tag}"
[[ "$release_tag" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$ ]] || exit 2
remote="pati@144.76.107.210"
local_image="vibeide:$release_tag"
remote_image="localhost:5000/vibeide:$release_tag"
render_dir=$(mktemp -d)
trap 'rm -rf "$render_dir"' EXIT
docker buildx build --platform linux/amd64 -f Dockerfile.prod -t "$local_image" --load .
docker save "$local_image" | ssh -o BatchMode=yes "$remote" "docker load >/dev/null && docker tag '$local_image' '$remote_image' && docker push '$remote_image'"
for file in k8s/*.yaml; do
  sed "s/RELEASE_TAG/$release_tag/g" "$file" > "$render_dir/$(basename "$file")"
done
ssh -o BatchMode=yes "$remote" "mkdir -p ~/vibeide-dev-k8s"
scp -q "$render_dir/"*.yaml "$remote:vibeide-dev-k8s/"
ssh -o BatchMode=yes "$remote" 'kubectl --kubeconfig=$HOME/.kube/config apply -f ~/vibeide-dev-k8s/namespace.yaml && kubectl --kubeconfig=$HOME/.kube/config apply -f ~/vibeide-dev-k8s/ && kubectl --kubeconfig=$HOME/.kube/config -n vibeide-dev rollout status deployment/vibeide --timeout=240s'
