#!/usr/bin/env bash

IMAGENAME="sim-telemetry"
CONTAINERNAME="${IMAGENAME}-container"
PORTS="-p 8888:8888 -p 3000:3000 -p 9999:9999"

SCRIPT_DIR=$(realpath $(dirname "$0"))
VOLUMES="-v ${SCRIPT_DIR}/web-server/odometers.json:/usr/src/app/web-server/odometers.json"
touch ${SCRIPT_DIR}/web-server/odometers.json

build(){
  if ! docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINERNAME}$"; then
    echo "Building $CONTAINERNAME"
    docker build -t "$IMAGENAME" .
  fi
}

stop(){
  docker update --restart=no $CONTAINERNAME
  docker stop $CONTAINERNAME
}

start() {
  docker run -d $PORTS $VOLUMES --network host --restart always --name "$CONTAINERNAME" "$IMAGENAME"
}

if [ "$1" == "help" ] || [ "$1" == "-h" ] || [ "$1" == "--help" ]; then
  echo "Build the docker container:"
  echo "./docker.sh: Creates container and starts right now"
  echo "./docker.sh stop: Stops the container"
  echo "./docker.sh restart: Stops the container"
  echo "./docker.sh help: Display this message"
elif [ "$1" == "stop" ]; then
  stop
elif [ "$1" == "restart" ]; then
  stop
  docker rm $CONTAINERNAME
  build
  start
elif [ "$1" == "remove" ]; then
  stop
  docker rm $CONTAINERNAME
elif [ "$1" == "enter" ]; then
  docker exec -it $CONTAINERNAME bash
else
  build
  start
fi
