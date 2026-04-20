#!/bin/bash

  # -- OS Detection --
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
  else
    echo "Could not detect OS. This script only supports Debian/Ubuntu."
    exit 1
  fi
  echo "Detected OS: $OS"

  if [[ $EUID -ne 0 ]]; then
    echo "Error: This script requires root privileges. Please use 'sudo'."
    exit 1
  fi
  if [[ -z "$SUDO_USER" || "$SUDO_USER" == "root" ]]; then
    echo "Warn: Running directly as root is discouraged."
    echo "Please run this as a regular user using 'sudo'."
    exit 1
  fi

  SF_PATH=$SUDO_HOME/src/Stockfish

  mkdir -p ${SF_PATH}

  LATEST_TAG=$(curl -s https://api.github.com/repos/official-stockfish/Stockfish/releases/latest | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

  if [ -z ${LATEST_TAG} ]; then
    echo "Error: Unable to determine latest tag. Exiting."
    exit 1
  fi

  TARGET_DIR="${SF_PATH}/${LATEST_TAG}"

  if [ -d ${TARGET_DIR} ]; then
    echo "${LATEST_TAG} already found"
    exit 0
  fi

  curl -L -o "${SF_PATH}/Stockfish-${LATEST_TAG}.tar.gz" "https://github.com/official-stockfish/Stockfish/archive/refs/tags/${LATEST_TAG}.tar.gz"

  mkdir -p ${TARGET_DIR}
  tar -xzf "${SF_PATH}/Stockfish-${LATEST_TAG}.tar.gz" -C "$TARGET_DIR" --strip-components=1


  SYMLINK="${SF_PATH}/current_version"
  rm -f ${SYMLINK}
  ln -sf "${TARGET_DIR}" "$SYMLINK"
  chown "$SUDO_USER:$SUDO_USER" "$SYMLINK"

  cd ${TARGET_DIR}/src/ && make -j profile-build ARCH=native

  sudo chown -R "$SUDO_USER:$SUDO_USER" "${SF_PATH}"  

  cp ${TARGET_DIR}/src/stockfish /usr/local/bin/.

