#!/bin/bash

  # -- Functions ----------------------------------------------------------
  check_password() {
    local pwd=$1
    # Check length (>8), numbers, uppercase, and special characters
    if [[ ${#pwd} -le 8 ]] || [[ ! "$pwd" =~ [0-9] ]] || \
       [[ ! "$pwd" =~ [A-Z] ]] || [[ ! "$pwd" =~ ['!@#$%^&*()_+'] ]]; then
        return 1
    fi
    return 0
  }
  generate_secret() {
    if command -v openssl >/dev/null 2>&1; then
      openssl rand -hex 32
    else
      head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
    fi
  }
  # -----------------------------------------------------------------------

  APP_NAME="Magnus"
  APP_OWNER="yparsak"
  ENGINE_NAME="Stockfish"
  DB_PORT=3306

  LI_USER_API="https://lichess.org/api/games/user"
  CHESSCOM_USER_API="https://api.chess.com/pub/player"

  GIT_REPO="https://github.com"
  GIT_API="https://api.github.com/repos"

  MYHOME="/home/$SUDO_USER"
  SRC_PATH="$MYHOME/src"
  APP_PATH="$SRC_PATH/$APP_NAME"
  APP_DOTENV="${APP_PATH}/app/.env"
  SCR_DOTENV="${APP_PATH}/scripts/.env"

  ENGINE_SRC_PATH="$SRC_PATH/$ENGINE_NAME"

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
  REQUIRED_PKGS=("build-essential" "nodejs" "npm" "curl" "mariadb-server" "zstd" "openssl")
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

  # -- DOTENV
  APP_DOTENV="${APP_PATH}/app/.env"

  if [ -f "${APP_DOTENV}" ]; then
    source "${APP_DOTENV}"
  fi

  # -- DB Password
  if [[ -z "${DB_PASSWORD}" ]]; then
    while true; do
      read -s -p "Enter Database Password: " INPUT_PASS
      echo ""
      if [[ -z "$INPUT_PASS" ]]; then
        echo "Exiting.."; exit 0
      fi
      if check_password "$INPUT_PASS"; then
        break
      else
        echo "Password weak! Must have >8 chars, a number, uppercase, and special char."
      fi
    done
    DB_PASSWORD="$INPUT_PASS"
  fi

  # -- User Agent for API
  if [[ -z "$USER_AGENT" ]]; then
    read -p "Please enter email for application: " APP_EMAIL
    USER_AGENT="${APP_NAME}_contact:${APP_EMAIL}"
  fi

  # -- App Port Number
  if [[ -z "$PORT" ]]; then
    while true; do
      read -p "Enter port number for Magnus to listen on (3000-5000) [default: 3000]: " INPUT_PORT
      # Default to 3000 if the user just presses Enter
      if [[ -z "$INPUT_PORT" ]]; then
        INPUT_PORT=3000
      fi
      # Validate: must be a whole number between 3000 and 5000 inclusive
      if [[ "$INPUT_PORT" =~ ^[0-9]+$ ]] && [ "$INPUT_PORT" -ge 3000 ] && [ "$INPUT_PORT" -le 5000 ]; then
        PORT="$INPUT_PORT"
        break
      else
        echo "Invalid port. Please enter a number between 3000 and 5000."
      fi
    done
  fi

  SECRET="$(generate_secret)"

  echo "PORT=${PORT}"                                    > "${APP_DOTENV}"
  echo "DB_HOST=localhost"                              >> "${APP_DOTENV}"
  echo "DB_PORT=${DB_PORT}"                             >> "${APP_DOTENV}"
  echo "DB_USER=${SUDO_USER,,}"                         >> "${APP_DOTENV}"
  echo "DB_NAME=${APP_NAME}"                            >> "${APP_DOTENV}"
  echo "DB_PASSWORD=${DB_PASSWORD}"                     >> "${APP_DOTENV}"
  echo "USER_AGENT=${USER_AGENT}"                       >> "${APP_DOTENV}"
  echo "ENGINE_SRC_PATH=${ENGINE_SRC_PATH}"             >> "${APP_DOTENV}"
  echo "ENGINE_PATH=/usr/local/bin/${ENGINE_NAME,,}"    >> "${APP_DOTENV}"
  echo "LOGFILE=${LOGFILE}"                             >> "${APP_DOTENV}"
  echo "SESSION_SECRET=${SECRET}"                       >> "${APP_DOTENV}"

  cp ${APP_DOTENV} ${SCR_DOTENV}

  # -- Setting up database
  echo "Setting up database"

  sudo mariadb -e "CREATE DATABASE IF NOT EXISTS \`${APP_NAME}\`;"
  sudo mariadb -e "CREATE USER IF NOT EXISTS '${SUDO_USER,,}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';"
  sudo mariadb -e "GRANT ALL PRIVILEGES ON \`${APP_NAME}\`.* TO '${SUDO_USER,,}'@'localhost';"
  sudo mariadb -e "FLUSH PRIVILEGES;"

  # -- Import SQL schema & data
  if [ -d $APP_PATH/sql ]; then
    for sql_file in "$APP_PATH/sql"/*.sql; do
      mysql -u"${SUDO_USER}" -p"$DB_PASSWORD" "${APP_NAME}" < "$sql_file"
      if [ $? -eq 0 ]; then
        echo "[>] Successfully imported: $sql_file"
      else
        echo "[>] Error importing :  $sql_file"
        exit 1
      fi
    done
  fi

  sudo chown -R "$SUDO_USER:$SUDO_USER" ${APP_PATH}

  cd $APP_PATH/app && make
  cd $APP_PATH/scripts && make

  #echo "Adding user to database"
  #cd $APP_PATH/scripts && node adduser.js

  ${APP_PATH}/scripts/install_engine.sh

  sudo cp ${ENGINE_SRC_PATH}/current_version/src/${ENGINE_NAME,,} ${ENGINE_SRC_PATH}/current_version/.
  sudo ln -sf ${ENGINE_SRC_PATH}/current_version/${ENGINE_NAME,,} /usr/local/bin/${ENGINE_NAME,,}
  sudo chown "$SUDO_USER:$SUDO_USER" /usr/local/bin/${ENGINE_NAME,,}

  sudo ln -sf ${APP_PATH}/scripts/${APP_NAME,,} /usr/local/bin/${APP_NAME,,}
  sudo chown "$SUDO_USER:$SUDO_USER" /usr/local/bin/${APP_NAME,,}

  echo "Done"

