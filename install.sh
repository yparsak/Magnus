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
  ENGINE_NAME="stockfish"

  # --
  GIT_REPO="https://github.com"
  GIT_API="https://api.github.com/repos"

  # --
  APP_REPO_URL="$GIT_REPO/${APP_OWNER}/${APP_NAME}/${APP_NAME}.git"
  # --
  ENGINE_REPO_URL="$GIT_REPO/official-stockfish/Stockfish"
  ENGINE_API_URL="$GIT_API/official-stockfish/Stockfish/releases/latest"

  if [ -z $SUDO_HOME ]; then
    MYHOME="$HOME"
  else
    MYHOME="$SUDO_HOME"
  fi

  SRC_PATH="$MYHOME/src"
  APP_PATH="$SRC_PATH/$APP_NAME"
  ENGINE_PATH="$SRC_PATH/$ENGINE_NAME"
  ENV_FILE="$APP_PATH/scripts/.env"

  # -- Required Packages
  REQUIRED_PKGS=("build-essential" "apache2" "php" "nodejs" "npm" "curl" "git" "openssh-server" "mariadb-server")
  MISSING_PKGS=()

  if [ ${#MISSING_PKGS[@]} -eq 0 ]; then
    echo "[>] All required packages are already installed. Nothing to do!"
  else
    echo "Installing missing packages"

    if [[ $EUID -ne 0 ]]; then
      echo "Error: This script requires root privileges. Please use 'sudo'."
      exit 1
    fi
    if [[ -z ${SUDO_USER} ]]; then
      echo "Warn: Running directly as root is discouraged."
      echo "Please run this as a regular user using 'sudo'."
      exit 1
    fi

    # -- Update repositories
    sudo apt-get update -y > /dev/null    


    while true; do
      echo "Packages: ${MISSING_PKGS[@]}"
      read -p "Do you want to install (Y/N): " choice
      choice=${choice^^}
      case "$choice" in
        Y)
            echo "Proceeding with installation of: $PACKAGE"
            # Logic to install goes here
            break # Exit the loop
            ;;
        N)
            echo "Installation cancelled. Exiting..."
            exit 0 # Exit the script entirely
            ;;
        *)
            echo "Invalid entry: '$choice'. Please type Y or N."
            echo "------------------------------------------"
            ;;
      esac
    done

    # -- Install
    sudo apt-get install -y "${MISSING_PKGS[@]}"

    if [ $? -eq 0 ]; then
      echo "All missing packages installed successfully."
    else
      echo "Error: There was an error during the installation process."
      exit 1
    fi
  fi

  # -- Verify Missing Packages Installed
  if [ ${#MISSING_PKGS[@]} -ne 0 ]; then
    for PKG in "${REQUIRED_PKGS[@]}"; do
      if dpkg-query -W -f='${Status}' "$PKG" 2>/dev/null | grep -q "ok installed"; then
        echo "[>] $PKG is present."
      else
        echo "[X] $PKG is missing."
        exit 1
      fi
    done
  fi
  


