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
  if [[ -z "$SUDO_USER" || "$SUDO_USER" == "root" ]]; then
    echo "Warn: Running directly as root is discouraged."
    echo "Please run this as a regular user using 'sudo'."
    exit 1
  fi

  MYHOME="$SUDO_HOME"

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
  ENGINE_PATH="/usr/local/bin/${ENGINE_NAME,,}"
  ENV_FILE="$APP_PATH/scripts/.env"

  # -- Required Packages
  REQUIRED_PKGS=("build-essential" "apache2" "php" "nodejs" "npm" "curl" "git" "openssh-server" "mariadb-server")
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

  # -- Start Apache
  sudo systemctl start apache2

  # -- Enable Apache to start on boot
  sudo systemctl enable apache2

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

  if [ -f "$ENV_FILE" ]; then
    source "$ENV_FILE"
  fi

  # -- Setting User Full Name
  if [[ -z "$USER_NAME" ]]; then
    read -p "Please enter your first name: " USER_NAME
  fi
  if [[ -z $USER_LASTNAME ]];then
    read -p "Please enter your last name: " USER_LASTNAME
  fi
  if [[ -z $USER_EMAIL ]]; then
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
  echo "USER_EMAIL=$USER_EMAIL"                              >> "$ENV_FILE"
 
  echo "LI_USER_API=https://lichess.org/api/games/user"      >> "$ENV_FILE"
  echo "CHESSCOM_USER_API=https://api.chess.com/pub/player"  >> "$ENV_FILE"
  echo "USER_AGENT=${APP_NAME}_contact:$USER_EMAIL"          >> "$ENV_FILE" 
  echo "SRC_PATH=$SRC_PATH"                                  >> "$ENV_FILE"
  echo "ENGINE_SRC_PATH=${ENGINE_SRC_PATH}"                  >> "$ENV_FILE"
  echo "ENGINE_PATH=${ENGINE_PATH}"                          >> "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  chown "$SUDO_USER:$SUDO_USER" "$ENV_FILE"

  # -- Create Database
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

  cd $APP_PATH/scripts && make

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
    sudo mv ${ENGINE_NAME,,} /usr/local/bin/

    cd "$ENGINE_SRC_PATH"
    SYMLINK="$ENGINE_SRC_PATH/current_version"
    rm -f "$SYMLINK"

    ln -s "$TARGET_DIR" "$SYMLINK"
    chown "$SUDO_USER:$SUDO_USER" "$SYMLINK"

    echo "[>] $ENGINE_NAME $VERSION installation complete" 
    
  fi   

  # -- Enabling SSH
  SERVICE="ssh"
  if systemctl is-active --quiet $SERVICE; then
    echo "[>] SSH is already running."
  else
    echo "[X] SSH is stopped. Starting it now..."
    systemctl start $SERVICE
  fi

  if systemctl is-enabled --quiet $SERVICE; then
    echo "[>] SSH is already enabled to start on boot."
  else
    echo "[X] SSH is disabled. Enabling it now..."
    systemctl enable $SERVICE
  fi

  # -- insert User in DB
  QUERY="INSERT INTO users (name, lastname) 
         SELECT '${USER_NAME}', '${USER_LASTNAME}' 
         FROM DUAL 
         WHERE NOT EXISTS (
           SELECT 1 FROM users 
           WHERE name = '${USER_NAME}' AND lastname = '${USER_LASTNAME}'
  );"

  mariadb -u "$DB_USER" -p"$DB_PASS" "$APP_NAME" -e "$QUERY"
  if [ $? -eq 0 ]; then
    echo "Process complete: Database checked and updated if necessary."
  else
    echo "Error: Failed to insert user. Please insert manually."
  fi


  # -- add cronjobs
  CURRENT_CRON=$(crontab -l 2>/dev/null)
  PROGRAM_NAME='download.lichessorg.js'
  * 1am every day
  CRON_SCHEDULE="0 1 * * *"
  CRON_JOB="$CRON_SCHEDULE cd ${APP_PATH}/scripts/ && node ${PROGRAM_NAME}"
  if echo "$CURRENT_CRON" | grep -Fq "$PROGRAM_NAME"; then
    echo "Task for '$PROGRAM_NAME' is already scheduled."
  else
    (echo "$CURRENT_CRON"; echo "$CRON_JOB") | crontab -
    echo "Successfully scheduled task for '$PROGRAM_NAME'"
  fi

  # --
  CURRENT_CRON=$(crontab -l 2>/dev/null)
  PROGRAM_NAME='download.chesscom.js'
  * 2am every day
  CRON_SCHEDULE="0 2 * * *"
  CRON_JOB="$CRON_SCHEDULE cd ${APP_PATH}/scripts/ && node ${PROGRAM_NAME}"
  if echo "$CURRENT_CRON" | grep -Fq "$PROGRAM_NAME"; then
    echo "Task for '$PROGRAM_NAME' is already scheduled."
  else
    (echo "$CURRENT_CRON"; echo "$CRON_JOB") | crontab -
    echo "Successfully scheduled task for '$PROGRAM_NAME'"
  fi

  # --
  CURRENT_CRON=$(crontab -l 2>/dev/null)
  PROGRAM_NAME='set.openingbook.js'
  * 3am every day
  CRON_SCHEDULE="0 3 * * *"
  CRON_JOB="$CRON_SCHEDULE cd ${APP_PATH}/scripts/ && node ${PROGRAM_NAME}"
  if echo "$CURRENT_CRON" | grep -Fq "$PROGRAM_NAME"; then
    echo "Task for '$PROGRAM_NAME' is already scheduled."
  else
    (echo "$CURRENT_CRON"; echo "$CRON_JOB") | crontab -
    echo "Successfully scheduled task for '$PROGRAM_NAME'"
  fi 

  # --
  CURRENT_CRON=$(crontab -l 2>/dev/null)
  PROGRAM_NAME='set.move.eval.js'
  * every hour, at *:00
  CRON_SCHEDULE="0 * * * *"
  CRON_JOB="$CRON_SCHEDULE cd ${APP_PATH}/scripts/ && node ${PROGRAM_NAME}"
  if echo "$CURRENT_CRON" | grep -Fq "$PROGRAM_NAME"; then
    echo "Task for '$PROGRAM_NAME' is already scheduled."
  else
    (echo "$CURRENT_CRON"; echo "$CRON_JOB") | crontab -
    echo "Successfully scheduled task for '$PROGRAM_NAME'"
  fi 

  # --
  CURRENT_CRON=$(crontab -l 2>/dev/null)
  PROGRAM_NAME='set.evaluation.js'
  * every hour at *:30
  CRON_SCHEDULE="30 * * * *"
  CRON_JOB="$CRON_SCHEDULE cd ${APP_PATH}/scripts/ && node ${PROGRAM_NAME}"
  if echo "$CURRENT_CRON" | grep -Fq "$PROGRAM_NAME"; then
    echo "Task for '$PROGRAM_NAME' is already scheduled."
  else
    (echo "$CURRENT_CRON"; echo "$CRON_JOB") | crontab -
    echo "Successfully scheduled task for '$PROGRAM_NAME'"
  fi 

  CURRENT_CRON=$(crontab -l 2>/dev/null)
  PROGRAM_NAME='check.engine.updates.sh'
  * 5am, 1st day of every month
  CRON_SCHEDULE="0 5 1 * *"
  CRON_JOB="$CRON_SCHEDULE sudo ${APP_PATH}/scripts/${PROGRAM_NAME}"
  if echo "$CURRENT_CRON" | grep -Fq "$PROGRAM_NAME"; then
    echo "Task for '$PROGRAM_NAME' is already scheduled."
  else
    (echo "$CURRENT_CRON"; echo "$CRON_JOB") | crontab -
    echo "Successfully scheduled task for '$PROGRAM_NAME'"
  fi 
  
  # -- done
  echo "Done."

