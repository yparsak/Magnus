#!/bin/bash

  APP_NAME="Magnus"
  APP_OWNER="yparsak"
  ENGINE_NAME="Stockfish"

  GIT_REPO="https://github.com"
  GIT_API="https://api.github.com/repos"

  MYHOME="/home/$SUDO_USER"
  SRC_PATH="$MYHOME/src"
  APP_PATH="$SRC_PATH/$APP_NAME"
  ENGINE_SRC_PATH="$SRC_PATH/$ENGINE_NAME"
  ENV_FILE="$APP_PATH/scripts/.env"

  APP_REPO_URL="$GIT_REPO/${APP_OWNER}/${APP_NAME}/${APP_NAME}.git"
  APP_API_URL="$GIT_API/${APP_OWNER}/${APP_NAME}/releases/latest"

  ENGINE_REPO_URL="$GIT_REPO/official-${ENGINE_NAME,,}/$ENGINE_NAME"
  ENGINE_API_URL="$GIT_API/official-${ENGINE_NAME,,}/$ENGINE_NAME/releases/latest"

  USRLOCALBIN="/usr/local/bin/"
  LOGFILE="/tmp/${APP_NAME}.log"

  SF_PATH="$SRC_PATH/$ENGINE_NAME"

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

  # -- Download Required Packages
  REQUIRED_PKGS=("build-essential" "nodejs" "npm" "curl" "mariadb-server" "zstd")
  MISSING_PKGS=()

  echo "Checking required packages"

  # -- detect missing packages
  for PKG in "${REQUIRED_PKGS[@]}"; do
    if dpkg-query -W -f='${Status}' "$PKG" 2>/dev/null | grep -q "ok installed"; then
      echo "  [>] $PKG is present."
    else
      echo "  [X] $PKG is missing."
      MISSING_PKGS+=("$PKG") 
    fi
  done  

  # -- Install Missing Packages
  if [ ${#MISSING_PKGS[@]} -eq 0 ]; then
    echo "All required packages are already installed. Nothing to do!"
  else
    echo "Installing missing packages"

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
        echo "  [>] $PKG is present."
      else
        echo "  [X] $PKG is missing."
        exit 1
      fi
    done
  fi  

  # -- Setting up directories
  sudo mkdir -p "${SRC_PATH}" 
  sudo mkdir -p "${ENGINE_SRC_PATH}"
  sudo chown "$SUDO_USER:$SUDO_USER" ${SRC_PATH}
  sudo chown "$SUDO_USER:$SUDO_USER" ${ENGINE_SRC_PATH}

  if [ ! -d "$APP_PATH" ]; then

    # -- Installing the App
    sudo mkdir -p "${APP_PATH}"
    sudo chown "$SUDO_USER:$SUDO_USER" ${APP_PATH}

    RESPONSE=$(curl -sL $APP_API_URL)
    DOWNLOAD_URL=$(echo "$RESPONSE" | grep -oP '"tarball_url":\s*"\K[^"]+')
    TAG_NAME=$(echo "$RESPONSE" | grep -oP '"tag_name":\s*"\K[^"]+')

    if [ -z "$DOWNLOAD_URL" ]; then
      echo "Error: Could not parse the download URL. Check your connection or GitHub API limits."
      exit 1
    fi
    echo "Downloading $DOWNLOAD_URL Tag: $TAG_NAME"

    FILENAME="$APP_NAME-$TAG_NAME.tar.gz"
    FULL_PATH="$APP_PATH/$FILENAME" 

    # -- downloading ...

    curl -L "$DOWNLOAD_URL" -o "$FULL_PATH"

    if [ -f "$FULL_PATH" ]; then
      # -- Extract
      tar -zxf "$FULL_PATH" -C "$APP_PATH" --strip-components=1

      if [ $? -eq 0 ]; then
        echo "Extraction successful. Removing archive..."
        rm "$FULL_PATH" 
        echo "Version: $TAG_NAME" > ${APP_PATH}/version
      else
        echo "Error: Extraction failed."
        exit 1 
      fi 
    else
      echo "Error: Download failed."
      exit 1
    fi
  fi

  # -- Install Engine
  sudo mkdir -p "$SF_PATH"

  echo "Getting ${ENGINE_NAME} Latest Tag info"

  LATEST_TAG=$(curl -s $ENGINE_API_URL | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
  if [ -z ${LATEST_TAG} ]; then
    echo "Error: Unable to determine ${ENGINE_NAME} latest tag. Exiting."
    exit 1
  fi

  TARGET_DIR="${SF_PATH}/${LATEST_TAG}"
  if [ -d ${TARGET_DIR} ]; then
    echo "${ENGINE_NAME} ${LATEST_TAG} already found. Skipping install."
    exit 0
  fi

  echo "Downloading ${ENGINE_NAME} Latest Tag: ${LATEST_TAG}"

  curl -L -o "${SF_PATH}/${ENGINE_NAME}-${LATEST_TAG}.tar.gz" "${ENGINE_REPO_URL}/archive/refs/tags/${LATEST_TAG}.tar.gz"

  sudo mkdir -p ${TARGET_DIR}
  tar -xzf "${SF_PATH}/${ENGINE_NAME}-${LATEST_TAG}.tar.gz" -C "$TARGET_DIR" --strip-components=1

  SYMLINK="${SF_PATH}/current_version"
  sudo rm -f ${SYMLINK}

  ln -sf "${TARGET_DIR}" "$SYMLINK"
  sudo chown "$SUDO_USER:$SUDO_USER" "$SYMLINK"

  echo "Installing ${ENGINE_NAME} Tag: ${LATEST_TAG}"
  cd ${TARGET_DIR}/src/ && make -j profile-build ARCH=native

  sudo chown -R "$SUDO_USER:$SUDO_USER" "${SF_PATH}"
  
  cp ${TARGET_DIR}/src/stockfish /usr/local/bin/.

  echo "Done"

 
