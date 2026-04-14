#!/bin/bash

  if [[ $EUID -ne 0 ]]; then
    echo "Error: This script requires root privileges. Please use 'sudo'."
    exit 1
  fi
  if [[ -z "$SUDO_USER" || "$SUDO_USER" == "root" ]]; then
    echo "Warn: Running directly as root is discouraged."
    echo "Please run this as a regular user using 'sudo'."
    exit 1
  fi

  MYHOME="$SUDO_HOME"
  ENGINE_NAME="Stockfish"

  # --
  GIT_REPO="https://github.com"
  GIT_API="https://api.github.com/repos"

  # --
  ENGINE_REPO_URL="$GIT_REPO/official-${ENGINE_NAME,,}/$ENGINE_NAME"
  ENGINE_API_URL="$GIT_API/official-${ENGINE_NAME,,}/$ENGINE_NAME/releases/latest"

  ENGINE_SRC_PATH="$SRC_PATH/$ENGINE_NAME"
  USRLOCALBIN="/usr/local/bin/"

  # -- Install Stockfish
  echo "Checking $ENGINE_NAME latest version"
  LATEST_TAG=$(curl -s $ENGINE_API_URL | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
  VERSION=$(echo "$LATEST_TAG" | grep -o -E '[0-9]+' | head -1)
  if [[ -z ${VERSION} ]]; then
    echo "Err: Unable to determine latest tag version for $ENGINE_NAME"
    exit 1
  fi

  TARGET_DIR="$ENGINE_SRC_PATH/$VERSION"
  if [ -d "$TARGET_DIR" ]; then
    echo "[>] $ENGINE_NAME version ${VERSION} is already present."
  else
    mkdir -p "$TARGET_DIR"
    chown "$SUDO_USER:$SUDO_USER" "$TARGET_DIR"

    if [ -z "$TARGET_DIR" ]; then
      echo "[X] $TARGET_DIR is not set."
      exit 1
    fi

    # -- download engine
    git clone --depth 1 --branch "$LATEST_TAG" "$ENGINE_REPO_URL" "$TARGET_DIR"

    cd "$TARGET_DIR/src" || { echo "[X] Failed to enter directory $TARGET_DIR/src"; exit 1; }

    make -j profile-build ARCH=native

    if [ $? -ne 0 ]; then
      echo "[X] $ENGINE_NAME $VERSION installation failed during the build process."
      exit 1
    fi

    chown "$SUDO_USER:$SUDO_USER" ${ENGINE_NAME,,}
    chmod +x ${ENGINE_NAME,,}
    sudo mv ${ENGINE_NAME,,} ${USRLOCALBIN}

    cd "$ENGINE_SRC_PATH"
    SYMLINK="$ENGINE_SRC_PATH/current_version"
    rm -f "$SYMLINK"

    ln -s "$TARGET_DIR" "$SYMLINK"
    chown "$SUDO_USER:$SUDO_USER" "$SYMLINK"

    echo "[>] $ENGINE_NAME $VERSION installation complete"
  fi
  
