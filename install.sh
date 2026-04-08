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

  # --
  APP_NAME="Magnus"
  APP_OWNER="yparsak"
  # --
  GIT_REPO="https://github.com"
  GIT_API="https://api.github.com/repos"
  APP_REPO_URL="$GIT_REPO/${APP_OWNER}/${APP_NAME}/${APP_NAME}.git"
  ENGINE_NAME="stockfish"
  ENGINE_REPO_URL="$GIT_REPO/official-stockfish/Stockfish"
  ENGINE_API_URL="$GIT_API/official-stockfish/Stockfish/releases/latest"

  if [ -z $SUDO_HOME ]; then
    MYHOME="$HOME"
  else
    MYHOME="$SUDO_HOME"
  fi



