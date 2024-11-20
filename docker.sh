#!/usr/bin/env bash

IMAGENAME="sim-telemetry"
CONTAINERNAME="${IMAGENAME}-container"
PORTS="-p 8888:8888 -p 3000:3000 -p 9999:9999"

SCRIPT_DIR=$(realpath $(dirname "$0"))
VOLUMES="-v ${SCRIPT_DIR}/web-server/data:/usr/src/app/web-server/data \
         -v ${SCRIPT_DIR}/telemetry/data:/usr/src/app/telemetry/data"

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

newJsonFile() {
  if [ -f ${SCRIPT_DIR}/$1 ]; then
    return
  fi

  touch ${SCRIPT_DIR}/$1
  echo "{}" > $1
}

newScaleFile() {
  if [ -f ${SCRIPT_DIR}/$1 ]; then
    return
  fi

  touch ${SCRIPT_DIR}/$1
echo '{
      "default": {
        "top": 0,
        "zoom": 100
    }
}' > $1
}


start() {
  newJsonFile web-server/data/odometers.json
  newScaleFile web-server/data/scale.json
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
elif [ "$1" == "logs" ]; then
  docker logs -f $CONTAINERNAME
else
  build
  start
fi
