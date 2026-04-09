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

  if [[ $EUID -ne 0 ]]; then
    echo "Error: This script requires root privileges. Please use 'sudo'."
    exit 1
  fi
  if [[ -z ${SUDO_USER} ]]; then
    echo "Warn: Running directly as root is discouraged."
    echo "Please run this as a regular user using 'sudo'."
    exit 1
  fi

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
  if [ -n "$SUDO_USER" ]; then
    mkdir -p "${SRC_PATH}" 
    mkdir -p "${APP_PATH}"
    mkdir -p "${ENGINE_PATH}"
    chown "$SUDO_USER:$SUDO_USER" ${SRC_PATH}
    chown "$SUDO_USER:$SUDO_USER" ${APP_PATH}
    chown "$SUDO_USER:$SUDO_USER" ${ENGINE_PATH}
  fi
  
  # -- Install the App
  if [ ! -d "$APP_PATH" ]; then

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

  if [ -f "$ENV_FILE" ]; then
    source "$ENV_FILE"
  fi

  # -- Setting User Full Name
  if [[ -z "$USER_NAME" ]]; then
    read -p "Please enter your first name: " USER_NAME
  fi
  if [[ -n $USER_LASTNAME ]];then
    read -p "Please enter your last name: " USER_LASTNAME
  fi
  if [[ -n $USER_EMAIL ]]; then
    read -p "Please enter your email: " USER_EMAIL
  fi

  # -- setting DB_PASS
  if [[ -z "$DB_PASS" ]]; then
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
    DB_PASS="$INPUT_PASS"
  fi

  echo "HOME=$HOME"                                           > "$ENV_FILE"
  echo "DB_HOST=localhost"                                   >> "$ENV_FILE"
  echo "DB_USER=$SUDO_USER"                                  >> "$ENV_FILE"
  echo "DB_PASS=$DB_PASS"                                    >> "$ENV_FILE"
  echo "DB_NAME=$APP_NAME"                                   >> "$ENV_FILE"

  echo "USER_NAME=$USER_NAME"                                >> "$ENV_FILE"
  echo "USER_LASTNAME=$USER_LASTNAME"                        >> "$ENV_FILE"
  echo "USER_FULLNAME=$USER_FULLNAME"                        >> "$ENV_FILE"
 
  echo "LI_USER_API=https://lichess.org/api/games/user"      >> "$ENV_FILE"
  echo "CHESSCOM_USER_API=https://api.chess.com/pub/player"  >> "$ENV_FILE"
  echo "USER_AGENT=$APP_NAME (contact: $USER_EMAIL )"        >> "$ENV_FILE" 

  echo "FILES_PATH=$FILES_PATH"                              >> "$ENV_FILE"
  echo "SRC_PATH=$SRC_PATH"                                  >> "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  chown "$SUDO_USER:$SUDO_USER" "$ENV_FILE"


  # -- Create Database
  if [ -n $SUDO_USER ]; then
    sudo mariadb -e "CREATE DATABASE IF NOT EXISTS \`${APP_NAME}\`;"
    sudo mariadb -e "CREATE USER IF NOT EXISTS '${SUDO_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';" 
    sudo mariadb -e "GRANT ALL PRIVILEGES ON \`${APP_NAME}\`.* TO '${SUDO_USER}'@'localhost';"
    sudo mariadb -e "FLUSH PRIVILEGES;"

    # -- Import SQL schema & data
    if [ -d $APP_PATH/sql ]; then
      for sql_file in "$APP_PATH/sql"/*.sql; do
        mysql -u"${SUDO_USER}" -p"$DB_PASS" "${APP_NAME}" < "$sql_file"
        if [ $? -eq 0 ]; then
          echo "[>] Successfully imported: $sql_file"
        else
          echo "[>] Error importing :  $sql_file"
          exit 1
        fi
      done
    fi
  fi 

