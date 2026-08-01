#!/bin/bash

  USERID="${USER}"
  if [[ "${USERID}" == "root" ]]; then
    USERID="${SUDO_USER}" 
  fi

  GIT_HUB_API="https://api.github.com/repos/official-stockfish"
  ENGINE_NAME="Stockfish"
  TAG_URL="${GIT_HUB_API}/${ENGINE_NAME}/releases/latest"
  DOWNLOAD_URL="https://github.com/official-stockfish/Stockfish/archive/refs/tags"

  # --
  APP_NAME="Magnus"
  APP_PATH="/home/${USERID}/src/${APP_NAME}"

  ENGINE_PATH="/home/${USERID}/src/${ENGINE_NAME}"
  mkdir -p ${ENGINE_PATH}

  LATEST_TAG=$(curl -s ${TAG_URL} | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
  if [ -z ${LATEST_TAG} ]; then
    echo "Error: Unable to determine latest tag. Exiting."
    exit 1
  fi

  echo "Installing ${ENGINE_NAME} ${LATEST_TAG}"

  TARGET_DIR="${ENGINE_PATH}/${LATEST_TAG}"
  if [ -d ${TARGET_DIR} ]; then
    echo "Tag: ${LATEST_TAG} already found. Nothing to do."
    exit 0
  fi

  curl -L -o "${ENGINE_PATH}/${ENGINE_NAME}-${LATEST_TAG}.tar.gz"  "${DOWNLOAD_URL}/${LATEST_TAG}.tar.gz"

  mkdir -p ${TARGET_DIR}
  tar -xzf "${ENGINE_PATH}/${ENGINE_NAME}-${LATEST_TAG}.tar.gz" -C "$TARGET_DIR" --strip-components=1


  SYMLINK="${ENGINE_PATH}/current_version"
  rm -f ${SYMLINK}

  ln -sf "${TARGET_DIR}" "$SYMLINK"
  chown "$USERID:$USERID" "$SYMLINK"

  cd ${TARGET_DIR}/src/ && make -j profile-build ARCH=native

  sudo chown -R "$USERID:$USERID" "${ENGINE_PATH}"


