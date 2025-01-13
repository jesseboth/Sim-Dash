#!/usr/bin/env bash


PORT="3000"
IMAGENAME="sim-telemetry"
CONTAINERNAME="${IMAGENAME}-container"
PORTS="-p 8888:8888 -p $PORT:3000 -p 9999:9999"

SCRIPT_DIR=$(realpath $(dirname "$0"))
VOLUMES="-v ${SCRIPT_DIR}/web-server/data:/usr/src/app/web-server/data \
         -v ${SCRIPT_DIR}/telemetry/data:/usr/src/app/telemetry/data"

git update-index --assume-unchanged web-server/data/scale.json
git update-index --assume-unchanged web-server/data/config.json

function help() {
    echo -e "\033[1;34mSim Racing Dash Docker Container:\033[0m"
    echo ""
    echo -e "\033[1;33mArguments:\033[0m"
    echo -e "  \033[1;32mdaemon\033[0m    : Creates container and restarts it at boot"
    echo -e "  \033[1;32mstop\033[0m      : Stops the container"
    echo -e "  \033[1;32mrestart\033[0m   : Restarts the container"
    echo -e "  \033[1;32mlog\033[0m       : Shows Docker logs"
    echo -e "  \033[1;32mhelp\033[0m      : Display this help message"
    echo ""
    echo -e "\033[1;33mFlags:\033[0m"
    echo -e "  \033[1;36m-p\033[0m|\033[1;36m--port\033[0m : Change the port the container listens on"
    echo ""
    echo -e "\033[1;33mUsage:\033[0m"
    echo -e "  $0 \033[1;32m[argument argument ...]\033[0m \033[1;36m[flags]\033[0m"
    echo -e ""
    echo -e "  Example: \033[1;32m./docker restart daemon\033[0m \033[1;36m-p 8000\033[0m"
    echo ""
}


function print() {
    printf "\033[1m\033[38;5;27m$1\033[0m"
}

function run() {
    local err=FALSE
    # Start the long-running command in the background
    eval "$@" > /dev/null 2>&1 &
    cmd_pid=$!

    printf "\033[38;5;27m"

    while kill -0 $cmd_pid 2>/dev/null; do
        printf "."
        sleep 1
    done

    if ! wait $cmd_pid > /dev/null 2>&1; then
        printf "\033[0;31mError"
        err=TRUE
    fi

    printf "\033[0m\n"

    if [ $err == TRUE ]; then
        exit 1
    fi
}

BUILD=FALSE
STOP=FALSE
LOG=FALSE
DAEMON=FALSE
if [ ! $# -gt 0 ]; then
    help
    exit 1
fi
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help|help)
            help
            exit 0
        ;;
        stop)
            STOP=TRUE
            shift
        ;;
        restart)
            STOP=TRUE
            BUILD=TRUE
            shift
        ;;
        start)
            BUILD=TRUE
            shift
        ;;
        daemon)
            BUILD=TRUE
            DAEMON=TRUE
            shift
        ;;
        log|logs)
            LOG=TRUE
            shift
        ;;
        -p|--port)
            PORT=$2
            shift
            shift
        ;;
        *)
            echo "Unknown option: $1"
            help
            exit 1
        ;;
    esac
done

if [ $STOP == TRUE ]; then
  if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINERNAME}$"; then
    print "Stopping container"
    run " docker update --restart=no $CONTAINERNAME; docker stop $CONTAINERNAME; docker rm $CONTAINERNAME"
  fi
fi

if [ $BUILD == TRUE ]; then
  if ! docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINERNAME}$"; then
    print "Building container"
    run docker build -t $IMAGENAME .
  fi
fi

if [ $DAEMON == TRUE ]; then
    print "Starting daemon container"
    run docker run -d $PORTS $VOLUMES --network host --restart always --name "$CONTAINERNAME" "$IMAGENAME"
    print "\nContainer running on port $PORT\n"
elif [ $BUILD = TRUE ]; then
    print "Starting container"
    run docker run -d $PORTS $VOLUMES --network host --name "$CONTAINERNAME" "$IMAGENAME"
    print "\nContainer running on port $PORT\n"
fi

if [ $LOG == TRUE ]; then
    print "Showing logs\n"
    docker logs -f "$CONTAINERNAME"
fi
