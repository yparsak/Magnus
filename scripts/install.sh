#!/bin/bash

  # -- Functions -----
  check_password() {
    local pwd=$1
    # Check length (>8), numbers, uppercase, and special characters
    if [[ ${#pwd} -le 8 ]] || [[ ! "$pwd" =~ [0-9] ]] || \
       [[ ! "$pwd" =~ [A-Z] ]] || [[ ! "$pwd" =~ ['!@#$%^&*()_+'] ]]; then
        return 1
    fi
    return 0
  }  

  # -- OS Detection --
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
  else
    echo "Could not detect OS. This script only supports Debian/Ubuntu."
    exit 1
  fi
  echo "Detected OS: $OS"

  # -- Functions -----
  check_password() {
    local pwd=$1
    # Check length (>8), numbers, uppercase, and special characters
    if [[ ${#pwd} -le 8 ]] || [[ ! "$pwd" =~ [0-9] ]] || \
       [[ ! "$pwd" =~ [A-Z] ]] || [[ ! "$pwd" =~ ['!@#$%^&*()_+'] ]]; then
        return 1
    fi
    return 0
  }  

  # -- OS Detection --
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
  else
    echo "Could not detect OS. This script only supports Debian/Ubuntu."
    exit 1
  fi
  echo "Detected OS: $OS"

  MYHOME="/home/$SUDO_USER"

  # --
  APP_NAME="Magnus"
  APP_OWNER="yparsak"
  ENGINE_NAME="Stockfish"

  # --
  GIT_REPO="https://github.com"
  GIT_API="https://api.github.com/repos"

  # --
  APP_REPO_URL="$GIT_REPO/${APP_OWNER}/${APP_NAME}/${APP_NAME}.git"
  APP_API_URL="$GIT_API/${APP_OWNER}/${APP_NAME}/releases/latest"
  # --
  ENGINE_REPO_URL="$GIT_REPO/official-${ENGINE_NAME,,}/$ENGINE_NAME"
  ENGINE_API_URL="$GIT_API/official-${ENGINE_NAME,,}/$ENGINE_NAME/releases/latest"

  SRC_PATH="$MYHOME/src"
  APP_PATH="$SRC_PATH/$APP_NAME"
  ENGINE_SRC_PATH="$SRC_PATH/$ENGINE_NAME"
  ENV_FILE="$APP_PATH/scripts/.env"

  USRLOCALBIN="/usr/local/bin/"
  LOGFILE="/tmp/Magnus.process.log"

  # -- Required Packages
  REQUIRED_PKGS=("build-essential" "nodejs" "npm" "curl" "mariadb-server" "zstd")
  MISSING_PKGS=()

  # -- detect missing packages
  for PKG in "${REQUIRED_PKGS[@]}"; do
    if dpkg-query -W -f='${Status}' "$PKG" 2>/dev/null | grep -q "ok installed"; then
      echo "[>] $PKG is present."
    else
      echo "[X] $PKG is missing."
      MISSING_PKGS+=("$PKG") 
    fi
  done  

  # -- install missing packages
  if [ ${#MISSING_PKGS[@]} -eq 0 ]; then
    echo "[>] All required packages are already installed. Nothing to do!"
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
        echo "[>] $PKG is present."
      else
        echo "[X] $PKG is missing."
        exit 1
      fi
    done
  fi

  # -- Set directories
  sudo mkdir -p "${SRC_PATH}" 
  sudo mkdir -p "${ENGINE_SRC_PATH}"
  sudo chown "$SUDO_USER:$SUDO_USER" ${SRC_PATH}
  sudo chown "$SUDO_USER:$SUDO_USER" ${ENGINE_SRC_PATH}
  
  # -- Install the App
  if [ ! -d "$APP_PATH" ]; then

    sudo mkdir -p "${APP_PATH}"
    sudo chown "$SUDO_USER:$SUDO_USER" ${APP_PATH}

    RESPONSE=$(curl -sL $APP_API_URL)
    DOWNLOAD_URL=$(echo "$RESPONSE" | grep -oP '"tarball_url":\s*"\K[^"]+')
    TAG_NAME=$(echo "$RESPONSE" | grep -oP '"tag_name":\s*"\K[^"]+')

    if [ -z "$DOWNLOAD_URL" ]; then
      echo "Error: Could not parse the download URL. Check your connection or GitHub API limits."
      exit 1
    fi
    echo "$DOWNLOAD_URL $TAG_NAME"

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
      else
        echo "Error: Extraction failed."
        exit 1 
      fi 
    else
      echo "Error: Download failed."
      exit 1
    fi
  fi



















 









 



